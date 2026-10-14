import crypto from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const OPENAI_IMAGE_URL = 'https://api.openai.com/v1/images/generations';
const GATEWAY_IMAGE_URL = 'https://ai-gateway.vercel.sh/v1/images/generations';
const RUNWAY_BASE = 'https://api.dev.runwayml.com';
const DEFAULT_SEEDANCE_BASE = 'https://ark.ap-southeast.bytepluses.com/api/v3';
const MAX_JSON_BYTES = 30 * 1024 * 1024;
const MAX_VIDEO_BYTES = 220 * 1024 * 1024;

const enabled = (env) => String(env.AI_MEDIA_GENERATION_ENABLED || '').toLowerCase() === 'true';
const cleanBase = (value) => String(value || '').replace(/\/+$/, '');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function timeoutSignal(ms) {
  return AbortSignal.timeout(Math.max(1000, Number(ms) || 120000));
}

async function readLimited(response, limit, label) {
  const declared = Number(response.headers?.get?.('content-length') || 0);
  if (declared > limit) throw new Error(`${label}_too_large`);
  const data = Buffer.from(await response.arrayBuffer());
  if (data.length > limit) throw new Error(`${label}_too_large`);
  return data;
}

async function jsonResponse(response, label) {
  const raw = await readLimited(response, MAX_JSON_BYTES, label);
  const text = raw.toString('utf8');
  if (!response.ok) throw new Error(`${label}_${response.status}_${text.slice(0, 500)}`);
  try { return JSON.parse(text); } catch { throw new Error(`${label}_invalid_json`); }
}

function apiHeaders(key, extra = {}) {
  return { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...extra };
}

function sha256(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function configuredVideoProvider(env) {
  const requested = String(env.AI_VIDEO_PROVIDER || 'auto').toLowerCase();
  if (requested === 'seedance') return env.ARK_API_KEY ? 'seedance' : null;
  if (requested === 'runway') return env.RUNWAYML_API_SECRET ? 'runway' : null;
  if (requested !== 'auto') return null;
  if (env.ARK_API_KEY) return 'seedance';
  if (env.RUNWAYML_API_SECRET) return 'runway';
  return null;
}

function imageProviderConfig(env) {
  if (env.OPENAI_API_KEY) return { provider: 'openai', token: env.OPENAI_API_KEY, url: OPENAI_IMAGE_URL, model: env.OPENAI_IMAGE_MODEL || 'gpt-image-2' };
  const gatewayToken = env.AI_GATEWAY_API_KEY || env.VERCEL_OIDC_TOKEN;
  if (gatewayToken) return { provider: 'vercel-ai-gateway', token: gatewayToken, url: GATEWAY_IMAGE_URL, model: env.OPENAI_IMAGE_MODEL || 'openai/gpt-image-2' };
  return null;
}

export function mediaProviderCapabilities(env = process.env) {
  const on = enabled(env);
  const image = on ? imageProviderConfig(env) : null;
  return {
    enabled: on,
    image: Boolean(image),
    imageProvider: image?.provider || null,
    video: on && Boolean(configuredVideoProvider(env)),
    videoProvider: on ? configuredVideoProvider(env) : null,
    seedance: on && Boolean(env.ARK_API_KEY),
    runway: on && Boolean(env.RUNWAYML_API_SECRET),
  };
}

export async function generateOpenAiImage({ prompt, env = process.env, fetcher = fetch, timeoutMs = 120000 }) {
  if (!enabled(env)) throw new Error('ai_media_generation_disabled');
  const image = imageProviderConfig(env);
  if (!image) throw new Error('openai_image_not_configured');
  const response = await fetcher(image.url, {
    method: 'POST',
    headers: apiHeaders(image.token),
    signal: timeoutSignal(timeoutMs),
    body: JSON.stringify({
      model: image.model,
      prompt: String(prompt || '').slice(0, 12000),
      size: env.OPENAI_IMAGE_SIZE || '1088x1360',
      quality: env.OPENAI_IMAGE_QUALITY || 'medium',
      output_format: 'webp',
      moderation: 'auto',
    }),
  });
  const payload = await jsonResponse(response, 'openai_image');
  const encoded = payload?.data?.[0]?.b64_json;
  if (!encoded || typeof encoded !== 'string') throw new Error('openai_image_missing_data');
  const data = Buffer.from(encoded, 'base64');
  if (!data.length || data.length > MAX_JSON_BYTES) throw new Error('openai_image_invalid_size');
  const meta = await sharp(data).metadata();
  if (!meta.width || !meta.height || !['webp', 'png', 'jpeg'].includes(String(meta.format))) {
    throw new Error('openai_image_invalid_media');
  }
  return { data, type: `image/${meta.format === 'jpeg' ? 'jpeg' : meta.format}`, provider: image.provider, model: image.model, sha256: sha256(data), width: meta.width, height: meta.height };
}

function safeRemoteUrl(value) {
  let url;
  try { url = new URL(String(value)); } catch { throw new Error('provider_output_invalid_url'); }
  if (url.protocol !== 'https:') throw new Error('provider_output_unsafe_url');
  const host = url.hostname.toLowerCase();
  if (host === 'localhost' || host === '::1' || host === '[::1]' || host.endsWith('.local') || /^(127|10|0)\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host)) {
    throw new Error('provider_output_unsafe_url');
  }
  return url.toString();
}

function firstUrl(value) {
  if (!value) return null;
  if (typeof value === 'string' && /^https:\/\//i.test(value)) return value;
  if (Array.isArray(value)) {
    for (const item of value) { const found = firstUrl(item); if (found) return found; }
    return null;
  }
  if (typeof value === 'object') {
    for (const key of ['video_url', 'videoUrl', 'url', 'output', 'outputs', 'content', 'data', 'result']) {
      const found = firstUrl(value[key]); if (found) return found;
    }
  }
  return null;
}

async function pollTask({ getTask, taskId, maxWaitMs, intervalMs, sleeper, onProgress, provider }) {
  const started = Date.now();
  const pauseMs = Math.max(1000, Number(intervalMs) || 5000);
  let attempt = 0;
  while (Date.now() - started < maxWaitMs) {
    const task = await getTask(taskId);
    const state = String(task?.status || task?.state || task?.data?.status || task?.data?.state || '').toLowerCase();
    if (['succeeded', 'success', 'completed', 'done'].includes(state)) {
      const outputUrl = firstUrl(task);
      if (!outputUrl) throw new Error(`${provider}_missing_output`);
      return outputUrl;
    }
    if (['failed', 'error', 'cancelled', 'canceled'].includes(state)) {
      const detail = task?.error?.message || task?.error || task?.message || state;
      throw new Error(`${provider}_task_failed_${String(detail).slice(0, 300)}`);
    }
    attempt += 1;
    await onProgress?.(Math.min(82, 18 + attempt * 4), `${provider === 'runway' ? 'Runway' : 'Seedance'} 正在生成 AI 镜头`);
    await sleeper(pauseMs);
  }
  throw new Error(`${provider}_task_timeout`);
}

async function downloadProviderVideo(url, fetcher, timeoutMs) {
  const response = await fetcher(safeRemoteUrl(url), { signal: timeoutSignal(timeoutMs) });
  if (!response.ok) throw new Error(`provider_video_download_${response.status}`);
  const data = await readLimited(response, MAX_VIDEO_BYTES, 'provider_video');
  if (data.length < 1024) throw new Error('provider_video_too_small');
  return data;
}

async function generateRunwayVideo({ prompt, duration, env, fetcher, sleeper, onProgress, maxWaitMs }) {
  const key = env.RUNWAYML_API_SECRET;
  if (!key) throw new Error('runway_not_configured');
  const headers = apiHeaders(key, { 'X-Runway-Version': env.RUNWAY_API_VERSION || '2024-11-06' });
  const create = await fetcher(`${RUNWAY_BASE}/v1/text_to_video`, {
    method: 'POST', headers, signal: timeoutSignal(30000),
    body: JSON.stringify({ model: env.RUNWAY_VIDEO_MODEL || 'gen4.5', promptText: String(prompt).slice(0, 1000), ratio: '768:1280', duration: Math.max(5, Math.min(10, Number(duration) || 5)) }),
  });
  const created = await jsonResponse(create, 'runway_create');
  const taskId = created?.id || created?.taskId;
  if (!taskId) throw new Error('runway_missing_task_id');
  const outputUrl = await pollTask({
    taskId, provider: 'runway', maxWaitMs, sleeper, onProgress,
    getTask: async (id) => jsonResponse(await fetcher(`${RUNWAY_BASE}/v1/tasks/${encodeURIComponent(id)}`, { headers, signal: timeoutSignal(30000) }), 'runway_status'),
  });
  return { data: await downloadProviderVideo(outputUrl, fetcher, 60000), provider: 'runway', model: env.RUNWAY_VIDEO_MODEL || 'gen4.5', taskId };
}

async function generateSeedanceVideo({ prompt, duration, env, fetcher, sleeper, onProgress, maxWaitMs }) {
  const key = env.ARK_API_KEY;
  if (!key) throw new Error('seedance_not_configured');
  const base = cleanBase(env.SEEDANCE_API_BASE || DEFAULT_SEEDANCE_BASE);
  const headers = apiHeaders(key);
  const model = env.SEEDANCE_VIDEO_MODEL || 'dreamina-seedance-2-5-260628';
  const create = await fetcher(`${base}/contents/generations/tasks`, {
    method: 'POST', headers, signal: timeoutSignal(30000),
    body: JSON.stringify({ model, content: [{ type: 'text', text: String(prompt).slice(0, 8000) }], ratio: '9:16', duration: Math.max(4, Math.min(12, Number(duration) || 5)), generate_audio: false, watermark: false }),
  });
  const created = await jsonResponse(create, 'seedance_create');
  const taskId = created?.id || created?.task_id || created?.data?.id || created?.data?.task_id;
  if (!taskId) throw new Error('seedance_missing_task_id');
  const outputUrl = await pollTask({
    taskId, provider: 'seedance', maxWaitMs, sleeper, onProgress,
    getTask: async (id) => jsonResponse(await fetcher(`${base}/contents/generations/tasks/${encodeURIComponent(id)}`, { headers, signal: timeoutSignal(30000) }), 'seedance_status'),
  });
  return { data: await downloadProviderVideo(outputUrl, fetcher, 60000), provider: 'seedance', model, taskId };
}

export async function generateAiVideoClip({ prompt, duration = 5, env = process.env, fetcher = fetch, sleeper = sleep, onProgress = async () => {}, maxWaitMs }) {
  if (!enabled(env)) throw new Error('ai_media_generation_disabled');
  const provider = configuredVideoProvider(env);
  if (!provider) throw new Error('ai_video_provider_not_configured');
  const requestedWait = Number(maxWaitMs || env.AI_PROVIDER_MAX_WAIT_MS || 210000);
  const wait = Number.isFinite(requestedWait) ? Math.max(1000, requestedWait) : 210000;
  const args = { prompt, duration, env, fetcher, sleeper, onProgress, maxWaitMs: wait };
  const generated = provider === 'runway' ? await generateRunwayVideo(args) : await generateSeedanceVideo(args);
  return { ...generated, type: 'video/mp4', sha256: sha256(generated.data) };
}

function visualPrompt(job, scene, position) {
  const brief = String(job.brief || '').slice(0, 5000);
  return `Create a premium vertical 9:16 commercial ${position} shot for this campaign. ${scene?.title || ''}. ${scene?.subtitle || ''}. Campaign context: ${brief}. Photorealistic, natural human movement and anatomy, polished lighting, clear subject, generous safe space for later overlay typography. Do not render any words, letters, subtitles, logos, prices, watermarks, UI, or QR codes inside the image/video.`;
}

export async function prepareAiHybridAssets({ job, downloadedInputs, scenes, workdir, env = process.env, fetcher = fetch, sleeper = sleep, onProgress = async () => {} }) {
  if (job.workflow_mode !== 'ai_hybrid') return { inputs: downloadedInputs, generation: [] };
  const approved = (item) => item.semantic_approved === true || item.semanticApproved === true;
  const sourceLed = downloadedInputs.some((item) => ['viral_hook', 'customer_hook'].includes(item.role) && String(item.type || '').startsWith('video/'));
  if (sourceLed) return { inputs: downloadedInputs, generation: [] };
  const existingHook = downloadedInputs.some((item) => item.role === 'ai_hook' && approved(item));
  const existingCta = downloadedInputs.some((item) => item.role === 'ai_cta' && approved(item));
  const missing = [
    ...(!existingHook ? [{ role: 'ai_hook', scene: scenes[0], position: 'opening hook' }] : []),
    ...(!existingCta ? [{ role: 'ai_cta', scene: scenes.at(-1), position: 'closing call-to-action' }] : []),
  ];
  if (!missing.length) return { inputs: downloadedInputs, generation: [] };
  const capabilities = mediaProviderCapabilities(env);
  if (!capabilities.video && !capabilities.image) throw new Error('ai_media_provider_not_configured');
  const generated = await Promise.all(missing.map(async (item, index) => {
    const prompt = visualPrompt(job, item.scene, item.position);
    if (capabilities.video) {
      const result = await generateAiVideoClip({ prompt, duration: item.scene?.seconds || 5, env, fetcher, sleeper, onProgress, maxWaitMs: env.AI_PROVIDER_MAX_WAIT_MS });
      const localPath = path.join(workdir, `${item.role}-${index}.mp4`);
      await writeFile(localPath, result.data);
      return { input: { role: item.role, type: result.type, name: path.basename(localPath), localPath, semantic_approved: true }, meta: { role: item.role, provider: result.provider, model: result.model, task_id: result.taskId, sha256: result.sha256 } };
    }
    const result = await generateOpenAiImage({ prompt, env, fetcher });
    const extension = result.type === 'image/png' ? '.png' : result.type === 'image/jpeg' ? '.jpg' : '.webp';
    const localPath = path.join(workdir, `${item.role}-${index}${extension}`);
    await writeFile(localPath, result.data);
    return { input: { role: item.role, type: result.type, name: path.basename(localPath), localPath, semantic_approved: true }, meta: { role: item.role, provider: result.provider, model: result.model, sha256: result.sha256 } };
  }));
  await onProgress(24, `AI 已生成 ${generated.length} 个补充镜头，开始混剪`);
  return { inputs: [...downloadedInputs, ...generated.map((item) => item.input)], generation: generated.map((item) => item.meta) };
}
