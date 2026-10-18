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
