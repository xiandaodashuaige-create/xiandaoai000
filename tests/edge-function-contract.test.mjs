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
