import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import ffmpegPath from 'ffmpeg-static';
import sharp from 'sharp';
import { renderCloudVideo } from './_cloud-video.mjs';
import { generateOpenAiImage, mediaProviderCapabilities } from './_cloud-media-providers.mjs';

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

const POSTER_STYLES = {
  black_gold: {
    label: 'black and gold premium beauty-business advertising',
    prompt: 'A confident Asian beauty salon owner in an elegant dark salon, positioned in the upper-right third. Black lacquer, warm champagne-gold details, cinematic rim light, premium restrained luxury. Keep the upper-left and lower-left areas visually calm for typography.',
    title: '#fff7df', fact: '#f5e7bd', accent: '#d8ad56', ctaText: '#171006',
  },
  wine_process: {
    label: 'burgundy process-led beauty-business advertising',
    prompt: 'A confident Asian beauty salon owner holding a tablet, positioned on the right side of a modern salon. Deep burgundy, wine red and soft blush lighting, energetic but premium. Keep the left side and lower band visually calm for a step-by-step acquisition flow.',
    title: '#fff7f2', fact: '#ffe7df', accent: '#ffb29c', ctaText: '#47130f',
  },
  beige_omnichannel: {
    label: 'warm beige omnichannel technology advertising',
    prompt: 'A confident Asian beauty salon owner consulting in a bright modern salon, positioned on the right third. Warm ivory, beige, champagne and subtle rose-gold palette, clean editorial technology aesthetic. Keep the left sixty percent simple and bright for an omnichannel flow.',
    title: '#2a211d', fact: '#4f4038', accent: '#b66c4d', ctaText: '#fffaf6',
  },
  documentary: {
    label: 'authentic beauty-salon documentary advertising',
    prompt: 'An authentic Asian beauty salon owner speaking with a client inside a real local salon, candid documentary photography, warm natural window light, credible and approachable, no staged influencer pose. Keep the lower third calm for verified selling points.',
    title: '#ffffff', fact: '#f4eee8', accent: '#e4a874', ctaText: '#26170d',
  },
};

export function posterStyleFromBrief(brief) {
  const requested = briefValue(brief, '视觉风格', 'auto');
  if (POSTER_STYLES[requested]) return requested;
  const text = String(brief || '').toLowerCase();
  if (/(fb|instagram|\big\b|小紅書|小红书|google|全渠道|全通路|omnichannel)/i.test(text)) return 'beige_omnichannel';
  if (/(流程|步驟|步骤|自動跟進|自动跟进|预约流程)/.test(text)) return 'wine_process';
  if (/(高端|黑金|尊貴|尊贵|奢華|奢华)/.test(text)) return 'black_gold';
  return 'documentary';
}

function splitFacts(value) {
  const parts = String(value || '').split(/[｜|\n]+|[。；;](?=\S)/).map((item) => item.trim()).filter(Boolean);
  return (parts.length ? parts : [String(value || '').trim()]).filter(Boolean).slice(0, 5);
}

function roundedRect(width, height, fill, radius = 28, stroke = 'none', strokeWidth = 0) {
  return Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><rect x="${strokeWidth / 2}" y="${strokeWidth / 2}" width="${width - strokeWidth}" height="${height - strokeWidth}" rx="${radius}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"/></svg>`);
}

async function factCards(value, font, width, style, compact = false) {
  const items = splitFacts(value);
  const gap = compact ? 12 : 16;
  const padX = compact ? 24 : 28;
  const padY = compact ? 16 : 20;
  const size = Math.round(width * (compact ? .042 : .046));
  const rendered = [];
  let height = 0;
  for (let index = 0; index < items.length; index += 1) {
    const text = await textLayer(`${String(index + 1).padStart(2, '0')}  ${items[index]}`, font, size, width - padX * 2, style.fact, index === 0 ? 700 : 500);
    const meta = await sharp(text).metadata();
    const cardHeight = Math.max(compact ? 68 : 78, Number(meta.height || size) + padY * 2);
    rendered.push({ text, height: cardHeight, textHeight: Number(meta.height || size) });
    height += cardHeight + (index ? gap : 0);
  }
  const layers = [];
  let top = 0;
  for (const item of rendered) {
    const fill = style === POSTER_STYLES.beige_omnichannel ? '#fffaf2e8' : '#090807a8';
    const stroke = style.accent;
    layers.push({ input: roundedRect(width, item.height, fill, 22, stroke, 2), top, left: 0 });
    layers.push({ input: item.text, top: top + Math.round((item.height - item.textHeight) / 2), left: padX });
    top += item.height + gap;
  }
  return {
    data: await sharp({ create: { width, height: Math.max(1, height), channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite(layers).png().toBuffer(),
    height,
  };
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
  const styleKey = posterStyleFromBrief(brief);
  const style = POSTER_STYLES[styleKey];

  const modulation = styleKey === 'beige_omnichannel'
    ? { brightness: 1.08, saturation: 0.78 }
    : styleKey === 'documentary' ? { brightness: .94, saturation: .92 } : { brightness: .74, saturation: .72 };
  const base = await sharp(input).resize(width, height, { fit: 'cover', position: styleKey === 'beige_omnichannel' || styleKey === 'wine_process' ? 'right' : 'attention' }).modulate(modulation).toBuffer();
  const shadeStops = styleKey === 'beige_omnichannel'
    ? '<stop offset="0" stop-color="#fffaf2" stop-opacity=".98"/><stop offset=".58" stop-color="#fff8ee" stop-opacity=".88"/><stop offset="1" stop-color="#fff8ee" stop-opacity=".08"/>'
    : styleKey === 'wine_process'
      ? '<stop offset="0" stop-color="#400914" stop-opacity=".94"/><stop offset=".62" stop-color="#5f1020" stop-opacity=".72"/><stop offset="1" stop-color="#150409" stop-opacity=".20"/>'
      : styleKey === 'black_gold'
        ? '<stop offset="0" stop-color="#050505" stop-opacity=".88"/><stop offset=".58" stop-color="#090806" stop-opacity=".58"/><stop offset="1" stop-color="#050403" stop-opacity=".84"/>'
        : '<stop offset="0" stop-color="#1b120c" stop-opacity=".16"/><stop offset=".52" stop-color="#1b120c" stop-opacity=".18"/><stop offset="1" stop-color="#160d07" stop-opacity=".90"/>';
  const direction = styleKey === 'beige_omnichannel' || styleKey === 'wine_process' ? 'x2="1" y2="0"' : 'x2="0" y2="1"';
  const shade = Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g" x1="0" y1="0" ${direction}>${shadeStops}</linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/></svg>`);
  const brandWidth = Math.min(contentWidth, Math.max(280, Math.round(width * .42)));
  const brandBg = roundedRect(brandWidth, 62, styleKey === 'beige_omnichannel' ? '#2b211d' : '#070605b8', 31, style.accent, 2);
  const ctaWidth = Math.min(contentWidth, Math.max(Math.round(width * .52), 500));
  const ctaBg = roundedRect(ctaWidth, 92, style.accent, 46);
  const layoutWidth = styleKey === 'black_gold'
    ? Math.round(width * .60)
    : styleKey === 'beige_omnichannel' || styleKey === 'wine_process' ? Math.round(width * .55) : contentWidth;
  const [brandText, titleText, cards, ctaText] = await Promise.all([
    textLayer(brand.slice(0, 28), font, Math.round(width * .030), brandWidth - 44, styleKey === 'beige_omnichannel' ? '#fffaf5' : style.accent, 700),
    textLayer(title, font, Math.round(width * (styleKey === 'beige_omnichannel' ? .066 : .071)), layoutWidth, style.title, 800),
    factCards(facts, font, layoutWidth, style, styleKey === 'wine_process'),
    textLayer(cta, font, Math.round(width * .041), ctaWidth - 72, style.ctaText, 800),
  ]);
  const [titleMeta, ctaMeta] = await Promise.all([sharp(titleText).metadata(), sharp(ctaText).metadata()]);
  const titleTop = styleKey === 'documentary' ? Math.round(height * .50) : Math.round(height * .15);
  const factsTop = titleTop + Number(titleMeta.height || 130) + Math.round(height * .035);
  const ctaTop = Math.min(height - 120, Math.max(height - 150, factsTop + cards.height + Math.round(height * .035)));

  return sharp(base).composite([
    { input: shade, top: 0, left: 0 },
    { input: brandBg, top: Math.round(height * .065), left: margin },
    { input: brandText, top: Math.round(height * .065) + 12, left: margin + 22 },
    { input: titleText, top: titleTop, left: margin },
    { input: cards.data, top: factsTop, left: margin },
    { input: ctaBg, top: ctaTop, left: margin },
    { input: ctaText, top: ctaTop + Math.max(10, Math.round((92 - Number(ctaMeta.height || 50)) / 2)), left: margin + 36 },
  ]).jpeg({ quality: 94, progressive: true, chromaSubsampling: '4:4:4' }).toBuffer();
}

export function posterGenerationPrompt(job) {
  const title = briefValue(job.brief, '主标题', job.project_name || '营销海报');
  const facts = briefValue(job.brief, '核心卖点与准确事实', '');
  const brand = briefValue(job.brief, '品牌', '');
  const audience = briefValue(job.brief, '目标客户', 'beauty salon owners and local beauty-business decision makers');
  const business = briefValue(job.brief, '业务类型', 'beauty-business customer acquisition');
  const styleKey = posterStyleFromBrief(job.brief);
  const style = POSTER_STYLES[styleKey];
  return `Create a single premium vertical 4:5 advertising background image, not a finished poster and not a collage. Business: ${business}. Intended buyer: ${audience}. Brand context: ${brand}. Campaign theme: ${title}. Confirmed context for visual relevance only: ${facts}. Art direction: ${style.label}. ${style.prompt} Show a credible beauty-business decision maker, not a consumer massage promotion and not an unrelated industry. Photorealistic commercial photography, natural hands and anatomy, one clear focal story, realistic salon details, polished lighting. Leave deliberately quiet safe areas exactly as described for later deterministic typography. Do not render any words, letters, numbers, prices, platform names, logos, watermarks, app UI, QR codes, captions, poster borders, or fake metrics.`;
}

async function heartbeat(accessCode, jobId, stage, progress) {
  await rpc('video_agent_worker_heartbeat', { p_access: accessCode, p_job_id: jobId, p_worker_id: WORKER, p_stage: stage, p_progress: progress });
}

export async function runOne(accessCode, mediaEnv = process.env) {
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
        const generated = await generateOpenAiImage({ prompt: posterGenerationPrompt(job), env: mediaEnv });
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
    console.error('cloud_worker_failed', JSON.stringify({ job_id: job.id, workflow_mode: job.workflow_mode, error: message.slice(0, 900) }));
    const inputs = Array.isArray(job.input_files) ? job.input_files : [];
    const hasLocalPosterSource = inputs.some((item) => item.role === 'main' && item.path);
    if (job.workflow_mode === 'image_poster' && !hasLocalPosterSource) {
      await rpc('video_agent_worker_update', {
        p_access: accessCode, p_job_id: job.id, p_status: 'failed', p_progress: 18,
        p_stage: 'GPT 主视觉生成失败，请查看错误后重试', p_output_files: [], p_error_message: message.slice(-900),
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

