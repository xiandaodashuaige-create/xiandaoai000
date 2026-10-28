import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import {
  completeFontDirectory,
  createFontLoader,
} from '../api/_font-cache.mjs';

const font = () => {
  const bytes = Buffer.alloc(32);
  bytes.writeUInt32BE(0x10000);
  bytes.writeUInt16BE(1, 4);
  bytes.write('test', 12);
  bytes.writeUInt32BE(28, 20);
  bytes.writeUInt32BE(4, 24);
  return bytes; // SYNTHETIC SFNT directory, never used as a render font.
};
const response = (bytes) => ({ ok: true, arrayBuffer: async () => bytes });
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => (resolve = done));
  return { promise, resolve };
};
async function fixture(run) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'lulian-font-cache-test-'));
  try {
    return await run(path.join(dir, 'cache', 'NotoSansSC.ttf'), dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('rejects truncated SFNT directories, table bounds and non-font HTTP bytes', () => {
  const valid = font();
  assert.equal(completeFontDirectory(valid), true);
  assert.equal(completeFontDirectory(valid.subarray(0, 16)), false);
  assert.equal(
    completeFontDirectory(Buffer.from('<html>not a font</html>')),
    false,
  );
  for (const [at, value] of [
    [20, 64],
    [24, 64],
  ]) {
    const broken = Buffer.from(valid);
    broken.writeUInt32BE(value, at);
    assert.equal(completeFontDirectory(broken), false);
  }
  const zeroTables = Buffer.from(valid);
  zeroTables.writeUInt16BE(0, 4);
  assert.equal(completeFontDirectory(zeroTables), false);
});

test('one shared promise downloads once for simultaneous cold callers and then reuses disk', () =>
  fixture(async (file) => {
    let calls = 0;
    const gate = deferred();
    const loader = createFontLoader({
      fontPath: file,
      fetcher: async () => {
        calls++;
        await gate.promise;
        return response(font());
      },
    });
    const requests = Array.from({ length: 32 }, () => loader());
    assert.ok(requests.every((request) => request === requests[0]));
    gate.resolve();
    assert.ok((await Promise.all(requests)).every((value) => value === file));
    assert.equal(calls, 1);
    assert.deepEqual(await readFile(file), font());
    const restarted = createFontLoader({
      fontPath: file,
      fetcher: () => assert.fail('warm cache must not download'),
    });
    assert.equal(await restarted(), file);
    assert.equal(await loader(), file);
    assert.equal(calls, 1);
  }));

test('readers never receive the public path while a temporary font is half written', () =>
  fixture(async (file, dir) => {
    const started = deferred(),
      release = deferred();
    let temp;
    const loader = createFontLoader({
      fontPath: file,
      fetcher: async () => response(font()),
      write: async (target, bytes, options) => {
        temp = target;
        await writeFile(target, bytes.subarray(0, 16), options);
        started.resolve();
        await release.promise;
        await writeFile(target, bytes);
      },
    });
    const first = loader();
    await started.promise;
    try {
      assert.notEqual(temp, file);
      assert.equal((await readFile(temp)).length, 16);
      await assert.rejects(readFile(file), { code: 'ENOENT' });
      const next = loader();
      assert.equal(next, first);
    } finally {
      release.resolve();
    }
    await first;
    assert.deepEqual(await readFile(file), font());
    assert.deepEqual(await readdir(path.join(dir, 'cache')), [
      'NotoSansSC.ttf',
    ]);
  }));

for (const corrupt of [Buffer.from('not a font'), font().subarray(0, 16)]) {
  test(
    'repairs an existing invalid cache instead of trusting file presence (' +
      corrupt.length +
      ' bytes)',
    () =>
      fixture(async (file) => {
        await mkdir(path.dirname(file));
        await writeFile(file, corrupt);
        let calls = 0;
        const loader = createFontLoader({
          fontPath: file,
          fetcher: async () => {
            calls++;
            return response(font());
          },
        });
        assert.equal(await loader(), file);
        assert.equal(calls, 1);
        assert.deepEqual(await readFile(file), font());
      }),
  );
}

test('HTTP failures are shared and a later call can retry without a cached rejection', () =>
  fixture(async (file) => {
    let calls = 0,
      fail = true;
    const loader = createFontLoader({
      fontPath: file,
      fetcher: async () => {
        calls++;
        return fail ? { ok: false, status: 503 } : response(font());
      },
    });
    const results = await Promise.allSettled(
      Array.from({ length: 20 }, () => loader()),
    );
    assert.ok(
      results.every(
        (item) =>
          item.status === 'rejected' &&
          item.reason.message === 'font_download_503',
      ),
    );
    assert.equal(calls, 1);
    await assert.rejects(readFile(file), { code: 'ENOENT' });
    fail = false;
    assert.equal(await loader(), file);
    assert.equal(calls, 2);
  }));

test('invalid successful HTTP content is never published and remains retryable', () =>
  fixture(async (file) => {
    let bad = true;
    const loader = createFontLoader({
      fontPath: file,
      fetcher: async () =>
        response(bad ? Buffer.from('<html>upstream error</html>') : font()),
    });
    await assert.rejects(loader(), /font_download_invalid/);
    await assert.rejects(readFile(file), { code: 'ENOENT' });
    bad = false;
    await loader();
    assert.deepEqual(await readFile(file), font());
  }));

test('interrupted writes clean up only their own temporary file and permit recovery', () =>
  fixture(async (file) => {
    let fail = true;
    const loader = createFontLoader({
      fontPath: file,
      fetcher: async () => response(font()),
      write: async (target, bytes, options) => {
        if (!fail) return writeFile(target, bytes, options);
        await writeFile(target, bytes.subarray(0, 16), options);
        throw new Error('TEST_ONLY_interrupted_write');
      },
    });
    await assert.rejects(loader(), /TEST_ONLY_interrupted_write/);
    assert.deepEqual(await readdir(path.dirname(file)), []);
    fail = false;
    await loader();
    assert.deepEqual(await readFile(file), font());
  }));

test('independent loaders publish only complete files when they race on one cache', () =>
  fixture(async (file) => {
    const one = deferred(),
      two = deferred(),
      release = deferred();
    const make = (started) =>
      createFontLoader({
        fontPath: file,
        fetcher: async () => {
          started.resolve();
          await release.promise;
          return response(font());
        },
      });
    const a = make(one)(),
      b = make(two)();
    await Promise.all([one.promise, two.promise]);
    release.resolve();
    assert.deepEqual(await Promise.all([a, b]), [file, file]);
    assert.deepEqual(await readFile(file), font());
    assert.deepEqual(await readdir(path.dirname(file)), ['NotoSansSC.ttf']);
  }));

test(
  'real cold poster and video overlays share one download and render real raster bytes',
  { timeout: 60_000 },
  async () => {
    let source;
    for (const file of [
      process.env.POSTER_TEST_FONT,
      'C:/tmp/NotoSansSC.ttf',
      'D:/tmp/NotoSansSC.ttf',
      'C:/Windows/Fonts/arial.ttf',
      '/tmp/NotoSansSC.ttf',
      '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
    ].filter(Boolean)) {
      try {
        if (completeFontDirectory(await readFile(file))) {
          source = file;
          break;
        }
      } catch {}
    }
    assert.ok(source, 'a real local test font is required');
    await fixture(async (_file, dir) => {
      const worker = new URL('../api/video-worker.mjs', import.meta.url).href;
      const cloud = new URL('../api/_cloud-video.mjs', import.meta.url).href;
      const packageUrl = new URL('../package.json', import.meta.url).href;
      const script = [
        "import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import {createRequire} from 'node:module';",
        'const require=createRequire(' +
          JSON.stringify(packageUrl) +
          ');const sharp=require("sharp");',
        'const {renderPoster}=await import(' +
          JSON.stringify(worker) +
          ');const {overlayPng}=await import(' +
          JSON.stringify(cloud) +
          ');',
        'const font=await readFile(' +
          JSON.stringify(source) +
          ');let downloads=0;',
        'globalThis.fetch=async url=>{assert.match(String(url),/^https:\\/\\/raw\\.githubusercontent\\.com\\/google\\/fonts\\//);downloads++;return new Response(font)};',
        'const photo=await sharp({create:{width:1080,height:1350,channels:3,background:"#678589"}}).png().toBuffer();',
        'const brief=' +
          JSON.stringify(
            '主标题：Cold cache test\n品牌：TEST ONLY\n核心卖点与准确事实：S$98 | 60 minutes\n行动引导：WhatsApp\n尺寸：1080x1350',
          ) +
          ';',
        'const overlay=path.join(os.tmpdir(),"test-overlay.png");',
        'const [one,two]=await Promise.all([renderPoster({brief},photo),renderPoster({brief},photo),overlayPng({template:"big_text_hook",title:"Cold font",subtitle:"TEST ONLY"},overlay)]);',
        'assert.equal(downloads,1);assert.equal((await sharp(one).metadata()).width,1080);assert.equal((await sharp(two).metadata()).height,1350);assert.equal((await sharp(overlay).metadata()).height,1920);',
        'assert.deepEqual(await readFile(path.join(os.tmpdir(),"NotoSansSC.ttf")),font);console.log(JSON.stringify({testOnly:true,downloads,posterWidth:1080,posterHeight:1350,overlayHeight:1920,paidCalls:0}));',
      ].join('\n');
      const env = { TEMP: dir, TMP: dir, TMPDIR: dir };
      for (const key of [
        'PATH',
        'Path',
        'SystemRoot',
        'SYSTEMROOT',
        'WINDIR',
        'LOCALAPPDATA',
        'APPDATA',
      ])
        if (process.env[key]) env[key] = process.env[key];
      const result = await promisify(execFile)(
        process.execPath,
        ['--input-type=module', '-e', script],
        { env, timeout: 45_000, maxBuffer: 1024 * 1024 },
      );
      assert.deepEqual(JSON.parse(result.stdout.trim().split('\n').at(-1)), {
        testOnly: true,
        downloads: 1,
        posterWidth: 1080,
        posterHeight: 1350,
        overlayHeight: 1920,
        paidCalls: 0,
      });
    });
  },
);
