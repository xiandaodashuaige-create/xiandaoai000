import test from 'node:test';
import assert from 'node:assert/strict';
import { readAcceptedImageLibrary } from '../api/_accepted-image-library.mjs';
import handler from '../api/a3-video-provider.mjs';

const job = (extra = {}) => ({
  id: 'job-1', external_tenant_id: 'tenant-1', external_project_id: 'project-1',
  conversation_session_id: 'original-session', version_number: 1, status: 'completed',
  accepted_at: '2026-10-27T01:00:00Z', output_sha256: 'a'.repeat(64),
  brief: 'PRIVATE', output_files: [{ path: 'tenant-1/project-1/job-1/poster.jpg', type: 'image/jpeg' }], ...extra,
});
function setup(jobs = [job()]) {
  const calls = [];
  return { calls, post: async (body) => { calls.push(body); return { ok: true, jobs }; } };
}
test('uses one scoped read, preserves original source, omits private brief', async () => {
  const { post, calls } = setup();
  const result = await readAcceptedImageLibrary(post, 'tenant-1', 'project-1');
  assert.deepEqual(calls, [{ action: 'provider_list_accepted_images', tenant_id: 'tenant-1', project_id: 'project-1' }]);
  assert.equal(result.jobs[0].conversation_session_id, 'original-session');
  assert.equal(JSON.stringify(result).includes('PRIVATE'), false);
});
test('invalid accepted row is rejected rather than silently hidden', async () => {
  for (const extra of [{ accepted_at: null }, { status: 'failed' }, { output_sha256: null }, { output_files: [] }]) {
    await assert.rejects(readAcceptedImageLibrary(setup([job(extra)]).post, 'tenant-1', 'project-1'));
  }
});
test('cross-scope rows never leak', async () => {
  for (const extra of [{ external_tenant_id: 'other' }, { external_project_id: 'other' }]) {
    await assert.rejects(readAcceptedImageLibrary(setup([job(extra)]).post, 'tenant-1', 'project-1'), /scope_mismatch/);
  }
});
test('empty is valid; failure is never empty', async () => {
  assert.deepEqual(await readAcceptedImageLibrary(setup([]).post, 'tenant-1', 'project-1'), { ok: true, jobs: [], limited: false });
  await assert.rejects(readAcceptedImageLibrary(async () => ({ error: 'offline' }), 'tenant-1', 'project-1'));
});
test('31st row is only sentinel and cursor derives from last displayed record', async () => {
  const jobs = Array.from({ length: 31 }, (_, i) => job({ id: 'job-' + i }));
  const result = await readAcceptedImageLibrary(setup(jobs).post, 'tenant-1', 'project-1');
  assert.equal(result.jobs.length, 30); assert.equal(result.limited, true);
  assert.deepEqual(result.nextCursor, { acceptedAt: job().accepted_at, jobId: 'job-29' });
  const { post, calls } = setup([job({ id: 'older' })]);
  await readAcceptedImageLibrary(post, 'tenant-1', 'project-1', result.nextCursor);
  assert.deepEqual(calls[0].cursor, result.nextCursor);
});
test('invalid scope/cursor and duplicate rows fail closed', async () => {
  await assert.rejects(readAcceptedImageLibrary(setup().post, 'tenant 1', 'project-1'));
  await assert.rejects(readAcceptedImageLibrary(setup().post, 'tenant-1', 'project-1', { acceptedAt: 'bad', jobId: 'a' }));
  await assert.rejects(readAcceptedImageLibrary(setup([job(), job()]).post, 'tenant-1', 'project-1'));
});
test('real gateway forwards authenticated library reads, never mutation actions', async (t) => {
  const names = ['A3_VIDEO_PROVIDER_TOKEN', 'VIDEO_AGENT_ACCESS', 'SUPABASE_PUBLISHABLE_KEY'];
  const prior = names.map((n) => process.env[n]); const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; names.forEach((n,i) => { if (prior[i] === undefined) delete process.env[n]; else process.env[n] = prior[i]; }); });
  process.env.A3_VIDEO_PROVIDER_TOKEN = 'fixture-token'; process.env.VIDEO_AGENT_ACCESS = 'fixture-access'; process.env.SUPABASE_PUBLISHABLE_KEY = 'fixture-key';
  const calls = [];
  global.fetch = async (_url, init) => { calls.push(JSON.parse(init.body)); return new Response(JSON.stringify({ ok: true, jobs: [job()] })); };
  let payload, status;
  const res = { status: (s) => { status=s; return res; }, json: (p) => { payload=p; return res; }, setHeader: () => {} };
  await handler({ method: 'POST', headers: { authorization: 'Bearer fixture-token' }, body: { action: 'provider_list_accepted_images', tenant_id: 'tenant-1', project_id: 'project-1' } }, res);
  assert.equal(status, 200); assert.equal(payload.jobs.length, 1);
  assert.deepEqual(calls.map((c) => c.action), ['provider_list_accepted_images']);
});
