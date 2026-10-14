import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import ffmpegPath from 'ffmpeg-static';
import { planRemix, seedFromText, windowsForInput, REMIX_WINDOW_SECONDS } from '../api/_cloud-remix.mjs';
import { renderCloudVideo } from '../api/_cloud-video.mjs';

const dir = () => mkdtempSync(path.join(tmpdir(), 'remix-'));
const durations = new Map([['/clips/a.mp4', 39], ['/clips/b.mov', 15.3]]);
const inputs = [
  { role: 'main', type: 'video/mp4', localPath: '/clips/a.mp4', name: 'a.mp4' },
  { role: 'main', type: 'video/quicktime', localPath: '/clips/b.mov', name: 'b.mov' },
];

test('same job id gives the same order; different job id usually differs', () => {
  const first = planRemix({ inputs, durations, seedText: 'job-1', slotCount: 5 });
  const again = planRemix({ inputs, durations, seedText: 'job-1', slotCount: 5 });
  const other = planRemix({ inputs, durations, seedText: 'job-2', slotCount: 5 });
  const key = (plan) => plan.slots.map((s) => `${s.clip.name}@${s.clip.start}`).join('|');
  assert.equal(key(first), key(again));
  assert.notEqual(key(first), key(other));
  assert.equal(first.seed, seedFromText('job-1'));
});

test('every slot gets a window and no clip repeats while unused windows remain', () => {
  const plan = planRemix({ inputs, durations, seedText: 'job-3', slotCount: 5 });
  assert.equal(plan.ok, true);
  assert.equal(plan.slots.length, 5);
  assert.equal(plan.reusedSlots, 0);
  const keys = plan.slots.map((s) => `${s.clip.localPath}@${s.clip.start}`);
  assert.equal(new Set(keys).size, keys.length);
  for (const slot of plan.slots) assert.ok(slot.clip.start + Math.min(REMIX_WINDOW_SECONDS, slot.clip.duration) <= slot.clip.duration + 0.01);
});

test('a small pool is reused and says so, instead of hiding the repeat', () => {
  const small = [{ role: 'main', type: 'video/mp4', localPath: '/clips/short.mp4', name: 'short.mp4' }];
  const plan = planRemix({ inputs: small, durations: new Map([['/clips/short.mp4', 7]]), seedText: 'job-4', slotCount: 5 });
  assert.equal(plan.ok, true);
  assert.ok(plan.reusedSlots >= 4);
});

test('labelled hook and ending footage feed their own slots', () => {
  const labelled = [
    { role: 'hook', type: 'video/mp4', localPath: '/clips/hit.mp4', name: 'hit.mp4' },
    { role: 'middle', type: 'video/mp4', localPath: '/clips/mid.mp4', name: 'mid.mp4' },
    { role: 'ending', type: 'video/mp4', localPath: '/clips/end.mp4', name: 'end.mp4' },
  ];
  const d = new Map([['/clips/hit.mp4', 12], ['/clips/mid.mp4', 30], ['/clips/end.mp4', 12]]);
  const plan = planRemix({ inputs: labelled, durations: d, seedText: 'job-5', slotCount: 5 });
  assert.equal(plan.slots[0].clip.name, 'hit.mp4');
  assert.equal(plan.slots[4].clip.name, 'end.mp4');
  for (const slot of plan.slots.slice(1, 4)) assert.equal(slot.clip.name, 'mid.mp4');
});

test('no footage fails honestly instead of falling back to other material', () => {
  assert.deepEqual(planRemix({ inputs: [], durations: new Map(), seedText: 'x', slotCount: 5 }), { ok: false, reason: 'REMIX_NO_FOOTAGE' });
  const refsOnly = [{ role: 'reference', type: 'video/mp4', localPath: '/r.mp4' }];
  assert.equal(planRemix({ inputs: refsOnly, durations: new Map([['/r.mp4', 9]]), seedText: 'x', slotCount: 5 }).ok, false);
});

test('a clip shorter than one window keeps a single window at 0', () => {
  assert.deepEqual(windowsForInput({ type: 'video/mp4' }, 4), [{ start: 0, duration: 4 }]);
  assert.deepEqual(windowsForInput({ type: 'video/mp4' }, 0), []);
});

test('renderCloudVideo remix job renders every slot from its planned clip', async () => {
  const work = dir();
  const make = (name, seconds) => {
    const file = path.join(work, name);
    execFileSync(ffmpegPath, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', `testsrc2=size=720x1280:rate=30:duration=${seconds}`,
      '-f', 'lavfi', '-i', `sine=frequency=440:duration=${seconds}`, '-af', 'volume=0.05', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', file]);
    return file;
  };
  const a = make('a.mp4', 14);
  const b = make('b.mp4', 14);
  const job = { id: 'remix-job-test', brief: '業務主題：想試下呢個療程', workflow_mode: 'remix', version_number: 1 };
  const downloaded = [
    { role: 'main', type: 'video/mp4', localPath: a, name: 'a.mp4' },
    { role: 'main', type: 'video/mp4', localPath: b, name: 'b.mp4' },
  ];
  const out = await renderCloudVideo(job, downloaded, async () => {}, { synthesize: async () => { throw new Error('no_tts_in_test'); } });
  assert.equal(out.width, 1080);
  assert.equal(out.height, 1920);
  assert.equal(out.remix.order.length, 5);
  assert.equal(out.remix.order[0].role, 'hook');
  assert.equal(out.remix.order[4].role, 'ending');
  const outFile = path.join(work, 'out.mp4');
  writeFileSync(outFile, out.data);
  const probed = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', outFile], { encoding: 'utf8' }));
  assert.ok(Math.abs(Number(probed.format.duration) - out.durationSeconds) < 0.3, `duration ${probed.format.duration}`);
});

