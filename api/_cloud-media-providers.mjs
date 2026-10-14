import crypto from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { experimental_generateVideo as generateVideo } from 'ai';
import { createGateway } from '@ai-sdk/gateway';

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
  const gatewayReady = Boolean((env.AI_GATEWAY_API_KEY || env.VERCEL_OIDC_TOKEN) && env.AI_GATEWAY_VIDEO_MODEL);
  if (['gateway', 'vercel-ai-gateway'].includes(requested)) return gatewayReady ? 'vercel-ai-gateway' : null;
  if (requested === 'seedance') return env.ARK_API_KEY ? 'seedance' : null;
  if (requested === 'runway') return env.RUNWAYML_API_SECRET ? 'runway' : null;
  if (requested !== 'auto') return null;
  if (gatewayReady) return 'vercel-ai-gateway';
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
    gatewayVideo: on && configuredVideoProvider(env) === 'vercel-ai-gateway',
    seedance: on && Boolean(env.ARK_API_KEY),
    runway: on && Boolean(env.RUNWAYML_API_SECRET),
  };
}

function gatewayProviderOptions(model, negativePrompt, env, maxWaitMs) {
  if (model.startsWith('klingai/')) {
    return {
      klingai: {
        mode: env.AI_GATEWAY_VIDEO_QUALITY || 'std',
        cfgScale: Math.max(0, Math.min(1, Number(env.AI_GATEWAY_VIDEO_CFG_SCALE || 0.7))),
        negativePrompt: String(negativePrompt || '').slice(0, 2500),
        pollIntervalMs: 5000,
        pollTimeoutMs: maxWaitMs,
      },
    };
  }
  if (model.startsWith('bytedance/')) return { bytedance: { pollIntervalMs: 5000, pollTimeoutMs: maxWaitMs } };
  if (model.startsWith('spacexai/')) return { spacexai: { resolution: '720p', pollIntervalMs: 5000, pollTimeoutMs: maxWaitMs } };
  return undefined;
}

async function generateGatewayVideo({ prompt, negativePrompt, duration, referenceImage, idempotencyKey, env, fetcher, onProgress, maxWaitMs, videoGenerator, gatewayFactory }) {
  const token = env.AI_GATEWAY_API_KEY || env.VERCEL_OIDC_TOKEN;
  const model = String(env.AI_GATEWAY_VIDEO_MODEL || '');
  if (!token || !model) throw new Error('gateway_video_not_configured');
  if (model.includes('-i2v') && !referenceImage?.data) throw new Error('ai_video_reference_required');

  const usingOidc = !env.AI_GATEWAY_API_KEY && Boolean(env.VERCEL_OIDC_TOKEN);
  const gateway = gatewayFactory({
    apiKey: token,
    fetch: fetcher,
    ...(usingOidc ? { headers: { 'ai-gateway-auth-method': 'oidc' } } : {}),
  });
  await onProgress?.(18, 'Vercel AI Gateway 正在提交人物一致性视频任务');
  const result = await videoGenerator({
    model: gateway.videoModel(model),
    prompt: {
      image: referenceImage.data,
      text: String(prompt).slice(0, 2500),
    },
    duration: Math.max(3, Math.min(15, Number(duration) || 5)),
    aspectRatio: '9:16',
    generateAudio: false,
    providerOptions: gatewayProviderOptions(model, negativePrompt, env, maxWaitMs),
    headers: { 'idempotency-key': idempotencyKey },
    poll: { intervalMs: 5000, timeoutMs: maxWaitMs },
    download: async ({ url, abortSignal }) => {
      const response = await fetcher(safeRemoteUrl(url), { signal: abortSignal || timeoutSignal(60000) });
      if (!response.ok) throw new Error(`gateway_video_download_${response.status}`);
      const data = await readLimited(response, MAX_VIDEO_BYTES, 'gateway_video_download');
      if (data.length < 1024) throw new Error('gateway_video_too_small');
      return { data, mediaType: response.headers.get('content-type') || 'video/mp4' };
    },
  });
  const file = result?.videos?.[0];
  const data = file?.uint8Array ? Buffer.from(file.uint8Array) : null;
  if (!data || data.length < 1024 || data.length > MAX_VIDEO_BYTES) throw new Error('gateway_video_invalid_media');
  const taskId = result?.providerMetadata?.gateway?.asyncJob?.jobId;
  if (!taskId) throw new Error('gateway_video_missing_task_id');
  return { data, provider: 'vercel-ai-gateway', model, taskId, type: file.mediaType || 'video/mp4' };
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

export async function generateAiVideoClip({ prompt, negativePrompt = '', duration = 5, referenceImage, idempotencyKey = crypto.randomUUID(), env = process.env, fetcher = fetch, sleeper = sleep, onProgress = async () => {}, maxWaitMs, videoGenerator = generateVideo, gatewayFactory = createGateway }) {
  if (!enabled(env)) throw new Error('ai_media_generation_disabled');
  const provider = configuredVideoProvider(env);
  if (!provider) throw new Error('ai_video_provider_not_configured');
  const requestedWait = Number(maxWaitMs || env.AI_PROVIDER_MAX_WAIT_MS || 210000);
  const wait = Number.isFinite(requestedWait) ? Math.max(1000, requestedWait) : 210000;
  const args = { prompt, negativePrompt, duration, referenceImage, idempotencyKey, env, fetcher, sleeper, onProgress, maxWaitMs: wait, videoGenerator, gatewayFactory };
  const generated = provider === 'vercel-ai-gateway'
    ? await generateGatewayVideo(args)
    : provider === 'runway' ? await generateRunwayVideo(args) : await generateSeedanceVideo(args);
  return { ...generated, type: generated.type || 'video/mp4', sha256: sha256(generated.data) };
}

function visualPrompt(job, scene, position) {
  const brief = String(job.brief || '').replaceAll('\\n', '\n');
  const positiveContext = brief.split('\n').filter((line) => !/(禁止|不得|不要|排除|must[_ -]?exclude|negative)/i.test(line)).join(' ').slice(0, 1800);
  const action = position === 'opening hook'
    ? 'Open on immediate confident movement: the adult business spokesperson from the reference image enters a contemporary workplace and engages a business owner; use a subtle forward camera move and establish the problem within the first second.'
    : 'End on a credible result moment: the same adult spokesperson and business owner review strong customer-enquiry results together; the camera settles into a clean confident composition with generous lower safe space for a later call-to-action overlay.';
  return `Create a premium photorealistic vertical 9:16 social-media commercial ${position} shot. Preserve the exact adult spokesperson identity, face, hair, age, and wardrobe cues from the supplied reference image. ${action} Scene copy intent: ${scene?.title || ''}. ${scene?.subtitle || ''}. Campaign context: ${positiveContext}. Natural human motion and anatomy, polished commercial lighting, realistic Hong Kong business environment when relevant, strong visual focus, no baked-in typography. Do not render words, letters, subtitles, logos, prices, watermarks, interface text, or QR codes.`;
}

function negativeVisualPrompt(job) {
  const exclusions = String(job.brief || '').replaceAll('\\n', '\n').split('\n')
    .filter((line) => /(禁止|不得|不要|排除|must[_ -]?exclude|negative)/i.test(line))
    .join('; ')
    .slice(0, 1200);
  return `identity drift, different person, face morphing, distorted anatomy, extra fingers, deformed hands, duplicate people, text, letters, captions, subtitles, logos, watermarks, QR codes, UI text${exclusions ? `; ${exclusions}` : ''}`;
}

export function aiVideoIdempotencyKey(job = {}, role = 'clip') {
  const retryIdentity = [
    job.video_project_id || '',
    String(job.project_name || '').replace(/ · Retry [0-9]+$/, ''),
    sha256(Buffer.from(String(job.brief || ''))),
  ].join(':');
  const identity = job.revision_scope === 'retry_failed' ? retryIdentity : (job.id || 'job');
  return `v3-${crypto.createHash('sha256').update(`${identity}:${role}`).digest('hex').slice(0, 48)}`;
}

export async function prepareAiHybridAssets({ job, downloadedInputs, scenes, workdir, env = process.env, fetcher = fetch, sleeper = sleep, onProgress = async () => {}, videoGenerator = generateVideo, gatewayFactory = createGateway }) {
  if (job.workflow_mode !== 'ai_hybrid') return { inputs: downloadedInputs, generation: [] };
  const existingHook = downloadedInputs.some((item) => item.role === 'ai_hook');
  const existingCta = downloadedInputs.some((item) => item.role === 'ai_cta');
  const missing = [
    ...(!existingHook ? [{ role: 'ai_hook', scene: scenes[0], position: 'opening hook' }] : []),
    ...(!existingCta ? [{ role: 'ai_cta', scene: scenes.at(-1), position: 'closing call-to-action' }] : []),
  ];
  if (!missing.length) return { inputs: downloadedInputs, generation: [] };
  const capabilities = mediaProviderCapabilities(env);
  // AI Hybrid is a video-generation workflow. Still-image generation is useful
  // for posters, but silently substituting stills here would falsely report that
  // AI video generation succeeded.
  if (!capabilities.video) throw new Error('ai_video_provider_not_configured');
  const reference = downloadedInputs.find((item) => item.role === 'character_reference' && String(item.type || '').startsWith('image/') && item.localPath);
  const referenceData = reference ? await readFile(reference.localPath) : null;
  if (referenceData && referenceData.length > 10 * 1024 * 1024) throw new Error('ai_video_reference_too_large');
  const referenceImage = referenceData ? { data: referenceData, type: reference.type } : null;
  const negativePrompt = negativeVisualPrompt(job);
  const generated = await Promise.all(missing.map(async (item, index) => {
    const prompt = visualPrompt(job, item.scene, item.position);
    const idempotencyKey = aiVideoIdempotencyKey(job, item.role);
    const result = await generateAiVideoClip({ prompt, negativePrompt, duration: item.scene?.seconds || 5, referenceImage, idempotencyKey, env, fetcher, sleeper, onProgress, maxWaitMs: env.AI_PROVIDER_MAX_WAIT_MS, videoGenerator, gatewayFactory });
    const localPath = path.join(workdir, `${item.role}-${index}${result.type === 'video/webm' ? '.webm' : '.mp4'}`);
    await writeFile(localPath, result.data);
    return { input: { role: item.role, type: result.type, name: path.basename(localPath), localPath }, meta: { role: item.role, provider: result.provider, model: result.model, task_id: result.taskId, sha256: result.sha256, character_reference_used: Boolean(referenceImage) } };
  }));
  await onProgress(24, `AI 已生成 ${generated.length} 个补充镜头，开始混剪`);
  return { inputs: [...downloadedInputs, ...generated.map((item) => item.input)], generation: generated.map((item) => item.meta) };
}
