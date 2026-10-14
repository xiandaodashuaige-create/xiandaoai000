import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { posterBrief, preparePosterSource, posterGenerationPrompt } from '../api/_poster-brief.mjs';
import { generateOpenAiImage } from '../api/_cloud-media-providers.mjs';
import { renderPoster } from '../api/video-worker.mjs';

const env = { AI_MEDIA_GENERATION_ENABLED: 'true', OPENAI_API_KEY: 'test-only' };
const job = { brief: '【海报制作】\n制作方式：新做一张营销海报\n视觉风格：黑金\n主标题：广告咨询有跟进\n核心卖点与准确事实：集中整理咨询，方便店员跟进\n行动引导：预约产品演示\n品牌：LULIAN AI' };
const fixture = () => sharp({ create: { width: 1200, height: 1500, channels: 3, background: '#222222' } }).webp().toBuffer();

test('current request overrides old project copy; revisions override explicit fields', () => {
  const result = posterBrief({ brief: '主标题：旧品牌\n【本次制作需求】\n主标题：预约按摩体验\n视觉风格：black_gold', revision_prompt: '主标题：周末放松体验\n视觉风格：酒红' });
  assert.equal(result.title, '周末放松体验');
  assert.equal(result.style, 'burgundy');
  assert.equal(result.brand, '');
});

test('customer main without references does not spend or replace actual material', async () => {
  const actual = await fixture();
  const result = await preparePosterSource({ job, main: { role: 'main' }, load: async () => actual, generate: () => { throw new Error('must not generate'); } });
  assert.equal(result.source, actual);
  assert.equal(result.metadata.composition, 'customer_image_with_typeset_copy');
});

test('style reference is passed as bytes after actual main; never replaces main', async () => {
  const actual = Buffer.from('actual'), style = Buffer.from('style');
  let calls = 0;
  const result = await preparePosterSource({ job, main: { role: 'main' }, references: [{ role: 'reference', type: 'image/png' }], load: async item => item.role === 'main' ? actual : style, generate: async args => {
    calls++;
    assert.equal(args.referenceImages[0].data, actual);
    assert.equal(args.referenceImages[1].data, style);
    assert.match(args.prompt, /STYLE references only/);
    assert.match(args.prompt, /preserve its identity/);
    return { data: actual, model: 'test' };
  } });
  assert.equal(calls, 1);
  assert.equal(result.metadata.reference_count, 1);
});

test('remake and optimization reject missing inputs before spending', async () => {
  const noLoad = () => { throw new Error('must not load'); };
  await assert.rejects(preparePosterSource({ job: { brief: '制作方式：参考上传海报重制' }, load: noLoad }), /requires_reference/);
  await assert.rejects(preparePosterSource({ job: { brief: '制作方式：检验并优化现有海报' }, load: noLoad }), /requires_main/);
});

test('image edit uses multipart image bytes and exactly one generated image', async () => {
  const input = await fixture();
  const output = await generateOpenAiImage({ prompt: posterGenerationPrompt(job), referenceImages: [{ data: input }], env, fetcher: async (url, options) => {
    assert.equal(url, 'https://api.openai.com/v1/images/edits');
    assert.ok(options.body instanceof FormData);
    assert.equal(options.body.get('n'), '1');
    assert.equal(options.body.get('input_fidelity'), null);
    assert.equal(options.headers['Content-Type'], undefined);
    assert.equal(options.body.getAll('image[]').length, 1);
    assert.deepEqual(Buffer.from(await options.body.get('image[]').arrayBuffer()), input);
    return new Response(JSON.stringify({ data: [{ b64_json: input.toString('base64') }] }));
  } });
  assert.equal(output.width, 1200);
});

test('gateway-only environment cannot silently ignore a style reference', async () => {
  await assert.rejects(generateOpenAiImage({ prompt: 'x', referenceImages: [{ data: await fixture() }], env: { AI_MEDIA_GENERATION_ENABLED: 'true', AI_GATEWAY_API_KEY: 'test-only' }, fetcher: () => { throw new Error('must not fetch'); } }), /requires_openai_key/);
});

test('poster styles render exact dimensions even with long CTA and smaller square output', async () => {
  for (const [size, style] of [['1080x1350', 'black_gold'], ['640x640', 'burgundy'], ['1080x1920', 'brand_green']]) {
    const output = await renderPoster({ brief: `${job.brief}\n尺寸：${size}`, revision_prompt: `视觉风格：${style}\n行动引导：预约咨询，了解服务与可用时间` }, await fixture());
    const meta = await sharp(output).metadata();
    assert.deepEqual([meta.width, meta.height], size.split('x').map(Number));
  }
});

test('oversized copy fails explicitly instead of truncating prices or CTA', () => {
  assert.throws(() => posterBrief({ brief: '行动引导：' + '长'.repeat(49) }), /too_long_cta/);
});
