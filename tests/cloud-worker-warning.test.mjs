import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('completed render exposes a voice failure as an operator warning', async () => {
  const worker = await readFile(new URL('../api/video-worker.mjs', import.meta.url), 'utf8');
  assert.match(worker, /artifactMeta\.voice_error/);
  assert.match(worker, /旁白生成失败，请检查后再投放/);
});
