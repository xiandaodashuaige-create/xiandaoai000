import { writeFile } from 'node:fs/promises';
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';
import { experimental_generateSpeech as generateSpeech } from 'ai';
import { createGateway } from '@ai-sdk/gateway';
import { isEnglishJob, voiceRulesFor } from './_cloud-industry.mjs';

export { isEnglishJob };

// Same voices and rates as the local worker (worker/video_agent_worker.mjs).
export const VOICES = {
  english: { voice: 'en-US-JennyNeural', rate: '+8%', language: 'en-US' },
  chinese: { voice: 'zh-HK-HiuMaanNeural', rate: '+4%', language: 'zh-HK' },
};
const MIN_AUDIO_BYTES = 1024;
const DEFAULT_TIMEOUT_MS = 60_000;

// Same voice and rate rules as the local worker, including the male/female
// Cantonese switch requested through the revision prompt.
export function voiceFor(job) {
  const { english, voice, rate } = voiceRulesFor(job);
  const mandarin = !english && /普通话|普通話|华语|華語|Mandarin|zh-CN/i.test(String(job?.brief || '')) && !/香港粤语|香港粵語|Cantonese/i.test(String(job?.brief || ''));
  return { voice: mandarin ? 'zh-CN-XiaoxiaoNeural' : voice, rate, language: english ? 'en-US' : mandarin ? 'zh-CN' : 'zh-HK' };
}

export function gatewaySpeechConfigured(env = process.env) {
  return String(env.AI_MEDIA_GENERATION_ENABLED).toLowerCase() === 'true' && Boolean(env.AI_GATEWAY_API_KEY || env.VERCEL_OIDC_TOKEN);
}

export function createGatewaySynthesizer({ env = process.env, fetcher = fetch, speechGenerator = generateSpeech, gatewayFactory = createGateway } = {}) {
  return async ({ text, voice, rate }) => {
    if (!gatewaySpeechConfigured(env)) throw new Error('cloud_tts_not_configured');
    const token = env.AI_GATEWAY_API_KEY || env.VERCEL_OIDC_TOKEN;
    const gateway = gatewayFactory({ apiKey: token, fetch: fetcher, ...(!env.AI_GATEWAY_API_KEY ? { headers: { 'ai-gateway-auth-method': 'oidc' } } : {}) });
    const language = voice.startsWith('en-') ? 'natural English' : voice.startsWith('zh-CN') ? 'natural Mandarin Chinese' : 'natural Hong Kong Cantonese, not Mandarin';
    const result = await speechGenerator({
      model: gateway.speechModel(env.AI_GATEWAY_TTS_MODEL || 'google/gemini-3.8-flash-tts'),
      text, voice: /WanLung/.test(voice) ? 'Charon' : 'Kore', outputFormat: 'wav',
      instructions: `Read only the provided text in ${language}. One consistent adult speaker, warm and clear commercial delivery, conversational rhythm, no music or sound effects.`,
      speed: 1 + (Number.parseFloat(rate) || 0) / 100,
      maxRetries: 0, abortSignal: AbortSignal.timeout(55_000),
    });
    return Buffer.from(result.audio.uint8Array);
  };
}

// Scene copy is joined into one short narration. Characters that could
// break SSML are removed; the narration is plain text only.
export function narrationFor(scenes) {
  return scenes
    .flatMap((scene) => (scene.vo ? [scene.vo] : [scene.title, scene.subtitle]))
    .filter((line) => typeof line === 'string' && line.trim())
    .map((line) => line.replace(/[<>&"'`]/g, ' ').trim())
    .join('。');
}

async function defaultSynthesize({ text, voice, rate }) {
  const tts = new MsEdgeTTS();
  await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);
  const { audioStream } = tts.toStream(text, { rate });
  const chunks = [];
  for await (const chunk of audioStream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

// Never throws. A failed or empty synthesis returns { ok: false, reason }
// so the caller can render without voice and say so, instead of claiming one.
export async function synthesizeVoiceover({
  text, voice, rate, outputPath,
  synthesize = defaultSynthesize,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}) {
  if (!text || !text.trim()) return { ok: false, reason: 'empty_narration' };
  let timer;
  try {
    const audio = await Promise.race([
      synthesize({ text, voice, rate }),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('tts_timeout')), timeoutMs);
      }),
    ]);
    if (!audio || audio.length < MIN_AUDIO_BYTES) {
      return { ok: false, reason: 'tts_empty_audio' };
    }
    await writeFile(outputPath, audio);
    return { ok: true, path: outputPath, bytes: audio.length };
  } catch (error) {
    return { ok: false, reason: String(error?.message || error).slice(0, 120) };
  } finally {
    clearTimeout(timer);
  }
}

// Uploaded voiceover always wins. Only when none was uploaded do we
// synthesize, and the result says which source was used.
export async function resolveVoiceover({ uploadedVoice, job, scenes, outputPath, synthesize, timeoutMs }) {
  if (uploadedVoice) return { voice: uploadedVoice, voiceSource: 'uploaded', voiceError: null };
  const { voice, rate } = voiceFor(job);
  const result = await synthesizeVoiceover({
    text: narrationFor(scenes), voice, rate, outputPath, synthesize, timeoutMs,
  });
  return result.ok
    ? { voice: result.path, voiceSource: 'tts', voiceError: null }
    : { voice: null, voiceSource: 'none', voiceError: result.reason };
}

// Local worker rule: a scene lasts at least its template time, and at least
// its own voiceover plus a short tail (6.8s voice -> 7.1s scene).
export const VOICE_TAIL_SECONDS = 0.3;
export function fitSecondsToVoice(baseSeconds, voiceSeconds) {
  if (!(voiceSeconds > 0)) return baseSeconds;
  return Math.max(baseSeconds, Math.round((voiceSeconds + VOICE_TAIL_SECONDS) * 10) / 10);
}
