import { spawn } from 'node:child_process';
import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import ffmpegPath from 'ffmpeg-static';
import { resolveVoiceover, isEnglishJob } from './_cloud-tts.mjs';
import { englishStoryboard, industryStoryboard } from './_cloud-industry.mjs';
import sharp from 'sharp';

// Output is 1080x1920 to match the local worker. Overlay layout is authored
// at 720 and scaled by K so both paths keep the same proportions.
const WIDTH = 1080;
const HEIGHT = 1920;
const K = WIDTH / 720;
const px = (value) => Math.round(value * K);
// Social-platform loudness target; the final pass normalises every render to it.
const LOUDNESS = { I: -14, TP: -1.5, LRA: 11 };
const FPS = 25;
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

export function copyFor(job) {
  const brief = String(job.brief || '').replaceAll('\\n', '\n');
  const scenes = isEnglishJob(job) ? englishStoryboard(job) : industryStoryboard(job);
  const hook = briefBlock(brief, /1\. AI生成开头 Hook[：:]([^\n]+)/);
  const cta = briefBlock(brief, /3\. AI生成结尾 CTA[：:]([^\n]+)/);
  if (hook) scenes[0] = { ...scenes[0], title: hook };
  if (cta) scenes[scenes.length - 1] = { ...scenes[scenes.length - 1], title: cta };
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

function textImage(text, fontFile, width, fontSize, color, weight = 700) {
  const escaped = String(text || '').replace(/[&<>"']/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&apos;' })[char]);
  return sharp({ text: { text: `<span foreground="${color}" font_weight="${weight}">${escaped}</span>`, font: `Noto Sans SC ${fontSize}`, fontfile: fontFile, width, rgba: true, wrap: 'word-char', spacing: Math.round(fontSize * .16), align: 'left' } })
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
  const pad = px(26);
  const text = async (value, width, size, color, weight) => {
    if (!value) return null;
    const image = await textImage(value, fontFile, width, size, color, weight);
    const meta = await sharp(image).metadata();
    return { image, width: meta.width || 0, height: meta.height || 0 };
  };
  const rect = (x, y, w, h, rx, fill, extra = '') =>
    shapes.push(`<rect x="${px(x)}" y="${px(y)}" width="${px(w)}" height="${px(h)}" rx="${px(rx)}" fill="${fill}" ${extra}/>`);

  let y = 0;
  if (template === 'pain_cards') {
    y = px(470);
    for (const card of scene.cards || []) {
      const t = await text(card, px(560), px(34), '#ffffff', 700);
      if (!t) continue;
      const h = t.height + pad * 2;
      rect(48, y / K, 624, h / K, 22, '#ffffff', 'fill-opacity=".14" stroke="#21d17d" stroke-width="' + px(3) + '"');
      composites.push({ input: t.image, top: y + pad, left: px(48) + pad });
      y += h + px(24);
    }
  }
  if (template === 'whatsapp_chat') {
    y = px(470);
    for (const [index, message] of (scene.messages || []).entries()) {
      const t = await text(message, px(440), px(30), index % 2 ? '#00130b' : '#0b1f16', 500);
      if (!t) continue;
      const w = t.width + pad * 2;
      const h = t.height + pad * 2;
      const left = index % 2 ? WIDTH - px(48) - w : px(48);
      shapes.push(`<rect x="${left}" y="${y}" width="${w}" height="${h}" rx="${px(24)}" fill="${index % 2 ? '#25d366' : '#ffffff'}"/>`);
      composites.push({ input: t.image, top: y + pad, left: left + pad });
      y += h + px(22);
    }
  }
  if (template === 'cta_offer' && scene.button) {
    const label = await text(scene.button, px(560), px(34), '#00130b', 800);
    if (label) {
      const h = px(84);
      shapes.push(`<rect x="${px(48)}" y="${px(1190)}" width="${px(624)}" height="${h}" rx="${px(42)}" fill="#21d17d"/>`);
      composites.push({ input: label.image, top: px(1190) + Math.round((h - label.height) / 2), left: px(48) + px(36) });
    }
  }

  const svg = Buffer.from(`<svg width="${WIDTH}" height="${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
    <defs><linearGradient id="shade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#00130b" stop-opacity=".2"/><stop offset=".55" stop-color="#00130b" stop-opacity="0"/><stop offset="1" stop-color="#00130b" stop-opacity=".88"/></linearGradient></defs>
    <rect width="100%" height="100%" fill="url(#shade)"/>
    <rect x="${px(48)}" y="${px(72)}" width="${px(220)}" height="${px(54)}" rx="${px(27)}" fill="#21d17d"/>
    ${shapes.join('\n')}
  </svg>`);
  const kicker = await text(scene.kicker, px(180), px(25), '#002414', 700);
  const title = await text(scene.title, px(624), px(58), '#ffffff', 800);
  const subtitle = scene.showSubtitle === false ? null : await text(scene.subtitle, px(624), px(28), '#e1f7ec', 500);
  const layers = [...composites];
  if (kicker) layers.push({ input: kicker.image, top: px(84), left: px(68) });
  if (title) layers.push({ input: title.image, top: Math.max(px(800), px(1055) - title.height), left: px(48) });
  if (subtitle) layers.push({ input: subtitle.image, top: px(1100), left: px(48) });
  await sharp(svg).composite(layers).png().toFile(output);
}

export async function normalizeSegment({ source, type, overlay, output, seconds = SEGMENT_SECONDS, startFraction = 0 }) {
  const isImage = String(type || '').startsWith('image/');
  const hasAudio = !isImage && await sourceHasAudio(source);
  const duration = isImage ? 0 : await sourceDuration(source);
  const seekSeconds = duration > seconds ? Math.max(0, (duration - seconds) * Math.min(1, Math.max(0, startFraction))) : 0;
  const input = isImage
    ? ['-loop', '1', '-framerate', String(FPS), '-i', source]
    : [...(seekSeconds > 0 ? ['-ss', seekSeconds.toFixed(3)] : []), '-i', source];
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
    '-t', String(seconds), '-shortest', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23',
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

export async function renderCloudVideo(job, downloadedInputs, onProgress = async () => {}) {
  const workdir = path.join('/tmp', `video-${job.id}`);
  await rm(workdir, { recursive: true, force: true });
  await mkdir(workdir, { recursive: true });
  const visual = selectSceneSources(downloadedInputs);
  if (!visual.length) throw new Error('missing_visual_input');
  const uploadedVoice = downloadedInputs.find((item) => item.role === 'voiceover' && String(item.type || '').startsWith('audio/'))?.localPath;
  const bgm = downloadedInputs.find((item) => item.role === 'bgm' && String(item.type || '').startsWith('audio/'))?.localPath;
  const scenes = copyFor(job);
  const sourceCounts = new Map();
  for (let index = 0; index < scenes.length; index += 1) {
    const source = visual[index] || visual[index % visual.length];
    sourceCounts.set(source.localPath, (sourceCounts.get(source.localPath) || 0) + 1);
  }
  const sourceOccurrences = new Map();
  const { voice, voiceSource, voiceError } = await resolveVoiceover({
    uploadedVoice, job, scenes, outputPath: path.join(workdir, 'voiceover-tts.mp3'),
  });
  const segments = [];
  for (let index = 0; index < scenes.length; index += 1) {
    const source = visual[index] || visual[index % visual.length];
    const overlay = path.join(workdir, `overlay-${index}.png`);
    const segment = path.join(workdir, `segment-${index}.mp4`);
    const occurrence = sourceOccurrences.get(source.localPath) || 0;
    const count = sourceCounts.get(source.localPath) || 1;
    sourceOccurrences.set(source.localPath, occurrence + 1);
    await overlayPng(scenes[index], overlay);
    await normalizeSegment({
      source: source.localPath,
      type: source.type,
      overlay,
      output: segment,
      seconds: scenes[index].seconds ?? SEGMENT_SECONDS,
      startFraction: count > 1 ? occurrence / count : 0,
    });
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
    voiceSource, voiceError, quality,
  };
}
