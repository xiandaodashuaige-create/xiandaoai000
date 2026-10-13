#!/usr/bin/env node
// Measures a rendered MP4 so local and cloud outputs can be compared with
// numbers instead of impressions. Reports resolution, frame rate, bitrate,
// audio codec, EBU R128 loudness, true peak and silence. Exits 1 when any
// check fails so it can gate a comparison run.
//
// Usage: node scripts/video-quality-check.mjs <file.mp4> [--json]
//   [--size 720x1280] [--fps 25] [--min-kbps 800]
//   [--loudness-min -17] [--loudness-max -11] [--true-peak-max -1]
import { spawnSync } from 'node:child_process';
import ffmpegStatic from 'ffmpeg-static';

const args = process.argv.slice(2);
const file = args[0] && !args[0].startsWith('--') ? args[0] : null;
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback;
};
const expect = {
  size: opt('size', null),
  fps: Number(opt('fps', 25)),
  minKbps: Number(opt('min-kbps', 800)),
  loudnessMin: Number(opt('loudness-min', -17)),
  loudnessMax: Number(opt('loudness-max', -11)),
  truePeakMax: Number(opt('true-peak-max', -1)),
};

if (!file) {
  console.error('usage: video-quality-check.mjs <file.mp4> [--json] [--size WxH] [--fps N] [--min-kbps N]');
  process.exit(2);
}

function probe(target) {
  const r = spawnSync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', target], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`ffprobe_failed: ${r.stderr.slice(-300)}`);
  return JSON.parse(r.stdout);
}

function ffmpegFilterLog(target, filter) {
  const r = spawnSync(ffmpegStatic, ['-hide_banner', '-nostats', '-i', target, '-af', filter, '-f', 'null', '-'], { encoding: 'utf8' });
  return `${r.stdout}\n${r.stderr}`;
}

function parseFrameRate(value) {
  const [n, d] = String(value || '0/1').split('/').map(Number);
  return d ? n / d : n;
}

const info = probe(file);
const video = info.streams.find((s) => s.codec_type === 'video');
const audio = info.streams.find((s) => s.codec_type === 'audio');
const durationSeconds = Number(info.format?.duration || video?.duration || 0);
const bitrateKbps = Math.round(Number(info.format?.bit_rate || 0) / 1000);
const fps = parseFrameRate(video?.avg_frame_rate || video?.r_frame_rate);

const loudnessLog = ffmpegFilterLog(file, 'ebur128=peak=true');
const summary = loudnessLog.split('Summary:')[1] || '';
const integrated = Number(summary.match(/I:\s+(-?[\d.]+)\s+LUFS/)?.[1]);
const truePeak = Number(summary.match(/Peak:\s+(-?[\d.]+)\s+dBFS/)?.[1]);
const silenceLog = ffmpegFilterLog(file, 'silencedetect=noise=-50dB:d=1');
const silentRuns = (silenceLog.match(/silence_start/g) || []).length;

const measured = {
  file,
  durationSeconds: Number(durationSeconds.toFixed(2)),
  video: video ? { codec: video.codec_name, width: video.width, height: video.height, fps: Number(fps.toFixed(3)) } : null,
  audio: audio ? { codec: audio.codec_name, sampleRate: Number(audio.sample_rate), channels: audio.channels } : null,
  bitrateKbps,
  loudnessLUFS: Number.isFinite(integrated) ? integrated : null,
  truePeakDBTP: Number.isFinite(truePeak) ? truePeak : null,
  silentRuns,
};

const checks = [
  { name: 'video stream present', pass: Boolean(video) },
  { name: 'audio stream present', pass: Boolean(audio) },
  { name: `size ${expect.size || 'any'}`, pass: !expect.size || Boolean(video && `${video.width}x${video.height}` === expect.size) },
  { name: `fps ${expect.fps}`, pass: Boolean(video) && Math.abs(fps - expect.fps) < 0.5 },
  { name: `bitrate >= ${expect.minKbps} kbps`, pass: bitrateKbps >= expect.minKbps },
  { name: `loudness ${expect.loudnessMin}..${expect.loudnessMax} LUFS`, pass: measured.loudnessLUFS !== null && measured.loudnessLUFS >= expect.loudnessMin && measured.loudnessLUFS <= expect.loudnessMax },
  { name: `true peak <= ${expect.truePeakMax} dBTP`, pass: measured.truePeakDBTP !== null && measured.truePeakDBTP <= expect.truePeakMax },
];

const failed = checks.filter((c) => !c.pass);
const result = {
  measured,
  checks: checks.map((c) => ({ name: c.name, result: c.pass ? 'PASS' : 'FAIL' })),
  verdict: failed.length ? 'FAIL' : 'PASS',
};

if (args.includes('--json')) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log(JSON.stringify(measured, null, 2));
  for (const check of result.checks) console.log(`${check.result}  ${check.name}`);
  console.log(`VERDICT ${result.verdict}`);
}
process.exit(failed.length ? 1 : 0);
