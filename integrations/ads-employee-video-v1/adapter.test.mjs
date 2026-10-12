import test from 'node:test';
import assert from 'node:assert/strict';
import { createAdsEmployeeVideoAdapter } from './adapter.mjs';
import {
  syntheticCompletedJob,
  syntheticFeedbackEnvelope,
  syntheticJobEnvelope,
  syntheticQueuedJob,
  syntheticRevisionJob,
  syntheticUploadEnvelope,
  syntheticUploadingJob,
} from './fixtures.mjs';

const ORIGIN = 'https://ads.example.test';
const DOWNLOAD_ORIGIN = 'https://storage.example.test';
const brief = {
  campaignRef: 'campaign-synthetic-17',
  strategyRef: 'strategy-synthetic-3',
  materialVersionRef: 'materials-synthetic-v2',
  language: 'en',
  audience: 'Adults interested in the service',
  offerFacts: 'Caller supplied: 10% off',
  prohibitedClaims: ['No guaranteed results'],
  referenceAssets: ['asset-source-synthetic-5'],
  desired: { format: 'video', durationSeconds: 20, count: 1 },
  cta: 'Learn more',
};

function fakePersistence() {
  const operations = new Map();
  const jobs = new Map();
  const uploads = new Map();
  const snapshots = [];
  const keyFor = (scope, key) => `${scope.tenantId}/${scope.videoProjectId}/${key}`;
  const mappingKey = (scope, jobRef) => keyFor(scope, `job/${jobRef}`);
  const uploadKey = (scope, jobRef, uploadRef) => keyFor(scope, `upload/${jobRef}/${uploadRef}`);
  return {
    operations,
    jobs,
    uploads,
    snapshots,
    async reserveOperation({ scope, key, fingerprint, details }) {
      const id = keyFor(scope, key);
      const found = operations.get(id);
      if (found) return { created: false, record: found };
      const record = { fingerprint, state: 'reserved', result: null, details };
      operations.set(id, record);
      return { created: true, record };
    },
    async completeOperation({ scope, key, fingerprint, result, details }) {
      const record = operations.get(keyFor(scope, key));
      assert.ok(record);
      assert.equal(record.fingerprint, fingerprint);
      record.state = 'completed';
      record.result = result;
      record.details = details;
      if (details.jobMapping) {
        jobs.set(mappingKey(scope, details.jobMapping.jobRef), details.jobMapping);
      }
      if (details.uploadMapping) {
        uploads.set(uploadKey(scope, details.uploadMapping.jobRef, details.uploadMapping.uploadRef), details.uploadMapping);
      }
    },
    async getJobMapping({ scope, jobRef }) {
      return jobs.get(mappingKey(scope, jobRef)) || null;
    },
    async getUploadMapping({ scope, jobRef, uploadRef }) {
      return uploads.get(uploadKey(scope, jobRef, uploadRef)) || null;
    },
    async reconcileOperation() {
      return null;
    },
    async saveSnapshot(snapshot) {
      snapshots.push(snapshot);
    },
  };
}

function harness({
  context = { actorId: 'actor-A', tenantId: 'tenant-A', role: 'customer' },
  transport,
  persistence = fakePersistence(),
  resolveBinding,
  createId,
  timeoutMs,
  readRetries = 0,
} = {}) {
  const calls = [];
  const bindings = [];
  const handler = createAdsEmployeeVideoAdapter({
    authorize: async () => context,
    resolveBinding: resolveBinding || (async ({ tenantId, projectRef }) => {
      bindings.push({ tenantId, projectRef });
      if (projectRef === 'project-A' && tenantId === 'tenant-A') {
        return { tenantId, videoProjectId: 'media-project-A' };
      }
      if (projectRef === 'project-B' && tenantId === 'tenant-B') {
        return { tenantId, videoProjectId: 'media-project-B' };
      }
      return null;
    }),
    transport: async (action, body, options) => {
      calls.push({ action, body, options });
      return transport ? transport(action, body, options) : defaultTransport(action, body);
    },
    persistence,
    allowedOrigins: [ORIGIN],
    signedUrlOrigins: [DOWNLOAD_ORIGIN],
    timeoutMs,
    readRetries,
    sleep: async () => {},
    now: () => Date.parse('2026-10-12T12:00:00Z'),
    createId: createId || (() => `ref-${calls.length + 1}`),
  });
  return { handler, calls, bindings, persistence };
}

function defaultTransport(action, body) {
  if (action === 'init_job') return { status: 200, body: syntheticJobEnvelope(syntheticUploadingJob) };
  if (action === 'sign_upload') return { status: 200, body: syntheticUploadEnvelope };
  if (action === 'submit_job') return { status: 200, body: syntheticJobEnvelope(syntheticQueuedJob) };
  if (action === 'status') {
    return { status: 200, body: syntheticJobEnvelope(body.job_id === syntheticRevisionJob.id ? syntheticRevisionJob : syntheticCompletedJob) };
  }
  if (action === 'create_revision') return { status: 200, body: syntheticJobEnvelope(syntheticRevisionJob) };
  if (action === 'download_url') {
    return {
      status: 200,
      body: { ok: true, url: `${DOWNLOAD_ORIGIN}/object/signed/synthetic-result?expires=fixture` },
    };
  }
  if (action === 'record_feedback') return { status: 200, body: syntheticFeedbackEnvelope };
  return { status: 400, body: { ok: false, error: 'unknown_action' } };
}

function request(operation, extra = {}, { origin = ORIGIN } = {}) {
  return {
    headers: { origin },
    body: { operation, projectRef: 'project-A', ...extra },
  };
}

function createRequest(extra = {}) {
  return request('create_job', {
    idempotencyKey: 'create-key-1',
    taskId: 'task-synthetic-1',
    input: { projectName: 'Synthetic campaign', mode: 'remix', creativeBrief: brief },
    ...extra,
  });
}

async function createJob(h) {
  return h.handler(createRequest());
}

test('unknown tenants and foreign job references fail before contacting the media service', async () => {
  const h = harness();
  const unknownTenant = harness({ context: { actorId: 'actor-X', tenantId: 'tenant-X', role: 'customer' } });
  const unknown = await unknownTenant.handler(request('status', { jobRef: 'foreign-job' }));
  assert.equal(unknown.status, 404);
  assert.equal(unknown.body.error, 'project_not_found');
  assert.equal(unknownTenant.calls.length, 0);

  const unknownJob = await h.handler(request('status', { jobRef: 'foreign-job' }));
  assert.equal(unknownJob.body.error, 'job_not_found');
  assert.equal(h.calls.length, 0);

  const created = await createJob(h);
  assert.equal(created.status, 200);
  const foreign = harness({
    context: { actorId: 'actor-B', tenantId: 'tenant-B', role: 'customer' },
    persistence: h.persistence,
  });
  const denied = await foreign.handler(request('download_url', {
    projectRef: 'project-B',
    jobRef: created.body.result.jobRef,
    taskId: created.body.result.taskId,
    input: { assetRef: 'asset-0' },
  }));
  assert.equal(denied.status, 404);
  assert.equal(denied.body.error, 'job_not_found');
  assert.equal(foreign.calls.length, 0);
});

test('worker/admin operations are not in the customer integration allowlist', async () => {
  const h = harness();
  const response = await h.handler(request('worker_update', {
    jobRef: 'job',
    input: { status: 'completed', output_files: [] },
  }));
  assert.equal(response.status, 400);
  assert.equal(response.body.error, 'operation_not_allowed');
  assert.equal(h.calls.length, 0);
});

test('creates a versioned brief snapshot and keeps scope for status, refresh, revision, and feedback', async () => {
  const h = harness({ createId: (() => {
    let n = 0;
    return () => `integration-job-${++n}`;
  })() });
  const created = await createJob(h);
  assert.equal(created.status, 200);
  assert.equal(created.body.result.jobId, syntheticUploadingJob.id);
  assert.equal(created.body.result.taskId, 'task-synthetic-1');
  assert.equal(created.body.result.state, 'submitted');
  assert.equal(created.body.result.completionConfirmed, false);
  assert.deepEqual(h.persistence.snapshots[0].snapshot.referenceAssets, ['asset-source-synthetic-5']);
  assert.match(h.calls[0].body.brief, /Prohibited claims: No guaranteed results/);
  assert.equal(h.persistence.jobs.size, 1);
  const jobRef = created.body.result.jobRef;

  const status = await h.handler(request('status', { jobRef }));
  assert.equal(status.body.result.state, 'completed');
  assert.equal(status.body.result.assets[0].durationSeconds, null);
  assert.equal(status.body.result.assets[0].width, null);
  assert.equal(status.body.result.assets[0].cost, null);
  const refresh = await h.handler(request('refresh', { jobRef }));
  assert.equal(refresh.body.result.jobId, syntheticCompletedJob.id);

  const revision = await h.handler(request('create_revision', {
    jobRef,
    idempotencyKey: 'revision-key-1',
    input: { prompt: 'Make the opening clearer', scope: 'hook' },
  }));
  assert.equal(revision.body.result.parentJobRef, jobRef);
  assert.equal(revision.body.result.revisionOfJobId, syntheticCompletedJob.id);
  assert.equal(revision.body.result.version, 2);

  const feedback = await h.handler(request('record_feedback', {
    jobRef,
    idempotencyKey: 'feedback-key-1',
    input: { content: 'Please retain this tone' },
  }));
  assert.equal(feedback.status, 200);
  const feedbackCall = h.calls.find((call) => call.action === 'record_feedback');
  assert.equal(feedbackCall.body.video_project_id, 'media-project-A');
  assert.equal(feedbackCall.body.actor_id, 'actor-A');
  assert.equal(feedbackCall.body.event_type, 'ads_employee_customer_feedback');
  assert.equal(feedbackCall.body.metadata.task_id, 'task-synthetic-1');
  assert.equal(h.bindings.length, 5);
  assert.ok(h.bindings.every(({ tenantId, projectRef }) => tenantId === 'tenant-A' && projectRef === 'project-A'));
  assert.equal(h.calls.some((call) => call.action === 'accept_job'), false);
});

test('uploads use service-issued project/job paths and submit uses only persisted upload references', async () => {
  const h = harness();
  const created = await createJob(h);
  const jobRef = created.body.result.jobRef;
  const prepared = await h.handler(request('prepare_upload', {
    jobRef,
    idempotencyKey: 'upload-key-1',
    input: { fileName: 'reference.jpg', contentType: 'image/jpeg', role: 'main' },
  }));
  assert.equal(prepared.status, 200);
  assert.equal(prepared.body.result.bucket, 'video-agent-inputs');
  assert.equal(prepared.body.result.path, syntheticUploadEnvelope.path);

  const submitted = await h.handler(request('submit_job', {
    jobRef,
    idempotencyKey: 'submit-key-1',
    input: { uploadRefs: [prepared.body.result.uploadRef], path: 'tenant-B/private.jpg' },
  }));
  assert.equal(submitted.status, 200);
  const submitCall = h.calls.find((call) => call.action === 'submit_job');
  assert.deepEqual(submitCall.body.input_files, [{
    name: 'reference.jpg',
    path: syntheticUploadEnvelope.path,
    type: 'image/jpeg',
    role: 'main',
  }]);
  assert.equal(Object.hasOwn(submitCall.body, 'path'), false);
});

test('repeated submit and revision keys reuse stored results; an ambiguous write is never retried', async () => {
  const h = harness({ createId: (() => {
    let n = 0;
    return () => `integration-job-${++n}`;
  })() });
  const created = await createJob(h);
  const jobRef = created.body.result.jobRef;
  const prepared = await h.handler(request('prepare_upload', {
    jobRef,
    idempotencyKey: 'upload-key-1',
    input: { fileName: 'reference.jpg', contentType: 'image/jpeg' },
  }));
  const submit = request('submit_job', {
    jobRef,
    idempotencyKey: 'submit-once',
    input: { uploadRefs: [prepared.body.result.uploadRef] },
  });
  const firstSubmit = await h.handler(submit);
  const secondSubmit = await h.handler(submit);
  assert.deepEqual(secondSubmit, firstSubmit);
  assert.equal(h.calls.filter((call) => call.action === 'submit_job').length, 1);

  const revision = request('create_revision', {
    jobRef,
    idempotencyKey: 'revision-once',
    input: { prompt: 'Adjust the ending', scope: 'cta' },
  });
  const firstRevision = await h.handler(revision);
  const secondRevision = await h.handler(revision);
  assert.deepEqual(secondRevision, firstRevision);
  assert.equal(h.calls.filter((call) => call.action === 'create_revision').length, 1);

  const ambiguous = harness({
    persistence: fakePersistence(),
    transport: async (action) => {
      if (action === 'init_job') throw new Error('fixture transport detail');
      return defaultTransport(action, {});
    },
  });
  const first = await createJob(ambiguous);
  const retry = await createJob(ambiguous);
  assert.equal(first.body.error, 'upstream_unavailable');
  assert.equal(retry.body.error, 'reconciliation_required');
  assert.equal(ambiguous.calls.filter((call) => call.action === 'init_job').length, 1);
  assert.doesNotMatch(JSON.stringify(first), /fixture transport detail/);
});

test('queued and incomplete completed records never claim a final asset; signed URLs expire explicitly', async () => {
  const h = harness({
    transport: async (action, body) => {
      if (action === 'init_job') return { status: 200, body: syntheticJobEnvelope(syntheticUploadingJob) };
      if (action === 'status') {
        const job = body.job_id === 'missing-manifest'
          ? { ...syntheticCompletedJob, id: 'missing-manifest', output_files: [] }
          : syntheticQueuedJob;
        return { status: 200, body: syntheticJobEnvelope(job) };
      }
      if (action === 'download_url') return defaultTransport(action, body);
      return defaultTransport(action, body);
    },
  });
  const created = await createJob(h);
  const queued = await h.handler(request('status', { jobRef: created.body.result.jobRef }));
  assert.equal(queued.body.result.state, 'queued');
  assert.equal(queued.body.result.completionConfirmed, false);
  assert.equal(queued.body.result.hasOutputManifest, false);

  const missing = fakePersistence();
  const missingHarness = harness({
    persistence: missing,
    transport: async (action, body) => {
      if (action === 'status' && body.job_id === 'missing-manifest') {
        return { status: 200, body: syntheticJobEnvelope({ ...syntheticCompletedJob, id: 'missing-manifest', output_files: [] }) };
      }
      return defaultTransport(action, body);
    },
  });
  const missingCreate = await createJob(missingHarness);
  const mapping = await missingHarness.persistence.getJobMapping({
    scope: { tenantId: 'tenant-A', actorId: 'actor-A', projectRef: 'project-A', videoProjectId: 'media-project-A' },
    jobRef: missingCreate.body.result.jobRef,
  });
  mapping.mediaJobId = 'missing-manifest';
  missingHarness.persistence.jobs.set('tenant-A/media-project-A/job/' + missingCreate.body.result.jobRef, mapping);
  const noManifest = await missingHarness.handler(request('status', { jobRef: missingCreate.body.result.jobRef }));
  assert.equal(noManifest.body.result.serviceStatus, 'completed');
  assert.equal(noManifest.body.result.state, 'needs-attention');
  assert.equal(noManifest.body.result.completionConfirmed, false);

  const completed = await h.handler(request('status', { jobRef: created.body.result.jobRef }));
  assert.equal(completed.body.result.hasOutputManifest, false);
  const withAsset = harness();
  const withAssetCreated = await createJob(withAsset);
  const assetResult = await withAsset.handler(request('download_url', {
    jobRef: withAssetCreated.body.result.jobRef,
    input: { assetRef: 'asset-0', path: 'arbitrary/other/path', bucket: 'other-bucket' },
  }));
  assert.equal(assetResult.status, 200);
  assert.equal(assetResult.body.result.expiresInSeconds, 3600);
  assert.equal(assetResult.body.result.expiresAt, '2026-10-12T13:00:00.000Z');
  const signCall = withAsset.calls.find((call) => call.action === 'download_url');
  assert.equal(signCall.body.bucket, 'video-agent-results');
  assert.equal(signCall.body.path, syntheticCompletedJob.output_files[0].path);
});

test('upstream authorization, rate limiting, timeouts and malformed envelopes are redacted', async (t) => {
  for (const [status, expected] of [[401, 'upstream_unauthorized'], [403, 'upstream_forbidden'], [429, 'upstream_rate_limited']]) {
    await t.test(`HTTP ${status}`, async () => {
      let initialized = false;
      const h = harness({ transport: async (action, body) => {
        if (action === 'init_job' && !initialized) {
          initialized = true;
          return defaultTransport(action, body);
        }
        return { status, body: { ok: false, error: 'synthetic private transport detail' } };
      } });
      const created = await createJob(h);
      assert.equal(created.status, 200);
      const result = await h.handler(request('status', { jobRef: created.body.result.jobRef }));
      assert.equal(result.body.error, expected);
      assert.doesNotMatch(JSON.stringify(result), /synthetic private transport detail/);
    });
  }

  await t.test('timeout', async () => {
    let initialized = false;
    const h = harness({
      timeoutMs: 100,
      transport: async (action, body) => {
        if (action === 'init_job' && !initialized) {
          initialized = true;
          return defaultTransport(action, body);
        }
        return new Promise(() => {});
      },
    });
    const created = await createJob(h);
    const result = await h.handler(request('status', { jobRef: created.body.result.jobRef }));
    assert.equal(result.body.error, 'upstream_timeout');
  });

  await t.test('unexpected envelope', async () => {
    let initialized = false;
    const h = harness({
      transport: async (action, body) => {
        if (action === 'init_job' && !initialized) {
          initialized = true;
          return defaultTransport(action, body);
        }
        return { status: 200, body: { data: 'synthetic private detail' } };
      },
    });
    const created = await createJob(h);
    const result = await h.handler(request('status', { jobRef: created.body.result.jobRef }));
    assert.equal(result.body.error, 'unexpected_upstream_envelope');
    assert.doesNotMatch(JSON.stringify(result), /synthetic private detail/);
  });
});

test('origin, supported format, and upload reference boundaries are enforced', async () => {
  const h = harness();
  const wrongOriginRequest = createRequest();
  wrongOriginRequest.headers.origin = 'https://untrusted.example.test';
  const wrongOrigin = await h.handler(wrongOriginRequest);
  assert.equal(wrongOrigin.status, 403);
  const unsupported = await h.handler(createRequest({
    input: { projectName: 'Unsupported', mode: 'remix', creativeBrief: { ...brief, desired: { ...brief.desired, format: 'square-video' } } },
  }));
  assert.equal(unsupported.body.error, 'unsupported_format_or_mode');
  assert.equal(h.calls.length, 0);
});

test('the adapter emits no caller credential or arbitrary operation in response data', async () => {
  const h = harness();
  const response = await createJob(h);
  assert.equal(response.status, 200);
  assert.doesNotMatch(JSON.stringify(response), /credential|access_code|api[_-]?key|authorization/i);
  assert.equal(h.calls[0].action, 'init_job');
  assert.equal(Object.hasOwn(h.calls[0].body, 'access_code'), false);
});
