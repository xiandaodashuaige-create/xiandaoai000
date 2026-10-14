import { spawn } from 'node:child_process';
import { access, copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import ffmpegPath from 'ffmpeg-static';
import { synthesizeVoiceover, voiceFor, fitSecondsToVoice, isEnglishJob } from './_cloud-tts.mjs';
import { englishStoryboard, industryStoryboard } from './_cloud-industry.mjs';
import sharp from 'sharp';
import { prepareAiHybridAssets } from './_cloud-media-providers.mjs';

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
const TRANSITION_SECONDS = 0.5;
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
export function sceneStarts(duration, scenes, source = {}) {
  const trimStart = Math.max(0, Number(source.trim_start ?? source.trimStartSeconds ?? 0) || 0);
  const requestedEnd = Number(source.trim_end ?? source.trimEndSeconds ?? duration) || duration;
  const trimEnd = Math.max(trimStart, Math.min(duration || requestedEnd, requestedEnd));
  const window = Math.max(0, trimEnd - trimStart);
  return scenes.map((scene, index) => {
    const x = [0.03, 0.22, 0.42, 0.61, 0.78][index % 5];
    const latest = Math.max(trimStart, trimEnd - (scene.seconds ?? SEGMENT_SECONDS) - 0.2);
    return duration > 0 ? Math.min(latest, trimStart + window * x) : trimStart;
  });
}

export function pacingFromReferenceCuts(cutTimes, referenceDuration, baseDurations) {
  const bases = baseDurations.map((value) => Math.max(1.5, Number(value) || SEGMENT_SECONDS));
  const duration = Math.max(0, Number(referenceDuration) || 0);
  const cuts = [...new Set(cutTimes.map(Number).filter((value) => value > 0.35 && value < duration - 0.35))].sort((a, b) => a - b);
  if (cuts.length < 2 || !duration) return bases;
  const points = [0, ...cuts, duration];
  const raw = [];
  let accumulated = 0;
  for (let index = 1; index < points.length && raw.length < bases.length; index += 1) {
    accumulated += points[index] - points[index - 1];
    const threshold = Math.max(1.8, bases[raw.length] * 0.55);
    if (accumulated >= threshold || index === points.length - 1) {
      raw.push(accumulated);
      accumulated = 0;
    }
  }
  while (raw.length < bases.length) raw.push(bases[raw.length]);
  const blended = bases.map((base, index) => {
    const bounded = Math.max(base * 0.65, Math.min(base * 1.35, raw[index]));
    return base * 0.55 + bounded * 0.45;
  });
  const target = bases.reduce((sum, value) => sum + value, 0);
  const scale = target / blended.reduce((sum, value) => sum + value, 0);
  const result = blended.map((value) => Math.round(value * scale * 10) / 10);
  result[result.length - 1] = Math.round((result.at(-1) + target - result.reduce((sum, value) => sum + value, 0)) * 10) / 10;
  return result;
}

export async function referencePacing(reference, baseDurations) {
  const fallback = { source: 'storyboard', cutCount: 0, durations: [...baseDurations] };
  if (!reference?.localPath || !String(reference.type || '').startsWith('video/')) return fallback;
  const duration = Math.min(30, await sourceDuration(reference.localPath));
  if (!(duration > 0)) return fallback;
  try {
    const output = await run([
      '-hide_banner', '-i', reference.localPath, '-t', String(duration),
      '-vf', "scale=180:-2,select='gt(scene,0.35)',showinfo", '-an', '-f', 'null', '-',
    ], path.dirname(reference.localPath));
    const cuts = [...output.matchAll(/pts_time:([0-9.]+)/g)].map((match) => Number(match[1]));
    if (cuts.length < 2) return fallback;
    return { source: 'reference', cutCount: cuts.length, durations: pacingFromReferenceCuts(cuts, duration, baseDurations) };
  } catch {
    return fallback;
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
  // An uploaded AI hook/CTA may belong to another business, offer or person.
  // Only use generated-role footage after a semantic approval step. Assets
  // generated for this job receive that flag in prepareAiHybridAssets().
  const approved = (item) => item.semantic_approved === true || item.semanticApproved === true;
  const generated = byRole('ai_generated').filter(approved);
  const hook = [...byRole('ai_hook').filter(approved), ...generated, ...byRole('asset'), ...byRole('main')];
  const proof = [...byRole('main'), ...byRole('case_proof'), ...byRole('asset')];
  const cta = [...byRole('ai_cta').filter(approved), ...generated.slice(1), ...generated, ...byRole('asset'), ...byRole('main')];
  if (!visuals.length) return [];
  const pick = (pool, index = 0) => pool[index % Math.max(1, pool.length)] || visuals[index % visuals.length];
  return [pick(hook), pick(proof, 0), pick(proof, 1), pick(proof, 2), pick(cta)].filter(Boolean);
}

const SOURCE_LED_HOOK_ROLES = new Set(['viral_hook', 'customer_hook']);
const SOURCE_LED_MIDDLE_ROLES = ['process', 'service_value', 'trust_proof', 'case_proof', 'main', 'asset'];
const SOURCE_LED_CTA_ROLES = new Set(['customer_cta', 'cta']);

function stableNumber(value) {
  let hash = 2166136261;
  for (const char of String(value || 'default')) {
    hash ^= char.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function stableInputs(items) {
  return [...items].sort((a, b) => {
    const aSequence = Number(a.sequence ?? a.order ?? Number.MAX_SAFE_INTEGER);
    const bSequence = Number(b.sequence ?? b.order ?? Number.MAX_SAFE_INTEGER);
    if (aSequence !== bSequence) return aSequence - bSequence;
    const aPriority = Number(a.priority ?? 0);
    const bPriority = Number(b.priority ?? 0);
    if (aPriority !== bPriority) return bPriority - aPriority;
    return String(a.name || a.path || a.localPath || '').localeCompare(String(b.name || b.path || b.localPath || ''));
  });
}

function boundedSeconds(source, fallback) {
  return Math.max(2, Math.min(6, Number(source.segment_duration ?? source.segmentDuration ?? source.clip_duration ?? fallback) || fallback));
}

function sourceStart(source) {
  return Math.max(0, Number(source.clip_start ?? source.clipStart ?? source.trim_start ?? source.trimStartSeconds ?? 0) || 0);
}

// Fixed product contract for customer-material remixes. Variation is allowed
// only inside the approved hook pool and is reproducible from variant_seed.
// Copy, voice identity and CTA behavior are never randomized.
export function sourceLedRemixPlan(job, inputs) {
  const visuals = inputs.filter((item) => /^(video|image)\//.test(String(item.type || '')));
  const hooks = stableInputs(visuals.filter((item) => SOURCE_LED_HOOK_ROLES.has(item.role) && String(item.type || '').startsWith('video/')));
  if (!hooks.length) return null;
  const seed = String(job.variant_seed ?? job.variantSeed ?? job.id ?? 'default');
  const hook = hooks[stableNumber(seed) % hooks.length];
  const middles = stableInputs(visuals.filter((item) => SOURCE_LED_MIDDLE_ROLES.includes(item.role) && item !== hook));
  if (!middles.length) throw new Error('remix_missing_customer_middle_material');
  const customerCtas = stableInputs(visuals.filter((item) => SOURCE_LED_CTA_ROLES.has(item.role)));
  const cta = customerCtas.length ? customerCtas[stableNumber(`${seed}:cta`) % customerCtas.length] : null;
  const selectedMiddle = middles.slice(0, 3);
  const warnings = [];

  const nativeScene = (source, phase, fallbackSeconds) => {
    if (phase !== 'hook' && (source.preserve_audio === true || source.preserveAudio === true)) warnings.push(`secondary_source_audio_muted:${source.name || source.role}`);
    return {
      template: 'source_native', title: '', subtitle: '', vo: '', showSubtitle: false,
      seconds: boundedSeconds(source, fallbackSeconds), sourceStart: sourceStart(source),
      audioMode: phase === 'hook' ? 'anchor' : 'silent',
      phase,
    };
  };

  const scenes = [nativeScene(hook, 'hook', 3)];
  const sources = [hook];
  for (const source of selectedMiddle) {
    scenes.push(nativeScene(source, 'middle', 4));
    sources.push(source);
  }
  if (cta) {
    scenes.push(nativeScene(cta, 'cta', 3));
    sources.push(cta);
  } else {
    const fallbackSource = selectedMiddle.at(-1);
    scenes.push({
      template: 'clean_cta', title: '', subtitle: '', vo: '', showSubtitle: false,
      button: '➜ WhatsApp 聯繫預約', seconds: 3, sourceStart: sourceStart(fallbackSource),
      audioMode: 'silent', phase: 'cta',
    });
    sources.push(fallbackSource);
    warnings.push('customer_cta_missing_simple_whatsapp_fallback_used');
  }
  return {
    scenes, sources, warnings: [...new Set(warnings)],
    contract: {
      mode: 'customer_source_led_v1', deterministic: true, variantSeed: seed,
      hookSource: hook.name || hook.path || hook.localPath,
      hookAudio: 'continuous_original_anchor', middleSourceCount: selectedMiddle.length,
      voiceIdentity: 'continuous_from_hook_source',
      textMode: 'preserve_source_no_generated_overlay',
      ctaMode: cta ? 'customer_original' : 'simple_whatsapp_fallback',
    },
  };
}

function compactLine(value) {
  return String(value || '').replace(/\s*\n\s*/g, '｜').replace(/\s+/g, ' ').trim();
}

// A single source cannot honestly look like a five-source montage. In that
// case use a sparse, shorter cut instead of covering the same footage with
// five unrelated UI templates. The warning is returned in artifact metadata
// so operators know that more source footage is still needed for a true mix.
export function sparseStoryboardForSingleSource(scenes, sources, targetSeconds = 13) {
  const unique = new Set(sources.map((source) => source?.localPath).filter(Boolean));
  if (unique.size > 1) return { applied: false, warning: null, scenes };
  const originalTotal = scenes.reduce((sum, scene) => sum + (Number(scene.seconds) || SEGMENT_SECONDS), 0);
  const wantedTotal = Math.min(originalTotal, targetSeconds);
  const baseDurations = [3, 6, 4];
  const scale = wantedTotal / baseDurations.reduce((sum, value) => sum + value, 0);
  const durations = baseDurations.map((value) => Math.round(value * scale * 10) / 10);
  durations[durations.length - 1] = Math.round((durations.at(-1) + wantedTotal - durations.reduce((sum, value) => sum + value, 0)) * 10) / 10;
  const english = scenes.some((scene) => /[A-Za-z]{4}/.test(String(scene.title || scene.vo || '')) && !/[\u3400-\u9fff]/.test(String(scene.title || scene.vo || '')));
  const fullHook = compactLine(scenes[0]?.title);
  const hook = fullHook.includes('？') ? `${fullHook.split('？')[0]}？` : fullHook.includes('?') ? `${fullHook.split('?')[0]}?` : fullHook;
  const selected = [scenes[0], scenes[2], scenes.at(-1)];
  const titles = [
    hook,
    english ? 'Real service｜Real process' : '真人手法｜真實過程',
    scenes[4]?.title,
  ];
  const compact = selected.map((scene, index) => {
    const title = compactLine(titles[index]);
    return {
      ...scene,
      template: index === selected.length - 1 ? 'clean_cta' : 'clean_caption',
      title,
      subtitle: '',
      cards: undefined,
      messages: undefined,
      showSubtitle: false,
      seconds: durations[index],
      vo: title ? `${title.replaceAll('｜', '，')}。` : scene.vo,
    };
  });
  return { applied: true, warning: 'single_visual_source_limited_diversity', scenes: compact };
}

export function renderWorkdirFor(jobId) {
  // Inputs are downloaded to /tmp/video-<jobId>. Rendering must never clean
  // that same directory or the worker deletes its own source files.
  return path.join('/tmp', `video-render-${jobId}`);
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
  const template = scene.template || 'big_text_hook';
  if (template === 'source_native') {
    await sharp({ create: { width: WIDTH, height: HEIGHT, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toFile(output);
    return;
  }
  const fontFile = await ensureFont();
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
      shapes.push(`<circle cx="${px(100)}" cy="${cy}" r="${px(20)}" fill="#e53935"/>`);
      shapes.push(`<path d="M${px(91)} ${cy - px(9)} L${px(109)} ${cy + px(9)} M${px(109)} ${cy - px(9)} L${px(91)} ${cy + px(9)}" stroke="#ffffff" stroke-width="${px(4)}" stroke-linecap="round"/>`);
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
    const offerTop = px(470);
    const pillH = px(72);
    const buttonH = px(92);
    const pillTop = Math.max(px(600), offerTop + (offer ? offer.height : 0) + px(14));
    const cardTop = px(430);
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

  // Compact CTA for real-footage remixes. It keeps the service visible and
  // avoids the large offer card/phone mock-up taking over the whole frame.
  if (template === 'clean_cta') {
    const title = await text(compactLine(scene.title), px(560), px(42), '#ffffff', 800, 'centre');
    const label = await text(scene.button || '➜ WhatsApp 聯繫預約', px(420), px(30), '#ffffff', 800, 'centre');
    const top = px(820);
    shapes.push(`<rect x="${px(45)}" y="${top}" width="${px(630)}" height="${px(300)}" rx="${px(28)}" fill="#111111" fill-opacity=".76"/>`);
    if (title) composites.push({ input: title.image, top: top + px(38), left: px(80) });
    shapes.push(`<rect x="${px(170)}" y="${top + px(185)}" width="${px(380)}" height="${px(78)}" rx="${px(39)}" fill="#25d366"/>`);
    if (label) composites.push({ input: label.image, top: top + px(185) + Math.round((px(78) - label.height) / 2), left: px(150) });
  }

  // Main title: centred, bold, with a dark shadow for legibility.
  const title = ['cta_offer', 'clean_cta'].includes(template) ? null : await text(scene.title, px(624), template === 'clean_caption' ? px(48) : px(58), '#ffffff', 800, 'centre');
  const titleTop = title ? Math.max(px(760), px(1000) - title.height) : 0;
  if (title) {
    if (template === 'clean_caption') {
      shapes.push(`<rect x="${px(30)}" y="${titleTop - px(22)}" width="${px(660)}" height="${title.height + px(44)}" rx="${px(18)}" fill="#000000" fill-opacity=".62"/>`);
    } else {
      const shadow = await text(scene.title, px(624), px(58), '#000000', 800, 'centre');
      composites.push({ input: shadow.image, top: titleTop + px(3), left: px(48) + px(3) });
    }
    composites.push({ input: title.image, top: titleTop, left: px(48) });
  }
  // Subtitle sits in a translucent caption bar, as in the local worker.
  const subtitle = scene.showSubtitle === false ? null : await text(scene.subtitle, px(600), px(28), '#ffffff', 500, 'centre');
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

function validCrop(value) {
  return /^\d{2,4}:\d{2,4}:\d{1,4}:\d{1,4}$/.test(String(value || '')) ? String(value) : null;
}

export async function normalizeSegment({ source, type, overlay, output, seconds = SEGMENT_SECONDS, start = 0, loop = false, cropOverride = null, fitMode = 'fill', focusX = 0.5, preserveSourceAudio = false, overlaySeconds = seconds }) {
  const isImage = String(type || '').startsWith('image/');
  const hasAudio = preserveSourceAudio && !isImage && await sourceHasAudio(source);
  // Seek before the input so each scene starts at its own point in the footage.
  const input = isImage
    ? ['-loop', '1', '-framerate', String(FPS), '-i', source]
    : [...(loop ? ['-stream_loop', '-1'] : []), ...(start > 0 ? ['-ss', start.toFixed(2)] : []), '-i', source];
  const audioInput = hasAudio ? [] : ['-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000'];
  const overlayIndex = hasAudio ? 1 : 2;
  const crop = isImage ? null : validCrop(cropOverride);
  const cropFilter = crop ? `crop=${crop},` : '';
  const safeFocusX = Math.max(0, Math.min(1, Number(focusX) || 0.5));
  const baseFilter = isImage
    ? `[0:v]scale=${WIDTH * 2}:${HEIGHT * 2}:force_original_aspect_ratio=increase,crop=${WIDTH * 2}:${HEIGHT * 2},zoompan=z='min(zoom+0.0008,1.08)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${Math.ceil(seconds * FPS)}:s=${WIDTH}x${HEIGHT}:fps=${FPS},setsar=1[base]`
    : fitMode === 'contain_blur'
      ? `[0:v]${cropFilter}split=2[fg0][bg0];[bg0]scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=increase,crop=${WIDTH}:${HEIGHT},gblur=sigma=28,fps=${FPS},setsar=1[bg];[fg0]scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=decrease,fps=${FPS},setsar=1[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2[base]`
      : `[0:v]${cropFilter}scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=increase,crop=${WIDTH}:${HEIGHT}:x='(iw-ow)*${safeFocusX.toFixed(3)}':y='(ih-oh)/2',fps=${FPS},setsar=1[base]`;
  const overlayOut = Math.max(0.22, Number(overlaySeconds) - 0.22);
  const videoFilter = `${baseFilter};[${overlayIndex}:v]format=rgba,fade=t=in:st=0:d=0.22:alpha=1,fade=t=out:st=${overlayOut.toFixed(3)}:d=0.22:alpha=1[ol];[base][ol]overlay=0:0:format=auto[v]`;
  const audioMap = hasAudio ? '0:a:0' : '1:a:0';
  await run([
    '-y', ...input, ...audioInput, '-loop', '1', '-framerate', String(FPS), '-i', overlay,
    '-filter_complex', videoFilter, '-map', '[v]', '-map', audioMap,
    '-t', String(seconds), '-shortest', '-c:v', 'libx264', '-preset', 'medium', '-crf', '12', '-maxrate', '16M', '-bufsize', '32M',
    '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-ar', '48000', '-ac', '2', output,
  ], path.dirname(output));
  return { hasAudio };
}

export async function assembleWithTransitions({ segments, durations, output, workdir, transitionSeconds = TRANSITION_SECONDS }) {
  if (segments.length !== durations.length || !segments.length) throw new Error('invalid_transition_timeline');
  if (segments.length === 1) {
    await run(['-y', '-i', segments[0], '-t', String(durations[0]), '-c', 'copy', '-movflags', '+faststart', output], workdir);
    return output;
  }
  const args = ['-y'];
  for (const segment of segments) args.push('-i', segment);
  const filters = segments.map((_, index) => `[${index}:v]settb=AVTB,setpts=PTS-STARTPTS[v${index}]`);
  let video = '[v0]';
  let elapsed = durations[0];
  for (let index = 1; index < segments.length; index += 1) {
    const next = `[vx${index}]`;
    filters.push(`${video}[v${index}]xfade=transition=fade:duration=${transitionSeconds}:offset=${elapsed.toFixed(3)}${next}`);
    video = next;
    elapsed += durations[index];
  }
  const audioInputs = durations.map((duration, index) => {
    const fade = Math.min(0.15, duration / 8);
    const outStart = Math.max(0, duration - fade);
    filters.push(`[${index}:a]atrim=duration=${duration},asetpts=PTS-STARTPTS,afade=t=in:st=0:d=${fade},afade=t=out:st=${outStart}:d=${fade}[a${index}]`);
    return `[a${index}]`;
  });
  filters.push(`${audioInputs.join('')}concat=n=${segments.length}:v=0:a=1[aout]`);
  const total = durations.reduce((sum, value) => sum + value, 0);
  await run([
    ...args, '-filter_complex', filters.join(';'), '-map', video, '-map', '[aout]', '-t', String(total),
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '14', '-maxrate', '16M', '-bufsize', '32M',
    '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-ac', '2', '-movflags', '+faststart', output,
  ], workdir);
  return output;
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

async function extractAnchorAudio(source, start, seconds, output) {
  if (!await sourceHasAudio(source)) throw new Error('remix_hook_missing_original_audio');
  const duration = await sourceDuration(source);
  if (duration - start < seconds - 0.2) throw new Error('remix_hook_audio_too_short_for_timeline');
  await run([
    '-y', ...(start > 0 ? ['-ss', start.toFixed(2)] : []), '-i', source, '-vn',
    '-t', String(seconds), '-ar', '48000', '-ac', '2', '-c:a', 'pcm_s16le', output,
  ], path.dirname(output));
  return output;
}

export async function normalizeLoudness(input, output) {
  await run(['-y', '-i', input, '-map', '0:v:0', '-map', '0:a:0', '-c:v', 'copy',
    '-af', `loudnorm=I=${LOUDNESS.I}:TP=${LOUDNESS.TP}:LRA=${LOUDNESS.LRA}`,
    '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-movflags', '+faststart', output], path.dirname(output));
  return output;
}

export async function inspectRender(file, expectedDuration, { allowSilent = false } = {}) {
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
  if (!allowSilent && (metadata.loudnessLUFS === null || metadata.loudnessLUFS < -17 || metadata.loudnessLUFS > -11)) failures.push(`loudness_${metadata.loudnessLUFS}`);
  if (!allowSilent && (metadata.truePeakDBTP === null || metadata.truePeakDBTP > -1)) failures.push(`true_peak_${metadata.truePeakDBTP}`);
  if (failures.length) throw new Error(`cloud_render_quality_failed:${failures.join(',')}`);
  return metadata;
}

// Each scene is voiced on its own, as the local worker does. Its clip is
// padded or trimmed to the scene length, then the clips are joined into one
// track. Scene lengths grow to fit the voice. Any failure means no voice at
// all, so a half-narrated video is never shipped.
export async function renderVoiceTrack({ job, scenes, workdir, synthesize, timeoutMs, env = process.env, fetcher = fetch }) {
  const { voice, rate, language } = voiceFor(job);
  const parts = [];
  const providers = new Set();
  for (let index = 0; index < scenes.length; index += 1) {
    const scene = scenes[index];
    const base = scene.seconds ?? SEGMENT_SECONDS;
    const raw = path.join(workdir, `vo-${index}.mp3`);
    let voiceSeconds = 0;
    if (scene.vo && scene.vo.trim()) {
      const result = await synthesizeVoiceover({ text: scene.vo, voice, rate, language, outputPath: raw, synthesize, timeoutMs, env, fetcher });
      if (!result.ok) return { ok: false, reason: `scene_${index + 1}_${result.reason}` };
      providers.add(result.provider);
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
  return { ok: true, path: track, provider: [...providers].join('+') || 'none' };
}

export async function renderCloudVideo(job, downloadedInputs, onProgress = async () => {}, options = {}) {
  const workdir = renderWorkdirFor(job.id);
  await rm(workdir, { recursive: true, force: true });
  await mkdir(workdir, { recursive: true });
  let scenes = copyFor(job);
  const reference = downloadedInputs.find((item) => item.role === 'reference');
  const pacing = await referencePacing(reference, scenes.map((scene) => scene.seconds ?? SEGMENT_SECONDS));
  scenes.forEach((scene, index) => { scene.seconds = pacing.durations[index] ?? scene.seconds; });
  const prepared = await prepareAiHybridAssets({ job, downloadedInputs, scenes, workdir, onProgress, env: options.mediaEnv || process.env });
  const activeInputs = prepared.inputs;
  const sourceLed = sourceLedRemixPlan(job, activeInputs);
  let visual = sourceLed?.sources || selectSceneSources(activeInputs);
  if (!visual.length) throw new Error('missing_visual_input');
  const sparse = sourceLed
    ? { applied: false, warning: null, scenes: sourceLed.scenes }
    : sparseStoryboardForSingleSource(scenes, visual);
  scenes = sparse.scenes;
  const uploadedVoice = activeInputs.find((item) => item.role === 'voiceover' && String(item.type || '').startsWith('audio/'))?.localPath;
  const bgm = activeInputs.find((item) => item.role === 'bgm' && String(item.type || '').startsWith('audio/'))?.localPath;
  let voice = sourceLed ? null : (uploadedVoice || null);
  let voiceSource = sourceLed ? 'source_locked' : (uploadedVoice ? 'uploaded' : 'none');
  let voiceProvider = sourceLed ? null : (uploadedVoice ? 'uploaded' : null);
  let voiceError = null;
  if (!sourceLed && !uploadedVoice) {
    const timed = await renderVoiceTrack({ job, scenes, workdir, synthesize: options.synthesize, env: options.mediaEnv || process.env, fetcher: options.fetcher });
    if (timed.ok) {
      voice = timed.path;
      voiceSource = 'tts';
      voiceProvider = timed.provider;
    } else {
      voiceError = timed.reason;
    }
  }
  if (sourceLed) {
    const total = scenes.reduce((sum, scene) => sum + (scene.seconds ?? SEGMENT_SECONDS), 0);
    voice = await extractAnchorAudio(visual[0].localPath, scenes[0].sourceStart || 0, total, path.join(workdir, 'customer-anchor.wav'));
    voiceSource = 'customer_anchor';
    voiceProvider = 'original_source';
  }
  const segments = [];
  let preservedAudioSegments = 0;
  const durationBySource = new Map();
  for (const source of visual) {
    if (!durationBySource.has(source.localPath)) durationBySource.set(source.localPath, await sourceDuration(source.localPath));
  }
  for (let index = 0; index < scenes.length; index += 1) {
    const source = visual[index] || visual[index % visual.length];
    const customStarts = source.scene_starts ?? source.sceneStarts;
    const customStart = Array.isArray(customStarts) ? Number(customStarts[index]) : NaN;
    const plannedStart = Number(scenes[index].sourceStart);
    const start = Number.isFinite(plannedStart)
      ? plannedStart
      : Number.isFinite(customStart)
      ? customStart
      : sceneStarts(durationBySource.get(source.localPath) || 0, scenes, source)[index];
    const overlay = path.join(workdir, `overlay-${index}.png`);
    const segment = path.join(workdir, `segment-${index}.mp4`);
    await overlayPng(scenes[index], overlay);
    const wanted = scenes[index].seconds ?? SEGMENT_SECONDS;
    const renderSeconds = wanted + (index < scenes.length - 1 ? TRANSITION_SECONDS : 0);
    // Short clips loop (as the local worker does) so the scene keeps its length.
    const loop = !String(source.type || '').startsWith('image/') && durationBySource.get(source.localPath) < start + renderSeconds;
    const normalized = await normalizeSegment({
      source: source.localPath, type: source.type, overlay, output: segment,
      seconds: renderSeconds, start, loop, cropOverride: source.crop,
      fitMode: source.fit_mode ?? source.fitMode ?? 'fill',
      focusX: Array.isArray(source.focus_x ?? source.focusX)
        ? (source.focus_x ?? source.focusX)[index]
        : (source.focus_x ?? source.focusX ?? 0.5),
      preserveSourceAudio: sourceLed
        ? false
        : source.preserve_audio === true || source.preserveAudio === true,
      overlaySeconds: wanted,
    });
    if (normalized.hasAudio) preservedAudioSegments += 1;
    segments.push(segment);
    await onProgress(28 + index * 11, `云端正在编排第 ${index + 1}/${scenes.length} 段`);
  }
  const assembled = path.join(workdir, 'assembled.mp4');
  const durations = scenes.map((scene) => scene.seconds ?? SEGMENT_SECONDS);
  await assembleWithTransitions({ segments, durations, output: assembled, workdir });
  const finalPath = path.join(workdir, 'final-cloud.mp4');
  const mixed = await mixAudio(assembled, voice, bgm, path.join(workdir, 'mixed.mp4'));
  const hasMeaningfulAudio = Boolean(voice || bgm || preservedAudioSegments);
  const result = hasMeaningfulAudio
    ? await normalizeLoudness(mixed, finalPath)
    : (await copyFile(mixed, finalPath), finalPath);
  const expectedDuration = durations.reduce((sum, value) => sum + value, 0);
  const quality = await inspectRender(result, expectedDuration, { allowSilent: !hasMeaningfulAudio });
  await onProgress(90, '云端成片已生成，正在质检与回传');
  return {
    data: await readFile(result), durationSeconds: expectedDuration, width: WIDTH, height: HEIGHT,
    voiceSource, voiceProvider, voiceError, quality, mediaGeneration: prepared.generation,
    pacing: { ...pacing, finalDurations: durations }, transitionSeconds: TRANSITION_SECONDS,
    contentQuality: {
      uniqueVisualSources: new Set(visual.map((source) => source.localPath)).size,
      sparseLayout: sparse.applied,
      warning: sourceLed?.warnings?.length ? sourceLed.warnings : sparse.warning,
      audioStatus: hasMeaningfulAudio ? 'present' : 'silent_wrong_source_audio_removed',
      preservedAudioSegments,
      remixContract: sourceLed?.contract || null,
    },
  };
}
