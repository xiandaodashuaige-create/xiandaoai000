import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import sharp from 'sharp';
import {
  aiVideoIdempotencyKey,
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
    enabled: false, image: false, imageProvider: null, video: false, videoProvider: null, gatewayVideo: false, seedance: false, runway: false,
  });
  assert.equal(mediaProviderCapabilities({ AI_MEDIA_GENERATION_ENABLED: 'true', OPENAI_API_KEY: 'secret' }).image, true);
  assert.equal(mediaProviderCapabilities({ AI_MEDIA_GENERATION_ENABLED: 'true', RUNWAYML_API_SECRET: 'secret' }).videoProvider, 'runway');
  assert.equal(mediaProviderCapabilities({ AI_MEDIA_GENERATION_ENABLED: 'true', VERCEL_OIDC_TOKEN: 'oidc', AI_GATEWAY_VIDEO_MODEL: 'klingai/kling-v3.0-i2v' }).videoProvider, 'vercel-ai-gateway');
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

test('GPT image model name is normalized for direct OpenAI and Gateway routes', async () => {
  const fixture = await sharp({ create: { width: 1088, height: 1360, channels: 3, background: '#335544' } }).webp().toBuffer();
  for (const scenario of [
    { env: { OPENAI_API_KEY: 'direct', OPENAI_IMAGE_MODEL: 'openai/gpt-image-2' }, expected: 'gpt-image-2' },
    { env: { VERCEL_OIDC_TOKEN: 'gateway', OPENAI_IMAGE_MODEL: 'gpt-image-2' }, expected: 'openai/gpt-image-2' },
  ]) {
    let body;
    await generateOpenAiImage({
      prompt: 'premium ad image',
      env: { AI_MEDIA_GENERATION_ENABLED: 'true', ...scenario.env },
      fetcher: async (_url, init) => { body = JSON.parse(init.body); return json({ data: [{ b64_json: fixture.toString('base64') }] }); },
    });
    assert.equal(body.model, scenario.expected);
  }
});

test('GPT image adapter uses Vercel OIDC when a provider key cannot be exported', async () => {
  const fixture = await sharp({ create: { width: 1088, height: 1360, channels: 3, background: '#224f3d' } }).webp().toBuffer();
  let request;
  const result = await generateOpenAiImage({
    prompt: 'premium wellness background without text',
    env: { AI_MEDIA_GENERATION_ENABLED: 'true', VERCEL_OIDC_TOKEN: 'oidc-token' },
    fetcher: async (url, init) => { request = { url, init, body: JSON.parse(init.body) }; return json({ data: [{ b64_json: fixture.toString('base64') }] }); },
  });
  assert.equal(request.url, 'https://ai-gateway.vercel.sh/v1/images/generations');
  assert.equal(request.init.headers.Authorization, 'Bearer oidc-token');
  assert.equal(request.body.model, 'openai/gpt-image-2');
  assert.equal(result.provider, 'vercel-ai-gateway');
});

test('Runway creates, polls and downloads a vertical clip', async () => {
  const calls = [];
  const result = await generateAiVideoClip({
    prompt: 'vertical beauty commercial', duration: 5,
    referenceImage: { data: Buffer.alloc(2048, 3), type: 'image/jpeg' },
    env: { AI_MEDIA_GENERATION_ENABLED: 'true', AI_VIDEO_PROVIDER: 'runway', RUNWAYML_API_SECRET: 'runway-key' },
    sleeper: async () => {}, maxWaitMs: 5000,
    fetcher: async (url, init = {}) => {
      calls.push({ url, init });
      if (url.endsWith('/v1/image_to_video')) return json({ id: 'task-runway' });
      if (url.endsWith('/v1/tasks/task-runway')) return json({ status: 'SUCCEEDED', output: ['https://cdn.example.com/runway.mp4'] });
      if (url === 'https://cdn.example.com/runway.mp4') return video();
      throw new Error(`unexpected ${url}`);
    },
  });
  const body = JSON.parse(calls[0].init.body);
  assert.equal(calls[0].init.headers['X-Runway-Version'], '2024-11-06');
  assert.equal(body.model, 'gen4.5');
  assert.match(body.promptImage, /^data:image\/jpeg;base64,/);
  assert.equal(body.ratio, '768:1280');
  assert.equal(result.provider, 'runway');
  assert.equal(result.taskId, 'task-runway');
});

test('provider polling uses a bounded five-second default instead of hammering the API', async () => {
  let polls = 0;
  const pauses = [];
  await generateAiVideoClip({
    prompt: 'vertical ad', maxWaitMs: 5000,
    referenceImage: { data: Buffer.alloc(2048, 4), type: 'image/png' },
    env: { AI_MEDIA_GENERATION_ENABLED: 'true', AI_VIDEO_PROVIDER: 'runway', RUNWAYML_API_SECRET: 'key' },
    sleeper: async (ms) => { pauses.push(ms); },
    fetcher: async (url) => {
      if (url.endsWith('/image_to_video')) return json({ id: 'poll-task' });
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
    referenceImage: { data: Buffer.alloc(2048, 5), type: 'image/webp' },
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
  assert.equal(body.omni_reference_task_type, 'reference');
  assert.equal(body.content[1].role, 'reference_image');
  assert.match(body.content[1].image_url.url, /^data:image\/webp;base64,/);
  assert.equal(body.ratio, '9:16');
  assert.equal(body.generate_audio, false);
  assert.equal(result.provider, 'seedance');
});

test('Vercel AI Gateway submits a reference-to-video job with OIDC and provenance', async () => {
  let gatewaySettings;
  let request;
  const result = await generateAiVideoClip({
    prompt: 'same spokesperson meets a salon owner',
    negativePrompt: 'massage, text, identity drift',
    duration: 5,
    referenceImage: { data: Buffer.alloc(2048, 2), type: 'image/jpeg' },
    idempotencyKey: 'v3-job-hook',
    fetcher: async (url) => {
      assert.equal(String(url), 'https://cdn.example.com/gateway.mp4');
      return video();
    },
    env: {
      AI_MEDIA_GENERATION_ENABLED: 'true', AI_VIDEO_PROVIDER: 'vercel-ai-gateway',
      VERCEL_OIDC_TOKEN: 'oidc-token', AI_GATEWAY_VIDEO_MODEL: 'klingai/kling-v3.0-i2v',
    },
    gatewayFactory: (settings) => {
      gatewaySettings = settings;
      return { videoModel: (id) => ({ id }) };
    },
    videoGenerator: async (options) => {
      request = options;
      const downloaded = await options.download({ url: new URL('https://cdn.example.com/gateway.mp4') });
      assert.equal(downloaded.data.length, 2048);
      assert.equal(downloaded.mediaType, 'video/mp4');
      return {
        videos: [{ uint8Array: new Uint8Array(2048).fill(8), mediaType: 'video/mp4' }],
        providerMetadata: { gateway: { asyncJob: { jobId: 'gateway-job-1', status: 'completed' } } },
      };
    },
  });
  assert.equal(gatewaySettings.apiKey, 'oidc-token');
  assert.equal(gatewaySettings.headers['ai-gateway-auth-method'], 'oidc');
  assert.equal(request.model.id, 'klingai/kling-v3.0-i2v');
  assert.equal(request.aspectRatio, '9:16');
  assert.equal(request.duration, 5);
  assert.equal(request.generateAudio, false);
  assert.equal(request.prompt.text, 'same spokesperson meets a salon owner');
  assert.equal(request.prompt.image.length, 2048);
  assert.equal(request.inputReferences, undefined);
  assert.equal(request.headers['idempotency-key'], 'v3-job-hook');
  assert.match(request.providerOptions.klingai.negativePrompt, /identity drift/);
  assert.equal(result.provider, 'vercel-ai-gateway');
  assert.equal(result.taskId, 'gateway-job-1');
  assert.match(result.sha256, /^[a-f0-9]{64}$/);
});

test('failed-job retries reuse generation idempotency keys without merging distinct revisions', () => {
  const shared = { video_project_id: 'project-1', project_name: 'Campaign · Retry 4', brief: 'same brief', revision_scope: 'retry_failed', correlation_id: 'root-generation' };
  assert.equal(
    aiVideoIdempotencyKey({ ...shared, id: 'retry-4' }, 'ai_hook'),
    aiVideoIdempotencyKey({ ...shared, id: 'retry-5', project_name: 'Campaign · Retry 5' }, 'ai_hook'),
  );
  assert.equal(
    aiVideoIdempotencyKey({ ...shared, id: 'retry-5' }, 'ai_hook'),
    aiVideoIdempotencyKey({ id: 'root-generation' }, 'ai_hook'),
  );
  assert.notEqual(
    aiVideoIdempotencyKey({ id: 'revision-a', revision_scope: 'copy' }, 'ai_hook'),
    aiVideoIdempotencyKey({ id: 'revision-b', revision_scope: 'copy' }, 'ai_hook'),
  );
});

test('Gateway image-to-video model fails before spending when character reference is absent', async () => {
  await assert.rejects(
    generateAiVideoClip({
      prompt: 'vertical ad',
      env: {
        AI_MEDIA_GENERATION_ENABLED: 'true', AI_VIDEO_PROVIDER: 'vercel-ai-gateway',
        VERCEL_OIDC_TOKEN: 'oidc-token', AI_GATEWAY_VIDEO_MODEL: 'klingai/kling-v3.0-i2v',
      },
    }),
    /ai_video_reference_required/,
  );
});

test('direct video providers fail before creating a paid task when character reference is absent', async () => {
  for (const env of [
    { AI_MEDIA_GENERATION_ENABLED: 'true', AI_VIDEO_PROVIDER: 'runway', RUNWAYML_API_SECRET: 'key' },
    { AI_MEDIA_GENERATION_ENABLED: 'true', AI_VIDEO_PROVIDER: 'seedance', ARK_API_KEY: 'key' },
  ]) {
    let called = false;
    await assert.rejects(
      generateAiVideoClip({ prompt: 'vertical spokesperson ad', env, fetcher: async () => { called = true; return json({}); } }),
      /ai_video_reference_required/,
    );
    assert.equal(called, false);
  }
});

test('AI Hybrid sends the same character reference to hook and CTA gateway jobs', async () => {
  const workdir = await mkdtemp(path.join(tmpdir(), 'ai-video-reference-'));
  const referencePath = path.join(workdir, 'character.jpg');
  await sharp({ create: { width: 640, height: 960, channels: 3, background: '#92776b' } }).jpeg().toFile(referencePath);
  const requests = [];
  try {
    const result = await prepareAiHybridAssets({
      job: { id: 'job-reference', workflow_mode: 'ai_hybrid', brief: '业务主题：香港美容院同区新客获取合作\n禁止出现：按摩、疗程操作' },
      downloadedInputs: [{ role: 'character_reference', type: 'image/jpeg', localPath: referencePath }],
      workdir,
      scenes: [{ title: '你有客源焦虑吗', seconds: 5 }, { title: '立即了解获客方案', seconds: 5 }],
      env: {
        AI_MEDIA_GENERATION_ENABLED: 'true', AI_VIDEO_PROVIDER: 'vercel-ai-gateway',
        VERCEL_OIDC_TOKEN: 'oidc-token', AI_GATEWAY_VIDEO_MODEL: 'klingai/kling-v3.0-i2v',
      },
      gatewayFactory: () => ({ videoModel: (id) => ({ id }) }),
      videoGenerator: async (options) => {
        requests.push(options);
        return {
          videos: [{ uint8Array: new Uint8Array(2048).fill(requests.length), mediaType: 'video/mp4' }],
          providerMetadata: { gateway: { asyncJob: { jobId: `gateway-${requests.length}`, status: 'completed' } } },
        };
      },
    });
    assert.equal(requests.length, 2);
    assert.ok(requests.every((item) => Buffer.isBuffer(item.prompt.image)));
    assert.deepEqual(result.generation.map((item) => item.character_reference_used), [true, true]);
    assert.deepEqual(result.generation.map((item) => item.task_id), ['gateway-1', 'gateway-2']);
    assert.match(requests[0].providerOptions.klingai.negativePrompt, /禁止出现：按摩、疗程操作/);
    assert.match(requests[0].prompt.text, /entire head, shoulders, and upper torso visible/);
    assert.match(requests[0].prompt.text, /no tilt, orbit, push-in, extreme close-up, selfie angle, or camera shake/);
    assert.match(requests[1].prompt.text, /lower forty percent visually quiet and empty/);
    assert.match(requests[1].prompt.text, /No other person may enter or overlap the frame/);
    assert.match(requests[1].providerOptions.klingai.negativePrompt, /forehead-only framing/);
    assert.notEqual(requests[0].headers['idempotency-key'], requests[1].headers['idempotency-key']);
  } finally { await rm(workdir, { recursive: true, force: true }); }
});

test('AI Hybrid fails closed when only still-image generation is configured', async () => {
  await assert.rejects(
    prepareAiHybridAssets({
      job: { workflow_mode: 'ai_hybrid', brief: '业务主题：美容院' }, downloadedInputs: [], workdir: '/tmp',
      scenes: [{ title: 'Hook', seconds: 3 }, { title: 'CTA', seconds: 5 }],
      env: { AI_MEDIA_GENERATION_ENABLED: 'true', OPENAI_API_KEY: 'test-key' },
    }),
    /ai_video_provider_not_configured/,
  );
});

test('AI Hybrid records provider, model, task id and checksum for generated video clips', async () => {
  const workdir = await mkdtemp(path.join(tmpdir(), 'ai-video-assets-'));
  const referencePath = path.join(workdir, 'character.jpg');
  let created = 0;
  try {
    await sharp({ create: { width: 640, height: 960, channels: 3, background: '#806f66' } }).jpeg().toFile(referencePath);
    const result = await prepareAiHybridAssets({
      job: { workflow_mode: 'ai_hybrid', brief: '业务主题：香港美容院同区新客获取合作' },
      workdir,
      scenes: [{ title: 'Hook', seconds: 5 }, { title: 'CTA', seconds: 5 }],
      env: { AI_MEDIA_GENERATION_ENABLED: 'true', AI_VIDEO_PROVIDER: 'runway', RUNWAYML_API_SECRET: 'test-key' },
      downloadedInputs: [
        { role: 'case_proof', type: 'video/mp4', localPath: '/tmp/proof.mp4' },
        { role: 'character_reference', type: 'image/jpeg', localPath: referencePath },
      ],
      sleeper: async () => {},
      fetcher: async (url) => {
        if (url.endsWith('/v1/image_to_video')) return json({ id: `task-${++created}` });
        if (url.includes('/v1/tasks/task-')) return json({ status: 'SUCCEEDED', output: [`https://cdn.example.com/${url.split('/').at(-1)}.mp4`] });
        if (url.startsWith('https://cdn.example.com/')) return video();
        throw new Error(`unexpected ${url}`);
      },
    });
    assert.deepEqual(result.inputs.map((item) => item.role), ['case_proof', 'character_reference', 'ai_hook', 'ai_cta']);
    assert.deepEqual(result.generation.map((item) => item.provider), ['runway', 'runway']);
    assert.deepEqual(result.generation.map((item) => item.task_id), ['task-1', 'task-2']);
    assert.ok(result.generation.every((item) => /^[a-f0-9]{64}$/.test(item.sha256)));
    assert.ok((await readFile(result.inputs[2].localPath)).length > 1000);
  } finally { await rm(workdir, { recursive: true, force: true }); }
});

test('AI Hybrid never pretends uploaded remix footage was generated', async () => {
  await assert.rejects(
    prepareAiHybridAssets({
      job: { workflow_mode: 'ai_hybrid', brief: '业务主题：美容院' },
      downloadedInputs: [{ role: 'case_proof', type: 'video/mp4', localPath: '/tmp/proof.mp4' }],
      scenes: [{ title: 'Hook' }, { title: 'CTA' }], workdir: '/tmp', env: {},
    }),
    /ai_video_provider_not_configured/,
  );
});

test('provider downloads reject local and private-network URLs', async () => {
  await assert.rejects(
    generateAiVideoClip({
      prompt: 'x', referenceImage: { data: Buffer.alloc(2048, 6), type: 'image/jpeg' }, env: { AI_MEDIA_GENERATION_ENABLED: 'true', AI_VIDEO_PROVIDER: 'runway', RUNWAYML_API_SECRET: 'key' }, sleeper: async () => {}, maxWaitMs: 5000,
      fetcher: async (url) => url.endsWith('/image_to_video') ? json({ id: 'unsafe' }) : url.endsWith('/tasks/unsafe') ? json({ status: 'SUCCEEDED', output: ['https://127.0.0.1/private.mp4'] }) : video(),
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
  assert.match(worker, /async function posterSource\(main, jobId\)/);
  assert.match(worker, /'-ss', '1'.*'-frames:v', '1'/s);
  assert.doesNotMatch(worker, /video_poster_source_requires_local_ffmpeg/);
});

test('capability endpoint separates installed adapters from configured providers', async () => {
  const worker = await readFile(new URL('../api/video-worker.mjs', import.meta.url), 'utf8');
  assert.match(worker, /provider_adapters: \['openai_image', 'vercel_ai_gateway_image', 'vercel_ai_gateway_video', 'seedance', 'runway'\]/);
  assert.match(worker, /req\.headers\['x-vercel-oidc-token'\]/);
  assert.match(worker, /providers: mediaProviderCapabilities\(mediaEnv\)/);
  assert.match(worker, /AI 视频生成失败，未回退到普通素材混剪/);
  assert.match(worker, /mode: 'ai_hybrid_gateway_reference'/);
});

// Guards against vendor/provider-name disclosure: the GET capability
// endpoint has no auth on it by design (health checks hit it without a
// token), so it must never hand an unauthenticated caller the installed
// provider_adapters/providers detail -- only an authorised caller (the
// same x-video-access check POST already enforces) gets that payload.
test('unauthenticated GET does not disclose provider_adapters/providers; authorised GET does', async () => {
  const worker = await readFile(new URL('../api/video-worker.mjs', import.meta.url), 'utf8');
  const getBlock = worker.match(/if \(req\.method === 'GET'\) \{[\s\S]*?\n {2}\}/)?.[0];
  assert.ok(getBlock, 'expected a GET branch guarded by its own block');
  assert.match(getBlock, /if \(!authorised\(req\)\) return res\.status\(200\)\.json\(\{ ok: true, worker: WORKER \}\);/);
  assert.match(getBlock, /provider_adapters:/);
});
