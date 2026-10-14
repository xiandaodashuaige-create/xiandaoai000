import crypto from 'node:crypto';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { renderCloudVideo } from './_cloud-video.mjs';
import { generateOpenAiImage, mediaProviderCapabilities } from './_cloud-media-providers.mjs';

export const config = { maxDuration: 300 };

const WORKER = 'VERCEL-CREATIVE-V2';
const INPUT_BUCKET = 'video-agent-inputs';
const RESULT_BUCKET = 'video-agent-results';
const FONT_PATH = '/tmp/NotoSansSC.ttf';
const FONT_URL = 'https://raw.githubusercontent.com/google/fonts/main/ofl/notosanssc/NotoSansSC%5Bwght%5D.ttf';

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

async function textLayer(text, fontFile, size, width, color = '#ffffff', weight = 700) {
  return sharp({
    text: {
      text: `<span foreground="${color}" font_weight="${weight}">${xml(text)}</span>`,
      font: `Noto Sans SC ${size}`,
      fontfile: fontFile,
      width,
      rgba: true,
      wrap: 'word-char',
      spacing: Math.round(size * 0.22),
    },
  }).png().toBuffer();
}

export async function renderPoster(job, input) {
  const font = await ensureFont();
  const brief = String(job.brief || '');
  const size = briefValue(brief, '尺寸', '1080x1350').match(/(\d+)x(\d+)/i);
  const width = Math.max(640, Math.min(2160, Number(size?.[1] || 1080)));
  const height = Math.max(640, Math.min(2160, Number(size?.[2] || 1350)));
  const margin = Math.round(width * 0.075);
  const contentWidth = width - margin * 2;
  const title = briefValue(brief, '主标题', job.project_name || '营销海报');
  const facts = briefValue(brief, '核心卖点与准确事实', briefValue(brief, '准确价格/优惠/事实', ''));
  const cta = briefValue(brief, '行动引导', '立即了解');
  const brand = briefValue(brief, '品牌', briefValue(brief, '客户', 'LULIAN AI'));

  const base = await sharp(input).resize(width, height, { fit: 'cover', position: 'attention' }).modulate({ brightness: 0.92, saturation: 0.96 }).toBuffer();
  const shade = Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#02140d" stop-opacity=".18"/><stop offset=".46" stop-color="#03120c" stop-opacity=".14"/><stop offset="1" stop-color="#020b07" stop-opacity=".92"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/></svg>`);
  const brandBg = Buffer.from(`<svg width="${Math.round(width * .44)}" height="66" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" rx="33" fill="#28d57e"/></svg>`);
  const ctaWidth = Math.min(contentWidth, Math.max(Math.round(width * .52), 500));
  const ctaBg = Buffer.from(`<svg width="${ctaWidth}" height="92" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" rx="46" fill="#28d57e"/></svg>`);
  const [brandText, titleText, factText, ctaText] = await Promise.all([
    textLayer(brand.slice(0, 28), font, Math.round(width * .032), Math.round(width * .37), '#ffffff', 700),
    textLayer(title, font, Math.round(width * .072), contentWidth, '#ffffff', 800),
    textLayer(facts.replaceAll('｜', ' · '), font, Math.round(width * .039), contentWidth, '#e2f4ea', 400),
    textLayer(cta, font, Math.round(width * .041), ctaWidth - 72, '#021b0f', 800),
  ]);
  const [titleMeta, factMeta, ctaMeta] = await Promise.all([sharp(titleText).metadata(), sharp(factText).metadata(), sharp(ctaText).metadata()]);
  const titleTop = Math.max(Math.round(height * .49), height - Number(titleMeta.height || 130) - Number(factMeta.height || 70) - 230);
  const factsTop = titleTop + Number(titleMeta.height || 130) + 28;
  const ctaTop = Math.min(height - 120, factsTop + Number(factMeta.height || 70) + 36);

  return sharp(base).composite([
    { input: shade, top: 0, left: 0 },
    { input: brandBg, top: Math.round(height * .065), left: margin },
    { input: brandText, top: Math.round(height * .065) + 13, left: margin + 24 },
    { input: titleText, top: titleTop, left: margin },
    { input: factText, top: factsTop, left: margin },
    { input: ctaBg, top: ctaTop, left: margin },
    { input: ctaText, top: ctaTop + Math.max(10, Math.round((92 - Number(ctaMeta.height || 50)) / 2)), left: margin + 36 },
  ]).jpeg({ quality: 94, progressive: true, chromaSubsampling: '4:4:4' }).toBuffer();
}

function posterGenerationPrompt(job) {
  const title = briefValue(job.brief, '主标题', job.project_name || '营销海报');
  const facts = briefValue(job.brief, '核心卖点与准确事实', '');
  const brand = briefValue(job.brief, '品牌', '');
  return `Create a premium commercial advertising background image for ${brand}. Campaign theme: ${title}. Confirmed context: ${facts}. Photorealistic, polished studio lighting, natural anatomy, strong focal subject, vertical social-ad composition, clean negative space in the lower half for later typography. Do not render words, letters, numbers, prices, logos, watermarks, UI, QR codes, or captions.`;
}

async function heartbeat(accessCode, jobId, stage, progress) {
  await rpc('video_agent_worker_heartbeat', { p_access: accessCode, p_job_id: jobId, p_worker_id: WORKER, p_stage: stage, p_progress: progress });
}

async function runOne(accessCode) {
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
      let source;
      if (main?.path) {
        if (String(main.type || '').startsWith('video/')) throw new Error('video_poster_source_requires_local_ffmpeg');
        await heartbeat(accessCode, job.id, '云端正在下载主视觉', 18);
        source = await download(INPUT_BUCKET, main.path);
      } else {
        await heartbeat(accessCode, job.id, '云端正在用 GPT 生成主视觉', 18);
        const generated = await generateOpenAiImage({ prompt: posterGenerationPrompt(job) });
        source = generated.data;
        artifactMeta = { generated_background: true, image_provider: generated.provider, image_model: generated.model, source_sha256: generated.sha256 };
      }
      await heartbeat(accessCode, job.id, '云端正在生成商业海报', 52);
      result = await renderPoster(job, source);
      fileName = 'poster-cloud.jpg';
      contentType = 'image/jpeg';
    } else {
      await heartbeat(accessCode, job.id, '云端正在下载项目隔离素材', 14);
      const downloaded = [];
      for (let index = 0; index < inputs.length; index += 1) downloaded.push(await downloadToTmp(inputs[index], index, job.id));
      const rendered = await renderCloudVideo(job, downloaded, (progress, stage) => heartbeat(accessCode, job.id, stage, progress));
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
    await rpc('video_agent_cloud_fallback', { p_access: accessCode, p_job_id: job.id, p_worker_id: WORKER, p_error_message: message });
    return { ok: false, claimed: true, job_id: job.id, fallback: 'local', error: message };
  }
}

export default async function handler(req, res) {
  if (req.method === 'GET') return res.status(200).json({ ok: true, worker: WORKER, capability: ['image_poster', 'remix', 'ai_hybrid', 'voiceover_mix', 'bgm_mix'], provider_adapters: ['openai_image', 'seedance', 'runway'], providers: mediaProviderCapabilities(), mode: 'cloud_canary_with_local_fallback' });
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  try {
    if (!authorised(req)) return res.status(401).json({ error: 'unauthorized' });
    const result = await runOne(env('VIDEO_AGENT_ACCESS'));
    return res.status(result.ok ? 200 : 202).json(result);
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
}

