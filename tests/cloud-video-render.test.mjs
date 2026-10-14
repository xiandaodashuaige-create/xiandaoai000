import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import ffmpegPath from 'ffmpeg-static';
import sharp from 'sharp';
import { readFileSync } from 'node:fs';
import { overlayPng, normalizeLoudness, sceneStarts, renderVoiceTrack } from '../api/_cloud-video.mjs';
import { fitSecondsToVoice } from '../api/_cloud-tts.mjs';
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

test('final audio is normalised to the -16 LUFS local target', async () => {
  const input = path.join(dir(), 'quiet.mp4');
  execFileSync(ffmpegPath, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=360x640:rate=25:duration=6',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=6', '-af', 'volume=0.05', '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-shortest', input]);
  const output = path.join(dir(), 'normalised.mp4');
  await normalizeLoudness(input, output);
  const measure = spawnSync(ffmpegPath, ['-hide_banner', '-nostats', '-i', output, '-af', 'ebur128', '-f', 'null', '-'], { encoding: 'utf8' });
  const integrated = Number(measure.stderr.split('Summary:')[1].match(/I:\s+(-?[\d.]+)\s+LUFS/)[1]);
  assert.ok(Math.abs(integrated - -16) <= 1, `integrated ${integrated}`);
});

test('scene start points match the local worker on the same 39s clip', () => {
  const scenes = industryStoryboard({ brief: '業務主題：想試下呢個療程' });
  const starts = sceneStarts(39.056, scenes).map((value) => Number(value.toFixed(2)));
  assert.deepEqual(starts, [1.17, 8.59, 16.4, 23.82, 30.46]);
});

test('scene length grows to fit its own voice and never drops below the template time', () => {
  assert.equal(fitSecondsToVoice(3, 2), 3);
  assert.equal(fitSecondsToVoice(6, 5.7), 6);
  assert.equal(fitSecondsToVoice(6, 6.8), 7.1);
  assert.equal(fitSecondsToVoice(5, 4.6), 5);
});

const tone = (seconds, file) => {
  execFileSync(ffmpegPath, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', `sine=frequency=300:duration=${seconds}`, '-b:a', '64k', file]);
  return readFileSync(file);
};

test('per-scene voice track keeps each scene at its own length', async () => {
  const work = dir();
  const clips = { a: tone(4.5, path.join(work, 'a.mp3')), b: tone(2, path.join(work, 'b.mp3')) };
  const scenes = [{ vo: 'a', seconds: 3 }, { vo: 'b', seconds: 5 }];
  const result = await renderVoiceTrack({ job: { brief: '業務主題：美甲' }, scenes, workdir: work, synthesize: async ({ text }) => clips[text] });
  assert.equal(result.ok, true);
  assert.ok(Math.abs(scenes[0].seconds - 4.8) <= 0.2, `scene1 ${scenes[0].seconds}`); // mp3 padding adds a little
  assert.equal(scenes[1].seconds, 5);
  const length = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', result.path], { encoding: 'utf8' }));
  assert.ok(Math.abs(length - 9.8) < 0.1, `track ${length}s`);
});

test('one failed scene voice means no voice at all, never a partial narration', async () => {
  const work = dir();
  const clips = { a: tone(2, path.join(work, 'a2.mp3')) };
  const scenes = [{ vo: 'a', seconds: 3 }, { vo: 'b', seconds: 5 }];
  const result = await renderVoiceTrack({ job: {}, scenes, workdir: work, synthesize: async ({ text }) => { if (!clips[text]) throw new Error('tts_down'); return clips[text]; } });
  assert.equal(result.ok, false);
  assert.match(result.reason, /scene_2_tts_down/);
});
