import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import sharp from 'sharp';
import {
  generateAiVideoClip,
  generateOpenAiImage,
  mediaProviderCapabilities,
  prepareAiHybridAssets,
} from '../api/_cloud-media-providers.mjs';

const json = (value, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { 'content-type': 'application/json' },
});
const video = () => new Response(Buffer.alloc(2048, 7), {
  status: 200, headers: { 'content-type': 'video/mp4' },
});

test('capabilities are false until the paid-generation switch is explicit', () => {
  assert.deepEqual(mediaProviderCapabilities({ OPENAI_API_KEY: 'secret', ARK_API_KEY: 'secret' }), {
    enabled: false, image: false, imageProvider: null, video: false, videoProvider: null, seedance: false, runway: false,
  });
  assert.equal(mediaProviderCapabilities({ AI_MEDIA_GENERATION_ENABLED: 'true', OPENAI_API_KEY: 'secret' }).image, true);
  assert.equal(mediaProviderCapabilities({ AI_MEDIA_GENERATION_ENABLED: 'true', RUNWAYML_API_SECRET: 'secret' }).videoProvider, 'runway');
});

test('GPT image adapter sends the restored model contract and validates the image', async () => {
  const fixture = await sharp({ create: { width: 1088, height: 1360, channels: 3, background: '#176b4b' } }).webp().toBuffer();
  let request;
  const result = await generateOpenAiImage({
    prompt: 'premium spa background without text',
    env: { AI_MEDIA_GENERATION_ENABLED: 'true', OPENAI_API_KEY: 'test-key' },
    fetcher: async (url, init) => { request = { url, init, body: JSON.parse(init.body) }; return json({ data: [{ b64_json: fixture.toString('base64') }] }); },
  });
  assert.equal(request.url, 'https://api.openai.com/v1/images/generations');
  assert.equal(request.init.headers.Authorization, 'Bearer test-key');
  assert.equal(request.body.model, 'gpt-image-2');
  assert.equal(request.body.size, '1088x1360');
  assert.equal(request.body.output_format, 'webp');
  assert.equal(result.type, 'image/webp');
  assert.equal(result.width, 1088);
  assert.equal(result.height, 1360);
  assert.match(result.sha256, /^[a-f0-9]{64}$/);
});

test('Runway creates, polls and downloads a vertical clip', async () => {
  const calls = [];
  const result = await generateAiVideoClip({
    prompt: 'vertical beauty commercial', duration: 5,
    env: { AI_MEDIA_GENERATION_ENABLED: 'true', AI_VIDEO_PROVIDER: 'runway', RUNWAYML_API_SECRET: 'runway-key' },
    sleeper: async () => {}, maxWaitMs: 5000,
    fetcher: async (url, init = {}) => {
      calls.push({ url, init });
      if (url.endsWith('/v1/text_to_video')) return json({ id: 'task-runway' });
      if (url.endsWith('/v1/tasks/task-runway')) return json({ status: 'SUCCEEDED', output: ['https://cdn.example.com/runway.mp4'] });
      if (url === 'https://cdn.example.com/runway.mp4') return video();
      throw new Error(`unexpected ${url}`);
    },
  });
  const body = JSON.parse(calls[0].init.body);
  assert.equal(calls[0].init.headers['X-Runway-Version'], '2024-11-06');
  assert.equal(body.model, 'gen4.5');
  assert.equal(body.ratio, '768:1280');
  assert.equal(result.provider, 'runway');
  assert.equal(result.taskId, 'task-runway');
});

test('provider polling uses a bounded five-second default instead of hammering the API', async () => {
  let polls = 0;
  const pauses = [];
  await generateAiVideoClip({
    prompt: 'vertical ad', maxWaitMs: 5000,
    env: { AI_MEDIA_GENERATION_ENABLED: 'true', AI_VIDEO_PROVIDER: 'runway', RUNWAYML_API_SECRET: 'key' },
    sleeper: async (ms) => { pauses.push(ms); },
    fetcher: async (url) => {
      if (url.endsWith('/text_to_video')) return json({ id: 'poll-task' });
      if (url.endsWith('/tasks/poll-task')) return ++polls === 1 ? json({ status: 'RUNNING' }) : json({ status: 'SUCCEEDED', output: ['https://cdn.example.com/poll.mp4'] });
      return video();
    },
  });
  assert.deepEqual(pauses, [5000]);
});

test('Seedance creates, polls and downloads a vertical clip', async () => {
  const calls = [];
  const result = await generateAiVideoClip({
    prompt: 'vertical salon commercial', duration: 6,
    env: { AI_MEDIA_GENERATION_ENABLED: 'true', AI_VIDEO_PROVIDER: 'seedance', ARK_API_KEY: 'ark-key' },
    sleeper: async () => {}, maxWaitMs: 5000,
    fetcher: async (url, init = {}) => {
      calls.push({ url, init });
      if (url.endsWith('/contents/generations/tasks') && init.method === 'POST') return json({ id: 'task-seedance' });
      if (url.endsWith('/contents/generations/tasks/task-seedance')) return json({ status: 'succeeded', content: { video_url: 'https://cdn.example.com/seedance.mp4' } });
      if (url === 'https://cdn.example.com/seedance.mp4') return video();
      throw new Error(`unexpected ${url}`);
    },
  });
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.model, 'dreamina-seedance-2-5-260628');
  assert.equal(body.ratio, '9:16');
  assert.equal(body.generate_audio, false);
  assert.equal(result.provider, 'seedance');
});

test('AI Hybrid fills missing hook and CTA with GPT images when video is not configured', async () => {
  const fixture = await sharp({ create: { width: 1088, height: 1360, channels: 3, background: '#2c7257' } }).webp().toBuffer();
  const workdir = await mkdtemp(path.join(tmpdir(), 'ai-assets-'));
  try {
    const result = await prepareAiHybridAssets({
      job: { workflow_mode: 'ai_hybrid', brief: '业务主题：美容院' }, downloadedInputs: [], workdir,
      scenes: [{ title: 'Hook', seconds: 3 }, { title: 'CTA', seconds: 5 }],
      env: { AI_MEDIA_GENERATION_ENABLED: 'true', OPENAI_API_KEY: 'test-key' },
      fetcher: async () => json({ data: [{ b64_json: fixture.toString('base64') }] }),
    });
    assert.deepEqual(result.inputs.map((item) => item.role), ['ai_hook', 'ai_cta']);
    assert.ok((await readFile(result.inputs[0].localPath)).length > 100);
    assert.deepEqual(result.generation.map((item) => item.provider), ['openai', 'openai']);
  } finally { await rm(workdir, { recursive: true, force: true }); }
});

test('AI Hybrid never pretends uploaded remix footage was generated', async () => {
  await assert.rejects(
    prepareAiHybridAssets({
      job: { workflow_mode: 'ai_hybrid', brief: '业务主题：美容院' },
      downloadedInputs: [{ role: 'case_proof', type: 'video/mp4', localPath: '/tmp/proof.mp4' }],
      scenes: [{ title: 'Hook' }, { title: 'CTA' }], workdir: '/tmp', env: {},
    }),
    /ai_media_provider_not_configured/,
  );
});

test('provider downloads reject local and private-network URLs', async () => {
  await assert.rejects(
    generateAiVideoClip({
      prompt: 'x', env: { AI_MEDIA_GENERATION_ENABLED: 'true', AI_VIDEO_PROVIDER: 'runway', RUNWAYML_API_SECRET: 'key' }, sleeper: async () => {}, maxWaitMs: 5000,
      fetcher: async (url) => url.endsWith('/text_to_video') ? json({ id: 'unsafe' }) : url.endsWith('/tasks/unsafe') ? json({ status: 'SUCCEEDED', output: ['https://127.0.0.1/private.mp4'] }) : video(),
    }),
    /provider_output_unsafe_url/,
  );
});

test('poster UI permits an empty main image and the worker uses only role=main as source', async () => {
  const [ui, worker] = await Promise.all([
    readFile(new URL('../video/index.html', import.meta.url), 'utf8'),
    readFile(new URL('../api/video-worker.mjs', import.meta.url), 'utf8'),
  ]);
  assert.match(ui, /主视觉图片（可选）/);
  assert.doesNotMatch(ui, /if\(!main\.length\)throw new Error/);
  assert.match(worker, /inputs\.find\(\(item\) => item\.role === 'main'\);/);
  assert.doesNotMatch(worker, /missing_main_visual/);
});

test('capability endpoint separates installed adapters from configured providers', async () => {
  const worker = await readFile(new URL('../api/video-worker.mjs', import.meta.url), 'utf8');
  assert.match(worker, /provider_adapters: \['openai_image', 'seedance', 'runway'\]/);
  assert.match(worker, /providers: mediaProviderCapabilities\(\)/);
});
