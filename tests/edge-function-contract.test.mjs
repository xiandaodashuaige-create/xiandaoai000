import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../supabase/functions/video-agent-v0/index.ts', import.meta.url), 'utf8');

test('provider upload contract returns a time-limited signed upload token', () => {
  const providerBlock = source.slice(
    source.indexOf('if (action === "provider_sign_upload")'),
    source.indexOf('if (action === "provider_submit_job")'),
  );
  assert.match(providerBlock, /video_agent_provider_get_job/);
  assert.match(providerBlock, /createSignedUploadUrl/);
  assert.match(providerBlock, /token:\s*signedUpload\.token/);
  assert.match(providerBlock, /signed_url:\s*signedUpload\.signedUrl/);
});

test('signed upload is issued only after the scoped job lookup succeeds', () => {
  const providerBlock = source.slice(
    source.indexOf('if (action === "provider_sign_upload")'),
    source.indexOf('if (action === "provider_submit_job")'),
  );
  assert.ok(providerBlock.indexOf('video_agent_provider_get_job') < providerBlock.indexOf('createSignedUploadUrl'));
  assert.match(providerBlock, /if \(scopeError \|\| !scopedJob\?\.id\).*404/);
});

test('provider feedback is tenant scoped before project memory is updated', () => {
  const providerBlock = source.slice(
    source.indexOf('if (action === "provider_record_feedback")'),
    source.indexOf('if (action === "provider_accept_job")'),
  );
  assert.match(providerBlock, /video_agent_provider_get_job/);
  assert.match(providerBlock, /video_agent_record_feedback/);
  assert.ok(providerBlock.indexOf('video_agent_provider_get_job') < providerBlock.indexOf('video_agent_record_feedback'));
  assert.match(providerBlock, /scopedJob\.video_project_id/);
  assert.match(providerBlock, /p_content:\s*feedbackText/);
  assert.match(providerBlock, /p_metadata:/);
});

test('failed job retry reuses stored inputs and triggers the cloud worker', () => {
  const retryBlock = source.slice(
    source.indexOf('if (action === "retry_failed_job")'),
    source.indexOf('if (action === "accept_job")'),
  );
  assert.match(retryBlock, /video_agent_create_revision/);
  assert.match(retryBlock, /p_parent_job_id/);
  assert.match(retryBlock, /p_revision_scope:\s*"retry_failed"/);
  assert.match(retryBlock, /source:\s*"retry_failed_job"/);
  assert.match(retryBlock, /CLOUD_WORKER_URL/);
});

test('retry migration is access checked, input preserving, and idempotent', async () => {
  const migration = await readFile(
    new URL('../supabase/migrations/20261014105437_retry_failed_video_jobs.sql', import.meta.url),
    'utf8',
  );
  assert.match(migration, /video_agent_check_access\(p_access\)/);
  assert.match(migration, /p\.status = 'failed'/);
  assert.match(migration, /p\.input_files/);
  assert.match(migration, /'retry_failed'/);
  assert.match(migration, /where parent_job_id=p_parent_job_id/);
  assert.match(migration, /revoke all on function public\.video_agent_create_revision\(text,uuid,text,text\) from public/);
});

test('retry lineage preserves the paid-generation correlation id', async () => {
  const migration = await readFile(
    new URL('../supabase/migrations/20261014112600_retry_generation_correlation.sql', import.meta.url),
    'utf8',
  );
  assert.match(migration, /case when is_failed_retry then coalesce\(p\.correlation_id,p\.id::text\)/);
  assert.match(migration, /where parent_job_id=p_parent_job_id/);
  assert.match(migration, /video_agent_check_access\(p_access\)/);
});
