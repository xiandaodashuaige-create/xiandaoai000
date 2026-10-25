import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { posterGenerationPrompt } from '../api/_poster-current-brief.mjs';

const current = '【本次制作需求】\n产品/服务：面部護理美容院\n风格：香港繁體中文，米白與墨綠，簡約靜物\n主标题：面部護理・預約專屬時光\n品牌：香港地區驗收樣本\n不能出现：不要真人或手部，不要其他商戶名稱\n尺寸：1080x1350';

test('real HK failure: restrictions reach consumed prompt, no forced client or hands', () => {
  const prompt = posterGenerationPrompt({ brief: current });
  assert.match(prompt, /Mandatory current customer exclusions.*不要真人或手部/);
  assert.match(prompt, /香港繁體中文，米白與墨綠，簡約靜物/);
  assert.match(prompt, /CURRENT customer.*override generic/);
  assert.match(prompt, /with no people, faces, hands, arms or skin/);
  assert.doesNotMatch(prompt, /relaxed client with hands/);
});

test('latest request overrides old project fields and learned revisions', () => {
  const brief = '风格：旧粉色\n不能出现：旧限制\n【基于上一版继续优化】\n保留Old Brand和RM99\n' + current;
  const prompt = posterGenerationPrompt({ brief });
  assert.doesNotMatch(prompt, /旧粉色|旧限制|Old Brand|RM99/);
  assert.match(prompt, /香港地區驗收樣本/);
});

test('escaped newlines and empty fields cannot swallow the following field', () => {
  const prompt = posterGenerationPrompt({ brief: current.replaceAll('\n', '\\n').replace('不能出现：不要真人或手部，不要其他商戶名稱', '不能出现：') });
  assert.doesNotMatch(prompt, /Mandatory current customer exclusions/);
  assert.match(prompt, /香港地區驗收樣本/);
  assert.doesNotMatch(prompt, /尺寸：/);
});

test('Traditional restriction alias and current revision are preserved', () => {
  const prompt = posterGenerationPrompt({ brief: '【本次制作需求】\n風格：靜物\n禁止出现：不要人像\n尺寸：1080x1920\n【基于上一版继续优化】\n背景換成毛巾和植物' });
  assert.match(prompt, /不要人像/);
  assert.match(prompt, /背景換成毛巾和植物/);
  assert.match(prompt, /top 14 percent/);
});

test('actual worker imports and calls the tested helper, no duplicate legacy implementation', () => {
  const worker = readFileSync(new URL('../api/video-worker.mjs', import.meta.url), 'utf8');
  assert.match(worker, /import \{ currentPosterBrief, posterGenerationPrompt \} from '.\/_poster-current-brief.mjs'/);
  assert.match(worker, /prompt: posterGenerationPrompt\(job\)/);
  assert.doesNotMatch(worker, /function posterGenerationPrompt/);
});

test('numeric exclusions remain semantic constraints, never erased as prices', () => {
  const prompt = posterGenerationPrompt({ brief: '不能出現：不要18歲以下人物，不要超過2件產品\n风格：靜物' });
  assert.match(prompt, /不要18歲以下人物，不要超過2件產品/);
});

test('actual generation size and render placement/revision use the same current request', async () => {
  const { currentPosterBrief } = await import('../api/_poster-current-brief.mjs');
  const { posterPlacement, parsePosterRevision } = await import('../api/_poster-copy.mjs');
  const brief = '尺寸：1080x1920\n【基于上一版继续优化】\n标题大一点，背景粉色\n' + current;
  const request = currentPosterBrief(brief.replaceAll('\n', '\\n'));
  assert.equal(posterPlacement(request).key, 'feed');
  assert.equal(parsePosterRevision(request).background, '');
  const worker = readFileSync(new URL('../api/video-worker.mjs', import.meta.url), 'utf8');
  assert.match(worker, /const brief = currentPosterBrief\(job.brief\);\s*const placement = posterPlacement\(brief\)/);
  assert.match(worker, /size: posterPlacement\(currentPosterBrief\(job.brief\)\).generate/);
  assert.match(worker, /const revision = parsePosterRevision\(brief\)/);
});

test('a restricted body part does not override an explicitly allowed face/service subject', () => {
  const prompt = posterGenerationPrompt({ brief: '风格：保留真人面部護理場景\n不能出现：不要手部特寫，但保留真人面部護理場景' });
  assert.match(prompt, /不要手部特寫，但保留真人面部護理場景/);
  assert.match(prompt, /Only if the customer explicitly requests a pure still life or excludes all people/);
  assert.match(prompt, /one body part must not be expanded into a ban on all people/);
  assert.doesNotMatch(prompt, /For a still life or a request excluding people\/body parts/);
});
