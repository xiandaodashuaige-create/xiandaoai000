import assert from 'node:assert/strict';
import test from 'node:test';
import { copyFor, selectSceneSources } from '../api/_cloud-video.mjs';

const visual = (name, role) => ({ name, role, type: 'video/mp4' });

test('binds hook, customer proof and CTA to their semantic roles', () => {
  const selected = selectSceneSources([
    visual('customer-a.mp4', 'case_proof'),
    visual('customer-b.mp4', 'case_proof'),
    visual('generated-hook.mp4', 'ai_hook'),
    visual('generated-cta.mp4', 'ai_cta'),
    visual('face.jpg', 'character_reference'),
  ]);
  assert.deepEqual(selected.map((item) => item.name), [
    'generated-hook.mp4', 'customer-a.mp4', 'customer-b.mp4', 'customer-a.mp4', 'generated-cta.mp4',
  ]);
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
  assert.equal(scenes[0].vo, '每天回覆仍然漏客？');
  assert.equal(scenes.at(-1).vo, '立即預約診斷');
});

const structure = '\n【本次制作需求】\n1. AI生成开头 Hook：由系统根据业务和目标客户起草，前三秒必须有明确利益点。\n3. AI生成结尾 CTA：根据准确报名信息生成清晰行动引导，最后一秒仍保持声音与 CTA 画面。';

test('training uses its own verified topic, benefits, price and action, never treatment copy', () => {
  const job = { brief: '项目：AI入门实战课\n业务类型：线下培训\n业务说明：3小时线下实操\n目标客户：AI初学者\n准确价格/优惠/事实：价格：RM49\n课程内容：3小时线下实操\n✅ AI文案创作\n✅ AI商业海报\n✅ AI短视频作品\n行动引导：WhatsApp了解报名\n语言：马来西亚华语' + structure + '\n客户行动：点击WhatsApp了解报名\n语言声音：马来西亚华语' };
  const scenes = copyFor(job);
  const output = JSON.stringify(scenes);
  assert.match(output, /AI入门实战课/);
  assert.match(output, /RM49/);
  assert.match(scenes[2].vo, /AI文案创作、AI商业海报、AI短视频作品/);
  assert.match(scenes.at(-1).vo, /点击WhatsApp了解报名/);
  assert.equal(scenes.at(-1).button, 'WhatsApp 报名');
  assert.equal(scenes[1].positiveCards, true);
  assert.doesNotMatch(output, /療程|疗程|預約到店|由系统|根据准确|前三秒必须|最后一秒|鹿聯/);
});

test('a different unknown business uses its own project and offer without cross-project defaults', () => {
  const scenes = copyFor({ brief: '项目：暖宫护理体验\n业务类型：美容美体\n业务说明：仪器加手法\n价格：$198/30分钟\n目标客户：附近成人客户\n准确价格/优惠/事实：价格198/30分钟\n行动引导：WhatsApp预约体验\n语言：香港粤语' + structure + '\n客户行动：WhatsApp预约体验\n语言声音：香港粤语' });
  const output = JSON.stringify(scenes);
  assert.match(output, /暖宫护理体验/);
  assert.match(output, /\$198/);
  assert.match(scenes[0].vo, /先睇下/);
  assert.doesNotMatch(output, /RM49|AI入门|报名|由系统|根据准确/);
});

test('unknown topics without structured project fields keep the existing fallback', () => {
  const scenes = copyFor({ brief: 'Make a video from these materials.' });
  assert.equal(scenes.length, 5);
  assert.ok(scenes.every((scene) => scene.vo));
});
