import assert from 'node:assert/strict';
import test from 'node:test';
import { copyFor, renderWorkdirFor, sceneStarts, selectSceneSources, sparseStoryboardForSingleSource } from '../api/_cloud-video.mjs';

const visual = (name, role, extra = {}) => ({ name, role, type: 'video/mp4', ...extra });

test('binds hook, customer proof and CTA to their semantic roles', () => {
  const selected = selectSceneSources([
    visual('customer-a.mp4', 'case_proof'),
    visual('customer-b.mp4', 'case_proof'),
    visual('generated-hook.mp4', 'ai_hook', { semantic_approved: true }),
    visual('generated-cta.mp4', 'ai_cta', { semantic_approved: true }),
    visual('face.jpg', 'character_reference'),
  ]);
  assert.deepEqual(selected.map((item) => item.name), [
    'generated-hook.mp4', 'customer-a.mp4', 'customer-b.mp4', 'customer-a.mp4', 'generated-cta.mp4',
  ]);
});

test('rejects unapproved AI hook and CTA footage from another business', () => {
  const selected = selectSceneSources([
    visual('customer.mp4', 'main'),
    visual('wrong-business-hook.mp4', 'ai_hook'),
    visual('wrong-business-cta.mp4', 'ai_cta'),
  ]);
  assert.ok(selected.every((item) => item.name === 'customer.mp4'));
});

test('render workdir cannot overlap the worker input directory', () => {
  assert.equal(renderWorkdirFor('job-1'), '/tmp/video-render-job-1');
  assert.notEqual(renderWorkdirFor('job-1'), '/tmp/video-job-1');
});

test('scene starts stay inside an operator trim window', () => {
  const scenes = Array.from({ length: 5 }, () => ({ seconds: 3 }));
  const starts = sceneStarts(50, scenes, { trim_start: 10, trim_end: 25 });
  assert.ok(starts.every((value) => value >= 10 && value <= 21.8));
  assert.ok(starts[4] > starts[0]);
});

test('never treats a character reference as a timeline shot', () => {
  const selected = selectSceneSources([
    visual('customer.mp4', 'case_proof'),
    visual('face.jpg', 'character_reference'),
  ]);
  assert.equal(selected.some((item) => item.name === 'face.jpg'), false);
  assert.ok(selected.every((item) => item.name === 'customer.mp4'));
});

test('same-line hook and CTA markers do not leak into each other', () => {
  const scenes = copyFor({ brief: '業務主題：美容院 1. AI生成开头 Hook：每天回覆仍然漏客？ 3. AI生成结尾 CTA：立即預約診斷' });
  assert.equal(scenes[0].title, '每天回覆仍然漏客？');
  assert.equal(scenes.at(-1).title, '立即預約診斷');
});

test('one visual source gets a short sparse layout instead of five competing UI templates', () => {
  const scenes = copyFor({ brief: '業務主題：肩頸按摩' });
  const one = visual('massage.mp4', 'main', { localPath: '/tmp/massage.mp4' });
  const result = sparseStoryboardForSingleSource(scenes, [one, one, one, one, one]);
  assert.equal(result.applied, true);
  assert.equal(result.warning, 'single_visual_source_limited_diversity');
  assert.equal(result.scenes.length, 3);
  assert.ok(Math.abs(result.scenes.reduce((sum, scene) => sum + scene.seconds, 0) - 13) < 0.01);
  assert.ok(result.scenes.slice(0, -1).every((scene) => scene.template === 'clean_caption'));
  assert.equal(result.scenes.at(-1).template, 'clean_cta');
  assert.ok(result.scenes.every((scene) => scene.showSubtitle === false));
  assert.equal(result.scenes[0].title.includes('先看'), false);

  const many = sparseStoryboardForSingleSource(scenes, [
    { ...one, localPath: '/tmp/a.mp4' }, { ...one, localPath: '/tmp/b.mp4' },
  ]);
  assert.equal(many.applied, false);
});
