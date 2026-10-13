import { createAdsEmployeeVideoAdapter } from './adapter.mjs';

const safeAsset = (asset) => ({
  assetRef: asset.assetRef,
  name: asset.name,
  contentType: asset.contentType ?? null,
  durationSeconds: asset.durationSeconds ?? null,
  width: asset.width ?? null,
  height: asset.height ?? null,
  cost: asset.cost ?? null,
});

export function projectA3VideoResult(result) {
  const serviceStatus = typeof result?.serviceStatus === 'string' ? result.serviceStatus : 'unknown';
  const assets = Array.isArray(result?.assets) ? result.assets : [];
  const completionConfirmed = result?.completionConfirmed === true
    && result?.state === 'completed'
    && assets.length > 0;
  let state;
  if (completionConfirmed) state = 'completed';
  else if (serviceStatus === 'failed' || result?.state === 'failed') state = 'failed';
  else if (serviceStatus === 'uploading' || result?.state === 'submitted') state = 'pending';
  else if (serviceStatus === 'queued' || result?.state === 'queued'
    || serviceStatus === 'processing' || result?.state === 'rendering') state = 'progress';
  else state = 'needs-input';

  const eventTypes = state === 'completed'
    ? ['COMPLETED', 'APPROVAL_REQUIRED']
    : state === 'failed'
      ? ['FAILED']
      : state === 'needs-input'
        ? ['NEEDS_INPUT']
        : state === 'progress'
          ? ['PROGRESS']
          : ['STARTED'];

  return {
    product: 'A3',
    presentationRole: 'AI视频员工',
    registeredRole: 'ai_video_employee',
    taskRef: typeof result?.taskId === 'string' ? result.taskId : null,
    jobRef: typeof result?.jobRef === 'string' ? result.jobRef : null,
    version: Number.isInteger(result?.version) ? result.version : null,
    parentJobRef: typeof result?.parentJobRef === 'string' ? result.parentJobRef : null,
    mode: typeof result?.mode === 'string' ? result.mode : null,
    executionTarget: typeof result?.executionTarget === 'string' ? result.executionTarget : null,
    serviceStatus,
    state,
    eventTypes,
    completionConfirmed,
    adPublicationApproval: 'not_granted',
    assets: completionConfirmed ? assets.map(safeAsset) : [],
  };
}

function projectOperationResult(operation, result) {
  if (['create_job', 'submit_job', 'status', 'refresh', 'create_revision'].includes(operation)) {
    return projectA3VideoResult(result);
  }
  if (operation === 'prepare_upload') {
    return {
      taskRef: result.taskId,
      jobRef: result.jobRef,
      uploadRef: result.uploadRef,
      fileName: result.fileName,
      contentType: result.contentType,
      role: result.role,
    };
  }
  if (operation === 'download_url') {
    return {
      assetRef: result.assetRef,
      url: result.url,
      expiresAt: result.expiresAt,
      expiresInSeconds: result.expiresInSeconds,
    };
  }
  if (operation === 'record_feedback') {
    return {
      taskRef: result.taskId,
      jobRef: result.jobRef,
      recorded: true,
    };
  }
  return {};
}

export function createA3VideoCaller({ validatePrivateReferences, ...adapterOptions }) {
  if (typeof validatePrivateReferences !== 'function') {
    throw new TypeError('validatePrivateReferences is required');
  }

  return createAdsEmployeeVideoAdapter({
    ...adapterOptions,
    validateBriefReferences: validatePrivateReferences,
    projectResult: projectOperationResult,
  });
}
