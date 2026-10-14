import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import ffmpegPath from 'ffmpeg-static';
import { industryStoryboard } from '../api/_cloud-industry.mjs';
import { overlayPng, normalizeSegment, normalizeLoudness, inspectRender } from '../api/_cloud-video.mjs';

// Offline render-spec regression: fixed synthetic fixture, no Edge TTS / network.
// Asserts the final cloud output spec: 1080x1920, 30 fps (matches local worker), -14 LUFS target.
const dir = () => mkdtempSync(path.join(tmpdir(), 'render-spec-'));

const probe = (file) => JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_streams', file], { encoding: 'utf8' }));

test('final segment is 1080x1920 at 30 fps and loudness-normalised to -14 LUFS', async () => {
  const work = dir();
  const source = path.join(work, 'source.mp4');
  execFileSync(ffmpegPath, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=720x1280:rate=30:duration=4',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4', '-af', 'volume=0.05', '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-shortest', source]);
  const scene = industryStoryboard({ brief: '業務主題：肩頸按摩' })[0];
  const overlay = path.join(work, 'overlay.png');
  await overlayPng(scene, overlay);
  const segment = path.join(work, 'segment.mp4');
  await normalizeSegment({ source, type: 'video/mp4', overlay, output: segment, seconds: 2 });
  const normalised = path.join(work, 'final.mp4');
  await normalizeLoudness(segment, normalised);

  const video = probe(normalised).streams.find((s) => s.codec_type === 'video');
  assert.equal(video.width, 1080, 'width');
  assert.equal(video.height, 1920, 'height');
  assert.equal(video.avg_frame_rate, '30/1', 'fps');

  const measure = spawnSync(ffmpegPath, ['-hide_banner', '-nostats', '-i', normalised, '-af', 'ebur128', '-f', 'null', '-'], { encoding: 'utf8' });
  const integrated = Number(measure.stderr.split('Summary:')[1].match(/I:\s+(-?[\d.]+)\s+LUFS/)[1]);
  assert.ok(Math.abs(integrated - -14) <= 1, `integrated ${integrated}`);
  const quality = await inspectRender(normalised, 2);
  assert.equal(quality.width, 1080);
  assert.equal(quality.height, 1920);
  assert.ok(quality.bitrateKbps >= 800, `bitrate ${quality.bitrateKbps}`);
});

test('reused long video starts later scenes at a different source time', async () => {
  const work = dir();
  const source = path.join(work, 'changing-source.mp4');
  execFileSync(ffmpegPath, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=720x1280:rate=25:duration=8',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', source]);
  const overlay = path.join(work, 'overlay.png');
  await overlayPng(industryStoryboard({ brief: '業務主題：肩頸按摩' })[0], overlay);
  const early = path.join(work, 'early.mp4');
  const late = path.join(work, 'late.mp4');
  await normalizeSegment({ source, type: 'video/mp4', overlay, output: early, seconds: 1, start: 0 });
  await normalizeSegment({ source, type: 'video/mp4', overlay, output: late, seconds: 1, start: 5 });
  const frameMd5 = (file) => execFileSync(ffmpegPath, ['-v', 'error', '-i', file, '-frames:v', '1', '-f', 'md5', '-'], { encoding: 'utf8' }).trim();
  assert.notEqual(frameMd5(early), frameMd5(late));
});
