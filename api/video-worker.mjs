import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import ffmpegPath from 'ffmpeg-static';
import sharp from 'sharp';
import { renderCloudVideo } from './_cloud-video.mjs';
import { generateOpenAiImage, mediaProviderCapabilities } from './_cloud-media-providers.mjs';
import { accentFromDominant, buildPosterPrompt, parsePosterFacts, parsePosterRevision, posterPlacement, posterSafeZone, safeErrorCode } from './_poster-copy.mjs';

export const config = { maxDuration: 800 };

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

function hexToRgb(value) {
  const n = parseInt(value.slice(1), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export async function renderPoster(job, input) {
  const font = await ensureFont();
  const brief = String(job.brief || '');
  const placement = posterPlacement(brief);
  const { width, height } = placement;
  const safe = posterSafeZone(height, placement.key);
  const margin = Math.round(width * 0.075);
  const contentWidth = width - margin * 2;
  const title = briefValue(brief, '主标题', job.project_name || '营销海报');
  const facts = briefValue(brief, '核心卖点与准确事实', briefValue(brief, '准确价格/优惠/事实', ''));
  const cta = briefValue(brief, '行动引导', '');
  const brand = briefValue(brief, '品牌', briefValue(brief, '客户', 'LULIAN AI'));
  const copy = parsePosterFacts(facts);
  const revision = parsePosterRevision(brief);

  const base = await sharp(input).resize(width, height, { fit: 'cover', position: 'attention' }).modulate({ brightness: 0.95, saturation: 1.02 }).toBuffer();
  const picked = accentFromDominant((await sharp(base).stats()).dominant);
  const accent = revision.accent || picked.accent;
  const onAccent = revision.accent ? accentFromDominant(hexToRgb(revision.accent)).onAccent : picked.onAccent;
  const shade = Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#050505" stop-opacity=".16"/><stop offset=".34" stop-color="#050505" stop-opacity=".10"/><stop offset=".62" stop-color="#050505" stop-opacity=".58"/><stop offset="1" stop-color="#050505" stop-opacity=".9"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/></svg>`);
  const pill = (w, h, fill, opacity = 1) => Buffer.from(`<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" rx="${h / 2}" fill="${fill}" fill-opacity="${opacity}"/></svg>`);
  const layer = async (input_, left, top) => ({ input: await input_, left: Math.round(left), top: Math.round(top) });

  const composites = [{ input: shade, top: 0, left: 0 }];

  // Brand chip, top-left, sized to its own text.
  const brandText = await textLayer(brand.slice(0, 28), font, Math.round(width * 0.032), Math.round(width * 0.5), onAccent, 700);
  const brandMeta = await sharp(brandText).metadata();
  const brandW = Number(brandMeta.width || 200) + 48;
  const brandTop = safe.top;
  composites.push({ input: pill(brandW, 62, accent), top: brandTop, left: margin });
  composites.push(await layer(brandText, margin + 24, brandTop + Math.max(8, (62 - Number(brandMeta.height || 40)) / 2)));

  // Build the bottom stack from the call-to-action upward so nothing can
  // overflow the canvas, whatever the copy length.
  const gap = Math.round(height * 0.022);
  let cursor = height - safe.bottom;
  if (cta) {
    // Full-width action bar (>= 80% of the frame) with a chat/phone glyph: the
    // one element every high-performing reference ad shared.
    const ctaWidth = contentWidth;
    const ctaH = 104;
    const iconSize = 56;
    const ctaText = await textLayer(cta, font, Math.round(width * 0.043), ctaWidth - iconSize - 96, onAccent, 800);
    const ctaMeta = await sharp(ctaText).metadata();
    cursor -= ctaH;
    const icon = Buffer.from(`<svg width="${iconSize}" height="${iconSize}" viewBox="0 0 56 56" xmlns="http://www.w3.org/2000/svg"><circle cx="28" cy="28" r="28" fill="${onAccent}"/><g transform="translate(14 14) scale(1.17)"><path fill="${accent}" d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z"/></g></svg>`);
    composites.push({ input: pill(ctaWidth, ctaH, accent), top: cursor, left: margin });
    composites.push({ input: icon, top: Math.round(cursor + (ctaH - iconSize) / 2), left: margin + 28 });
    composites.push(await layer(ctaText, margin + 28 + iconSize + 24, cursor + Math.max(10, (ctaH - Number(ctaMeta.height || 50)) / 2)));
    cursor -= gap * 1.4;
  }
  if (copy.lines.length > 0) {
    const linesText = await textLayer(copy.lines.map((line) => `· ${line}`).join('\n'), font, Math.round(width * 0.04), contentWidth, '#f4f1ea', 500);
    const meta = await sharp(linesText).metadata();
    cursor -= Number(meta.height || 80);
    composites.push({ input: linesText, top: Math.round(cursor), left: margin });
    cursor -= gap;
  }
  if (copy.price) {
    const priceText = await textLayer(copy.price, font, Math.round(width * 0.125 * revision.priceScale), Math.round(contentWidth * 0.62), accent, 800);
    const priceMeta = await sharp(priceText).metadata();
    const priceH = Number(priceMeta.height || 150);
    const priceW = Number(priceMeta.width || 300);
    cursor -= priceH;
    composites.push({ input: priceText, top: Math.round(cursor), left: margin });
    if (copy.qualifier) {
      const qualText = await textLayer(copy.qualifier, font, Math.round(width * 0.036), Math.round(contentWidth * 0.4), '#ffffff', 700);
      const qualMeta = await sharp(qualText).metadata();
      const qualW = Number(qualMeta.width || 160) + 40;
      const qualH = Number(qualMeta.height || 44) + 20;
      const qualLeft = margin + priceW + 24;
      if (qualLeft + qualW <= width - margin) {
        const qualTop = cursor + priceH - qualH - Math.round(priceH * 0.2);
        composites.push({ input: pill(qualW, qualH, '#ffffff', 0.2), top: Math.round(qualTop), left: qualLeft });
        composites.push(await layer(qualText, qualLeft + 20, qualTop + 10));
      }
    }
    cursor -= gap;
  }
  const titleText = await textLayer(title, font, Math.round(width * 0.074 * revision.titleScale), contentWidth, '#ffffff', 800);
  const titleMeta = await sharp(titleText).metadata();
  // With little copy the title sits in the lower third rather than on the very bottom edge.
  const titleBottom = Math.min(cursor, Math.round(height * 0.8));
  const titleTop = Math.max(safe.top + 100, Math.round(titleBottom - Number(titleMeta.height || 130)));
  composites.push({ input: titleText, top: titleTop, left: margin });

  return sharp(base).composite(composites).jpeg({ quality: 94, progressive: true, chromaSubsampling: '4:4:4' }).toBuffer();
}

function posterGenerationPrompt(job) {
  return buildPosterPrompt({
    purpose: briefValue(job.brief, '产品/服务', ''),
    style: briefValue(job.brief, '风格', ''),
    title: briefValue(job.brief, '主标题', job.project_name || ''),
    brand: briefValue(job.brief, '品牌', ''),
    facts: briefValue(job.brief, '核心卖点与准确事实', ''),
    revision: parsePosterRevision(job.brief).background,
    placement: posterPlacement(job.brief).key,
  });
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
      let source;
      if (main?.path) {
        await heartbeat(accessCode, job.id, '云端正在下载主视觉', 18);
        source = await posterSource(main, job.id);
      } else {
        await heartbeat(accessCode, job.id, '云端正在用 GPT 生成主视觉', 18);
        const generated = await generateOpenAiImage({ prompt: posterGenerationPrompt(job), size: posterPlacement(job.brief).generate, env: mediaEnv });
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
      const rendered = await renderCloudVideo(job, downloaded, (progress, stage) => heartbeat(accessCode, job.id, stage, progress), {
        mediaEnv,
        onAsset: async (asset) => {
          const dest = await rpc('video_agent_issue_path', { p_access: accessCode, p_job_id: job.id, p_bucket: INPUT_BUCKET, p_file_name: asset.name });
          await upload(INPUT_BUCKET, dest, await readFile(asset.localPath), asset.type);
          await rpc('video_agent_worker_checkpoint_asset', {
            p_access: accessCode, p_job_id: job.id, p_worker_id: WORKER,
            p_asset: { role: asset.role, type: asset.type, name: asset.name, path: dest, generation: asset.generation },
          });
        },
      });
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
    console.error('cloud_worker_failed', { job_id: job.id, workflow_mode: job.workflow_mode, error: safeErrorCode(message) });
    if (job.workflow_mode === 'ai_hybrid') {
      await rpc('video_agent_worker_update', {
        p_access: accessCode, p_job_id: job.id, p_status: 'failed', p_progress: 100,
        p_stage: `AI 视频生成失败，未回退到普通素材混剪（原因：${safeErrorCode(message)}）`, p_output_files: [],
        p_error_message: message,
      });
      return { ok: false, claimed: true, job_id: job.id, fallback: null, error: message };
    }
    if (job.workflow_mode === 'image_poster' && /^(ai_media|openai_image|gateway)/.test(message)) {
      // The AI background failed in the cloud. Say so with a short safe code
      // instead of handing the poster to an offline local factory.
      await rpc('video_agent_worker_update', {
        p_access: accessCode, p_job_id: job.id, p_status: 'failed', p_progress: 100,
        p_stage: `海报背景生成失败（原因：${safeErrorCode(message)}）`, p_output_files: [],
        p_error_message: message,
      });
      return { ok: false, claimed: true, job_id: job.id, fallback: null, error: message };
    }
    if (['remix', 'image_poster'].includes(job.workflow_mode)) {
      await rpc('video_agent_worker_update', {
        p_access: accessCode, p_job_id: job.id, p_status: 'failed', p_progress: 100,
        p_stage: `云端制作失败，请查看原因后重试（原因：${safeErrorCode(message)}）`,
        p_output_files: [], p_error_message: message,
      });
      return { ok: false, claimed: true, job_id: job.id, fallback: null, error: message };
    }
    await rpc('video_agent_cloud_fallback', { p_access: accessCode, p_job_id: job.id, p_worker_id: WORKER, p_error_message: message });
    return { ok: false, claimed: true, job_id: job.id, fallback: 'local', error: message };
  }
}

export default async function handler(req, res) {
  const oidcToken = String(req.headers['x-vercel-oidc-token'] || process.env.VERCEL_OIDC_TOKEN || '');
  const mediaEnv = oidcToken ? { ...process.env, VERCEL_OIDC_TOKEN: oidcToken } : process.env;
  if (req.method === 'GET') {
    if (!authorised(req)) return res.status(200).json({ ok: true, worker: WORKER });
    return res.status(200).json({ ok: true, worker: WORKER, capability: ['image_poster', 'remix', 'ai_hybrid', 'voiceover_mix', 'bgm_mix'], provider_adapters: ['openai_image', 'vercel_ai_gateway_image', 'vercel_ai_gateway_video', 'seedance', 'runway'], providers: mediaProviderCapabilities(mediaEnv), mode: 'ai_hybrid_gateway_reference' });
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  try {
    if (!authorised(req)) return res.status(401).json({ error: 'unauthorized' });
    const result = await runOne(env('VIDEO_AGENT_ACCESS'), mediaEnv);
    return res.status(result.ok ? 200 : 202).json(result);
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
}

