import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import ffmpegPath from 'ffmpeg-static';
import sharp from 'sharp';
import { renderCloudVideo } from './_cloud-video.mjs';
import { generateOpenAiImage, mediaProviderCapabilities } from './_cloud-media-providers.mjs';
import { posterBrief, preparePosterSource } from './_poster-brief.mjs';

export const config = { maxDuration: 300 };

const WORKER = 'VERCEL-CREATIVE-V2';
const INPUT_BUCKET = 'video-agent-inputs';
const RESULT_BUCKET = 'video-agent-results';
const FONT_PATH = '/tmp/NotoSansSC.ttf';
const FONT_URL = 'https://raw.githubusercontent.com/google/fonts/main/ofl/notosanssc/NotoSansSC%5Bwght%5D.ttf';
const execFileAsync = promisify(execFile);

function env(name) {
  const value = process.env[name];
  if (!value) throw new Error(`missing_env_${name}`);
  return value;
}

function authorised(req) {
  const supplied = String(req.headers['x-video-access'] || '');
  const expected = env('VIDEO_AGENT_ACCESS');
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function headers() {
  const key = env('SUPABASE_PUBLISHABLE_KEY');
  return { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
}

async function rpc(name, body) {
  const response = await fetch(`${env('SUPABASE_URL')}/rest/v1/rpc/${name}`, {
    method: 'POST', headers: headers(), body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${name}_${response.status}_${text.slice(0, 500)}`);
  if (!text) return null;
  const data = JSON.parse(text);
  return Array.isArray(data) && data.length === 1 ? data[0] : data;
}

const encodePath = (value) => value.split('/').map(encodeURIComponent).join('/');

async function download(bucket, objectPath) {
  const key = env('SUPABASE_PUBLISHABLE_KEY');
  const response = await fetch(`${env('SUPABASE_URL')}/storage/v1/object/${bucket}/${encodePath(objectPath)}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  if (!response.ok) throw new Error(`download_${response.status}_${(await response.text()).slice(0, 300)}`);
  return Buffer.from(await response.arrayBuffer());
}

async function downloadToTmp(item, index, jobId) {
  const extension = path.extname(String(item.name || item.path || '')) || (String(item.type || '').startsWith('video/') ? '.mp4' : String(item.type || '').startsWith('audio/') ? '.mp3' : '.jpg');
  const localPath = path.join('/tmp', `video-${jobId}`, `input-${index}${extension}`);
  await mkdir(path.dirname(localPath), { recursive: true });
  await writeFile(localPath, await download(INPUT_BUCKET, item.path));
  return { ...item, localPath };
}

async function posterSource(main, jobId) {
  const downloaded = await downloadToTmp(main, 0, jobId);
  if (!String(main.type || '').startsWith('video/')) return readFile(downloaded.localPath);
  const output = path.join('/tmp', `video-${jobId}`, 'poster-source.jpg');
  await execFileAsync(ffmpegPath, [
    '-y', '-loglevel', 'error', '-ss', '1', '-i', downloaded.localPath,
    '-frames:v', '1', '-q:v', '2', output,
  ]);
  return readFile(output);
}

async function upload(bucket, objectPath, data, contentType) {
  const key = env('SUPABASE_PUBLISHABLE_KEY');
  const response = await fetch(`${env('SUPABASE_URL')}/storage/v1/object/${bucket}/${encodePath(objectPath)}`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': contentType, 'x-upsert': 'false' },
    body: data,
  });
  if (!response.ok) throw new Error(`upload_${response.status}_${(await response.text()).slice(0, 300)}`);
}

function briefValue(brief, label, fallback = '') {
  const text = String(brief || '');
  const request = text.includes('【本次制作需求】') ? text.split('【本次制作需求】').slice(1).join('【本次制作需求】') : text;
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = request.match(new RegExp(`${escaped}[：:]([^\\n]+)`));
  return match ? match[1].trim() : fallback;
}

function xml(value) {
  return String(value || '').replace(/[&<>"']/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&apos;' })[char]);
}

async function ensureFont() {
  try { await access(FONT_PATH); return FONT_PATH; } catch {}
  await mkdir(path.dirname(FONT_PATH), { recursive: true });
  const response = await fetch(FONT_URL);
  if (!response.ok) throw new Error(`font_download_${response.status}`);
  await writeFile(FONT_PATH, Buffer.from(await response.arrayBuffer()));
  return FONT_PATH;
}

async function textLayer(text, fontFile, size, width, color = '#ffffff', weight = 700, align = 'left') {
  return sharp({
    text: {
      text: `<span foreground="${color}" font_weight="${weight}">${xml(text)}</span>`,
      font: `Noto Sans SC ${size}`,
      fontfile: fontFile,
      width,
      rgba: true,
      wrap: 'word-char',
      spacing: Math.round(size * 0.22),
      align,
    },
  }).png().toBuffer();
}

export async function renderPoster(job, input) {
  const font = await ensureFont();
  const { width, height, title, facts, cta, brand, palette } = posterBrief(job);
  const margin = Math.round(width * 0.075);
  const contentWidth = width - margin * 2;
  const base = await sharp(input).resize(width, height, { fit: 'cover', position: 'attention' }).modulate({ brightness: 0.92, saturation: 0.96 }).toBuffer();
  const shade = Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${palette.shade}" stop-opacity="${palette.layout === 'top' ? '.85' : '.18'}"/><stop offset=".5" stop-color="${palette.shade}" stop-opacity=".12"/><stop offset="1" stop-color="${palette.shade}" stop-opacity=".92"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/></svg>`);
  // Measure every text block and shrink within a fixed budget. Never clip copy.
  const fitText = async (value, ratio, maxHeight, color, weight = 700, align = 'left') => {
    if (!value) return null;
    for (let size = Math.round(width * ratio); size >= Math.round(width * .022); size -= 2) {
      const data = await textLayer(value, font, size, contentWidth, color, weight, align);
      const meta = await sharp(data).metadata();
      if (meta.height <= maxHeight && meta.width <= contentWidth) return { data, height: meta.height, width: meta.width };
    }
    throw new Error('poster_copy_does_not_fit');
  };
  const [brandText, titleText, factText, ctaText] = await Promise.all([
    fitText(brand, .032, height * .065, palette.text),
    fitText(title.replace(/[｜|]/g, '\n').replace(/([\p{Script=Han}])\s+(?=[\p{Script=Han}])/gu, '$1\n'), .072, height * .24, palette.text, 800),
    fitText(facts.replaceAll('｜', ' · '), .039, height * .16, palette.detail, 400),
    fitText(cta, .041, height * .09, palette.ink, 800, 'centre'),
  ]);
  const gap = Math.round(height * .022);
  const ctaPadding = Math.round(height * .015);
  const ctaHeight = (ctaText?.height || 0) + ctaPadding * 2;
  const ctaTop = height - margin - ctaHeight;
  const ctaBg = Buffer.from(`<svg width="${contentWidth}" height="${ctaHeight}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" rx="${Math.round(ctaHeight / 2)}" fill="${palette.accent}"/></svg>`);
  const blockHeight = (titleText?.height || 0) + (factText?.height || 0) + gap;
  const brandTop = margin;
  const titleTop = palette.layout === 'top' ? brandTop + (brandText?.height || 0) + gap * 2 : ctaTop - gap * 2 - blockHeight;
  const factsTop = titleTop + (titleText?.height || 0) + gap;
  if (titleTop < margin || factsTop + (factText?.height || 0) > ctaTop - gap) throw new Error('poster_copy_does_not_fit');
  const composites = [{ input: shade, top: 0, left: 0 }];
  if (brandText) composites.push({ input: brandText.data, top: brandTop, left: margin });
  if (titleText) composites.push({ input: titleText.data, top: titleTop, left: margin });
  if (factText) composites.push({ input: factText.data, top: factsTop, left: margin });
  if (ctaText) composites.push({ input: ctaBg, top: ctaTop, left: margin }, { input: ctaText.data, top: ctaTop + ctaPadding, left: margin + Math.floor((contentWidth - ctaText.width) / 2) });
  return sharp(base).composite(composites).jpeg({ quality: 94, progressive: true, chromaSubsampling: '4:4:4' }).toBuffer();
}

async function heartbeat(accessCode, jobId, stage, progress) {
  await rpc('video_agent_worker_heartbeat', { p_access: accessCode, p_job_id: jobId, p_worker_id: WORKER, p_stage: stage, p_progress: progress });
}

async function runOne(accessCode, mediaEnv = process.env) {
  const job = await rpc('video_agent_claim_cloud_job', { p_access: accessCode, p_worker_id: WORKER });
  if (!job?.id) return { ok: true, claimed: false };
  try {
    const inputs = Array.isArray(job.input_files) ? job.input_files : [];
    const main = inputs.find((item) => item.role === 'main');
    let result;
    let fileName;
    let contentType;
    let artifactMeta = {};
    if (job.workflow_mode === 'image_poster') {
      await heartbeat(accessCode, job.id, '云端正在准备海报主视觉与参考风格', 18);
      const prepared = await preparePosterSource({
        job, main: main?.path ? main : null,
        references: inputs.filter(item => item.role === 'reference'),
        load: item => posterSource(item, job.id),
        generate: args => generateOpenAiImage({ ...args, env: mediaEnv }),
      });
      const source = prepared.source;
      artifactMeta = { ...prepared.metadata, copy_rendering: 'typeset_from_confirmed_brief', visual_review: 'required' };
      await heartbeat(accessCode, job.id, '云端正在生成商业海报', 52);
      result = await renderPoster(job, source);
      fileName = 'poster-cloud.jpg';
      contentType = 'image/jpeg';
    } else {
      await heartbeat(accessCode, job.id, '云端正在下载项目隔离素材', 14);
      const downloaded = [];
      for (let index = 0; index < inputs.length; index += 1) downloaded.push(await downloadToTmp(inputs[index], index, job.id));
      const rendered = await renderCloudVideo(job, downloaded, (progress, stage) => heartbeat(accessCode, job.id, stage, progress), { mediaEnv });
      result = rendered.data;
      fileName = 'creative-cloud.mp4';
      contentType = 'video/mp4';
      artifactMeta = {
        duration_seconds: rendered.durationSeconds,
        width: rendered.width,
        height: rendered.height,
        fps: rendered.quality?.fps,
        bitrate_kbps: rendered.quality?.bitrateKbps,
        loudness_lufs: rendered.quality?.loudnessLUFS,
        true_peak_dbtp: rendered.quality?.truePeakDBTP,
        voice_source: rendered.voiceSource,
        voice_error: rendered.voiceError || undefined,
        media_generation: rendered.mediaGeneration,
      };
    }
    await heartbeat(accessCode, job.id, '云端成品已生成，正在回传', 94);
    const dest = await rpc('video_agent_issue_path', { p_access: accessCode, p_job_id: job.id, p_bucket: RESULT_BUCKET, p_file_name: fileName });
    await upload(RESULT_BUCKET, dest, result, contentType);
    const sha256 = crypto.createHash('sha256').update(result).digest('hex');
    await rpc('video_agent_worker_set_artifact_metadata', {
      p_access: accessCode, p_job_id: job.id, p_worker_id: WORKER, p_output_sha256: sha256,
    });
    await rpc('video_agent_worker_update', {
      p_access: accessCode, p_job_id: job.id, p_status: 'completed', p_progress: 100,
      p_stage: job.workflow_mode === 'image_poster' ? '云端已完成，可查看海报' : '云端已完成，可查看成片',
      p_output_files: [{ name: fileName, path: dest, type: contentType, sha256, ...artifactMeta }], p_error_message: null,
    });
    return { ok: true, claimed: true, job_id: job.id, output_path: dest };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // The local renderer does not consume style references. A poster error
    // must remain visible instead of quietly returning an unrelated template.
    if (job.workflow_mode === 'image_poster') {
      await rpc('video_agent_worker_update', {
        p_access: accessCode, p_job_id: job.id, p_status: 'failed', p_progress: 0,
        p_stage: '海报未完成，请查看错误后重试', p_output_files: [], p_error_message: message,
      });
      return { ok: false, claimed: true, job_id: job.id, error: message };
    }
    await rpc('video_agent_cloud_fallback', { p_access: accessCode, p_job_id: job.id, p_worker_id: WORKER, p_error_message: message });
    return { ok: false, claimed: true, job_id: job.id, fallback: 'local', error: message };
  }
}

export default async function handler(req, res) {
  const oidcToken = String(req.headers['x-vercel-oidc-token'] || process.env.VERCEL_OIDC_TOKEN || '');
  const mediaEnv = oidcToken ? { ...process.env, VERCEL_OIDC_TOKEN: oidcToken } : process.env;
  if (req.method === 'GET') return res.status(200).json({ ok: true, worker: WORKER, capability: ['image_poster', 'remix', 'ai_hybrid', 'voiceover_mix', 'bgm_mix'], provider_adapters: ['openai_image', 'vercel_ai_gateway', 'seedance', 'runway'], providers: mediaProviderCapabilities(mediaEnv), mode: 'cloud_canary_with_local_fallback' });
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  try {
    if (!authorised(req)) return res.status(401).json({ error: 'unauthorized' });
    const result = await runOne(env('VIDEO_AGENT_ACCESS'), mediaEnv);
    return res.status(result.ok ? 200 : 202).json(result);
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
}
