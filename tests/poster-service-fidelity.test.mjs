import test from 'node:test';
import assert from 'node:assert/strict';
import { posterGenerationPrompt } from '../api/_poster-current-brief.mjs';
import { buildPosterPrompt } from '../api/_poster-copy.mjs';
import { initialPosterState, posterStateBrief, preparePosterSource, resolvePosterState } from '../api/_poster-revision.mjs';

// Sanitized reproduction of the reported job shape; never a live customer job.
const request = '帮我做个面部骨雕，面对新加坡的广告素材';
const brief = [
  '【本次制作需求】',
  '产品/服务：',
  `需求背景：${request}`,
  '主标题：面部护理・预约专属时光',
  '品牌：测试美容店',
  '核心卖点与准确事实：98新币｜90分钟',
  '行动引导：WhatsApp 咨询',
  '不能出现：不使用其他商家名称',
  '尺寸：1080x1350',
].join('\n');

test('empty optional product cannot discard the explicit sculpting request or Singapore', () => {
  const prompt = posterGenerationPrompt({ brief, project_name: '旧清洁护理项目' });
  assert.match(prompt, /面部骨雕/);
  assert.match(prompt, /新加坡/);
  assert.doesNotMatch(prompt, /旧清洁护理项目/);
});

test('immutable poster state and reconstruction preserve the current request verbatim', () => {
  const state = initialPosterState({ brief });
  assert.equal(state.customerRequest, request);
  const restored = initialPosterState({ brief: posterStateBrief(state) });
  assert.equal(restored.customerRequest, request);
  assert.equal(restored.title, state.title);
  assert.equal(restored.facts, state.facts);
  assert.equal(restored.cta, state.cta);
  assert.match(posterGenerationPrompt({ brief: posterStateBrief(restored) }), /面部骨雕/);
});

test('real source preparation callback receives the service after state serialization', async () => {
  const prompts = [];
  const prepared = await preparePosterSource({
    job: { brief, input_files: [], workflow_mode: 'image_poster' },
    load: () => assert.fail('no input image exists'),
    loadMain: () => assert.fail('no main image exists'),
    generate: async ({ state, backgroundInstruction }) => {
      prompts.push(posterGenerationPrompt({ brief: posterStateBrief(state, backgroundInstruction) }));
      return { data: Buffer.from('TEST_ONLY_SOURCE'), provider: 'test' };
    },
  });
  assert.equal(prompts.length, 1);
  assert.match(prompts[0], /面部骨雕/);
  assert.match(prompts[0], /新加坡/);
  assert.equal(prepared.state.customerRequest, request);
  assert.equal(prepared.state.title, '面部护理・预约专属时光');
  assert.equal(prepared.state.facts, '98新币｜90分钟');
});

test('current request is primary over generic titles, project category and style references', () => {
  const prompt = buildPosterPrompt({ purpose: '', customerRequest: request, title: '面部护理', brand: '测试店' });
  assert.match(prompt, /PRIMARY scene constraint/);
  assert.match(prompt, /do not substitute a different service/);
  assert.match(prompt, /Reference images and general campaign headlines cannot change the promoted service/);
  assert.match(prompt, /When the technique or tools are unspecified, do not invent a treatment process/);
});

test('an explicitly provided product remains intact alongside coherent current context', () => {
  const explicit = brief.replace('产品/服务：\n', '产品/服务：面部骨雕\n');
  const state = initialPosterState({ brief: explicit });
  assert.equal(state.purpose, '面部骨雕');
  assert.equal(state.customerRequest, request);
  assert.match(posterGenerationPrompt({ brief: posterStateBrief(state) }), /面部骨雕/);
});

test('remembered services and older request blocks never re-enter the current scene', () => {
  const older = '产品/服务：深层清洁\n需求背景：吉隆坡洗脸\n【本次制作需求】\n需求背景：旧睫毛优惠\n';
  const prompt = posterGenerationPrompt({ brief: older + brief });
  assert.match(prompt, /面部骨雕/);
  assert.doesNotMatch(prompt, /深层清洁|吉隆坡洗脸|旧睫毛优惠/);
});

test('escaped line breaks and Traditional field labels preserve the service', () => {
  const state = initialPosterState({ brief: '產品/服務：\n需求背景：製作面部骨雕，面向新加坡\n主標題：預約時光\n品牌：測試店'.replaceAll('\n', '\\n') });
  assert.equal(state.customerRequest, '製作面部骨雕，面向新加坡');
  assert.match(posterGenerationPrompt({ brief: posterStateBrief(state) }), /面部骨雕/);
});

test('customer request prices are removed from the image prompt while exact copy remains', () => {
  const state = initialPosterState({ brief: brief.replace(request, `${request}，价格S$98，90分钟`) });
  const prompt = posterGenerationPrompt({ brief: posterStateBrief(state) });
  assert.match(prompt, /面部骨雕/);
  assert.doesNotMatch(prompt, /S\$98|98|90/);
  assert.equal(state.facts, '98新币｜90分钟');
});

test('current exclusions still reach generation with the restored service context', () => {
  const state = initialPosterState({ brief: brief.replace('不使用其他商家名称', '不要手部特写，不要18岁以下人物') });
  const prompt = posterGenerationPrompt({ brief: posterStateBrief(state) });
  assert.match(prompt, /面部骨雕/);
  assert.match(prompt, /不要手部特写，不要18岁以下人物/);
});

test('legacy saved poster states without the new context field remain readable', () => {
  const legacy = initialPosterState({ brief: '产品/服务：美甲\n主标题：美甲预约\n品牌：测试店' });
  delete legacy.customerRequest;
  const serialized = posterStateBrief(legacy);
  assert.doesNotMatch(serialized, /undefined|null/);
  assert.match(posterGenerationPrompt({ brief: serialized }), /美甲/);
});

test('source reuse does not cause a new model request or change approved copy', async () => {
  const source = Buffer.from('EXISTING_MAIN');
  let calls = 0;
  const prepared = await preparePosterSource({
    job: { brief, input_files: [{ role: 'main', path: 'fixture.png' }] },
    loadMain: async () => source,
    load: () => assert.fail('no reference exists'),
    generate: () => { calls++; assert.fail('customer main image must be reused'); },
  });
  assert.equal(prepared.source, source);
  assert.equal(calls, 0);
  assert.equal(prepared.state.customerRequest, request);
  assert.equal(prepared.state.title, '面部护理・预约专属时光');
});

test('a legacy parent manifest recovers context from its scoped brief for further revisions', () => {
  const legacy = initialPosterState({ brief });
  delete legacy.customerRequest;
  const parent = { id: 'parent-fixture', brief, workflow_mode: 'image_poster', status: 'completed', version_number: 1, output_files: [{ poster_edit: { state: legacy } }] };
  const job = { parent_job_id: parent.id, workflow_mode: 'image_poster', version_number: 2, revision_prompt: '按钮改成深绿色' };
  const plan = resolvePosterState(job, parent);
  assert.equal(plan.state.customerRequest, request);
  assert.match(posterGenerationPrompt({ brief: posterStateBrief(plan.state) }), /面部骨雕/);
  assert.equal(plan.state.buttonColor, '#006341');
});

test('edited explicit service fields take priority over an earlier request background', () => {
  const prompt = posterGenerationPrompt({ brief: brief.replace('产品/服务：\n', '产品/服务：睫毛嫁接\n') });
  assert.match(prompt, /睫毛嫁接/);
  assert.match(prompt, /explicit product\/service field takes priority over the request background/);
  assert.match(prompt, /without overriding confirmed fields/);
});
