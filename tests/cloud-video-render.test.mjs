import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import ffmpegPath from 'ffmpeg-static';
import sharp from 'sharp';
import { overlayPng, normalizeLoudness } from '../api/_cloud-video.mjs';
import { industryStoryboard } from '../api/_cloud-industry.mjs';

const dir = () => mkdtempSync(path.join(tmpdir(), 'render-test-'));

test('every storyboard template renders a 1080x1920 overlay', async () => {
  const scenes = industryStoryboard({ brief: '業務主題：肩頸按摩' });
  for (const [index, scene] of scenes.entries()) {
    const output = path.join(dir(), `overlay-${index}.png`);
    await overlayPng(scene, output);
    const meta = await sharp(output).metadata();
    assert.equal(meta.width, 1080, `${scene.template} width`);
    assert.equal(meta.height, 1920, `${scene.template} height`);
    assert.equal(meta.hasAlpha, true, `${scene.template} alpha`);
  }
});

test('final audio is normalised to the -14 LUFS social target', async () => {
  const input = path.join(dir(), 'quiet.mp4');
  execFileSync(ffmpegPath, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=360x640:rate=25:duration=6',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=6', '-af', 'volume=0.05', '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-shortest', input]);
  const output = path.join(dir(), 'normalised.mp4');
  await normalizeLoudness(input, output);
  const measure = spawnSync(ffmpegPath, ['-hide_banner', '-nostats', '-i', output, '-af', 'ebur128', '-f', 'null', '-'], { encoding: 'utf8' });
  const integrated = Number(measure.stderr.split('Summary:')[1].match(/I:\s+(-?[\d.]+)\s+LUFS/)[1]);
  assert.ok(Math.abs(integrated - -14) <= 1, `integrated ${integrated}`);
});
