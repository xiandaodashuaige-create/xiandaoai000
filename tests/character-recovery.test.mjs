import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import sharp from 'sharp';
import { characterPrompt, prepareAiHybridAssets } from '../api/_cloud-media-providers.mjs';

const env = { AI_MEDIA_GENERATION_ENABLED: 'true', AI_VIDEO_PROVIDER: 'vercel-ai-gateway', VERCEL_OIDC_TOKEN: 'test', AI_GATEWAY_VIDEO_MODEL: 'klingai/kling-v3.0-i2v' };
const gatewayFactory = () => ({ videoModel: (id) => ({ id }) });
const generatedVideo = (id) => ({ videos: [{ uint8Array: new Uint8Array(2048).fill(8), mediaType: 'video/mp4' }], providerMetadata: { gateway: { asyncJob: { jobId: id } } } });

test('case_proof + reference without a portrait auto-creates one character and preserves evidence roles', async () => {
  const workdir = await mkdtemp(path.join(tmpdir(), 'character-recovery-'));
  const inputs = [{ role: 'case_proof', type: 'image/jpeg', localPath: '/not-a-portrait.jpg' }, { role: 'reference', type: 'video/quicktime', localPath: '/not-to-copy.mov' }];
  const checkpoints = []; const requests = []; let images = 0;
  try {
    const result = await prepareAiHybridAssets({
      job: { id: 'no-portrait', workflow_mode: 'ai_hybrid', brief: '业务主题：线下培训\n准确事实：RM49\n目标客户：AI初学者' },
      downloadedInputs: inputs, workdir, env, gatewayFactory,
      scenes: [{ title: 'Hook', seconds: 5 }, { title: 'CTA', seconds: 5 }],
      imageGenerator: async ({ prompt }) => { images++; assert.match(prompt, /fictional adult/); assert.match(prompt, /线下培训/); assert.doesNotMatch(prompt, /RM49/); return { data: await sharp({ create: { width: 128, height: 192, channels: 3, background: '#634244' } }).png().toBuffer() }; },
      onAsset: async (asset) => { checkpoints.push(asset); },
      videoGenerator: async (request) => { assert.equal(checkpoints[0].role, 'character_reference'); requests.push(request); return generatedVideo(`shot-${requests.length}`); },
    });
    assert.equal(images, 1); assert.equal(requests.length, 2);
    assert.deepEqual(requests[0].prompt.image, requests[1].prompt.image);
    const meta = await sharp(requests[0].prompt.image).metadata();
    assert.equal(meta.width, 768); assert.equal(meta.height, 1360); assert.equal(meta.format, 'jpeg');
    assert.deepEqual(checkpoints.map((x) => x.role).sort(), ['ai_cta', 'ai_hook', 'character_reference']);
    assert.equal(result.inputs[0], inputs[0]); assert.equal(result.inputs[1], inputs[1]);
  } finally { await rm(workdir, { recursive: true, force: true }); }
});

test('one failed shot retains the completed sibling and retry does not regenerate the character or completed shot', async () => {
  const workdir = await mkdtemp(path.join(tmpdir(), 'character-resume-'));
  const checkpoints = []; let hookImage;
  const args = { job: { id: 'partial', workflow_mode: 'ai_hybrid' }, workdir, env, gatewayFactory, scenes: [{ title: 'Hook', seconds: 5 }, { title: 'CTA', seconds: 5 }], onAsset: async (asset) => { checkpoints.push(asset); } };
  try {
    await assert.rejects(prepareAiHybridAssets({ ...args, downloadedInputs: [],
      imageGenerator: async () => ({ data: await sharp({ create: { width: 768, height: 1360, channels: 3, background: '#634244' } }).jpeg().toBuffer() }),
      videoGenerator: async (request) => { if (request.prompt.text.includes('opening hook')) { hookImage = request.prompt.image; return generatedVideo('hook-ok'); } throw new Error('provider_failed'); },
    }), /provider_failed/);
    assert.deepEqual(checkpoints.map((x) => x.role), ['character_reference', 'ai_hook']);
    let retryCalls = 0;
    const result = await prepareAiHybridAssets({ ...args, downloadedInputs: [...checkpoints],
      imageGenerator: async () => { throw new Error('must not regenerate portrait'); },
      videoGenerator: async (request) => { retryCalls++; assert.match(request.prompt.text, /closing call-to-action/); assert.deepEqual(request.prompt.image, hookImage); return generatedVideo('cta-ok'); },
    });
    assert.equal(retryCalls, 1); assert.equal(result.generation.length, 2);
  } finally { await rm(workdir, { recursive: true, force: true }); }
});

test('character checkpoint failure stops before starting either paid video task', async () => {
  const workdir = await mkdtemp(path.join(tmpdir(), 'character-persist-failure-'));
  try {
    await assert.rejects(prepareAiHybridAssets({ job: { id: 'persist-fail', workflow_mode: 'ai_hybrid' }, downloadedInputs: [], workdir, env, scenes: [{}, {}],
      imageGenerator: async () => ({ data: await sharp({ create: { width: 768, height: 1360, channels: 3, background: '#634244' } }).jpeg().toBuffer() }),
      onAsset: async () => { throw new Error('checkpoint_failed'); },
      videoGenerator: async () => { assert.fail('video task must not start'); },
    }), /checkpoint_failed/);
  } finally { await rm(workdir, { recursive: true, force: true }); }
});

test('character generation is campaign scoped and never hardcodes a previous business', () => {
  const prompt = characterPrompt({ brief: '项目：线下课\n业务主题：AI教学\n准确事实：RM49\n禁止出现：美容院\n参考爆款：某人' });
  assert.match(prompt, /AI教学/); assert.doesNotMatch(prompt, /美容院|RM49|某人/);
});

test('a changed brief regenerates inherited AI shots instead of silently ignoring a revision', async () => {
  const workdir = await mkdtemp(path.join(tmpdir(), 'character-revision-'));
  const referencePath = path.join(workdir, 'reference.jpg');
  await sharp({ create: { width: 768, height: 1360, channels: 3, background: '#634244' } }).jpeg().toFile(referencePath);
  let calls = 0;
  try {
    const result = await prepareAiHybridAssets({
      job: { id: 'revised', parent_job_id: 'old', workflow_mode: 'ai_hybrid', brief: '开头换一种表达' }, workdir, env, gatewayFactory,
      downloadedInputs: [
        { role: 'character_reference', type: 'image/jpeg', localPath: referencePath },
        { role: 'ai_hook', type: 'video/mp4', localPath: '/old.mp4', generation: { brief_sha256: 'old-brief' } },
        { role: 'ai_cta', type: 'video/mp4', localPath: '/old-cta.mp4', generation: { brief_sha256: 'old-brief' } },
      ], scenes: [{ title: 'New hook', seconds: 5 }, { title: 'New CTA', seconds: 5 }],
      videoGenerator: async () => { calls++; return generatedVideo(`new-${calls}`); },
    });
    assert.equal(calls, 2);
    assert.ok(result.inputs.every((item) => item.localPath !== '/old.mp4' && item.localPath !== '/old-cta.mp4'));
    assert.ok(result.generation.every((item) => /^[a-f0-9]{64}$/.test(item.brief_sha256)));
  } finally { await rm(workdir, { recursive: true, force: true }); }
});
