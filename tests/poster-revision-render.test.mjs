import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import sharp from 'sharp';
import worker, { renderPoster } from '../api/video-worker.mjs';
import provider from '../api/a3-video-provider.mjs';
import { applyPosterRevision, initialPosterState } from '../api/_poster-revision.mjs';

// TEST-ONLY: real compositor, real raster bytes and private in-process RPC/
// storage fixtures. These are not new production jobs or model generations.
const outputDir = process.env.POSTER_PROOF_DIR || path.join(os.tmpdir(), 'v3-poster-exact-proofs');
const brief = '主标题：忙了一天，让肩颈歇一歇\n品牌：Lash Atelier Penang\n核心卖点与准确事实：RM98 首次体验 · 60分钟肩颈按摩 · 槟城\n行动引导：WhatsApp 预约\n尺寸：1080x1350';
const sha = data => crypto.createHash('sha256').update(data).digest('hex');
const photo = async () => sharp(await readFile(new URL('../assets/v1-hero-store.png', import.meta.url))).jpeg({ quality: 90 }).toBuffer();
const save = async (name, bytes) => { await mkdir(outputDir, { recursive: true }); await writeFile(path.join(outputDir, name), bytes); };
const crop = async (bytes, region) => sharp(bytes).extract(region).raw().toBuffer();

async function render(state, bytes) {
  let snapshot;
  const result = await renderPoster({ brief }, bytes, { state, onManifest: value => { snapshot = value; } });
  return { result, snapshot };
}

test('actual JPEG photo and layout stay fixed; only button colors change', async () => {
  const source = await photo();
  const before = await render(initialPosterState({ brief }), source);
  const revised = applyPosterRevision(before.snapshot, '仅按钮改深绿色').state;
  const canonical = await sharp(source).png().toBuffer();
  const after = await render(revised, canonical);
  assert.deepEqual(after.snapshot.layout, before.snapshot.layout);
  assert.deepEqual(after.snapshot.palette, before.snapshot.palette);
  const region = { left: 200, top: 250, width: 700, height: 250 };
  assert.ok((await crop(before.result, region)).equals(await crop(after.result, region)), 'unmodified photo pixels must be identical, including first JPEG vs persisted PNG');
  const { left, top, width, height } = before.snapshot.layout.button;
  assert.ok(!(await crop(before.result, { left, top, width, height })).equals(await crop(after.result, { left, top, width, height })));
  const price = before.snapshot.layout.price;
  assert.ok((await crop(before.result, price)).equals(await crop(after.result, price)), 'price color and pixels unchanged');
  const brand = before.snapshot.layout.brandPill;
  assert.ok((await crop(before.result, brand)).equals(await crop(after.result, brand)), 'brand color and pixels unchanged');
  await save('01-before.jpg', before.result); await save('02-button-only.jpg', after.result);
});

test('actual field edits change rendered pixels and preserve other facts/photo boxes', async () => {
  const source = await photo();
  const before = await render(initialPosterState({ brief }), source);
  for (const [name, correction, field, expected, region] of [
    ['price', '价格由RM98改成RM108', 'facts', 'RM108 首次体验 · 60分钟肩颈按摩 · 槟城', 'price'],
    ['title', '主标题改为「下班后来放松」', 'title', '下班后来放松', 'title'],
    ['cta', '行动引导：Book on WhatsApp', 'cta', 'Book on WhatsApp', 'cta'],
  ]) {
    const state = applyPosterRevision(before.snapshot, correction).state;
    const after = await render(state, source);
    assert.equal(after.snapshot[field], expected);
    assert.deepEqual(after.snapshot.layout, before.snapshot.layout);
    assert.ok(!(await crop(before.result, before.snapshot.layout[region])).equals(await crop(after.result, before.snapshot.layout[region])));
    assert.ok((await crop(before.result, { left: 200, top: 250, width: 700, height: 250 })).equals(await crop(after.result, { left: 200, top: 250, width: 700, height: 250 })));
    await save(`03-${name}.jpg`, after.result);
  }
});

test('English CTA, Traditional and resized outputs are actual raster products', async () => {
  const source = await photo();
  for (const [name, request] of [
    ['english', '主标题：Unwind after work\n品牌：Orchard Relax\n核心卖点与准确事实：S$68 First visit · 60-minute massage · Orchard Road\n行动引导：Book on WhatsApp\n海报语言：English'],
    ['traditional', '主标题：下班後來放鬆\n品牌：信義舒活\n核心卖点与准确事实：NT$990 初次體驗 · 台北信義區\n行动引导：立即預約'],
  ]) {
    const rendered = await render(initialPosterState({ brief: request }), source);
    assert.equal(rendered.snapshot.cta, initialPosterState({ brief: request }).cta);
    assert.equal((await sharp(rendered.result).metadata()).width, 1080);
    await save(`04-${name}.jpg`, rendered.result);
  }
  const square = await render(applyPosterRevision(initialPosterState({ brief }), '比例改为1:1').state, source);
  assert.equal((await sharp(square.result).metadata()).height, 1080);
  await save('05-square.jpg', square.result);
});

test('actual worker persists clean source and consumes exact immediate-parent version', async () => {
  const originalFetch = globalThis.fetch;
  const envNames = ['VIDEO_AGENT_ACCESS', 'SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_URL'];
  const originalEnv = Object.fromEntries(envNames.map(name => [name, process.env[name]]));
  Object.assign(process.env, { VIDEO_AGENT_ACCESS: 'fixture-secret', SUPABASE_PUBLISHABLE_KEY: 'fixture-key', SUPABASE_URL: 'https://fixture.invalid' });
  const storage = new Map([['video-agent-inputs/jobs/one/main.jpg', await photo()]]);
  const jobs = new Map();
  const initial = { id: 'one', workflow_mode: 'image_poster', status: 'queued', brief, input_files: [{ role: 'main', path: 'jobs/one/main.jpg', type: 'image/jpeg' }], version_number: 1, video_project_id: 'media', external_tenant_id: 'tenant', external_project_id: 'project', conversation_session_id: 'session' };
  jobs.set(initial.id, initial);
  let nextJob = initial;
  let pathIndex = 0;
  let paidCalls = 0;
  globalThis.fetch = async (url, options = {}) => {
    const value = String(url);
    if (value.startsWith('https://raw.githubusercontent.com/')) return originalFetch(url, options); // font only
    if (!value.startsWith('https://fixture.invalid/')) { paidCalls++; throw new Error('unexpected_external_call'); }
    if (value.includes('/rest/v1/rpc/')) {
      const name = value.split('/').at(-1); const body = JSON.parse(options.body);
      if (name === 'video_agent_claim_cloud_job') return Response.json(nextJob);
      if (name === 'video_agent_get_job') return Response.json(jobs.get(body.p_job_id));
      if (name === 'video_agent_issue_path') return Response.json(`jobs/${body.p_job_id}/fixture/${++pathIndex}-${body.p_file_name}`);
      if (name === 'video_agent_worker_update') { Object.assign(nextJob, { status: body.p_status, output_files: body.p_output_files }); return Response.json(nextJob); }
      if (['video_agent_worker_heartbeat', 'video_agent_worker_set_artifact_metadata'].includes(name)) return Response.json({});
      throw new Error(`unexpected_rpc_${name}`);
    }
    const key = decodeURIComponent(value.split('/storage/v1/object/')[1]);
    if (options.method === 'POST') { storage.set(key, Buffer.from(options.body)); return Response.json({}); }
    assert.ok(storage.has(key), `missing stored bytes ${key}`);
    return new Response(storage.get(key));
  };
  const invoke = async () => {
    let result; const response = { status(code) { this.code = code; return this; }, json(value) { result = value; return value; } };
    await worker({ method: 'POST', headers: { 'x-video-access': 'fixture-secret' } }, response);
    return { result, code: response.code };
  };
  try {
    assert.equal((await invoke()).code, 200);
    const source1 = initial.output_files[0].poster_edit.source;
    assert.equal(source1.sha256, sha(storage.get(`video-agent-results/${source1.path}`)));
    const corrections = ['价格由RM98改成RM108', '主标题改为「下班后来放松」', '行动引导：Book on WhatsApp'];
    let previous = initial;
    for (const [index, revision_prompt] of corrections.entries()) {
      nextJob = { ...initial, id: `revision-${index}`, parent_job_id: previous.id, version_number: previous.version_number + 1, output_files: [], revision_prompt };
      jobs.set(nextJob.id, nextJob);
      assert.equal((await invoke()).code, 200);
      const edit = nextJob.output_files[0].poster_edit;
      assert.equal(edit.parent_job_id, previous.id); assert.equal(edit.version, previous.version_number + 1);
      assert.equal(edit.source.sha256, source1.sha256);
      assert.equal(edit.generation_calls, 0);
      assert.match(edit.state.facts, /RM108/);
      previous = nextJob;
    }
    assert.equal(previous.output_files[0].poster_edit.state.title, '下班后来放松');
    assert.equal(previous.output_files[0].poster_edit.state.cta, 'Book on WhatsApp');
    nextJob = { ...previous, id: 'wrong-session', parent_job_id: previous.id, version_number: 5, conversation_session_id: 'other' };
    const refused = await invoke();
    assert.equal(refused.code, 202); assert.equal(refused.result.ok, false);
    assert.equal(nextJob.status, 'failed'); assert.deepEqual(nextJob.output_files, []);
    assert.equal(paidCalls, 0);
    await save('06-worker-latest.jpg', storage.get(`video-agent-results/${previous.output_files[0].path}`));
    await save('manifest.json', Buffer.from(JSON.stringify({ label: 'TEST-ONLY / actual worker + fake RPC/storage / no model calls', outputs: [...jobs.values()].map(job => ({ id: job.id, parent: job.parent_job_id, version: job.version_number, outputs: job.output_files })) }, null, 2)));
  } finally {
    globalThis.fetch = originalFetch;
    for (const name of envNames) { if (originalEnv[name] === undefined) delete process.env[name]; else process.env[name] = originalEnv[name]; }
  }
});

test('V3 provider refuses stale-child success for a different revision', async () => {
  const originalFetch = globalThis.fetch; const keys = ['A3_VIDEO_PROVIDER_TOKEN', 'VIDEO_AGENT_ACCESS', 'SUPABASE_PUBLISHABLE_KEY'];
  const old = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  Object.assign(process.env, { A3_VIDEO_PROVIDER_TOKEN: 'fixture', VIDEO_AGENT_ACCESS: 'fixture', SUPABASE_PUBLISHABLE_KEY: 'fixture' });
  const body = { action: 'provider_create_revision', tenant_id: 'tenant', project_id: 'project', parent_job_id: 'parent', revision_prompt: '价格改为RM108', revision_scope: 'auto' };
  let returned = { id: 'old-child', parent_job_id: 'parent', version_number: 2, revision_prompt: '旧修改', revision_scope: 'auto', external_tenant_id: 'tenant', external_project_id: 'project' };
  globalThis.fetch = async () => Response.json({ ok: true, job: returned });
  const invoke = async () => {
    let result; const res = { status(code) { this.code = code; return this; }, setHeader() {}, send(value) { result = JSON.parse(value); }, json(value) { result = value; } };
    await provider({ method: 'POST', headers: { authorization: 'Bearer fixture' }, body }, res);
    return { code: res.code, result };
  };
  try {
    assert.equal((await invoke()).code, 409);
    returned = { ...returned, revision_prompt: body.revision_prompt };
    assert.equal((await invoke()).code, 200);
    returned.external_project_id = 'other';
    assert.equal((await invoke()).code, 409);
  } finally {
    globalThis.fetch = originalFetch;
    for (const key of keys) { if (old[key] === undefined) delete process.env[key]; else process.env[key] = old[key]; }
  }
});
