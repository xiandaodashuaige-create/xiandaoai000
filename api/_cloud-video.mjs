import { spawn } from 'node:child_process';
import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import ffmpegPath from 'ffmpeg-static';
import { synthesizeVoiceover, voiceFor, fitSecondsToVoice, isEnglishJob, createGatewaySynthesizer, gatewaySpeechConfigured } from './_cloud-tts.mjs';
import { englishStoryboard, industryStoryboard, inferIntent } from './_cloud-industry.mjs';
import sharp from 'sharp';
import { prepareAiHybridAssets } from './_cloud-media-providers.mjs';
import { planRemix } from './_cloud-remix.mjs';

// Output is 1080x1920 to match the local worker. Overlay layout is authored
// at 720 and scaled by K so both paths keep the same proportions.
const WIDTH = 1080;
const HEIGHT = 1920;
const K = WIDTH / 720;
const px = (value) => Math.round(value * K);
// Same loudness as the local worker's voice and final mix (EBU R128 -16 LUFS).
const LOUDNESS = { I: -16, TP: -1.5, LRA: 11 };
const FPS = 30; // local worker renders 30fps
const SEGMENT_SECONDS = 5;
const MIN_VIDEO_KBPS = 800;
const FONT_PATH = '/tmp/NotoSansSC.ttf';
const FONT_URL = 'https://raw.githubusercontent.com/google/fonts/main/ofl/notosanssc/NotoSansSC%5Bwght%5D.ttf';

function run(args, cwd) {
  return new Promise((resolve, reject) => {
    const process = spawn(ffmpegPath, args, { cwd });
    let output = '';
    process.stderr.on('data', (chunk) => { output += chunk.toString(); });
    process.on('error', reject);
    process.on('close', (code) => code === 0
      ? resolve(output)
      : reject(new Error(`ffmpeg_${code}_${output.slice(-1600)}`)));
  });
}

function parseDuration(log) {
  const match = String(log || '').match(/Duration:\s*(\d+):(\d+):([\d.]+)/);
  return match ? Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) : 0;
}

async function sourceDuration(file) {
  try {
    return parseDuration(await run(['-hide_banner', '-i', file], path.dirname(file)));
  } catch (error) {
    return parseDuration(error);
  }
}

// Same start points as the local worker: 3%, 22%, 42%, 61%, 78% of the clip.
export function sceneStarts(duration, scenes) {
  return scenes.map((scene, index) => {
    const x = [0.03, 0.22, 0.42, 0.61, 0.78][index % 5];
    const latest = Math.max(0, duration - (scene.seconds ?? SEGMENT_SECONDS) - 0.2);
    return duration > 0 ? Math.min(latest, duration * x) : 0;
  });
}

async function sourceHasAudio(file) {
  try {
    const output = await run(['-hide_banner', '-i', file, '-f', 'null', '-t', '0.05', '-'], path.dirname(file));
    return /Audio:/.test(output);
  } catch (error) {
    return /Audio:/.test(String(error));
  }
}

// Industry copy and the five-beat storyboard come from _cloud-industry.mjs,
// ported from the local worker. An explicit hook or CTA written in the brief
// is kept as the first or last beat title, so operator wording is not lost.
function briefBlock(brief, pattern) {
  const value = String(brief || '').match(pattern)?.[1] || '';
  return value.split(/\s+(?=\d+\.\s*AI生成)/)[0].trim();
}

// Unknown businesses must use their own project facts rather than the legacy
// Cantonese treatment template. Keep known industry storyboards unchanged.
function contextualStoryboard(job, scenes, brief) {
  if (isEnglishJob(job) || inferIntent(job) !== 'generic_service') return scenes;
  const project = brief.split('【本次制作需求】')[0];
  const field = (text, labels) => text.match(new RegExp(`^(?:${labels})[：:]\\s*([^\\n]+)`, 'm'))?.[1]?.trim() || '';
  const topic = field(project, '项目|項目') || field(brief, '业务主题|業務主題|业务类型|業務類型');
  if (!topic) return scenes;
  const facts = project.match(/^准确价格\/优惠\/事实[：:]([\s\S]*?)(?=^行动引导[：:]|^语言[：:]|(?![\s\S]))/m)?.[1] || '';
  const description = project.match(/^业务说明[：:]([\s\S]*?)(?=^目标客户[：:]|^准确价格|(?![\s\S]))/m)?.[1] || '';
  const price = (facts + '\n' + description).match(/(?:RM|HK\$|S\$|SGD|USD|RMB|¥|\$)\s*\d+(?:[.,]\d+)?/i)?.[0] || '';
  const action = field(brief.split('【本次制作需求】').at(-1), '客户行动|客戶行動') || field(project, '行动引导|行動引導');
  const validAction = action && !/^(未填写|未填寫|无|無)$/.test(action) ? action : '';
  const mandarin = voiceFor(job).language === 'zh-CN';
  const training = /培训|培訓|课程|課程|实战课|實戰課/.test(topic + field(brief, '业务主题|業務主題|业务类型|業務類型'));
  const duration = (facts + '\n' + description).match(/\d+(?:\.\d+)?\s*(?:小时|小時)/)?.[0];
  const points = [...(facts + '\n' + description).matchAll(/✅\s*([^\n✅]+)/g)].map((m) => m[1].trim()).slice(0, 3);
  const title = topic.slice(0, 36);
  const hook = training
    ? `${duration || '现场'}实操\n${title}`
    : `${title}\n${mandarin ? '先了解，再决定' : '先了解，再決定'}`;
  const hookVo = training
    ? `想了解${topic}？${duration ? duration + '线下实操，' : ''}先看看现场内容，再决定是否报名。`
    : mandarin ? `想了解${topic}？先看看真实内容，再决定。` : `想了解${topic}？先睇下實際內容，再決定。`;
  const cards = training && points.length === 3 ? points : mandarin ? ['了解项目内容', '查看真实过程', 'WhatsApp了解详情'] : ['了解項目內容', '睇實際過程', 'WhatsApp了解詳情'];
  const middleVo = training && points.length ? `现场内容包括${points.join('、')}。` : mandarin ? `这里展示${topic}的真实资料，你可以先了解实际内容。` : `呢度係${topic}嘅實際資料，你可以先了解清楚內容。`;
  const cta = validAction || (training ? 'WhatsApp了解报名' : mandarin ? 'WhatsApp了解详情' : 'WhatsApp了解詳情');
  const button = training ? 'WhatsApp 报名' : /预约|預約/.test(cta) ? (mandarin ? 'WhatsApp 预约' : 'WhatsApp 預約') : 'WhatsApp 了解';
  return scenes.map((scene, i) => ({ ...scene, ...[
    { kicker: mandarin ? '先看这里' : '先睇呢度', title: hook, subtitle: hookVo, vo: hookVo },
    { kicker: mandarin ? '项目内容' : '項目內容', cards, positiveCards: true, vo: cards.join('、') + '。' },
    { kicker: mandarin ? '真实资料' : '實際資料', title, subtitle: middleVo, vo: middleVo },
    { messages: [`你好，想了解${title}`, cta], subtitle: cta, vo: cta },
    { kicker: mandarin ? '了解详情' : '了解詳情', title: [title, price].filter(Boolean).join('\n'), button, subtitle: cta, vo: [price, cta].filter(Boolean).join('，') },
  ][i] }));
}

export function copyFor(job) {
  const brief = String(job.brief || '').replaceAll('\\n', '\n');
  const scenes = contextualStoryboard(job, isEnglishJob(job) ? englishStoryboard(job) : industryStoryboard(job), brief);
  const hook = briefBlock(brief, /1\. AI生成开头 Hook[：:]([^\n]+)/);
  const cta = briefBlock(brief, /3\. AI生成结尾 CTA[：:]([^\n]+)/);
  // UI structure instructions are not customer-facing advertising copy.
  const instruction = /由系统|由系統|根据准确|根據準確|前三秒必须|前三秒必須|最后一秒|最後一秒|生成清晰行动引导|生成清晰行動引導/;
  if (hook && !instruction.test(hook)) scenes[0] = { ...scenes[0], title: hook, subtitle: hook, vo: hook };
  if (cta && !instruction.test(cta)) scenes[scenes.length - 1] = { ...scenes.at(-1), title: cta, subtitle: cta, vo: cta };
  return scenes;
}

export function selectSceneSources(inputs) {
  const visuals = inputs.filter((item) => /^(video|image)\//.test(String(item.type || '')) && item.role !== 'reference' && item.role !== 'character_reference');
  const byRole = (role) => visuals.filter((item) => item.role === role);
  const generated = byRole('ai_generated');
  const hook = [...byRole('ai_hook'), ...generated, ...byRole('asset'), ...byRole('main')];
  const proof = [...byRole('main'), ...byRole('case_proof'), ...byRole('asset')];
  const cta = [...byRole('ai_cta'), ...generated.slice(1), ...generated, ...byRole('asset'), ...byRole('main')];
  if (!visuals.length) return [];
  const pick = (pool, index = 0) => pool[index % Math.max(1, pool.length)] || visuals[index % visuals.length];
  return [pick(hook), pick(proof, 0), pick(proof, 1), pick(proof, 2), pick(cta)].filter(Boolean);
}

async function ensureFont() {
  try { await access(FONT_PATH); return FONT_PATH; } catch {}
  const response = await fetch(FONT_URL);
  if (!response.ok) throw new Error(`font_download_${response.status}`);
  await writeFile(FONT_PATH, Buffer.from(await response.arrayBuffer()));
  return FONT_PATH;
}

function textImage(text, fontFile, width, fontSize, color, weight = 700, align = 'left') {
  const escaped = String(text || '').replace(/[&<>"']/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&apos;' })[char]);
  return sharp({ text: { text: `<span foreground="${color}" font_weight="${weight}">${escaped}</span>`, font: `Noto Sans SC ${fontSize}`, fontfile: fontFile, width, rgba: true, wrap: 'word-char', spacing: Math.round(fontSize * .16), align } })
    .png()
    .toBuffer();
}

// Overlay coordinates are authored on a 720x1280 grid and scaled with px().
// Templates follow the local worker: big text hook, pain cards, WhatsApp
// chat bubbles, and a CTA button.
export async function overlayPng(scene, output) {
  const fontFile = await ensureFont();
  const template = scene.template || 'big_text_hook';
  const shapes = [];
  const composites = [];
  const pad = px(24);
  const text = async (value, width, size, color, weight, align = 'left') => {
    if (!value) return null;
    const image = await textImage(value, fontFile, width, size, color, weight, align);
    const meta = await sharp(image).metadata();
    return { image, width: meta.width || 0, height: meta.height || 0 };
  };

  // Pain cards: white cards with a red cross, as in the local worker.
  if (template === 'pain_cards') {
    let y = px(520);
    for (const card of scene.cards || []) {
      const t = await text(card, px(500), px(36), '#1a1a1a', 700);
      if (!t) continue;
      const h = Math.max(t.height, px(44)) + pad * 2;
      const cy = y + h / 2;
      shapes.push(`<rect x="${px(60)}" y="${y}" width="${px(600)}" height="${h}" rx="${px(18)}" fill="#ffffff" fill-opacity=".95"/>`);
      shapes.push(`<circle cx="${px(100)}" cy="${cy}" r="${px(20)}" fill="${scene.positiveCards ? '#16883e' : '#e53935'}"/>`);
      const marker = scene.positiveCards
        ? `M${px(89)} ${cy} L${px(97)} ${cy + px(8)} L${px(112)} ${cy - px(9)}`
        : `M${px(91)} ${cy - px(9)} L${px(109)} ${cy + px(9)} M${px(109)} ${cy - px(9)} L${px(91)} ${cy + px(9)}`;
      shapes.push(`<path d="${marker}" fill="none" stroke="#ffffff" stroke-width="${px(4)}" stroke-linecap="round"/>`);
      composites.push({ input: t.image, top: y + pad, left: px(140) });
      y += h + px(22);
    }
  }
  // WhatsApp chat: a phone frame with a chat screen, as in the local worker.
  if (template === 'whatsapp_chat') {
    shapes.push(`<rect x="${px(130)}" y="${px(420)}" width="${px(460)}" height="${px(860)}" rx="${px(48)}" fill="#111111"/>`);
    shapes.push(`<rect x="${px(146)}" y="${px(452)}" width="${px(428)}" height="${px(796)}" rx="${px(30)}" fill="#e5ddd5"/>`);
    shapes.push(`<rect x="${px(146)}" y="${px(452)}" width="${px(428)}" height="${px(84)}" rx="${px(30)}" fill="#075e54"/>`);
    const header = await text('新客人', px(300), px(34), '#ffffff', 700);
    if (header) composites.push({ input: header.image, top: px(470), left: px(200) });
    let y = px(580);
    for (const [index, message] of (scene.messages || []).entries()) {
      const t = await text(message, px(290), px(28), index % 2 ? '#00130b' : '#111111', 500);
      if (!t) continue;
      const w = t.width + pad * 2;
      const h = t.height + pad * 2;
      const left = index % 2 ? px(146) + px(428) - px(14) - w : px(160);
      shapes.push(`<rect x="${left}" y="${y}" width="${w}" height="${h}" rx="${px(18)}" fill="${index % 2 ? '#dcf8c6' : '#ffffff'}"/>`);
      composites.push({ input: t.image, top: y + pad, left: left + pad });
      y += h + px(18);
    }
  }
  // CTA: gold offer card with a dark pill and a green WhatsApp button, as in
  // the local worker. The first line of the copy is the offer, the second the
  // call to action.
  if (template === 'cta_offer') {
    const [line1 = '', line2 = ''] = String(scene.title || '').split('\n');
    const offer = await text(line1, px(540), px(60), '#3a2a10', 900, 'centre');
    const action = await text(line2, px(460), px(34), '#f6e7b5', 800, 'centre');
    const label = await text(scene.button || 'WhatsApp 預約', px(380), px(36), '#ffffff', 800, 'centre');
    // Stack offer, pill and button from the measured text height so a wrapped
    // offer line never runs underneath the pill (was clipping "S$98").
    const offerTop = px(750);
    const pillH = px(72);
    const buttonH = px(92);
    const pillTop = Math.max(px(880), offerTop + (offer ? offer.height : 0) + px(14));
    const cardTop = px(720);
    const cardBottom = pillTop + pillH + px(24);
    const buttonTop = cardBottom + px(40);
    shapes.push(`<rect x="${px(70)}" y="${cardTop}" width="${px(580)}" height="${cardBottom - cardTop}" rx="${px(36)}" fill="url(#gold)"/>`);
    if (offer) composites.push({ input: offer.image, top: offerTop, left: px(90) });
    if (action) {
      shapes.push(`<rect x="${px(110)}" y="${pillTop}" width="${px(500)}" height="${pillH}" rx="${px(36)}" fill="#1f1606"/>`);
      composites.push({ input: action.image, top: pillTop + Math.round((pillH - action.height) / 2), left: px(130) });
    }
    shapes.push(`<rect x="${px(150)}" y="${buttonTop}" width="${px(420)}" height="${buttonH}" rx="${px(46)}" fill="#25d366"/>`);
    if (label) composites.push({ input: label.image, top: buttonTop + Math.round((buttonH - label.height) / 2), left: px(170) });
  }

  // Main title: centred, bold, with a dark shadow for legibility.
  const title = template === 'cta_offer' ? null : await text(scene.title, px(624), px(58), '#ffffff', 800, 'centre');
  const titleTop = title ? Math.max(px(760), px(1000) - title.height) : 0;
  if (title) {
    const shadow = await text(scene.title, px(624), px(58), '#000000', 800, 'centre');
    composites.push({ input: shadow.image, top: titleTop + px(3), left: px(48) + px(3) });
    composites.push({ input: title.image, top: titleTop, left: px(48) });
  }
  // Subtitle sits in a translucent caption bar, as in the local worker.
  const subtitle = scene.showSubtitle === false || template === 'cta_offer' ? null : await text(scene.subtitle, px(600), px(28), '#ffffff', 500, 'centre');
  if (subtitle) {
    const top = px(1100);
    shapes.push(`<rect x="${px(40)}" y="${top - pad}" width="${px(640)}" height="${subtitle.height + pad * 2}" rx="${px(14)}" fill="#000000" fill-opacity=".55"/>`);
    composites.push({ input: subtitle.image, top, left: px(60) });
  }

  const svg = Buffer.from(`<svg width="${WIDTH}" height="${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
    <defs><linearGradient id="gold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f4e2a8"/><stop offset=".5" stop-color="#c9a24e"/><stop offset="1" stop-color="#f1d98c"/></linearGradient><linearGradient id="shade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000000" stop-opacity="0"/><stop offset=".5" stop-color="#000000" stop-opacity=".15"/><stop offset="1" stop-color="#000000" stop-opacity=".6"/></linearGradient></defs>
    <rect width="100%" height="100%" fill="url(#shade)"/>
    ${shapes.join('\n')}
  </svg>`);
  await sharp(svg).composite(composites).png().toFile(output);
}

export async function normalizeSegment({ source, type, overlay, output, seconds = SEGMENT_SECONDS, start = 0, loop = false }) {
  const isImage = String(type || '').startsWith('image/');
  const hasAudio = !isImage && await sourceHasAudio(source);
  // Seek before the input so each scene starts at its own point in the footage.
  const input = isImage
    ? ['-loop', '1', '-framerate', String(FPS), '-i', source]
    : [...(loop ? ['-stream_loop', '-1'] : []), ...(start > 0 ? ['-ss', start.toFixed(2)] : []), '-i', source];
  const audioInput = hasAudio ? [] : ['-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000'];
  const overlayIndex = hasAudio ? 1 : 2;
  const baseFilter = isImage
    ? `[0:v]scale=${WIDTH * 2}:${HEIGHT * 2}:force_original_aspect_ratio=increase,crop=${WIDTH * 2}:${HEIGHT * 2},zoompan=z='min(zoom+0.0008,1.08)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${Math.ceil(seconds * FPS)}:s=${WIDTH}x${HEIGHT}:fps=${FPS},setsar=1[base]`
    : `[0:v]scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=increase,crop=${WIDTH}:${HEIGHT},fps=${FPS},setsar=1[base]`;
  const videoFilter = `${baseFilter};[base][${overlayIndex}:v]overlay=0:0:format=auto[v]`;
  const audioMap = hasAudio ? '0:a:0' : '1:a:0';
  await run([
    '-y', ...input, ...audioInput, '-i', overlay,
    '-filter_complex', videoFilter, '-map', '[v]', '-map', audioMap,
    '-t', String(seconds), '-shortest', '-c:v', 'libx264', '-preset', 'medium', '-crf', '12', '-maxrate', '16M', '-bufsize', '32M',
    '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-ar', '48000', '-ac', '2', output,
  ], path.dirname(output));
}

async function mixAudio(video, voice, bgm, output) {
  if (!voice && !bgm) return video;
  const inputs = ['-i', video];
  if (voice) inputs.push('-i', voice);
  if (bgm) inputs.push('-stream_loop', '-1', '-i', bgm);
  let filter;
  if (voice && bgm) filter = '[0:a]volume=.18[a0];[1:a]volume=1.25[a1];[2:a]volume=.10[a2];[a0][a1][a2]amix=inputs=3:duration=first:dropout_transition=2[a]';
  else if (voice) filter = '[0:a]volume=.16[a0];[1:a]volume=1.2[a1];[a0][a1]amix=inputs=2:duration=first:dropout_transition=2[a]';
  else filter = '[0:a]volume=.70[a0];[1:a]volume=.12[a1];[a0][a1]amix=inputs=2:duration=first:dropout_transition=2[a]';
  await run(['-y', ...inputs, '-filter_complex', filter, '-map', '0:v:0', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k', '-shortest', output], path.dirname(output));
  return output;
}

export async function normalizeLoudness(input, output) {
  await run(['-y', '-i', input, '-map', '0:v:0', '-map', '0:a:0', '-c:v', 'copy',
    '-af', `loudnorm=I=${LOUDNESS.I}:TP=${LOUDNESS.TP}:LRA=${LOUDNESS.LRA}`,
    '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-movflags', '+faststart', output], path.dirname(output));
  return output;
}

export async function inspectRender(file, expectedDuration) {
  const log = await run(['-hide_banner', '-i', file, '-af', 'ebur128=peak=true', '-f', 'null', '-'], path.dirname(file));
  const video = log.match(/Video:[^\n]*?\b(\d{2,5})x(\d{2,5})\b[^\n]*?(\d+(?:\.\d+)?)\s*fps/);
  const bitrate = Number(log.match(/Duration:[^\n]*bitrate:\s*(\d+)\s*kb\/s/)?.[1] || 0);
  const summary = log.split('Summary:').at(-1) || '';
  const loudness = Number(summary.match(/I:\s*(-?[\d.]+)\s*LUFS/)?.[1]);
  const truePeak = Number(summary.match(/Peak:\s*(-?[\d.]+)\s*dBFS/)?.[1]);
  const metadata = {
    durationSeconds: parseDuration(log),
    width: Number(video?.[1] || 0),
    height: Number(video?.[2] || 0),
    fps: Number(video?.[3] || 0),
    bitrateKbps: bitrate,
    loudnessLUFS: Number.isFinite(loudness) ? loudness : null,
    truePeakDBTP: Number.isFinite(truePeak) ? truePeak : null,
  };
  const failures = [];
  if (metadata.width !== WIDTH || metadata.height !== HEIGHT) failures.push(`resolution_${metadata.width}x${metadata.height}`);
  if (Math.abs(metadata.fps - FPS) >= 0.5) failures.push(`fps_${metadata.fps}`);
  if (Math.abs(metadata.durationSeconds - expectedDuration) > 1) failures.push(`duration_${metadata.durationSeconds}`);
  if (metadata.bitrateKbps < MIN_VIDEO_KBPS) failures.push(`bitrate_${metadata.bitrateKbps}`);
  if (metadata.loudnessLUFS === null || metadata.loudnessLUFS < -17 || metadata.loudnessLUFS > -11) failures.push(`loudness_${metadata.loudnessLUFS}`);
  if (metadata.truePeakDBTP === null || metadata.truePeakDBTP > -1) failures.push(`true_peak_${metadata.truePeakDBTP}`);
  if (failures.length) throw new Error(`cloud_render_quality_failed:${failures.join(',')}`);
  return metadata;
}

// Each scene is voiced on its own, as the local worker does. Its clip is
// padded or trimmed to the scene length, then the clips are joined into one
// track. Scene lengths grow to fit the voice. Any failure means no voice at
// all, so a half-narrated video is never shipped.
export async function renderVoiceTrack({ job, scenes, workdir, synthesize, timeoutMs }) {
  const { voice, rate } = voiceFor(job);
  const parts = [];
  for (let index = 0; index < scenes.length; index += 1) {
    const scene = scenes[index];
    const base = scene.seconds ?? SEGMENT_SECONDS;
    const raw = path.join(workdir, `vo-${index}.mp3`);
    let voiceSeconds = 0;
    if (scene.vo && scene.vo.trim()) {
      const result = await synthesizeVoiceover({ text: scene.vo, voice, rate, outputPath: raw, synthesize, timeoutMs });
      if (!result.ok) return { ok: false, reason: `scene_${index + 1}_${result.reason}` };
      voiceSeconds = await sourceDuration(raw);
    }
    scene.seconds = fitSecondsToVoice(base, voiceSeconds);
    const part = path.join(workdir, `vo-seg-${index}.wav`);
    if (voiceSeconds > 0) {
      await run(['-y', '-i', raw, '-af', 'apad', '-t', String(scene.seconds), '-ar', '48000', '-ac', '2', part], workdir);
    } else {
      await run(['-y', '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000', '-t', String(scene.seconds), part], workdir);
    }
    parts.push(part);
  }
  const list = path.join(workdir, 'vo-concat.txt');
  await writeFile(list, parts.map((file) => `file '${file.replaceAll("'", "'\\''")}'`).join('\n'));
  const track = path.join(workdir, 'voiceover-track.wav');
  await run(['-y', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'pcm_s16le', track], workdir);
  return { ok: true, path: track };
}

export async function renderCloudVideo(job, downloadedInputs, onProgress = async () => {}, options = {}) {
  // Inputs live in /tmp/video-<job>/input-*. Clean only render intermediates;
  // deleting the job root here destroys the sources downloaded by the worker.
  const workdir = path.join('/tmp', `video-${job.id}`, 'render');
  await rm(workdir, { recursive: true, force: true });
  await mkdir(workdir, { recursive: true });
  const scenes = copyFor(job);
  const prepared = await prepareAiHybridAssets({ job, downloadedInputs, scenes, workdir, onProgress, onAsset: options.onAsset, env: options.mediaEnv || process.env });
  const activeInputs = prepared.inputs;
  // Remix jobs (#564): each storyboard slot is filled from a seeded plan over
  // the customer's uploaded footage. Other jobs keep the role-based selection.
  const isRemix = job.workflow_mode === 'remix';
  const remixDurations = new Map();
  if (isRemix) {
    for (const input of activeInputs) {
      if (/^(video|image)\//.test(String(input.type || ''))) remixDurations.set(input.localPath, await sourceDuration(input.localPath));
    }
  }
  const remix = isRemix ? planRemix({ inputs: activeInputs, durations: remixDurations, seedText: job.id, slotCount: scenes.length }) : null;
  if (remix && !remix.ok) throw new Error(remix.reason);
  const visual = remix ? remix.slots.map((slot) => slot.clip) : selectSceneSources(activeInputs);
  if (!visual.length) throw new Error('missing_visual_input');
  const uploadedVoice = activeInputs.find((item) => item.role === 'voiceover' && String(item.type || '').startsWith('audio/'))?.localPath;
  const bgm = activeInputs.find((item) => item.role === 'bgm' && String(item.type || '').startsWith('audio/'))?.localPath;
  let voice = uploadedVoice || null;
  let voiceSource = uploadedVoice ? 'uploaded' : 'none';
  let voiceError = null;
  if (!uploadedVoice) {
    await onProgress(25, '云端正在生成同一声音的连续旁白');
    const mediaEnv = options.mediaEnv || process.env;
    const synthesize = options.synthesize || (gatewaySpeechConfigured(mediaEnv) ? createGatewaySynthesizer({ env: mediaEnv }) : undefined);
    const timed = await renderVoiceTrack({ job, scenes, workdir, synthesize });
    if (timed.ok) {
      voice = timed.path;
      voiceSource = 'tts';
    } else {
      voiceError = timed.reason;
      if (job.workflow_mode === 'ai_hybrid') throw new Error(`voiceover_generation_failed:${timed.reason}`);
    }
  }
  const segments = [];
  const durationBySource = new Map();
  for (const source of visual) {
    if (!durationBySource.has(source.localPath)) durationBySource.set(source.localPath, await sourceDuration(source.localPath));
  }
  if (remix) {
    for (const [localPath, duration] of remixDurations) durationBySource.set(localPath, duration);
  }
  for (let index = 0; index < scenes.length; index += 1) {
    const source = visual[index] || visual[index % visual.length];
    // A remix slot carries its own start point; other jobs spread starts over the clip.
    const start = remix ? source.start : sceneStarts(durationBySource.get(source.localPath) || 0, scenes)[index];
    const overlay = path.join(workdir, `overlay-${index}.png`);
    const segment = path.join(workdir, `segment-${index}.mp4`);
    await overlayPng(scenes[index], overlay);
    const wanted = scenes[index].seconds ?? SEGMENT_SECONDS;
    // Short clips loop (as the local worker does) so the scene keeps its length.
    const loop = !String(source.type || '').startsWith('image/') && durationBySource.get(source.localPath) < start + wanted;
    await normalizeSegment({ source: source.localPath, type: source.type, overlay, output: segment, seconds: wanted, start, loop });
    segments.push(segment);
    await onProgress(28 + index * 11, `云端正在编排第 ${index + 1}/${scenes.length} 段`);
  }
  const concat = path.join(workdir, 'concat.txt');
  await writeFile(concat, segments.map((file) => `file '${file.replaceAll("'", "'\\''")}'`).join('\n'));
  const assembled = path.join(workdir, 'assembled.mp4');
  await run(['-y', '-f', 'concat', '-safe', '0', '-i', concat, '-c', 'copy', '-movflags', '+faststart', assembled], workdir);
  const finalPath = path.join(workdir, 'final-cloud.mp4');
  const mixed = await mixAudio(assembled, voice, bgm, path.join(workdir, 'mixed.mp4'));
  const result = await normalizeLoudness(mixed, finalPath);
  const expectedDuration = scenes.reduce((sum, scene) => sum + (scene.seconds ?? SEGMENT_SECONDS), 0);
  const quality = await inspectRender(result, expectedDuration);
  await onProgress(90, '云端成片已生成，正在质检与回传');
  return {
    data: await readFile(result), durationSeconds: expectedDuration, width: WIDTH, height: HEIGHT,
    voiceSource, voiceError, quality, mediaGeneration: prepared.generation,
    ...(remix ? { remix: { seed: remix.seed, reusedSlots: remix.reusedSlots, order: remix.slots.map((slot) => ({ role: slot.role, start: slot.clip.start, source: slot.clip.name })) } } : {}),
  };
}

