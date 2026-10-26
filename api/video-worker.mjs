import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import ffmpegPath from 'ffmpeg-static';
import sharp from 'sharp';
import { renderCloudVideo } from './_cloud-video.mjs';
import { generateOpenAiImage, mediaProviderCapabilities } from './_cloud-media-providers.mjs';
import { accentFromDominant, parsePosterFacts, posterSafeZone, safeErrorCode } from './_poster-copy.mjs';
import { posterGenerationPrompt } from './_poster-current-brief.mjs';
import { preparePosterSource, resolvePosterState, posterStateBrief } from './_poster-revision.mjs';

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

export async function renderPoster(job, input, options = {}) {
  const font = options.fontPath || await ensureFont();
  const state = options.state || resolvePosterState(job).state;
  const { width, height, key } = state.placement;
  const safe = posterSafeZone(height, key);
  const margin = Math.round(width * 0.075);
  const contentWidth = width - margin * 2;
  const copy = parsePosterFacts(state.facts, { strict: true });
  // Freeze the *unlettered* photo and the independently addressable overlay
  // boxes. Revisions never feed a flattened JPEG back into this compositor.
  const base = await sharp(input).resize(width, height, { fit: 'cover', position: 'attention' }).modulate({ brightness: 0.95, saturation: 1.02 }).png().toBuffer();
  const palette = state.palette || accentFromDominant((await sharp(base).stats()).dominant);
  const accent = palette.accent;
  const onAccent = palette.onAccent;
  const buttonColor = state.buttonColor || accent;
  const rgb = hexToRgb(buttonColor);
  const onButton = (0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b) > 140 ? '#1a1410' : '#ffffff';
  const oldLayout = state.layout;
  const layout = {};
  const composites = [];
  const pill = (w, h, fill, opacity = 1) => Buffer.from(`<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" rx="${h / 2}" fill="${fill}" fill-opacity="${opacity}"/></svg>`);
  async function type(role, text, size, maxWidth, color, weight) {
    const box = oldLayout?.[role];
    const targetWidth = box?.width || maxWidth;
    const minimum = Math.max(20, Math.round(size * 0.65));
    for (let actual = Math.round(size); actual >= minimum; actual -= 2) {
      const data = await textLayer(text, font, actual, targetWidth, color, weight);
      const meta = await sharp(data).metadata();
      if (!box || (meta.width <= box.width && meta.height <= box.height)) return { data, width: meta.width, height: meta.height };
    }
    throw new Error(`poster_copy_does_not_fit_${role}`);
  }
  async function put(role, data, left, top, reservedWidth, reservedHeight) {
    const meta = await sharp(data).metadata();
    const previous = oldLayout?.[role];
    // Adding/removing a copy group cannot silently change a locked layout.
    if (oldLayout && !previous) throw new Error(`poster_layout_change_requires_confirmation_${role}`);
    const box = previous || { left: Math.round(left), top: Math.round(top), width: reservedWidth || meta.width, height: reservedHeight || meta.height };
    if (box.left < 0 || box.top < 0 || box.left + meta.width > width || box.top + meta.height > height || meta.width > box.width || meta.height > box.height) throw new Error(`poster_layout_overflow_${role}`);
    layout[role] = box;
    composites.push({ input: data, top: box.top, left: box.left });
  }
  const shade = Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#050505" stop-opacity=".16"/><stop offset=".34" stop-color="#050505" stop-opacity=".10"/><stop offset=".62" stop-color="#050505" stop-opacity=".58"/><stop offset="1" stop-color="#050505" stop-opacity=".9"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/></svg>`);
  composites.push({ input: shade, top: 0, left: 0 });
  if (state.brand) {
    const brand = await type('brand', state.brand, width * 0.032, width * 0.5, onAccent, 700);
    const bw = oldLayout?.brandPill?.width || brand.width + 48;
    const bh = Math.max(62, brand.height + 20);
    await put('brandPill', pill(bw, bh, accent), margin, safe.top);
    await put('brand', brand.data, margin + 24, safe.top + (bh - brand.height) / 2, Math.round(width * 0.5), brand.height);
  }
  const gap = Math.round(height * 0.022);
  let cursor = height - safe.bottom;
  if (state.cta) {
    const ctaH = oldLayout?.button?.height || 104;
    const cta = await type('cta', state.cta, width * 0.043, contentWidth - 152, onButton, 800);
    if (cta.height > ctaH - 20) throw new Error('poster_copy_does_not_fit_cta');
    cursor -= ctaH;
    await put('button', pill(contentWidth, ctaH, buttonColor), margin, cursor);
    const icon = Buffer.from(`<svg width="56" height="56" viewBox="0 0 56 56" xmlns="http://www.w3.org/2000/svg"><circle cx="28" cy="28" r="28" fill="${onButton}"/><path fill="${buttonColor}" d="M20 15l5 8-3 3c2 4 4 6 8 8l3-3 8 5v5c-16 1-28-11-27-27z"/></svg>`);
    await put('icon', icon, margin + 28, cursor + (ctaH - 56) / 2);
    await put('cta', cta.data, margin + 108, cursor + (ctaH - cta.height) / 2, contentWidth - 152, ctaH - 20);
    cursor -= gap * 1.4;
  }
  if (copy.lines.length) {
    const lines = await type('facts', copy.lines.map(line => `· ${line}`).join('\n'), width * 0.04, contentWidth, '#f4f1ea', 500);
    cursor -= lines.height;
    await put('facts', lines.data, margin, cursor, contentWidth, lines.height);
    cursor -= gap;
  }
  if (copy.price) {
    const price = await type('price', copy.price, width * 0.125 * state.priceScale, Math.round(contentWidth * 0.62), accent, 800);
    cursor -= price.height;
    await put('price', price.data, margin, cursor, Math.round(contentWidth * 0.62), price.height);
    if (copy.qualifier) {
      const qual = await type('qualifier', copy.qualifier, width * 0.036, Math.round(contentWidth * 0.3), '#ffffff', 700);
      const qw = oldLayout?.qualifierPill?.width || qual.width + 40;
      const qh = oldLayout?.qualifierPill?.height || qual.height + 20;
      const qleft = margin + Math.round(contentWidth * 0.65);
      if (qleft + qw > width - margin) throw new Error('poster_copy_does_not_fit_qualifier');
      const qtop = cursor + price.height - qh;
      await put('qualifierPill', pill(qw, qh, '#ffffff', 0.2), qleft, qtop);
      await put('qualifier', qual.data, qleft + 20, qtop + 10, Math.round(contentWidth * 0.3), qual.height);
    }
    cursor -= gap;
  }
  const title = await type('title', state.title, width * 0.074 * state.titleScale, contentWidth, '#ffffff', 800);
  const titleBottom = Math.min(cursor, Math.round(height * 0.8));
  const titleTop = Math.round(titleBottom - title.height);
  if (titleTop < safe.top + 100) throw new Error('poster_copy_does_not_fit_title');
  await put('title', title.data, margin, titleTop, contentWidth, title.height);
  if (oldLayout && Object.keys(oldLayout).some(role => !layout[role])) throw new Error('poster_layout_removal_requires_confirmation');
  const renderedState = { ...state, palette, layout };
  options.onManifest?.(renderedState);
  return sharp(base).composite(composites).jpeg({ quality: 94, progressive: true, chromaSubsampling: '4:4:4' }).toBuffer();
}

async function heartbeat(accessCode, jobId, stage, progress) {
  await rpc('video_agent_worker_heartbeat', { p_access: accessCode, p_job_id: jobId, p_worker_id: WORKER, p_stage: stage, p_progress: progress });
}

export async function renderVideoVersions(job, downloaded, onProgress, options, render = renderCloudVideo) {
  const count = job.workflow_mode === 'remix' ? Math.max(1, Math.min(3, Number(job.output_count) || 1)) : 1;
  const versions = [];
  for (let index = 0; index < count; index += 1) {
    // Keep the durable job identity for ownership; vary only the render seed
    // and scratch directory so the requested remix versions differ.
    const variantJob = index === 0 ? job : { ...job, id: `${job.id}-version-${index + 1}` };
    const rendered = await render(variantJob, downloaded, onProgress, options);
    versions.push(rendered);
  }
  return versions;
}

async function runOne(accessCode, mediaEnv = process.env) {
  const job = await rpc('video_agent_claim_cloud_job', { p_access: accessCode, p_worker_id: WORKER });
  if (!job?.id) return { ok: true, claimed: false };
  try {
    const inputs = Array.isArray(job.input_files) ? job.input_files : [];
    let result;
    let fileName;
    let contentType;
    let artifactMeta = {};
    let videoVersions = [];
    if (job.workflow_mode === 'image_poster') {
      const parent = job.parent_job_id ? await rpc('video_agent_get_job', { p_access: accessCode, p_job_id: job.parent_job_id }) : null;
      await heartbeat(accessCode, job.id, '云端正在核对海报文字与原图版本', 18);
      const prepared = await preparePosterSource({
        job, parent,
        load: (objectPath, kind) => download(kind === 'result' ? RESULT_BUCKET : INPUT_BUCKET, objectPath),
        loadMain: item => posterSource(item, job.id),
        generate: async ({ state, backgroundInstruction, referenceImages }) => {
          const effectiveJob = { ...job, brief: posterStateBrief(state, backgroundInstruction) };
          return generateOpenAiImage({
            prompt: posterGenerationPrompt(effectiveJob) + referenceImages.map((image, index) => image.role === 'customer_subject' ? ` Image ${index + 1} is the customer subject: preserve identity.` : ` Image ${index + 1} is a style reference only: never copy text, claims, prices, brand or subject.`).join(''),
            size: state.placement.generate, referenceImages, env: mediaEnv,
          });
        },
      });
      await heartbeat(accessCode, job.id, '云端正在生成商业海报', 52);
      let renderedState;
      result = await renderPoster(job, prepared.source, { state: prepared.state, onManifest: value => { renderedState = value; } });
      // A private, job-scoped clean source is persisted before completion. It
      // is metadata, not an extra accepted output or advertising approval.
      const sourcePath = await rpc('video_agent_issue_path', { p_access: accessCode, p_job_id: job.id, p_bucket: RESULT_BUCKET, p_file_name: 'poster-edit-source.png' });
      const sourceBytes = await sharp(prepared.source).png().toBuffer();
      await upload(RESULT_BUCKET, sourcePath, sourceBytes, 'image/png');
      artifactMeta = {
        generated_background: Boolean(prepared.generation),
        image_provider: prepared.generation?.provider || null,
        image_model: prepared.generation?.model || null,
        source_sha256: crypto.createHash('sha256').update(sourceBytes).digest('hex'),
        poster_edit: {
          schema: 'poster-edit-v1', job_id: job.id, parent_job_id: job.parent_job_id || null, version: Number(job.version_number || 1),
          state: renderedState,
          source: { path: sourcePath, sha256: crypto.createHash('sha256').update(sourceBytes).digest('hex'), type: 'image/png' },
          reference_count: prepared.referenceCount,
          generation_calls: prepared.generation ? 1 : 0, cost: null,
        },
      };
      fileName = 'poster-cloud.jpg';
      contentType = 'image/jpeg';
    } else {
      await heartbeat(accessCode, job.id, '云端正在下载项目隔离素材', 14);
      const downloaded = [];
      for (let index = 0; index < inputs.length; index += 1) downloaded.push(await downloadToTmp(inputs[index], index, job.id));
      videoVersions = await renderVideoVersions(job, downloaded, (progress, stage) => heartbeat(accessCode, job.id, stage, progress), {
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
      const rendered = videoVersions[0];
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
    const outputs = [];
    const versions = videoVersions.length ? videoVersions : [{ data: result }];
    for (let index = 0; index < versions.length; index += 1) {
      const variant = versions[index];
      const name = index === 0 ? fileName : `creative-cloud-${index + 1}.mp4`;
      const dest = await rpc('video_agent_issue_path', { p_access: accessCode, p_job_id: job.id, p_bucket: RESULT_BUCKET, p_file_name: name });
      await upload(RESULT_BUCKET, dest, variant.data, contentType);
      const sha256 = crypto.createHash('sha256').update(variant.data).digest('hex');
      outputs.push({ name, path: dest, type: contentType, ...artifactMeta,
        ...(videoVersions.length ? { duration_seconds: variant.durationSeconds, voice_source: variant.voiceSource, voice_error: variant.voiceError || undefined,
          fps: variant.quality?.fps, bitrate_kbps: variant.quality?.bitrateKbps, loudness_lufs: variant.quality?.loudnessLUFS,
          true_peak_dbtp: variant.quality?.truePeakDBTP, media_generation: variant.mediaGeneration } : {}), sha256 });
    }
    const sha256 = outputs[0].sha256;
    await rpc('video_agent_worker_set_artifact_metadata', {
      p_access: accessCode, p_job_id: job.id, p_worker_id: WORKER, p_output_sha256: sha256,
    });
    await rpc('video_agent_worker_update', {
      p_access: accessCode, p_job_id: job.id, p_status: 'completed', p_progress: 100,
      p_stage: job.workflow_mode === 'image_poster' ? '云端已完成，可查看海报' : '云端已完成，可查看成片',
      p_output_files: outputs, p_error_message: null,
    });
    return { ok: true, claimed: true, job_id: job.id, output_path: outputs[0].path, output_paths: outputs.map((item) => item.path) };
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

