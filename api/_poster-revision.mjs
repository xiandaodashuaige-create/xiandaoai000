// One immutable rendering snapshot per existing job/version. No customer facts
// are inferred from a market, reference, project memory, or the image model.
import crypto from 'node:crypto';
import { currentPosterBrief } from './_poster-current-brief.mjs';
import { parsePosterFacts, posterPlacement } from './_poster-copy.mjs';

const MARKER = '【基于上一版继续优化】';
const sha = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const normalize = (value) => String(value || '').replaceAll('\\n', '\n');
const englishLanguage = value => !/双语|雙語|bilingual|中英/iu.test(value) && /(?:^en(?:[-_][a-z]{2,})?$|english|英语|英語|英文)/iu.test(value);
const fail = (code) => { throw new Error(`poster_${code}`); };
const field = (text, labels, fallback = '') => {
  for (const label of labels) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const hit = text.match(new RegExp(`(?:^|\\n)${escaped}[：:]([^\\n]*)`));
    if (hit) return hit[1].trim();
  }
  return fallback;
};

export function initialPosterState(job) {
  const request = currentPosterBrief(job.brief).split(MARKER)[0];
  const language = field(request, ['海报语言', '海報語言', '语言', '語言']);
  const englishRequired = /全部英文|全英文|所有[^\n。]*英文|only\s+english|all\s+(?:text\s+in\s+)?english/iu.test(field(request, ['需求背景']));
  if (englishRequired && language && !englishLanguage(language)) fail('language_conflict_en_confirm_copy');
  return {
    schema: 'poster-edit-v1',
    title: field(request, ['主标题', '主標題'], job.project_name || ''),
    brand: field(request, ['品牌', '客户', '客戶']),
    facts: field(request, ['核心卖点与准确事实', '核心賣點與準確事實', '准确价格/优惠/事实']),
    cta: field(request, ['行动引导', '行動引導']),
    language: language || (englishRequired ? 'en' : ''),
    placement: posterPlacement(request),
    purpose: field(request, ['产品/服务', '產品/服務']),
    // Keep the customer's current scene direction even when the optional
    // product field is empty. This snapshot survives the worker's round trip.
    customerRequest: field(request, ['需求背景']),
    creationMethod: field(request, ['制作方式', '製作方式'], '新做一张营销海报'),
    style: field(request, ['风格', '風格']),
    exclusions: field(request, ['不能出现', '不能出現', '禁止出现', '禁止出現']),
    titleScale: 1, priceScale: 1, buttonColor: null,
    layout: null, palette: null,
  };
}

const COLORS = [
  [/深绿|深綠|dark\s*green/iu, '#006341'], [/墨绿|墨綠/iu, '#164b3a'],
  [/浅绿|淺綠|light\s*green/iu, '#a3d9a5'], [/粉/u, '#e87aa0'],
  [/红|紅/u, '#e5483f'], [/金|黄|黃/u, '#e8b83a'], [/橙/u, '#f08a3c'],
  [/绿|綠|green/iu, '#3fbf7f'], [/蓝|藍/u, '#4a8fe8'], [/紫/u, '#9a6be0'],
  [/白/u, '#f3f3f3'], [/黑/u, '#151515'],
];

function requestedText(text, label) {
  // Explicit field assignments (recommended caller contract), or a bounded
  // Chinese correction. Quoted values may contain commas and punctuation.
  const direct = text.match(new RegExp(`(?:^|[\\n；;])\\s*${label}\\s*[：:]\\s*(?:[「“"]([^」”"]+)[」”"]|([^；;\\n]+))`));
  if (direct) {
    const value = (direct[1] || direct[2]).trim();
    if (!direct[1] && /(?:价格|價格|标题|標題|按钮|按鈕|CTA|背景)\s*(?:改|换|換|变|變|[：:])/u.test(value)) fail('revision_contains_unsupported_change');
    return { value, raw: direct[0] };
  }
  const verb = '(?:由\\s*[「“"《][^」”"》]*[」”"》]\\s*)?(?:改成|改为|改為|换成|換成|替换为|替換為)';
  const hit = text.match(new RegExp(`${label}\\s*${verb}\\s*(?:[「“"《]([^」”"》]+)[」”"》]|([^；;，,。\\n]+))`, 'u'));
  return hit ? { value: (hit[1] || hit[2]).trim(), raw: hit[0] } : null;
}

export function applyPosterRevision(previous, revision) {
  const state = structuredClone(previous);
  const text = normalize(revision).trim();
  if (!text) fail('revision_missing');
  let changes = 0;
  const consumed = Array(text.length).fill(false);
  const consume = raw => { const start = text.indexOf(raw); if (start >= 0) consumed.fill(true, start, start + raw.length); };
  consume('只改文字和按钮颜色'); consume('只改文字和按鈕顏色');
  for (const [key, labels] of [['title', ['主标题', '标题', '主標題', '標題']], ['cta', ['行动引导', '行動引導', 'CTA', '按钮文字', '按鈕文字']], ['facts', ['核心卖点与准确事实', '核心賣點與準確事實']], ['brand', ['品牌']], ['language', ['海报语言', '海報語言', '语言', '語言']]]) {
    for (const label of labels) {
      const value = requestedText(text, label);
      if (value?.value) { state[key] = value.value; consume(value.raw); changes++; break; }
    }
  }
  const priceClause = text.match(/(?:价格|價格|价钱|價錢|金额|金額)\s*(?:由\s*[^；;，。\n]+?\s*)?(?:改成|改为|改為|换成|換成|改|[：:])\s*([^；;，。\n]+)/u)
    || text.match(/((?:RM|HK\$|S\$|NT\$|US\$|USD|TWD|HKD|SGD|\$)\s*\d[\d,.]*)\s*(?:改成|改为|改為|改|换成|換成)\s*([^；;，。\n]+)/iu);
  if (priceClause) {
    const value = priceClause.at(-1).trim().replace(/^[「“"]|[」”"]$/gu, '');
    const next = parsePosterFacts(value).price;
    const old = parsePosterFacts(state.facts).price;
    if (!old || !next || next !== value) fail('price_correction_needs_exact_currency_and_amount');
    state.facts = state.facts.split(old).join(next);
    consume(priceClause[0]); changes++;
  }
  const cta = text.match(/(?:按钮|按鈕)\s*(?:改成|改为|改為|写|寫)\s*[「“"]([^」”"]+)[」”"]/u);
  if (cta) { state.cta = cta[1]; consume(cta[0]); changes++; }
  const explicitColor = text.match(/(?:按钮|按鈕)(?:的)?(?:颜色|顏色|色)\s*(?:改成|改为|改為|换成|換成|改|[：:])\s*([^；;，,。\n]+)/u)
    || text.match(/(?:按钮|按鈕)[^；;。\n]*?[,，]\s*(?:颜色|顏色)\s*(?:改为|改為|改成|换成|換成)\s*([^；;，,。\n]+)/u);
  const colorClause = explicitColor || text.match(/(?:仅|只)?(?:按钮|按鈕)\s*(?:改成|改为|改為|换成|換成|改)\s*([^「“"；;，,。\n]+)/u);
  if (colorClause) {
    const value = colorClause[1];
    const color = value.match(/#[a-f\d]{6}\b/iu)?.[0] || COLORS.find(([re]) => re.test(value))?.[1];
    if (!color) fail('button_color_unsupported');
    state.buttonColor = color;
    consume(colorClause[0]); changes++;
  }
  const size = text.match(/(?:尺寸|比例)[^；;，,。\n]*?(1080\s*[x×]\s*(?:1080|1350|1920)|1\s*:\s*1|4\s*:\s*5|9\s*:\s*16)/iu);
  if (size) {
    const value = size[1].replace(/\s/g, '');
    const dimensions = ({ '1:1': '1080x1080', '4:5': '1080x1350', '9:16': '1080x1920' })[value] || value;
    state.placement = posterPlacement(`尺寸：${dimensions}`);
    state.layout = null;
    consume(size[0]); changes++;
  }
  for (const [pattern, key, value] of [
    [/(?:主标题|标题|標題)[^；;，,。\n]*(?:再大|放大|更大)/u, 'titleScale', 1.3],
    [/(?:价格|價格)[^；;，,。\n]*(?:再大|放大|更大)/u, 'priceScale', 1.25],
  ]) {
    const hit = text.match(pattern);
    if (hit) { state[key] = value; state.layout = null; consume(hit[0]); changes++; }
  }
  let preserve = /(?:保留|保持|不换|不換).*(?:照片|主图|主圖|主体|主體|背景)|(?:same|keep).*(?:photo|image|background)/iu.test(text);
  let replace = false;
  for (const clause of text.split(/[；;，,。\n]/u)) {
    if (!/(?:照片|主图|主圖|背景)/u.test(clause)) continue;
    if (/(?:不允许|不允許|不可以|不能|不可|不要|不换|不換).*(?:换|換|重新生成)/u.test(clause)) {
      preserve = true; consume(clause); continue;
    }
    if (/(?:允许|允許|可以|同意).*(?:更换|更換|换|換|重新生成).*(?:照片|主图|主圖|背景)|(?:照片|主图|主圖|背景)\s*(?:换成|換成|改成|改为|改為)/u.test(clause)) {
      replace = true; consume(clause);
    }
  }
  for (const keep of text.matchAll(/(?:保留|保持)[^改换換变變；;，,。:：\n]*(?:照片|主图|主圖|排版|布局)[^改换換变變；;，,。:：\n]*[：:]?/gu)) consume(keep[0]);
  if (preserve && replace) fail('conflicting_photo_instructions');
  if (replace) { state.layout = null; changes++; }
  if (previous.layout && !state.layout && /(?:保留|保持|不(?:要)?改(?:变|變))[^；;，,。\n]*(?:布局|排版)/u.test(text)) fail('conflicting_layout_instructions');
  if (!changes) fail('revision_needs_explicit_fields');
  let remaining = text.split('').map((char, index) => consumed[index] ? ' ' : char).join('');
  remaining = remaining.replace(/只改文字和按钮颜色|只改文字和按鈕顏色/gu, '');
  if (/(?:^|[；;，,。\n])\s*[^：:；;，,。\n]{1,24}[：:]/u.test(remaining)) fail('revision_contains_unsupported_field');
  if (/改|换|換|变成|變成|重新生成|调成|調成/u.test(remaining)) fail('revision_contains_unsupported_change');
  return { state, replaceBackground: replace, backgroundInstruction: replace ? text : '' };
}

export function validatePosterState(state) {
  for (const [key, limit] of [['title', 90], ['brand', 64], ['cta', 90], ['facts', 300]]) {
    if (typeof state[key] !== 'string' || [...state[key]].length > limit) fail(`copy_invalid_${key}`);
  }
  if (!state.title.trim()) fail('title_required');
  if (parsePosterFacts(state.facts, { strict: true }).lines.length > 3) fail('copy_too_many_fact_lines');
  if (englishLanguage(state.language) && [state.title, state.brand, state.facts, state.cta].some(text => /\p{Script=Han}/u.test(text))) fail('language_conflict_en_confirm_copy');
  return state;
}

export function assertPosterParent(job, parent) {
  if (!parent || parent.id !== job.parent_job_id || parent.workflow_mode !== 'image_poster' || !(parent.status === 'completed' || (parent.status === 'failed' && job.revision_scope === 'retry_failed'))) fail('parent_not_available');
  for (const key of ['video_project_id', 'external_tenant_id', 'external_project_id', 'conversation_session_id', 'correlation_id']) {
    if ((job[key] || null) !== (parent[key] || null)) fail('parent_scope_mismatch');
  }
  if (Number(job.version_number) !== Number(parent.version_number || 1) + 1) fail('parent_version_mismatch');
}

export function resolvePosterState(job, parent = null) {
  let state;
  let replaceBackground = false;
  let backgroundInstruction = '';
  if (job.parent_job_id) {
    assertPosterParent(job, parent);
    const saved = parent.output_files?.find(file => file.poster_edit?.state?.schema === 'poster-edit-v1')?.poster_edit;
    if (!saved?.state && job.revision_scope === 'retry_failed' && parent.parent_job_id) fail('retry_revision_state_unavailable');
    state = saved?.state ? structuredClone(saved.state) : initialPosterState(parent);
    // Older editable manifests lack this optional field. Recover only from
    // the same validated parent's current brief, never from project memory.
    state.customerRequest ??= field(currentPosterBrief(parent.brief).split(MARKER)[0], ['需求背景']);
    if (job.revision_scope !== 'retry_failed') ({ state, replaceBackground, backgroundInstruction } = applyPosterRevision(state, job.revision_prompt));
  } else {
    state = initialPosterState(job);
    // Standalone renderer use is supported for tests/internal tools, but the
    // live worker always resolves/validates a real parent before revision I/O.
    for (const revision of currentPosterBrief(job.brief).split(MARKER).slice(1)) ({ state, replaceBackground, backgroundInstruction } = applyPosterRevision(state, revision));
  }
  validatePosterState(state);
  return { state, replaceBackground, backgroundInstruction };
}

export function posterStateBrief(state, backgroundInstruction = '') {
  return [`产品/服务：${state.purpose}`, `需求背景：${state.customerRequest || ''}`, `主标题：${state.title}`, `品牌：${state.brand}`, `核心卖点与准确事实：${state.facts}`, `行动引导：${state.cta}`, `风格：${state.style}`, `不能出现：${state.exclusions}`, `尺寸：${state.placement.width}x${state.placement.height}`, backgroundInstruction ? `${MARKER}\n${backgroundInstruction}` : ''].filter(Boolean).join('\n');
}

export function parentPosterSource(job, parent) {
  assertPosterParent(job, parent);
  const edit = parent.output_files?.find(file => file.poster_edit)?.poster_edit;
  if (!edit || edit.job_id !== parent.id || Number(edit.version) !== Number(parent.version_number || 1)) fail('editable_source_unavailable');
  if (!edit.source?.path?.startsWith(`jobs/${parent.id}/`) || edit.source.path.split('/').some(part => !part || part === '..' || part.includes('\\')) || !/^[a-f\d]{64}$/u.test(edit.source.sha256 || '')) fail('editable_source_invalid');
  return edit.source;
}

export function verifyPosterSource(bytes, source) {
  if (sha(bytes) !== source.sha256) fail('editable_source_checksum_mismatch');
  return bytes;
}

export async function preparePosterSource({ job, parent, load, generate, loadMain }) {
  const plan = resolvePosterState(job, parent);
  let source, generation = null;
  const inputs = Array.isArray(job.input_files) ? job.input_files : [];
  const main = inputs.find(file => file.role === 'main');
  const references = inputs.filter(file => ['reference', 'style_reference'].includes(file.role));
  if (/参考上传海报重制|參考上傳海報重製/u.test(plan.state.creationMethod) && !references.length && !job.parent_job_id) fail('remake_requires_reference');
  if (/检验并优化现有海报|檢驗並優化現有海報/u.test(plan.state.creationMethod) && !job.parent_job_id) fail('flattened_poster_edit_requires_editable_source');
  if (references.length > 3) fail('reference_limit');
  if (references.some(file => !/^image\/(jpeg|png|webp)$/u.test(file.type))) fail('reference_requires_image');
  if (job.parent_job_id && job.revision_scope === 'retry_failed' && parent.status === 'failed' && main?.path && parent.input_files?.some(file => file.role === 'main' && file.path === main.path)) {
    source = await loadMain(main);
  } else if (job.parent_job_id && !plan.replaceBackground) {
    const saved = parentPosterSource(job, parent);
    source = verifyPosterSource(await load(saved.path, 'result'), saved);
  } else if (main?.path && !references.length && !plan.replaceBackground) {
    source = await loadMain(main);
  } else {
    const referenceImages = [];
    if (main?.path) referenceImages.push({ data: await loadMain(main), role: 'customer_subject' });
    for (const reference of references) referenceImages.push({ data: await load(reference.path, 'input'), role: 'style_reference' });
    generation = await generate({ state: plan.state, backgroundInstruction: plan.backgroundInstruction, referenceImages });
    source = generation.data;
  }
  return { ...plan, source, generation, referenceCount: references.length };
}
