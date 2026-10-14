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

test('result preview opens synchronously before the asynchronous storage download', () => {
  const block = source.slice(
    source.indexOf("root.querySelectorAll('.result-download')"),
    source.indexOf("root.querySelector('.revise-job')"),
  );
  assert.ok(block.indexOf("window.open('about:blank','_blank')") < block.indexOf('await sb.storage'));
  assert.match(block, /preview\.location\.href=u/);
  assert.match(block, /preview\?\.close\(\)/);
});

test('completed results expose a direct browser download action', () => {
  const block = source.slice(
    source.indexOf("root.querySelectorAll('.result-save')"),
    source.indexOf("root.querySelector('.revise-job')"),
  );
  assert.match(source, /下载成片 /);
  assert.match(source, /下载海报 /);
  assert.match(block, /link\.download=btn\.dataset\.path\.split\('\/'\)\.pop\(\)/);
  assert.match(block, /link\.click\(\)/);
  assert.match(block, /link\.remove\(\)/);
});

test('combined project locale still selects its matching AI voice', () => {
  assert.match(source, /const projectLanguage=String\(project\?\.default_language\|\|''\)/);
  assert.match(source, /projectLanguage\.startsWith\(optionLanguage\)/);
});
