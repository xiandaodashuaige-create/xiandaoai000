import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../video/index.html', import.meta.url), 'utf8');

test('failed jobs expose a reuse-without-upload retry action', () => {
  assert.match(source, /job\.status==='failed'/);
  assert.doesNotMatch(source, /if\(job\.input_files\?\.length\)/);
  assert.match(source, /复用原素材重新生成/);
  assert.match(source, /api\('retry_failed_job',\{job_id:job\.id\}\)/);
});
