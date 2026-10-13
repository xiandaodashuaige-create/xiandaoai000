import assert from 'node:assert/strict';
import test from 'node:test';
import handler from '../api/a3-video-provider.mjs';

function responseRecorder() {
  return {
    code: 200, headers: {}, body: undefined,
    status(code) { this.code = code; return this; },
    setHeader(name, value) { this.headers[name] = value; },
    json(value) { this.body = value; return this; },
    send(value) { this.body = value; return this; },
  };
}

test('rejects an invalid A3 service token', async () => {
  process.env.A3_VIDEO_PROVIDER_TOKEN = 'strong-a3-token';
  const res = responseRecorder();
  await handler({ method: 'POST', headers: { authorization: 'Bearer wrong' }, body: {} }, res);
  assert.equal(res.code, 401);
});

test('requires tenant and project scope for every A3 action', async () => {
  process.env.A3_VIDEO_PROVIDER_TOKEN = 'strong-a3-token';
  const res = responseRecorder();
  await handler({
    method: 'POST', headers: { authorization: 'Bearer strong-a3-token' },
    body: { action: 'provider_status', tenant_id: 'tenant-a' },
  }, res);
  assert.equal(res.code, 400);
  assert.deepEqual(res.body, { error: 'missing_project_id' });
});

test('forwards only scoped provider actions with the server secret', async () => {
  process.env.A3_VIDEO_PROVIDER_TOKEN = 'strong-a3-token';
  process.env.VIDEO_AGENT_ACCESS = 'provider-secret';
  process.env.SUPABASE_PUBLISHABLE_KEY = 'publishable-key';
  let forwarded;
  globalThis.fetch = async (url, options) => {
    forwarded = { url, options };
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const res = responseRecorder();
  await handler({
    method: 'POST', headers: { authorization: 'Bearer strong-a3-token' },
    body: { action: 'provider_status', tenant_id: 'tenant-a', project_id: 'project-a', job_id: 'job-a' },
  }, res);
  assert.equal(res.code, 200);
  assert.equal(forwarded.options.headers['x-video-access'], 'provider-secret');
  assert.equal(JSON.parse(forwarded.options.body).tenant_id, 'tenant-a');
});
