import assert from 'node:assert/strict';
import test from 'node:test';
import handler from '../api/video-agent.mjs';

function responseRecorder() {
  return {
    code: 200,
    headers: {},
    body: undefined,
    status(code) { this.code = code; return this; },
    setHeader(name, value) { this.headers[name] = value; },
    json(value) { this.body = value; return this; },
    send(value) { this.body = value; return this; },
  };
}

test('rejects the wrong employee access code before provider call', async () => {
  process.env.VIDEO_EMPLOYEE_ACCESS = 'lulian';
  let called = false;
  globalThis.fetch = async () => { called = true; throw new Error('should_not_call'); };
  const res = responseRecorder();

  await handler({ method: 'POST', headers: { 'x-employee-access': 'wrong' }, body: { action: 'auth' } }, res);

  assert.equal(res.code, 401);
  assert.deepEqual(res.body, { error: 'unauthorized' });
  assert.equal(called, false);
});

test('exchanges lulian for the server-only provider access code', async () => {
  process.env.VIDEO_EMPLOYEE_ACCESS = 'lulian';
  process.env.VIDEO_AGENT_ACCESS = 'provider-secret';
  process.env.SUPABASE_PUBLISHABLE_KEY = 'publishable-key';
  let forwarded;
  globalThis.fetch = async (url, options) => {
    forwarded = { url, options };
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  const res = responseRecorder();

  await handler({ method: 'POST', headers: { 'x-employee-access': 'lulian' }, body: { action: 'auth' } }, res);

  assert.equal(res.code, 200);
  assert.equal(forwarded.options.headers['x-video-access'], 'provider-secret');
  assert.notEqual(forwarded.options.headers['x-video-access'], 'lulian');
  assert.equal(forwarded.options.headers.apikey, 'publishable-key');
  assert.equal(JSON.parse(forwarded.options.body).action, 'auth');
});
