import { spawn } from 'node:child_process';
import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import ffmpegPath from 'ffmpeg-static';
import { resolveVoiceover, isEnglishJob } from './_cloud-tts.mjs';
import { englishStoryboard, industryStoryboard } from './_cloud-industry.mjs';
import sharp from 'sharp';

const WIDTH = 720;
const HEIGHT = 1280;
const FPS = 25;
const SEGMENT_SECONDS = 5;
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
  return String(brief || '').match(pattern)?.[1]?.trim() || '';
}

function copyFor(job) {
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

async function overlayPng(scene, output) {
  const fontFile = await ensureFont();
  const svg = Buffer.from(`<svg width="${WIDTH}" height="${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
    <defs><linearGradient id="shade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#00130b" stop-opacity=".2"/><stop offset=".55" stop-color="#00130b" stop-opacity="0"/><stop offset="1" stop-color="#00130b" stop-opacity=".88"/></linearGradient></defs>
    <rect width="100%" height="100%" fill="url(#shade)"/>
    <rect x="48" y="72" width="220" height="54" rx="27" fill="#21d17d"/>
  </svg>`);
  const [kicker, title, subtitle] = await Promise.all([
    textImage(scene.kicker, fontFile, 180, 25, '#002414', 700),
    textImage(scene.title, fontFile, 624, 58, '#ffffff', 800),
    textImage(scene.showSubtitle === false ? '' : scene.subtitle, fontFile, 624, 28, '#e1f7ec', 500),
  ]);
  const titleMeta = await sharp(title).metadata();
  const titleTop = Math.max(800, 1055 - Number(titleMeta.height || 140));
  await sharp(svg).composite([
    { input: kicker, top: 84, left: 68 },
    { input: title, top: titleTop, left: 48 },
    { input: subtitle, top: 1100, left: 48 },
  ]).png().toFile(output);
}

async function normalizeSegment({ source, type, overlay, output, seconds = SEGMENT_SECONDS }) {
  const isImage = String(type || '').startsWith('image/');
  const hasAudio = !isImage && await sourceHasAudio(source);
  const input = isImage ? ['-loop', '1', '-framerate', String(FPS), '-i', source] : ['-i', source];
  const audioInput = hasAudio ? [] : ['-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000'];
  const overlayIndex = hasAudio ? 1 : 2;
  const videoFilter = `[0:v]scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=increase,crop=${WIDTH}:${HEIGHT},fps=${FPS},setsar=1[base];[base][${overlayIndex}:v]overlay=0:0:format=auto[v]`;
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

export async function renderCloudVideo(job, downloadedInputs, onProgress = async () => {}) {
  const workdir = path.join('/tmp', `video-${job.id}`);
  await rm(workdir, { recursive: true, force: true });
  await mkdir(workdir, { recursive: true });
  const visual = selectSceneSources(downloadedInputs);
  if (!visual.length) throw new Error('missing_visual_input');
  const uploadedVoice = downloadedInputs.find((item) => item.role === 'voiceover' && String(item.type || '').startsWith('audio/'))?.localPath;
  const bgm = downloadedInputs.find((item) => item.role === 'bgm' && String(item.type || '').startsWith('audio/'))?.localPath;
  const scenes = copyFor(job);
  const { voice, voiceSource, voiceError } = await resolveVoiceover({
    uploadedVoice, job, scenes, outputPath: path.join(workdir, 'voiceover-tts.mp3'),
  });
  const segments = [];
  for (let index = 0; index < scenes.length; index += 1) {
    const source = visual[index] || visual[index % visual.length];
    const overlay = path.join(workdir, `overlay-${index}.png`);
    const segment = path.join(workdir, `segment-${index}.mp4`);
    await overlayPng(scenes[index], overlay);
    await normalizeSegment({ source: source.localPath, type: source.type, overlay, output: segment, seconds: scenes[index].seconds ?? SEGMENT_SECONDS });
    segments.push(segment);
    await onProgress(28 + index * 11, `云端正在编排第 ${index + 1}/${scenes.length} 段`);
  }
  const concat = path.join(workdir, 'concat.txt');
  await writeFile(concat, segments.map((file) => `file '${file.replaceAll("'", "'\\''")}'`).join('\n'));
  const assembled = path.join(workdir, 'assembled.mp4');
  await run(['-y', '-f', 'concat', '-safe', '0', '-i', concat, '-c', 'copy', '-movflags', '+faststart', assembled], workdir);
  const finalPath = path.join(workdir, 'final-cloud.mp4');
  const result = await mixAudio(assembled, voice, bgm, finalPath);
  await onProgress(90, '云端成片已生成，正在质检与回传');
  return {
    data: await readFile(result), durationSeconds: scenes.reduce((sum, scene) => sum + (scene.seconds ?? SEGMENT_SECONDS), 0), width: WIDTH, height: HEIGHT,
    voiceSource, voiceError,
  };
}
