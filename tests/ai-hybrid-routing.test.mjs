import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('AI Hybrid jobs and revisions route to cloud generation', async () => {
  const migration = await readFile(new URL('../supabase/migrations/20261014093000_ai_hybrid_cloud_fail_closed.sql', import.meta.url), 'utf8');
  assert.match(migration, /workflow_mode in \('image_poster','ai_hybrid'\).*then 'cloud'/s);
  assert.match(migration, /workflow_mode = 'ai_hybrid'[\s\S]*execution_target in \('auto','local'\)/);
  assert.match(migration, /p\.workflow_mode = 'ai_hybrid' then 'cloud'/);
});

test('cloud worker never falls back an AI Hybrid generation failure to local remix', async () => {
  const worker = await readFile(new URL('../api/video-worker.mjs', import.meta.url), 'utf8');
  const failClosed = worker.slice(worker.indexOf("if (job.workflow_mode === 'ai_hybrid')"), worker.indexOf("await rpc('video_agent_cloud_fallback'"));
  assert.match(failClosed, /p_status: 'failed'/);
  assert.match(failClosed, /p_output_files: \[\]/);
  assert.doesNotMatch(failClosed, /video_agent_cloud_fallback/);
});
