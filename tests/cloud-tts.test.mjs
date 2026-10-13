import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  narrationFor, voiceFor, synthesizeVoiceover, resolveVoiceover,
} from '../api/_cloud-tts.mjs';

const dir = () => mkdtempSync(path.join(tmpdir(), 'tts-test-'));
const bigAudio = Buffer.alloc(4096, 1);
const SCENES = [
  { kicker: 'k', title: '先别划走', subtitle: '这一次，看真实过程' },
  { kicker: 'k', title: 'A <b>&</b> "B"', subtitle: '现场画面' },
];

test('narration joins scene copy and strips SSML-breaking characters', () => {
  const text = narrationFor(SCENES);
  assert.equal(text, '先别划走。这一次，看真实过程。A  b   /b   B。现场画面');
  assert.doesNotMatch(text, /[<>&"'`]/);
});

test('voice follows the job language, defaulting to Chinese HK like the local worker', () => {
  assert.equal(voiceFor({ language: 'en-US' }).voice, 'en-US-JennyNeural');
  assert.equal(voiceFor({ locale: 'en-SG' }).voice, 'en-US-JennyNeural');
  assert.equal(voiceFor({}).voice, 'zh-HK-HiuMaanNeural');
  assert.equal(voiceFor({}).rate, '+4%');
});

test('successful synthesis writes the audio file and reports the path', async () => {
  const outputPath = path.join(dir(), 'vo.mp3');
  const result = await synthesizeVoiceover({
    text: 'hi', voice: 'v', rate: '+0%', outputPath,
    synthesize: async () => bigAudio,
  });
  assert.equal(result.ok, true);
  assert.equal(readFileSync(outputPath).length, bigAudio.length);
});

test('empty or near-empty audio is a failure, never a silent success', async () => {
  const result = await synthesizeVoiceover({
    text: 'hi', voice: 'v', rate: '+0%', outputPath: path.join(dir(), 'x.mp3'),
    synthesize: async () => Buffer.alloc(10),
  });
  assert.deepEqual(result, { ok: false, reason: 'tts_empty_audio' });
});

test('a thrown error becomes a reason instead of crashing the render', async () => {
  const result = await synthesizeVoiceover({
    text: 'hi', voice: 'v', rate: '+0%', outputPath: path.join(dir(), 'x.mp3'),
    synthesize: async () => { throw new Error('network down'); },
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'network down');
});

test('a hung synthesis times out', async () => {
  const result = await synthesizeVoiceover({
    text: 'hi', voice: 'v', rate: '+0%', outputPath: path.join(dir(), 'x.mp3'),
    synthesize: () => new Promise(() => {}),
    timeoutMs: 20,
  });
  assert.deepEqual(result, { ok: false, reason: 'tts_timeout' });
});

test('an uploaded voiceover always wins and synthesis is never called', async () => {
  let called = false;
  const out = await resolveVoiceover({
    uploadedVoice: '/tmp/uploaded.mp3', job: {}, scenes: SCENES,
    outputPath: path.join(dir(), 'x.mp3'),
    synthesize: async () => { called = true; return bigAudio; },
  });
  assert.deepEqual(out, { voice: '/tmp/uploaded.mp3', voiceSource: 'uploaded', voiceError: null });
  assert.equal(called, false);
});

test('without an upload, synthesized voice is used and labelled as tts', async () => {
  const out = await resolveVoiceover({
    uploadedVoice: undefined, job: { language: 'en' }, scenes: SCENES,
    outputPath: path.join(dir(), 'x.mp3'),
    synthesize: async ({ voice }) => { assert.equal(voice, 'en-US-JennyNeural'); return bigAudio; },
  });
  assert.equal(out.voiceSource, 'tts');
  assert.equal(out.voiceError, null);
});

test('if synthesis fails, the render continues without voice and says so', async () => {
  const out = await resolveVoiceover({
    uploadedVoice: undefined, job: {}, scenes: SCENES,
    outputPath: path.join(dir(), 'x.mp3'),
    synthesize: async () => { throw new Error('edge_unreachable'); },
  });
  assert.deepEqual(out, { voice: null, voiceSource: 'none', voiceError: 'edge_unreachable' });
});
