import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import sharp from 'sharp';
import { initialPosterState, applyPosterRevision, validatePosterState, resolvePosterState, preparePosterSource, parentPosterSource } from '../api/_poster-revision.mjs';
import { generateOpenAiImage } from '../api/_cloud-media-providers.mjs';
import { posterGenerationPrompt } from '../api/_poster-current-brief.mjs';

const brief = '【本次制作需求】\n产品/服务：60分钟肩颈按摩体验\n风格：温馨治愈\n主标题：忙了一天，让肩颈歇一歇\n品牌：Lash Atelier Penang\n核心卖点与准确事实：RM98 首次体验 · 60分钟肩颈按摩 · 槟城\n行动引导：WhatsApp 预约\n尺寸：1080x1350';
const original = () => initialPosterState({ brief });
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const parent = { id: 'parent', workflow_mode: 'image_poster', status: 'completed', version_number: 1, brief, video_project_id: 'media-project', external_tenant_id: 'tenant-a', external_project_id: 'project-a', conversation_session_id: 'session-a' };
const child = (revision_prompt, extra = {}) => ({ ...parent, id: 'child', parent_job_id: 'parent', version_number: 2, revision_prompt, ...extra });
const correction = '只改文字和按钮颜色，保留当前按摩照片及排版：价格由 RM98 改成 RM108；主标题改为「下班后来放松」；按钮仍是「WhatsApp 预约」，颜色改为深绿色。品牌、60分钟和槟城保持，旧价格RM98不得残留。';

test('observed failure: persisted full revision changes exact copy, only button palette', () => {
  const plan = resolvePosterState(child(correction), parent);
  assert.equal(plan.state.title, '下班后来放松');
  assert.equal(plan.state.facts, 'RM108 首次体验 · 60分钟肩颈按摩 · 槟城');
  assert.equal(plan.state.brand, original().brand);
  assert.equal(plan.state.cta, original().cta);
  assert.equal(plan.state.buttonColor, '#006341');
  assert.equal(plan.replaceBackground, false);
});

for (const [name, text, key, expected] of [
  ['price only', '价格由RM98改成RM108', 'facts', 'RM108 首次体验 · 60分钟肩颈按摩 · 槟城'],
  ['title only', '主标题改为「下班后来放松」', 'title', '下班后来放松'],
  ['CTA only', '行动引导：Book on WhatsApp', 'cta', 'Book on WhatsApp'],
  ['button only', '仅按钮改深绿色', 'buttonColor', '#006341'],
  ['Traditional title', '主標題改為「下班後來放鬆」', 'title', '下班後來放鬆'],
]) test(name, () => {
  const before = original();
  const { state, replaceBackground } = applyPosterRevision(before, text);
  assert.equal(state[key], expected);
  const untouched = structuredClone(state); untouched[key] = before[key];
  assert.deepEqual(untouched, before);
  assert.equal(replaceBackground, false);
});

test('no inferred currency or amount from region, unknown market or project memory', () => {
  const state = initialPosterState({ brief: '品牌：旧品牌\n核心卖点与准确事实：RM999\n【本次制作需求】\n主标题：Unwind\n核心卖点与准确事实：S$68 First visit\n素材参考地区：香港' });
  assert.equal(state.brand, '');
  assert.equal(state.facts, 'S$68 First visit');
  assert.throws(() => applyPosterRevision(state, '价格改为108'), /exact_currency/);
});

test('English requirement in actual request rejects Chinese CTA before any generation', async () => {
  const job = { brief: '【本次制作需求】\n需求背景：所有标题、卖点和按钮请用英文\n主标题：Unwind after work\n品牌：Orchard Relax\n核心卖点与准确事实：S$68 First visit · 60-minute massage · Orchard Road\n行动引导：WhatsApp 咨询' };
  let calls = 0;
  await assert.rejects(preparePosterSource({ job, generate: () => { calls++; } }), /language_conflict_en/);
  assert.equal(calls, 0);
  const good = validatePosterState(initialPosterState({ brief: job.brief.replace('WhatsApp 咨询', 'Book on WhatsApp') }));
  assert.equal(good.cta, 'Book on WhatsApp');
});

test('Traditional copy and NT$ remain verbatim; no geographic translation', () => {
  const state = validatePosterState(initialPosterState({ brief: '主标题：下班後來放鬆\n品牌：信義舒活\n核心卖点与准确事实：NT$990 初次體驗 · 台北信義區\n行动引导：立即預約\n海报语言：繁體中文' }));
  assert.equal(state.title, '下班後來放鬆');
  assert.equal(state.facts, 'NT$990 初次體驗 · 台北信義區');
});

test('unrecognized edits fail honestly rather than reprinting old copy', () => {
  assert.throws(() => applyPosterRevision(original(), '换成更吸引人的说法'), /needs_explicit_fields/);
});

test('explicit permission changes photo, size-only preserves photo with new layout', () => {
  assert.equal(applyPosterRevision(original(), '明确允许更换照片，背景换成毛巾和植物').replaceBackground, true);
  const resize = applyPosterRevision({ ...original(), layout: { old: true } }, '比例改为1:1');
  assert.equal(resize.state.placement.width, 1080);
  assert.equal(resize.state.placement.height, 1080);
  assert.equal(resize.replaceBackground, false);
  assert.equal(resize.state.layout, null);
});

for (const key of ['external_tenant_id', 'external_project_id', 'conversation_session_id', 'video_project_id', 'version_number']) test(`wrong parent ${key} rejects`, () => {
  assert.throws(() => resolvePosterState(child('主标题改为「新标题」', { [key]: 'other' }), parent), /parent_(?:scope|version)_mismatch/);
});

test('legacy generated image lacks clean source: preserve refuses, never generates a replacement', async () => {
  let calls = 0;
  await assert.rejects(preparePosterSource({ job: child(correction), parent, generate: () => { calls++; } }), /editable_source_unavailable/);
  assert.equal(calls, 0);
});

test('continuous revisions load the immediate parent snapshot, never old original brief', async () => {
  const bytes = Buffer.from('same clean photo bytes');
  const state = applyPosterRevision(original(), '价格由RM98改成RM108').state;
  const p2 = { ...child('价格由RM98改成RM108'), status: 'completed', output_files: [{ poster_edit: { job_id: 'child', version: 2, state, source: { path: 'jobs/child/source.png', sha256: sha(bytes) } } }] };
  const p3 = { ...p2, id: 'third', parent_job_id: 'child', version_number: 3, revision_prompt: '主标题改为「下班后来放松」' };
  const result = await preparePosterSource({ job: p3, parent: p2, load: async (path, kind) => { assert.equal(path, 'jobs/child/source.png'); assert.equal(kind, 'result'); return bytes; }, generate: () => assert.fail('must not generate') });
  assert.match(result.state.facts, /RM108/);
  assert.equal(result.state.title, '下班后来放松');
  assert.deepEqual(result.source, bytes);
});

test('wrong source job path, wrong manifest version, corrupted source bytes reject', async () => {
  const make = () => ({ ...parent, output_files: [{ poster_edit: { job_id: 'parent', version: 1, state: original(), source: { path: 'jobs/parent/source.png', sha256: sha(Buffer.from('right')) } } }] });
  const p = make(); p.output_files[0].poster_edit.source.path = 'jobs/other/source.png';
  assert.throws(() => parentPosterSource(child(correction), p), /source_invalid/);
  const p2 = make(); p2.output_files[0].poster_edit.version = 8;
  assert.throws(() => parentPosterSource(child(correction), p2), /source_unavailable/);
  await assert.rejects(preparePosterSource({ job: child(correction), parent: make(), load: async () => Buffer.from('corrupt') }), /checksum_mismatch/);
});

test('customer main photo is actually consumed without generating', async () => {
  const photo = Buffer.from('customer photo bytes');
  const result = await preparePosterSource({ job: { brief, input_files: [{ role: 'main', path: 'jobs/p/main.jpg', type: 'image/jpeg' }] }, loadMain: async file => { assert.equal(file.path, 'jobs/p/main.jpg'); return photo; }, generate: () => assert.fail('no generation') });
  assert.deepEqual(result.source, photo);
});

test('real reference bytes and their roles reach editing; exclusions keep priority', async () => {
  const job = { brief: brief + '\n不能出现：不要真人或手部', input_files: [{ role: 'reference', path: 'jobs/p/ref.png', type: 'image/png' }] };
  const result = await preparePosterSource({ job, load: async () => Buffer.from('reference bytes'), generate: async request => {
    assert.deepEqual(request.referenceImages, [{ data: Buffer.from('reference bytes'), role: 'style_reference' }]);
    const prompt = posterGenerationPrompt({ brief: `主标题：${request.state.title}\n不能出现：${request.state.exclusions}` });
    assert.match(prompt, /不要真人或手部/);
    return { data: Buffer.from('generated with reference') };
  } });
  assert.equal(result.referenceCount, 1);
});

test('reference editing adapter sends actual multipart image bytes; gateway refuses before fetch', async () => {
  const image = await sharp({ create: { width: 10, height: 10, channels: 3, background: '#daaabb' } }).png().toBuffer();
  let calls = 0;
  const fetcher = async (url, options) => {
    calls++; assert.equal(url, 'https://api.openai.com/v1/images/edits');
    assert.deepEqual(Buffer.from(await options.body.get('image[]').arrayBuffer()), image);
    assert.equal(options.body.get('size'), '1024x1024');
    return new Response(JSON.stringify({ data: [{ b64_json: image.toString('base64') }] }));
  };
  await generateOpenAiImage({ prompt: 'test', size: '1024x1024', referenceImages: [{ data: image }], env: { AI_MEDIA_GENERATION_ENABLED: 'true', OPENAI_API_KEY: 'synthetic-test-token' }, fetcher });
  assert.equal(calls, 1);
  await assert.rejects(generateOpenAiImage({ prompt: 'test', referenceImages: [{ data: image }], env: { AI_MEDIA_GENERATION_ENABLED: 'true', AI_GATEWAY_API_KEY: 'synthetic' }, fetcher }), /requires_openai/);
  assert.equal(calls, 1);
});

test('negative photo permission is never permission to regenerate', () => {
  for (const denial of ['不允许换照片', '不能更换照片', '不要把背景换成其他照片']) {
    const plan = applyPosterRevision(original(), `${denial}，价格改为RM108`);
    assert.equal(plan.replaceBackground, false);
  }
});

test('CTA plus its independent color change both apply', () => {
  const { state } = applyPosterRevision(original(), '按钮改成「Book now」，按钮颜色改为深绿色');
  assert.equal(state.cta, 'Book now');
  assert.equal(state.buttonColor, '#006341');
});

test('recognized correction cannot conceal another ambiguous edit or unsupported field', () => {
  for (const edit of ['价格改为RM108，标题改一下', '主标题改为「新标题」，背景变成红色', '价格改为RM108；不能出现：真人', '价格改为RM108，保留照片但背景变成红色']) {
    assert.throws(() => applyPosterRevision(original(), edit), /unsupported/);
  }
  const { state } = applyPosterRevision(original(), '海报语言：英文；主标题：Unwind；品牌：Relax；核心卖点与准确事实：S$68 First visit；行动引导：Book now');
  validatePosterState(state);
  assert.equal(state.title, 'Unwind');
  assert.equal(state.cta, 'Book now');
  assert.equal(state.facts, 'S$68 First visit');
  assert.throws(() => applyPosterRevision(original(), '主标题：新标题，价格改为RM108'), /unsupported/);
  const combined = applyPosterRevision(original(), '主标题：新标题；价格改为RM108').state;
  assert.equal(combined.title, '新标题');
  assert.match(combined.facts, /RM108/);
});

test('existing poster modes never treat flattened lettering as a clean photo', async () => {
  let generated = 0;
  const generate = () => { generated++; };
  await assert.rejects(preparePosterSource({ job: { brief: brief + '\n制作方式：参考上传海报重制' }, generate }), /remake_requires_reference/);
  await assert.rejects(preparePosterSource({ job: { brief: brief + '\n制作方式：检验并优化现有海报', input_files: [{ role: 'main', path: 'poster-with-old-price.jpg' }] }, generate }), /flattened_poster_edit_requires_editable_source/);
  assert.equal(generated, 0);
});

test('existing failed-photo retry reuses inherited main, while normal failed parent is refused', async () => {
  const file = { role: 'main', path: 'jobs/parent/main.jpg', type: 'image/jpeg' };
  const failed = { ...parent, status: 'failed', input_files: [file] };
  const retry = child('失败任务复用原素材重试', { revision_scope: 'retry_failed', input_files: [file] });
  const result = await preparePosterSource({ job: retry, parent: failed, loadMain: async () => Buffer.from('owned-original'), generate: () => assert.fail('no generation') });
  assert.equal(result.source.toString(), 'owned-original');
  assert.throws(() => resolvePosterState(child('价格改为RM108'), failed), /parent_not_available/);
});


test('price thousands separators are never silently truncated; duplicate instructions conflict', () => {
  const state = applyPosterRevision(original(), '价格改为RM1,108').state;
  assert.equal(state.facts, 'RM1,108 首次体验 · 60分钟肩颈按摩 · 槟城');
  assert.throws(() => applyPosterRevision(original(), '价格改为RM108，价格改RM118'), /unsupported/);
});


test('retry of failed revision cannot revert corrected facts to original brief', async () => {
  const file = { role: 'main', path: 'jobs/parent/main.jpg', type: 'image/jpeg' };
  const failedRevision = { ...child('价格由RM98改成RM108'), status: 'failed', input_files: [file], brief: brief + '\n【基于上一版继续优化】\n价格由RM98改成RM108' };
  const retry = { ...failedRevision, id: 'retry', parent_job_id: failedRevision.id, version_number: 3, revision_scope: 'retry_failed', revision_prompt: '失败任务复用原素材重试' };
  await assert.rejects(preparePosterSource({ job: retry, parent: failedRevision, loadMain: () => assert.fail('must not use old input facts') }), /retry_revision_state_unavailable/);
});


test('explicit preserved layout cannot silently be discarded by ratio or font changes', () => {
  const state = { ...original(), layout: { title: { left: 81, top: 700, width: 918, height: 100 } } };
  for (const request of ['标题放大，保留布局', '比例改为1:1，保持布局']) assert.throws(() => applyPosterRevision(state, request), /conflicting_layout_instructions/);
  assert.equal(applyPosterRevision(state, '比例改为1:1，保留照片').state.layout, null);
});


test('confirmed English language aliases cannot bypass all-visible-copy checks', () => {
  for (const language of ['全英文', '全部英文', 'Singapore English', 'en-SG']) {
    assert.throws(() => validatePosterState(initialPosterState({ brief: `主标题：Unwind\n行动引导：WhatsApp 咨询\n海报语言：${language}` })), /language_conflict_en/);
  }
});
