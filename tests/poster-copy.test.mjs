import test from 'node:test';
import assert from 'node:assert/strict';
import { accentFromDominant, buildPosterPrompt, parsePosterFacts, styleHint } from '../api/_poster-copy.mjs';

test('splits price, qualifier and selling lines without inventing text', () => {
  const parsed = parsePosterFacts('RM98 首次体验 · 60 分钟｜预约送护手霜');
  assert.equal(parsed.price, 'RM98');
  assert.equal(parsed.qualifier, '首次体验');
  assert.deepEqual(parsed.lines, ['60 分钟', '预约送护手霜']);
});

test('empty facts render nothing', () => {
  assert.deepEqual(parsePosterFacts(''), { price: '', qualifier: '', lines: [] });
  assert.deepEqual(parsePosterFacts(undefined), { price: '', qualifier: '', lines: [] });
});

test('facts without a price keep every line, capped at three', () => {
  const parsed = parsePosterFacts('预约送护手霜｜第二件半价｜免费补色｜加送卸甲');
  assert.equal(parsed.price, '');
  assert.equal(parsed.lines.length, 3);
});

test('recognises HK$ and Chinese currency units', () => {
  assert.equal(parsePosterFacts('HK$198 新客体验').price, 'HK$198');
  assert.equal(parsePosterFacts('体验价 99 令吉').price, '99 令吉');
});

test('prompt uses the customer words, asks for a service moment and no lettering', () => {
  const prompt = buildPosterPrompt({ purpose: '七夕海报，吉隆坡美甲店', style: '节庆气氛', title: '七夕限定 美甲 8 折', brand: 'Rose Nails', facts: '预约送护手霜' });
  assert.match(prompt, /吉隆坡美甲店/);
  assert.match(prompt, /Rose Nails/);
  assert.match(prompt, /festive/);
  assert.match(prompt, /real, believable moment/);
  assert.match(prompt, /no words, letters, numbers/i);
});

test('style hint falls back to a neutral description', () => {
  assert.equal(styleHint(''), 'polished and professional');
  assert.match(styleHint('高端大气'), /luxurious/);
});

test('accent is lifted and has a readable text colour', () => {
  const dark = accentFromDominant({ r: 40, g: 20, b: 30 });
  assert.match(dark.accent, /^#[0-9a-f]{6}$/);
  assert.ok(['#1a1410', '#ffffff'].includes(dark.onAccent));
});

import { parsePosterRevision } from '../api/_poster-copy.mjs';

test('revision: bigger title, colour change and passthrough text', () => {
  const brief = '主标题：七夕\n\n【基于上一版继续优化】\n标题再大一点，按钮换成粉色';
  const parsed = parsePosterRevision(brief);
  assert.equal(parsed.titleScale, 1.3);
  assert.equal(parsed.accent, '#e87aa0');
  assert.match(parsed.text, /标题再大一点/);
});

test('revision: no marker means no change', () => {
  const parsed = parsePosterRevision('主标题：七夕');
  assert.deepEqual(parsed, { text: '', background: '', titleScale: 1, priceScale: 1, accent: null });
});

test('revision text reaches the background prompt', () => {
  assert.match(buildPosterPrompt({ purpose: '美甲店', revision: '背景换成粉色' }), /背景换成粉色/);
});

import { META_POSTER_SIZES, posterPlacement, posterSafeZone } from '../api/_poster-copy.mjs';

test('poster size is always one of the Meta placements', () => {
  assert.equal(posterPlacement('尺寸：1080x1350（信息流）').key, 'feed');
  assert.equal(posterPlacement('尺寸：1080x1080').key, 'square');
  assert.equal(posterPlacement('尺寸：1080x1920').key, 'story');
  assert.equal(posterPlacement('尺寸：999x999').key, 'feed');
  assert.equal(posterPlacement('主标题：七夕').key, 'feed');
  for (const size of Object.values(META_POSTER_SIZES)) {
    const [w, h] = size.generate.split('x').map(Number);
    assert.equal(w % 16, 0);
    assert.equal(h % 16, 0);
    assert.ok(Math.abs(w / h - size.width / size.height) < 0.01);
  }
});

test('stories keep the top 14% and bottom 20% free', () => {
  assert.deepEqual(posterSafeZone(1920, 'story'), { top: 269, bottom: 384 });
  assert.ok(posterSafeZone(1350, 'feed').top < 100);
});

test('story prompt asks the model to keep the UI zones clear', () => {
  assert.match(buildPosterPrompt({ purpose: 'x', placement: 'story' }), /top 14 percent/);
});

test('image prompt never carries prices or digits, and layout-only revisions stay out of it', () => {
  const prompt = buildPosterPrompt({ purpose: '做一张海报，体验价 RM88', title: '七夕限定 美甲 8 折', brand: 'Rose Nails', facts: 'RM88 首次体验 · 60 分钟', style: '简洁' });
  assert.ok(!/\d/.test(prompt.replace(/\b(?:9:16|1:1)\b|\d+ percent/g, '')), prompt);
  assert.ok(!prompt.includes('RM'));
  const layoutOnly = parsePosterRevision('x\n\n【基于上一版继续优化】\n价格再大一点，按钮改成金色');
  assert.equal(layoutOnly.background, '');
  assert.equal(layoutOnly.priceScale, 1.25);
  const mixed = parsePosterRevision('x\n\n【基于上一版继续优化】\n标题大一点，背景换成粉色花瓣');
  assert.equal(mixed.background, '背景换成粉色花瓣');
});
