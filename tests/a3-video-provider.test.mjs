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

test('requires full conversation scope for provider job creation', async () => {
  process.env.A3_VIDEO_PROVIDER_TOKEN = 'strong-a3-token';
  const res = responseRecorder();
  await handler({
    method: 'POST', headers: { authorization: 'Bearer strong-a3-token' },
    body: { action: 'provider_init_job', tenant_id: 'tenant-a', project_id: 'project-a', idempotency_key: 'idem-a' },
  }, res);
  assert.equal(res.code, 400);
  assert.deepEqual(res.body, { error: 'missing_conversation_session_id' });
});

test('publishes a non-secret V3 ads integration capability contract', async () => {
  process.env.A3_VIDEO_PROVIDER_TOKEN = 'strong-a3-token';
  process.env.VIDEO_AGENT_ACCESS = 'provider-secret';
  process.env.SUPABASE_PUBLISHABLE_KEY = 'publishable-key';
  const res = responseRecorder();
  await handler({ method: 'GET', headers: {}, body: {} }, res);
  assert.equal(res.code, 200);
  assert.equal(res.body.service, 'v3-video-employee-provider');
  assert.equal(res.body.integration_target, 'v3-ads-employee');
  assert.equal(res.body.configured, true);
  assert.ok(res.body.actions.includes('provider_record_feedback'));
});

test('rejects incomplete scoped action payloads before forwarding', async () => {
  process.env.A3_VIDEO_PROVIDER_TOKEN = 'strong-a3-token';
  const res = responseRecorder();
  await handler({
    method: 'POST', headers: { authorization: 'Bearer strong-a3-token' },
    body: { action: 'provider_status', tenant_id: 'tenant-a', project_id: 'project-a' },
  }, res);
  assert.equal(res.code, 400);
  assert.deepEqual(res.body, { error: 'missing_job_id' });
});

test('allows revision and acceptance actions through the scoped gateway', async () => {
  process.env.A3_VIDEO_PROVIDER_TOKEN = 'strong-a3-token';
  process.env.VIDEO_AGENT_ACCESS = 'provider-secret';
  process.env.SUPABASE_PUBLISHABLE_KEY = 'publishable-key';
  const actions = [];
  globalThis.fetch = async (_url, options) => {
    const request = JSON.parse(options.body);
    actions.push(request.action);
    const job = request.action === 'provider_create_revision' ? { id: 'job-b', parent_job_id: request.parent_job_id, version_number: 2, revision_prompt: request.revision_prompt, revision_scope: request.revision_scope || 'auto', external_tenant_id: request.tenant_id, external_project_id: request.project_id } : undefined;
    return new Response(JSON.stringify({ ok: true, job }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  for (const body of [
    { action: 'provider_create_revision', tenant_id: 'tenant-a', project_id: 'project-a', parent_job_id: 'job-a', revision_prompt: '强化前三秒 Hook' },
    { action: 'provider_record_feedback', tenant_id: 'tenant-a', project_id: 'project-a', job_id: 'job-a', feedback_text: '字幕减少，不要挡脸' },
    { action: 'provider_accept_job', tenant_id: 'tenant-a', project_id: 'project-a', job_id: 'job-b' },
  ]) {
    const res = responseRecorder();
    await handler({ method: 'POST', headers: { authorization: 'Bearer strong-a3-token' }, body }, res);
    assert.equal(res.code, 200);
  }
  assert.deepEqual(actions, ['provider_create_revision', 'provider_record_feedback', 'provider_accept_job']);
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
