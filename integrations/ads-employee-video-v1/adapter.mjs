import { createHash, randomUUID } from 'node:crypto';

const ACTIONS = new Set([
  'create_job',
  'prepare_upload',
  'submit_job',
  'status',
  'refresh',
  'download_url',
  'create_revision',
  'record_feedback',
]);
const MODES = new Set(['remix', 'ai_hybrid', 'image_poster']);
const REVISION_SCOPES = new Set(['auto', 'hook', 'material', 'voice', 'subtitle', 'pace', 'cta', 'redo']);
const INPUT_BUCKET = 'video-agent-inputs';
const RESULT_BUCKET = 'video-agent-results';
const SIGNED_URL_LIFETIME_SECONDS = 3600;
const MAX_REQUEST_BYTES = 64 * 1024;
const MAX_READ_RETRIES = 2;

class AdapterError extends Error {
  constructor(status, code, definitive = false) {
    super(code);
    this.status = status;
    this.code = code;
    this.definitive = definitive;
  }
}

const fail = (status, code) => {
  throw new AdapterError(status, code);
};

function header(request, name) {
  if (typeof request.headers?.get === 'function') return request.headers.get(name);
  const wanted = name.toLowerCase();
  const key = Object.keys(request.headers || {}).find((item) => item.toLowerCase() === wanted);
  return key ? request.headers[key] : undefined;
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

function fingerprint(value) {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

function text(value, name, maxLength, { required = true } = {}) {
  if (typeof value !== 'string' || value.length > maxLength || (required && !value.trim())) {
    fail(400, `invalid_${name}`);
  }
  return value.trim();
}

function boundedList(value, name, maximum, itemLength) {
  if (!Array.isArray(value) || value.length > maximum) fail(400, `invalid_${name}`);
  return value.map((item) => text(item, name, itemLength));
}

function asNumber(value) {
  return Number.isFinite(value) ? value : null;
}

function outputManifest(job, taskId) {
  const files = Array.isArray(job.output_files) ? job.output_files : [];
  return files.flatMap((file, index) => {
    if (!file || typeof file.path !== 'string' || !file.path.trim()
      || typeof file.name !== 'string' || !file.name.trim()) return [];
    return [{
      assetRef: `asset-${index}`,
      name: file.name,
      contentType: typeof file.type === 'string' ? file.type : null,
      durationSeconds: asNumber(file.duration_seconds),
      width: asNumber(file.width),
      height: asNumber(file.height),
      cost: asNumber(file.cost),
      taskId,
    }];
  });
}

function mediaResult(job, taskId, jobRef, parentJobRef = null) {
  if (!job || typeof job !== 'object' || typeof job.id !== 'string') fail(502, 'invalid_media_job');
  const assets = outputManifest(job, taskId);
  const status = typeof job.status === 'string' ? job.status : 'unknown';
  const completionConfirmed = status === 'completed' && assets.length > 0;
  let state = ({
    uploading: 'submitted',
    queued: 'queued',
    processing: 'rendering',
    completed: completionConfirmed ? 'completed' : 'needs-attention',
    failed: 'failed',
    needs_attention: 'needs-attention',
    'needs-attention': 'needs-attention',
  })[status] || 'unknown';
  if (status === 'completed' && !assets.length) state = 'needs-attention';
  return {
    taskId,
    jobRef,
    jobId: job.id,
    parentJobRef,
    revisionOfJobId: typeof job.parent_job_id === 'string' ? job.parent_job_id : null,
    version: Number.isInteger(job.version_number) ? job.version_number : null,
    mode: typeof job.workflow_mode === 'string' ? job.workflow_mode : 'unknown',
    executionTarget: typeof job.execution_target === 'string' ? job.execution_target : 'unknown',
    serviceStatus: status,
    state,
    attentionRequired: Boolean(job.error_message) || (status === 'completed' && !assets.length),
    completionConfirmed,
    hasOutputManifest: assets.length > 0,
    assets,
  };
}

function briefSnapshot(input, taskId, mode) {
  const brief = input.creativeBrief;
  if (!brief || typeof brief !== 'object' || Array.isArray(brief)) fail(400, 'invalid_creative_brief');
  const desired = brief.desired;
  if (!desired || typeof desired !== 'object' || Array.isArray(desired)) fail(400, 'invalid_desired_output');
  const format = text(desired.format, 'format', 40).toLowerCase();
  if (!MODES.has(mode)) fail(400, 'unsupported_mode');
  if (!((format === 'image' && mode === 'image_poster') || (format === 'video' && mode !== 'image_poster'))) {
    fail(400, 'unsupported_format_or_mode');
  }
  const durationSeconds = desired.durationSeconds ?? null;
  if (durationSeconds !== null && (!Number.isInteger(durationSeconds) || durationSeconds < 1 || durationSeconds > 180)) {
    fail(400, 'invalid_duration');
  }
  const count = desired.count;
  if (!Number.isInteger(count) || count < 1 || count > 3) fail(400, 'invalid_count');
  const snapshot = {
    version: 1,
    taskId,
    campaignRef: text(brief.campaignRef, 'campaign_ref', 200),
    strategyRef: text(brief.strategyRef, 'strategy_ref', 200),
    materialVersionRef: text(brief.materialVersionRef, 'material_version_ref', 200),
    language: text(brief.language, 'language', 80),
    audience: text(brief.audience, 'audience', 2000),
    offerFacts: text(brief.offerFacts ?? '', 'offer_facts', 4000, { required: false }),
    prohibitedClaims: boundedList(brief.prohibitedClaims, 'prohibited_claim', 30, 500),
    referenceAssets: boundedList(brief.referenceAssets, 'reference_asset', 20, 300),
    desired: { format, durationSeconds, count },
    cta: text(brief.cta, 'cta', 500),
    mode,
  };
  const mediaBrief = [
    'Ads Employee creative brief snapshot v1',
    `Campaign reference: ${snapshot.campaignRef}`,
    `Strategy reference: ${snapshot.strategyRef}`,
    `Material version reference: ${snapshot.materialVersionRef}`,
    `Language: ${snapshot.language}`,
    `Audience: ${snapshot.audience}`,
    `Offer facts (caller-provided): ${snapshot.offerFacts || 'Not provided'}`,
    `Prohibited claims: ${snapshot.prohibitedClaims.join('; ') || 'None supplied'}`,
    `Reference asset references (not final assets): ${snapshot.referenceAssets.join('; ') || 'None'}`,
    `Requested format: ${format}`,
    `Requested duration seconds: ${durationSeconds ?? 'unspecified'}`,
    `Requested output count: ${count}`,
    `CTA: ${snapshot.cta}`,
  ].join('\n');
  return { snapshot, mediaBrief };
}

function operationKey(operation, key) {
  return `${operation}:${key}`;
}

function jobScope(scope, mapping) {
  if (!mapping || typeof mapping.mediaJobId !== 'string' || mapping.videoProjectId !== scope.videoProjectId) {
    fail(404, 'job_not_found');
  }
  return mapping;
}

export function createAdsEmployeeVideoAdapter({
  authorize,
  resolveBinding,
  transport,
  persistence,
  allowedOrigins,
  signedUrlOrigins,
  timeoutMs = 5000,
  readRetries = 1,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now = () => Date.now(),
  createId = randomUUID,
}) {
  if (![authorize, resolveBinding, transport].every((value) => typeof value === 'function')) {
    throw new TypeError('authorize, resolveBinding and transport are required');
  }
  if (!persistence || typeof persistence.reserveOperation !== 'function'
    || typeof persistence.completeOperation !== 'function'
    || typeof persistence.releaseOperation !== 'function'
    || typeof persistence.getJobMapping !== 'function'
    || typeof persistence.reconcileOperation !== 'function') {
    throw new TypeError('durable persistence hooks are required');
  }
  const origins = new Set(allowedOrigins || []);
  const urlOrigins = new Set(signedUrlOrigins || []);
  const boundedTimeout = Math.max(100, Math.min(15000, timeoutMs));
  const retries = Math.max(0, Math.min(MAX_READ_RETRIES, readRetries));

  async function call(action, payload, { read = false } = {}) {
    let attempt = 0;
    while (true) {
      const controller = new AbortController();
      let timer;
      try {
        const result = await Promise.race([
          Promise.resolve().then(() => transport(action, payload, { signal: controller.signal })),
          new Promise((_, reject) => {
            timer = setTimeout(() => {
              controller.abort();
              reject(new AdapterError(504, 'upstream_timeout'));
            }, boundedTimeout);
          }),
        ]);
        if (!result || !Number.isInteger(result.status)) fail(502, 'invalid_upstream_response');
        if (result.status < 200 || result.status >= 300) {
          const definitive = [400, 401, 403, 404, 409, 422, 429].includes(result.status);
          const error = result.status === 401 ? new AdapterError(401, 'upstream_unauthorized', true)
            : result.status === 403 ? new AdapterError(403, 'upstream_forbidden', true)
              : result.status === 429 ? new AdapterError(429, 'upstream_rate_limited', true)
                : result.status === 409 ? new AdapterError(409, 'upstream_conflict', true)
                  : definitive ? new AdapterError(502, 'upstream_rejected', true)
                    : new AdapterError(502, 'upstream_error');
          if (read && attempt < retries && [429, 502].includes(error.status)) {
            await sleep(100 * (2 ** attempt++));
            continue;
          }
          throw error;
        }
        if (!result.body || typeof result.body !== 'object' || Array.isArray(result.body) || result.body.ok !== true) {
          fail(502, 'unexpected_upstream_envelope');
        }
        return result.body;
      } catch (error) {
        const safeError = error instanceof AdapterError ? error : new AdapterError(502, 'upstream_unavailable');
        if (read && attempt < retries && [502, 504].includes(safeError.status)) {
          await sleep(100 * (2 ** attempt++));
          continue;
        }
        throw safeError;
      } finally {
        clearTimeout(timer);
      }
    }
  }

  async function bindingFor(context, projectRef) {
    let binding;
    try {
      binding = await resolveBinding({
        actorId: context.actorId,
        tenantId: context.tenantId,
        role: context.role,
        projectRef,
      });
    } catch {
      fail(404, 'project_not_found');
    }
    if (!binding || binding.tenantId !== context.tenantId
      || typeof binding.videoProjectId !== 'string' || !binding.videoProjectId) {
      fail(404, 'project_not_found');
    }
    return {
      tenantId: context.tenantId,
      actorId: context.actorId,
      projectRef,
      videoProjectId: binding.videoProjectId,
    };
  }

  async function mutation(scope, operation, idempotencyKey, payload, details, invoke, completionDetails = () => ({})) {
    const key = text(idempotencyKey, 'idempotency_key', 200);
    const scopedKey = operationKey(operation, key);
    const bodyFingerprint = fingerprint(payload);
    const reservation = await persistence.reserveOperation({
      scope,
      key: scopedKey,
      fingerprint: bodyFingerprint,
      details,
      logicalKey: details.logicalKey || null,
    });
    if (!reservation || !reservation.record) fail(503, 'idempotency_store_unavailable');
    if (reservation.record.fingerprint !== bodyFingerprint) fail(409, 'idempotency_conflict');
    if (reservation.record.state === 'completed') return reservation.record.result;
    const storedKey = reservation.record.key || scopedKey;
    if (!reservation.created) {
      const reconciled = await persistence.reconcileOperation({
        scope,
        key: storedKey,
        record: reservation.record,
        details,
      });
      if (reconciled?.state === 'completed' && reconciled.result) return reconciled.result;
      fail(409, 'reconciliation_required');
    }
    let result;
    try {
      result = await invoke(reservation.record);
    } catch (error) {
      if (error instanceof AdapterError && error.definitive) {
        await persistence.releaseOperation({
          scope,
          key: storedKey,
          fingerprint: bodyFingerprint,
        });
      }
      throw error;
    }
    const additionalDetails = await completionDetails(result, reservation.record);
    await persistence.completeOperation({
      scope,
      key: storedKey,
      fingerprint: bodyFingerprint,
      result,
      details: { ...reservation.record.details, ...details, ...additionalDetails },
    });
    return result;
  }

  async function mappedJob(scope, jobRef, taskId) {
    const mapping = jobScope(scope, await persistence.getJobMapping({
      scope,
      jobRef: text(jobRef, 'job_ref', 200),
    }));
    if (taskId && mapping.taskId && taskId !== mapping.taskId) fail(404, 'job_not_found');
    return mapping;
  }

  async function readStatus(scope, jobRef, taskId) {
    const mapping = await mappedJob(scope, jobRef, taskId);
    const response = await call('status', { job_id: mapping.mediaJobId }, { read: true });
    if (!response.job) fail(502, 'missing_media_job');
    return {
      mapping,
      job: response.job,
      result: mediaResult(response.job, mapping.taskId, jobRef, mapping.parentJobRef || null),
    };
  }

  async function handleRequest(request) {
    const origin = header(request, 'origin');
    let validOrigin = false;
    try {
      validOrigin = typeof origin === 'string' && new URL(origin).origin === origin && origins.has(origin);
    } catch {}
    if (!validOrigin) fail(403, 'origin_not_allowed');

    const contentLength = Number(header(request, 'content-length'));
    if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) fail(413, 'request_too_large');
    let requestBody = request.body;
    if (typeof requestBody === 'string') {
      try { requestBody = JSON.parse(requestBody); } catch { fail(400, 'invalid_json'); }
    } else if (typeof request.json === 'function') {
      try { requestBody = await request.json(); } catch { fail(400, 'invalid_json'); }
    }
    if (!requestBody || typeof requestBody !== 'object' || Array.isArray(requestBody)) fail(400, 'invalid_request');
    if (Buffer.byteLength(JSON.stringify(requestBody)) > MAX_REQUEST_BYTES) fail(413, 'request_too_large');
    const { operation, projectRef, idempotencyKey, jobRef, taskId, input = {} } = requestBody;
    if (!ACTIONS.has(operation)) fail(400, 'operation_not_allowed');
    text(projectRef, 'project_ref', 200);
    if (!input || typeof input !== 'object' || Array.isArray(input)) fail(400, 'invalid_input');

    let context;
    try { context = await authorize(request); } catch { fail(401, 'unauthorized'); }
    if (!context || typeof context.actorId !== 'string' || !context.actorId
      || typeof context.tenantId !== 'string' || !context.tenantId
      || !['customer', 'staff'].includes(context.role)) fail(401, 'unauthorized');
    const scope = await bindingFor(context, projectRef);

    if (operation === 'create_job') {
      const selectedMode = text(input.mode, 'mode', 40);
      if (!MODES.has(selectedMode)) fail(400, 'unsupported_mode');
      const canonicalTaskId = text(taskId, 'task_id', 200);
      const { snapshot, mediaBrief } = briefSnapshot(input, canonicalTaskId, selectedMode);
      const projectName = text(input.projectName, 'project_name', 200);
      const createPayload = { projectName, mode: selectedMode, snapshot };
      const jobRefForCreate = createId();
      if (typeof persistence.saveSnapshot !== 'function') fail(503, 'snapshot_store_unavailable');
      return await mutation(scope, operation, idempotencyKey, createPayload, {
        logicalKey: `task:${canonicalTaskId}`,
        jobRef: jobRefForCreate,
        taskId: canonicalTaskId,
        snapshot,
      }, async (record) => {
        try {
          await persistence.saveSnapshot({
            scope,
            taskId: canonicalTaskId,
            version: snapshot.version,
            snapshot,
          });
        } catch {
          throw new AdapterError(503, 'snapshot_store_unavailable', true);
        }
        const response = await call('init_job', {
          video_project_id: scope.videoProjectId,
          project_name: projectName,
          brief: mediaBrief,
          output_count: snapshot.desired.count,
          workflow_mode: selectedMode,
        });
        if (!response.job || typeof response.job.id !== 'string') fail(502, 'missing_created_job');
        return mediaResult(response.job, canonicalTaskId, record.details.jobRef);
      }, (result, record) => ({
        jobMapping: {
          jobRef: record.details.jobRef,
          mediaJobId: result.jobId,
          videoProjectId: scope.videoProjectId,
          taskId: canonicalTaskId,
          parentJobRef: null,
        },
      }));
    }

    if (operation === 'prepare_upload') {
      const mapping = await mappedJob(scope, jobRef, taskId);
      if (context.role !== 'staff' && context.role !== 'customer') fail(403, 'forbidden');
      const fileName = text(input.fileName, 'file_name', 200);
      if (fileName.includes('/') || fileName.includes('\\') || fileName === '.' || fileName === '..') fail(400, 'invalid_file_name');
      const contentType = text(input.contentType, 'content_type', 128);
      const role = text(input.role || 'reference', 'file_role', 40);
      const uploadRef = createId();
      const uploadPayload = { jobRef, fileName, contentType, role };
      return mutation(scope, operation, idempotencyKey, uploadPayload, {
        logicalKey: `upload:${jobRef}:${fingerprint(uploadPayload)}`,
        jobRef,
        uploadRef,
        taskId: mapping.taskId,
      }, async (record) => {
        const response = await call('sign_upload', {
          job_id: mapping.mediaJobId,
          file_name: fileName,
          content_type: contentType,
        });
        if (response.bucket !== INPUT_BUCKET || typeof response.path !== 'string' || !response.path) {
          fail(502, 'invalid_upload_path');
        }
        return {
          taskId: mapping.taskId,
          jobRef,
          uploadRef: record.details.uploadRef,
          bucket: INPUT_BUCKET,
          path: response.path,
          fileName,
          contentType,
          role,
        };
      }, (result, record) => ({
        uploadMapping: {
          jobRef,
          uploadRef: record.details.uploadRef,
          mediaJobId: mapping.mediaJobId,
          videoProjectId: scope.videoProjectId,
          bucket: result.bucket,
          path: result.path,
          fileName,
          contentType,
          role,
        },
      }));
    }

    if (operation === 'submit_job') {
      const mapping = await mappedJob(scope, jobRef, taskId);
      const uploads = boundedList(input.uploadRefs, 'upload_ref', 20, 200);
      const inputFiles = [];
      for (const uploadRef of uploads) {
        const upload = await persistence.getUploadMapping?.({ scope, jobRef, uploadRef });
        if (!upload || upload.videoProjectId !== scope.videoProjectId || upload.mediaJobId !== mapping.mediaJobId
          || upload.bucket !== INPUT_BUCKET || typeof upload.path !== 'string') fail(404, 'upload_not_found');
        inputFiles.push({
          name: upload.fileName,
          path: upload.path,
          type: upload.contentType,
          role: upload.role,
        });
      }
      const submitPayload = { jobRef, inputFiles };
      return mutation(scope, operation, idempotencyKey, submitPayload, {
        logicalKey: `submit:${jobRef}`,
        jobRef,
        taskId: mapping.taskId,
      }, async (record) => {
        const response = await call('submit_job', { job_id: mapping.mediaJobId, input_files: inputFiles });
        if (!response.job) fail(502, 'missing_submitted_job');
        const result = mediaResult(response.job, mapping.taskId, jobRef, mapping.parentJobRef || null);
        return result;
      });
    }

    if (operation === 'status' || operation === 'refresh') {
      const { result } = await readStatus(scope, jobRef, taskId);
      return result;
    }

    if (operation === 'download_url') {
      const { mapping, job, result } = await readStatus(scope, jobRef, taskId);
      const assetRef = text(input.assetRef, 'asset_ref', 40);
      const index = Number(assetRef.slice('asset-'.length));
      if (!assetRef.startsWith('asset-') || !Number.isInteger(index) || index < 0) fail(404, 'asset_not_found');
      const manifest = result.assets.find((asset) => asset.assetRef === assetRef);
      const file = Array.isArray(job.output_files) ? job.output_files[index] : null;
      if (!manifest || !file || typeof file.path !== 'string' || result.serviceStatus !== 'completed') {
        fail(404, 'asset_not_found');
      }
      const response = await call('download_url', { bucket: RESULT_BUCKET, path: file.path }, { read: true });
      if (typeof response.url !== 'string') fail(502, 'missing_download_url');
      let signedUrl;
      try { signedUrl = new URL(response.url); } catch { fail(502, 'invalid_download_url'); }
      if (signedUrl.protocol !== 'https:' || signedUrl.username || signedUrl.password || !urlOrigins.has(signedUrl.origin)) {
        fail(502, 'invalid_download_url');
      }
      const expiresAt = new Date(now() + SIGNED_URL_LIFETIME_SECONDS * 1000).toISOString();
      return { taskId: mapping.taskId, jobRef, assetRef, url: signedUrl.href, expiresAt, expiresInSeconds: SIGNED_URL_LIFETIME_SECONDS };
    }

    if (operation === 'create_revision') {
      const { mapping: parent, job: parentJob, result: parentResult } = await readStatus(scope, jobRef, taskId);
      if (parentJob.status !== 'completed') fail(409, 'parent_job_not_completed');
      if (!parentResult.completionConfirmed) fail(409, 'parent_output_missing');
      const revisionPrompt = text(input.prompt, 'revision_prompt', 4000);
      const revisionScope = text(input.scope || 'auto', 'revision_scope', 40);
      if (!REVISION_SCOPES.has(revisionScope)) fail(400, 'unsupported_revision_scope');
      const revisionPayload = { jobRef, prompt: revisionPrompt, scope: revisionScope };
      const revisionRef = createId();
      return mutation(scope, operation, idempotencyKey, revisionPayload, {
        logicalKey: `revision:${jobRef}`,
        jobRef: revisionRef,
        taskId: parent.taskId,
        parentJobRef: jobRef,
      }, async (record) => {
        const response = await call('create_revision', {
          parent_job_id: parent.mediaJobId,
          revision_prompt: revisionPrompt,
          revision_scope: revisionScope,
        });
        if (!response.job || typeof response.job.id !== 'string') fail(502, 'missing_revision_job');
        if (response.job.parent_job_id !== parent.mediaJobId
          || response.job.revision_prompt !== revisionPrompt
          || response.job.revision_scope !== revisionScope) {
          throw new AdapterError(409, 'revision_already_exists', true);
        }
        return mediaResult(response.job, parent.taskId, record.details.jobRef, jobRef);
      }, (result, record) => ({
        jobMapping: {
          jobRef: record.details.jobRef,
          mediaJobId: result.jobId,
          videoProjectId: scope.videoProjectId,
          taskId: parent.taskId,
          parentJobRef: jobRef,
        },
      }));
    }

    if (operation === 'record_feedback') {
      const mapping = jobRef ? await mappedJob(scope, jobRef, taskId) : null;
      const content = text(input.content, 'feedback', 4000);
      const feedbackPayload = { jobRef: jobRef || null, content };
      return mutation(scope, operation, idempotencyKey, feedbackPayload, {
        jobRef: jobRef || null,
        taskId: mapping?.taskId || text(taskId, 'task_id', 200),
      }, async (record) => {
        const response = await call('record_feedback', {
          video_project_id: scope.videoProjectId,
          job_id: mapping?.mediaJobId || null,
          actor_id: context.actorId,
          event_type: context.role === 'staff' ? 'ads_employee_staff_feedback' : 'ads_employee_customer_feedback',
          content,
          metadata: { task_id: record.details.taskId },
        });
        if (!Object.hasOwn(response, 'feedback')) fail(502, 'missing_feedback');
        return { taskId: record.details.taskId, jobRef: jobRef || null, feedback: response.feedback };
      });
    }
    fail(400, 'operation_not_allowed');
  }

  return async function handle(request) {
    try {
      return { status: 200, body: { ok: true, result: await handleRequest(request) } };
    } catch (error) {
      const known = error instanceof AdapterError ? error : new AdapterError(500, 'integration_error');
      return { status: known.status, body: { ok: false, error: known.code } };
    }
  };
}
