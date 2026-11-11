export const syntheticUploadingJob = {
  id: 'media-job-synthetic-001',
  video_project_id: 'media-project-A',
  project_name: 'Synthetic campaign',
  workflow_mode: 'remix',
  status: 'uploading',
  progress: 2,
  stage: 'Waiting for media',
  output_files: [],
  version_number: 1,
  execution_target: 'local',
  parent_job_id: null,
  error_message: null,
};

export const syntheticQueuedJob = {
  ...syntheticUploadingJob,
  status: 'queued',
  progress: 5,
  stage: 'Waiting for worker',
};

export const syntheticCompletedJob = {
  ...syntheticUploadingJob,
  status: 'completed',
  progress: 100,
  stage: 'Complete',
  output_files: [{
    name: 'result.mp4',
    path: 'synthetic/job/result.mp4',
    type: 'video/mp4',
  }],
};

export const syntheticRevisionJob = {
  ...syntheticQueuedJob,
  id: 'media-job-synthetic-revision-002',
  parent_job_id: syntheticCompletedJob.id,
  version_number: 2,
};

export const syntheticJobEnvelope = (job) => ({ ok: true, job });
export const syntheticUploadEnvelope = {
  ok: true,
  bucket: 'video-agent-inputs',
  path: 'synthetic/job/reference.jpg',
  content_type: 'image/jpeg',
};
export const syntheticFeedbackEnvelope = { ok: true, feedback: { id: 'feedback-synthetic-001' } };

export const syntheticA3CreateRequest = () => ({
  headers: { origin: 'https://ads.example.test' },
  body: {
    operation: 'create_job',
    projectRef: 'caller-project-A',
    taskId: 'caller-task-synthetic-17',
    idempotencyKey: 'a3-create-task-17',
    input: {
      projectName: 'Synthetic campaign',
      mode: 'remix',
      creativeBrief: {
        campaignRef: 'campaign-synthetic-17',
        strategyRef: 'strategy-synthetic-3',
        materialVersionRef: 'materials-synthetic-v2',
        language: 'en',
        audience: 'Synthetic audience',
        offerFacts: 'Synthetic caller-provided offer',
        prohibitedClaims: ['No guaranteed results'],
        referenceAssets: ['library-asset-synthetic-A-1'],
        desired: { format: 'video', durationSeconds: 20, count: 1 },
        cta: 'Learn more',
      },
    },
  },
});
