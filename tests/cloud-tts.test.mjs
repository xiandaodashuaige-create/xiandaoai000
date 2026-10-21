import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  narrationFor, voiceFor, synthesizeVoiceover, resolveVoiceover,
} from '../api/_cloud-tts.mjs';

const dir = () => mkdtempSync(path.join(tmpdir(), 'tts-test-'));
const bigAudio = Buffer.alloc(4096, 1);
const SCENES = [
  { kicker: 'k', title: '先别划走', subtitle: '这一次，看真实过程' },
  { kicker: 'k', title: 'A <b>&</b> "B"', subtitle: '现场画面' },
];

test('narration joins scene copy and strips SSML-breaking characters', () => {
  const text = narrationFor(SCENES);
  assert.equal(text, '先别划走。这一次，看真实过程。A  b   /b   B。现场画面');
  assert.doesNotMatch(text, /[<>&"'`]/);
});

test('voice follows the job language, defaulting to Chinese HK like the local worker', () => {
  assert.equal(voiceFor({ language: 'en-US' }).voice, 'en-US-JennyNeural');
  assert.equal(voiceFor({ locale: 'en-SG' }).voice, 'en-US-JennyNeural');
  assert.equal(voiceFor({}).voice, 'zh-HK-HiuMaanNeural');
  assert.equal(voiceFor({}).rate, '+4%');
});

test('successful synthesis writes the audio file and reports the path', async () => {
  const outputPath = path.join(dir(), 'vo.mp3');
  const result = await synthesizeVoiceover({
    text: 'hi', voice: 'v', rate: '+0%', outputPath,
    synthesize: async () => bigAudio,
  });
  assert.equal(result.ok, true);
  assert.equal(readFileSync(outputPath).length, bigAudio.length);
});

test('empty or near-empty audio is a failure, never a silent success', async () => {
  const result = await synthesizeVoiceover({
    text: 'hi', voice: 'v', rate: '+0%', outputPath: path.join(dir(), 'x.mp3'),
    synthesize: async () => Buffer.alloc(10),
  });
  assert.deepEqual(result, { ok: false, reason: 'tts_empty_audio' });
});

test('a thrown error becomes a reason instead of crashing the render', async () => {
  const result = await synthesizeVoiceover({
    text: 'hi', voice: 'v', rate: '+0%', outputPath: path.join(dir(), 'x.mp3'),
    synthesize: async () => { throw new Error('network down'); },
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'network down');
});

test('a hung synthesis times out', async () => {
  const result = await synthesizeVoiceover({
    text: 'hi', voice: 'v', rate: '+0%', outputPath: path.join(dir(), 'x.mp3'),
    synthesize: () => new Promise(() => {}),
    timeoutMs: 20,
  });
  assert.deepEqual(result, { ok: false, reason: 'tts_timeout' });
});

test('an uploaded voiceover always wins and synthesis is never called', async () => {
  let called = false;
  const out = await resolveVoiceover({
    uploadedVoice: '/tmp/uploaded.mp3', job: {}, scenes: SCENES,
    outputPath: path.join(dir(), 'x.mp3'),
    synthesize: async () => { called = true; return bigAudio; },
  });
  assert.deepEqual(out, { voice: '/tmp/uploaded.mp3', voiceSource: 'uploaded', voiceError: null });
  assert.equal(called, false);
});

test('without an upload, synthesized voice is used and labelled as tts', async () => {
  const out = await resolveVoiceover({
    uploadedVoice: undefined, job: { language: 'en' }, scenes: SCENES,
    outputPath: path.join(dir(), 'x.mp3'),
    synthesize: async ({ voice }) => { assert.equal(voice, 'en-US-JennyNeural'); return bigAudio; },
  });
  assert.equal(out.voiceSource, 'tts');
  assert.equal(out.voiceError, null);
});

test('if synthesis fails, the render continues without voice and says so', async () => {
  const out = await resolveVoiceover({
    uploadedVoice: undefined, job: {}, scenes: SCENES,
    outputPath: path.join(dir(), 'x.mp3'),
    synthesize: async () => { throw new Error('edge_unreachable'); },
  });
  assert.deepEqual(out, { voice: null, voiceSource: 'none', voiceError: 'edge_unreachable' });
});

test('cloud speech uses the deployed Gateway identity and one dialect-specific voice', async () => {
  const { createGatewaySynthesizer, gatewaySpeechConfigured } = await import('../api/_cloud-tts.mjs');
  assert.equal(gatewaySpeechConfigured({ VERCEL_OIDC_TOKEN:'x' }),false);
  let config; const requests=[];
  const synth=createGatewaySynthesizer({env:{AI_MEDIA_GENERATION_ENABLED:'true',VERCEL_OIDC_TOKEN:'test'},
    gatewayFactory:(value)=>{config=value;return {speechModel:(id)=>({id})};},
    speechGenerator:async(value)=>{requests.push(value);return {audio:{uint8Array:new Uint8Array(4096)}};},
  });
  assert.equal((await synth({text:'歡迎預約',voice:'zh-HK-HiuMaanNeural',rate:'+4%'})).length,4096);
  await synth({text:'欢迎参加',voice:'zh-CN-XiaoxiaoNeural',rate:'+4%'});
  assert.equal(config.headers['ai-gateway-auth-method'],'oidc');
  assert.equal(requests[0].model.id,'google/gemini-3.8-flash-tts');
  assert.equal(requests[0].voice,requests[1].voice);
  assert.match(requests[0].instructions,/Cantonese, not Mandarin/);
  assert.match(requests[1].instructions,/Mandarin Chinese/);
  assert.equal(requests[0].maxRetries,0);
  assert.equal(voiceFor({brief:'语言：马来西亚华语'}).language,'zh-CN');
  assert.equal(voiceFor({brief:'语言：香港粤语'}).language,'zh-HK');
});

test('current request language overrides the stored project default',()=>{
  const brief='语言：香港粤语\n【本次制作需求】\n语言声音：马来西亚华语，真人自然节奏';
  assert.equal(voiceFor({brief}).language,'zh-CN');
  assert.equal(voiceFor({brief:brief.replace('马来西亚华语','English')}).language,'en-US');
});

test('male and alternate voice revisions select distinct supported speakers',async()=>{
  const { createGatewaySynthesizer }=await import('../api/_cloud-tts.mjs');
  const male=voiceFor({brief:'语言：普通话',revision_scope:'voice',revision_prompt:'改成男声'});
  assert.equal(male.voice,'zh-CN-YunxiNeural');
  const alternate=voiceFor({brief:'语言：香港粤语',revision_scope:'voice',revision_prompt:'換個聲音'});
  assert.equal(alternate.voice,'zh-HK-HiuGaaiNeural');
  assert.equal(voiceFor({brief:'语言：香港粤语',revision_scope:'voice',revision_prompt:'改成普通话'}).language,'zh-CN');
  const requests=[];
  const synth=createGatewaySynthesizer({env:{AI_MEDIA_GENERATION_ENABLED:'true',VERCEL_OIDC_TOKEN:'fixture'},gatewayFactory:()=>({speechModel:id=>({id})}),speechGenerator:async options=>{requests.push(options);return {audio:{uint8Array:new Uint8Array(2048)}};}});
  await synth({text:'测试',...male}); await synth({text:'測試',...alternate});
  assert.equal(requests[0].voice,'Charon'); assert.equal(requests[1].voice,'Aoede');
});
