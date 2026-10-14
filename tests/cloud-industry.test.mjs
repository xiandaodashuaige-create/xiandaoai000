import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  inferIntent, industryStoryboard, englishStoryboard, voiceRulesFor, intentCopy, INTENT_COPY,
} from '../api/_cloud-industry.mjs';
import { narrationFor, voiceFor } from '../api/_cloud-tts.mjs';

const brief = (text) => ({ brief: text });

test('intent detection matches the local worker rules for each industry', () => {
  assert.equal(inferIntent(brief('業務主題：肩頸按摩')), 'massage');
  assert.equal(inferIntent(brief('業務主題：SMP 紋髮')), 'smp');
  assert.equal(inferIntent(brief('業務主題：美甲')), 'nail');
  assert.equal(inferIntent(brief('業務主題：植睫美睫')), 'lash');
  assert.equal(inferIntent(brief('業務主題：皮膚管理')), 'facial');
  assert.equal(inferIntent(brief('業務主題：染髮剪髮')), 'hair');
  assert.equal(inferIntent(brief('業務主題：AI廣告代投')), 'ad_service');
  assert.equal(inferIntent(brief('業務主題：咖啡店')), 'generic_service');
});

test('revision prompt can also carry the industry signal, as in the local worker', () => {
  assert.equal(inferIntent({ brief: '', revision_prompt: '改成美甲' }), 'nail');
});

test('negative constraints never override the explicit business intent', () => {
  assert.equal(inferIntent(brief('业务主题：香港美容院同区新客获取合作\n禁止出现：按摩、推拿、SPA')), 'ad_service');
  assert.equal(inferIntent(brief('业务类型：香港美业AI获客服务\nmust_exclude: massage, spa')), 'ad_service');
  assert.equal(inferIntent(brief('业务主题：肩颈按摩\n禁止出现：广告代投')), 'massage');
});

test('local worker carries the same negative-constraint guard', () => {
  const source = readFileSync(new URL('../worker/video_agent_worker.mjs', import.meta.url), 'utf8');
  assert.match(source, /function positiveIntentText/);
  assert.match(source, /must\[_ -\]\?exclude/);
  assert.ok(source.indexOf("type:'ad_service'") < source.indexOf("type:'massage'"));
});

test('every industry has the copy the local worker uses', () => {
  for (const type of Object.keys(INTENT_COPY)) {
    const copy = intentCopy(type, 1);
    assert.ok(copy.hook[0].length > 0 && copy.hook[1].length > 0, `${type} hook`);
    assert.equal(copy.cards.length, 3, `${type} cards`);
    assert.ok(copy.ctaText.includes('\n') || type === 'ad_service', `${type} cta`);
    assert.ok(copy.msgs.length === 2, `${type} msgs`);
  }
});

test('storyboard has five beats with the local worker timings', () => {
  const scenes = industryStoryboard(brief('業務主題：肩頸按摩'));
  assert.equal(scenes.length, 5);
  assert.deepEqual(scenes.map((scene) => scene.seconds), [3, 5, 6, 6, 5]);
  assert.ok(scenes.every((scene) => scene.vo));
  assert.deepEqual(scenes.map((scene) => scene.template), ['big_text_hook', 'pain_cards', 'big_text_hook', 'whatsapp_chat', 'cta_offer']);
  assert.equal(scenes[1].cards.length, 3);
  assert.equal(scenes[3].messages.length, 2);
  assert.equal(scenes[4].button, 'WhatsApp 預約');
});

test('pace revision shortens the storyboard as the local worker does', () => {
  const scenes = industryStoryboard({ brief: '業務主題：美甲', revision_prompt: '節奏快一點', revision_scope: 'pace' });
  assert.deepEqual(scenes.map((scene) => scene.seconds), [2.6, 4, 4.8, 4.5, 4]);
});

test('ad service uses the advertising beat sequence', () => {
  const scenes = industryStoryboard(brief('業務主題：AI廣告代投'));
  assert.equal(scenes[4].button, 'WhatsApp 了解');
  assert.equal(scenes[2].kicker, '廣告投放');
  assert.match(scenes[2].vo, /鹿聯AI廣告員工/);
});

test('subtitle reduction hides overlay subtitles on every beat', () => {
  const scenes = industryStoryboard({ brief: '業務主題：美甲', revision_prompt: '字幕太多，減少字幕', revision_scope: 'subtitle' });
  assert.ok(scenes.every((scene) => scene.showSubtitle === false));
});

test('narration uses the spoken line of each beat', () => {
  const text = narrationFor(industryStoryboard(brief('業務主題：美甲')));
  assert.ok(text.includes(intentCopy('nail', 1).ctaVo));
  assert.doesNotMatch(text, /[<>&"'`]/);
});

test('english brief gets the English storyboard and English voice', () => {
  const job = { brief: '语言：English\n业务类型：Nail studio' };
  const scenes = englishStoryboard(job);
  assert.equal(scenes.length, 5);
  assert.equal(voiceFor(job).voice, 'en-US-JennyNeural');
  assert.equal(voiceFor(job).rate, '+8%');
});

test('Cantonese voice: default HiuMaan, female on voice change, male when asked', () => {
  assert.equal(voiceRulesFor({ brief: '業務主題：美甲' }).voice, 'zh-HK-HiuMaanNeural');
  assert.equal(voiceRulesFor({ brief: 'x', revision_prompt: '換個聲音', revision_scope: 'voice' }).voice, 'zh-HK-HiuGaaiNeural');
  assert.equal(voiceRulesFor({ brief: 'x', revision_prompt: '改成男聲', revision_scope: 'voice' }).voice, 'zh-HK-WanLungNeural');
  assert.equal(voiceRulesFor({ brief: 'x', revision_prompt: '改成男声' }).voice, 'zh-HK-WanLungNeural');
  assert.equal(voiceFor({ revision_prompt: '改成男聲', revision_scope: 'voice' }).voice, 'zh-HK-WanLungNeural');
});

test('industry module carries no secrets, keys or Windows paths', () => {
  const source = readFileSync(new URL('../api/_cloud-industry.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /sb_publishable|supabase\.co|D:\\\\|VIDEO_AGENT_ACCESS/);
});
