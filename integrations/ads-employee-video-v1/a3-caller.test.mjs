import test from 'node:test';
import assert from 'node:assert/strict';
import { createA3VideoCaller, projectA3VideoResult } from './a3-caller.mjs';
import {
  syntheticA3CreateRequest,
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
const PRIVATE_ASSETS = new Set(['library-asset-synthetic-A-1']);
const MATERIAL_VERSIONS = new Set(['materials-synthetic-v2']);

function testOnlyPersistence() {
  const operations = new Map();
  const logicalOperations = new Map();
  const jobs = new Map();
  const uploads = new Map();
  const snapshots = [];
  const scopeKey = (scope, key) => `${scope.tenantId}/${scope.projectRef}/${scope.videoProjectId}/${key}`;
  return {
    operations,
    jobs,
    uploads,
    snapshots,
    async reserveOperation({ scope, key, fingerprint, details, logicalKey }) {
      const prior = operations.get(scopeKey(scope, key))
        || (logicalKey && logicalOperations.get(scopeKey(scope, logicalKey)));
      if (prior) return { created: false, record: prior };
      const record = { key, fingerprint, logicalKey, details, state: 'reserved', result: null };
      operations.set(scopeKey(scope, key), record);
      if (logicalKey) logicalOperations.set(scopeKey(scope, logicalKey), record);
      return { created: true, record };
    },
    async completeOperation({ scope, key, fingerprint, result, details }) {
      const record = operations.get(scopeKey(scope, key));
      assert.ok(record);
      assert.equal(record.fingerprint, fingerprint);
      record.state = 'completed';
      record.result = result;
      record.details = details;
      if (details.jobMapping) jobs.set(scopeKey(scope, `job/${details.jobMapping.jobRef}`), details.jobMapping);
      if (details.uploadMapping) {
        uploads.set(scopeKey(scope, `upload/${details.uploadMapping.jobRef}/${details.uploadMapping.uploadRef}`), details.uploadMapping);
      }
    },
    async releaseOperation({ scope, key }) {
      operations.delete(scopeKey(scope, key));
    },
    async reconcileOperation() {
      return null;
    },
    async getJobMapping({ scope, jobRef }) {
      return jobs.get(scopeKey(scope, `job/${jobRef}`)) || null;
    },
    async getUploadMapping({ scope, jobRef, uploadRef }) {
      return uploads.get(scopeKey(scope, `upload/${jobRef}/${uploadRef}`)) || null;
    },
    async saveSnapshot(snapshot) {
      snapshots.push(snapshot);
    },
  };
}

function callerHarness({ initialRole = 'customer', persistence = testOnlyPersistence(), transportMode = 'normal' } = {}) {
  let role = initialRole;
  let statusIsCompleted = false;
  let nextId = 0;
  const calls = [];
  const validations = [];
  const handler = createA3VideoCaller({
    authorize: async () => ({ actorId: `actor-${role}`, tenantId: 'tenant-A', role }),
    resolveBinding: async ({ tenantId, projectRef }) => {
      if (tenantId !== 'tenant-A') return null;
      if (projectRef === 'caller-project-A') return { tenantId, videoProjectId: 'media-project-A' };
      if (projectRef === 'caller-project-B') return { tenantId, videoProjectId: 'media-project-B' };
      return null;
    },
    validatePrivateReferences: async (binding) => {
      validations.push(binding);
      return binding.tenantId === 'tenant-A'
        && binding.projectRef === 'caller-project-A'
        && binding.videoProjectId === 'media-project-A'
        && MATERIAL_VERSIONS.has(binding.materialVersionRef)
        && binding.referenceAssets.every((assetRef) => PRIVATE_ASSETS.has(assetRef));
    },
    transport: async (action, body) => {
      calls.push({ action, body });
      if (transportMode === 'ambiguous-create' && action === 'init_job') {
        throw new Error('synthetic timeout');
      }
      if (action === 'init_job') return { status: 200, body: syntheticJobEnvelope(syntheticUploadingJob) };
      if (action === 'sign_upload') return { status: 200, body: syntheticUploadEnvelope };
      if (action === 'submit_job') return { status: 200, body: syntheticJobEnvelope(syntheticQueuedJob) };
      if (action === 'status') {
        const job = body.job_id === syntheticRevisionJob.id
          ? { ...syntheticCompletedJob, ...syntheticRevisionJob, output_files: syntheticCompletedJob.output_files }
          : statusIsCompleted ? syntheticCompletedJob : syntheticQueuedJob;
        return { status: 200, body: syntheticJobEnvelope(job) };
      }
      if (action === 'create_revision') {
        return {
          status: 200,
          body: syntheticJobEnvelope({
            ...syntheticRevisionJob,
            revision_prompt: body.revision_prompt,
            revision_scope: body.revision_scope,
          }),
        };
      }
      if (action === 'record_feedback') return { status: 200, body: syntheticFeedbackEnvelope };
      if (action === 'download_url') {
        return {
          status: 200,
          body: { ok: true, url: `${DOWNLOAD_ORIGIN}/object/synthetic?expires=fixture` },
        };
      }
      return { status: 400, body: { ok: false, error: 'unknown_action' } };
    },
    persistence,
    allowedOrigins: [ORIGIN],
    signedUrlOrigins: [DOWNLOAD_ORIGIN],
    timeoutMs: 500,
    readRetries: 0,
    sleep: async () => {},
    now: () => Date.parse('2026-10-13T00:00:00Z'),
    createId: () => `a3-ref-${++nextId}`,
  });
  return {
    handler,
    calls,
    validations,
    persistence,
    useRole(nextRole) { role = nextRole; },
    completeJobs() { statusIsCompleted = true; },
  };
}

const clone = (value) => structuredClone(value);

test('customer and staff share one task through the adapter; result events stay truthful and scoped', async () => {
  const h = callerHarness();
  const createReq = syntheticA3CreateRequest();
  const created = await h.handler(createReq);
  assert.equal(created.body.result.product, 'A3');
  assert.equal(created.body.result.presentationRole, 'AI视频员工');
  assert.equal(created.body.result.registeredRole, 'ai_video_employee');
  assert.equal(created.body.result.taskRef, 'caller-task-synthetic-17');
  assert.equal(created.body.result.version, 1);
  assert.equal(created.body.result.parentJobRef, null);
  assert.equal(created.body.result.state, 'pending');
  assert.deepEqual(created.body.result.eventTypes, ['STARTED']);
  assert.equal(created.body.result.completionConfirmed, false);
  assert.deepEqual(created.body.result.assets, []);

  h.useRole('staff');
  const staffDuplicateCreate = await h.handler(clone(createReq));
  assert.equal(staffDuplicateCreate.body.result.jobRef, created.body.result.jobRef);
  assert.equal(h.calls.filter(({ action }) => action === 'init_job').length, 1);

  const upload = await h.handler({
    headers: { origin: ORIGIN },
    body: {
      operation: 'prepare_upload',
      projectRef: 'caller-project-A',
      jobRef: created.body.result.jobRef,
      taskId: created.body.result.taskRef,
      idempotencyKey: 'upload-source-1',
      input: { fileName: 'reference.jpg', contentType: 'image/jpeg', role: 'reference' },
    },
  });
  assert.match(upload.body.result.uploadRef, /^a3-ref-\d+$/);
  assert.equal('path' in upload.body.result, false);
  assert.equal('bucket' in upload.body.result, false);

  h.useRole('customer');
  const submitRequest = {
    headers: { origin: ORIGIN },
    body: {
      operation: 'submit_job',
      projectRef: 'caller-project-A',
      jobRef: created.body.result.jobRef,
      taskId: created.body.result.taskRef,
      idempotencyKey: 'submit-task-17',
      input: { uploadRefs: [upload.body.result.uploadRef] },
    },
  };
  const submitted = await h.handler(submitRequest);
  assert.equal(submitted.body.result.state, 'progress');
  assert.deepEqual(submitted.body.result.eventTypes, ['PROGRESS']);
  assert.equal(submitted.body.result.completionConfirmed, false);
  const repeatedSubmit = await h.handler(clone(submitRequest));
  assert.deepEqual(repeatedSubmit, submitted);
  assert.equal(h.calls.filter(({ action }) => action === 'submit_job').length, 1);

  const pending = await h.handler({
    headers: { origin: ORIGIN },
    body: {
      operation: 'status',
      projectRef: 'caller-project-A',
      jobRef: created.body.result.jobRef,
      taskId: created.body.result.taskRef,
    },
  });
  assert.equal(pending.body.result.serviceStatus, 'queued');
  assert.equal(pending.body.result.state, 'progress');
  assert.deepEqual(pending.body.result.assets, []);

  h.completeJobs();
  const completed = await h.handler({
    headers: { origin: ORIGIN },
    body: {
      operation: 'refresh',
      projectRef: 'caller-project-A',
      jobRef: created.body.result.jobRef,
      taskId: created.body.result.taskRef,
    },
  });
  assert.equal(completed.body.result.state, 'completed');
  assert.deepEqual(completed.body.result.eventTypes, ['COMPLETED', 'APPROVAL_REQUIRED']);
  assert.equal(completed.body.result.adPublicationApproval, 'not_granted');
  assert.equal(completed.body.result.assets[0].durationSeconds, null);
  assert.equal(completed.body.result.assets[0].cost, null);
  const serialized = JSON.stringify(completed.body.result);
  for (const forbidden of ['tenant-A', 'actor-customer', 'media-job-synthetic-001', 'synthetic/job/result.mp4']) {
    assert.equal(serialized.includes(forbidden), false);
  }

  h.useRole('staff');
  const revision = await h.handler({
    headers: { origin: ORIGIN },
    body: {
      operation: 'create_revision',
      projectRef: 'caller-project-A',
      jobRef: created.body.result.jobRef,
      taskId: created.body.result.taskRef,
      idempotencyKey: 'revision-task-17',
      input: { prompt: 'Shorten the opening', scope: 'hook' },
    },
  });
  assert.equal(revision.body.result.parentJobRef, created.body.result.jobRef);
  assert.equal(revision.body.result.version, 2);

  const feedback = await h.handler({
    headers: { origin: ORIGIN },
    body: {
      operation: 'record_feedback',
      projectRef: 'caller-project-A',
      jobRef: created.body.result.jobRef,
      taskId: created.body.result.taskRef,
      idempotencyKey: 'feedback-task-17',
      input: { content: 'Synthetic staff feedback' },
    },
  });
  assert.equal(feedback.body.result.recorded, true);
  assert.equal('feedback' in feedback.body.result, false);
});

test('foreign private assets and forged material versions fail before create transport', async () => {
  const h = callerHarness();
  const foreignAsset = syntheticA3CreateRequest();
  foreignAsset.body.input.creativeBrief.referenceAssets = ['library-asset-synthetic-B-1'];
  const assetResult = await h.handler(foreignAsset);
  assert.equal(assetResult.status, 403);
  assert.equal(assetResult.body.error, 'private_references_not_authorized');
  assert.equal(h.calls.length, 0);

  const foreignMaterials = syntheticA3CreateRequest();
  foreignMaterials.body.input.creativeBrief.materialVersionRef = 'materials-synthetic-B-v2';
  const materialResult = await h.handler(foreignMaterials);
  assert.equal(materialResult.status, 403);
  assert.equal(h.calls.length, 0);
  assert.equal(h.persistence.operations.size, 0);
  assert.equal(h.persistence.snapshots.length, 0);
  assert.deepEqual(h.validations.map(({ tenantId, projectRef, videoProjectId }) => ({
    tenantId, projectRef, videoProjectId,
  })), [
    { tenantId: 'tenant-A', projectRef: 'caller-project-A', videoProjectId: 'media-project-A' },
    { tenantId: 'tenant-A', projectRef: 'caller-project-A', videoProjectId: 'media-project-A' },
  ]);
});

test('staff project switching cannot move a pending task or retrieve its mapping', async () => {
  const h = callerHarness();
  const created = await h.handler(syntheticA3CreateRequest());
  const before = h.calls.length;
  h.useRole('staff');
  const switched = await h.handler({
    headers: { origin: ORIGIN },
    body: {
      operation: 'status',
      projectRef: 'caller-project-B',
      jobRef: created.body.result.jobRef,
      taskId: created.body.result.taskRef,
    },
  });
  assert.equal(switched.status, 404);
  assert.equal(switched.body.error, 'job_not_found');
  assert.equal(h.calls.length, before);
});

test('ambiguous create remains reconciliation-required and is not repeated after reload', async () => {
  const h = callerHarness({ transportMode: 'ambiguous-create' });
  const request = syntheticA3CreateRequest();
  const first = await h.handler(request);
  assert.equal(first.status, 502);
  assert.equal(first.body.error, 'upstream_unavailable');
  const second = await h.handler(clone(request));
  assert.equal(second.status, 409);
  assert.equal(second.body.error, 'reconciliation_required');
  assert.equal(h.calls.filter(({ action }) => action === 'init_job').length, 1);
});

test('invalid binding fails closed and scoped download returns only explicit expiring URL', async () => {
  const h = callerHarness();
  const invalid = syntheticA3CreateRequest();
  invalid.body.projectRef = 'missing-project';
  const rejected = await h.handler(invalid);
  assert.equal(rejected.status, 404);
  assert.equal(h.calls.length, 0);

  const created = await h.handler(syntheticA3CreateRequest());
  h.completeJobs();
  const downloaded = await h.handler({
    headers: { origin: ORIGIN },
    body: {
      operation: 'download_url',
      projectRef: 'caller-project-A',
      jobRef: created.body.result.jobRef,
      taskId: created.body.result.taskRef,
      input: { assetRef: 'asset-0' },
    },
  });
  assert.equal(downloaded.body.result.expiresInSeconds, 3600);
  assert.match(downloaded.body.result.expiresAt, /^2026-10-13T01:00:00/);
  assert.equal(h.calls.filter(({ action }) => action === 'download_url').length, 1);
});

test('completed service state without a manifest projects to needs-input, never completion', () => {
  const result = projectA3VideoResult({
    taskId: 'caller-task-synthetic-17',
    jobRef: 'caller-job-synthetic-17',
    version: 1,
    serviceStatus: 'completed',
    state: 'needs-attention',
    completionConfirmed: false,
    assets: [],
  });
  assert.equal(result.state, 'needs-input');
  assert.equal(result.completionConfirmed, false);
  assert.deepEqual(result.eventTypes, ['NEEDS_INPUT']);
  assert.deepEqual(result.assets, []);
});

test('A3 projection preserves the parsed operation for string and stream request bodies', async () => {
  for (const bodyType of ['string', 'stream']) {
    const h = callerHarness();
    const request = syntheticA3CreateRequest();
    const serialized = JSON.stringify(request.body);
    request.body = bodyType === 'string'
      ? serialized
      : new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(serialized));
          controller.close();
        },
      });
    const response = await h.handler(request);
    assert.equal(response.body.ok, true);
    assert.equal(response.body.result.product, 'A3');
    assert.equal(response.body.result.taskRef, 'caller-task-synthetic-17');
  }
});
