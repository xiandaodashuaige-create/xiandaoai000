export const syntheticUploadingJob = {
  id: 'media-job-synthetic-001',
  video_project_id: 'media-project-synthetic-A',
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
