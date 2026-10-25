// Pure current-request extraction shared by the real worker and regression tests.
import { buildPosterPrompt, parsePosterRevision, posterPlacement } from './_poster-copy.mjs';

export function currentPosterBrief(brief) {
  const text = String(brief || '').replaceAll('\\n', '\n');
  // Never let remembered project preferences shadow the latest confirmed brief.
  return text.includes('【本次制作需求】') ? text.split('【本次制作需求】').at(-1) : text;
}

export function posterGenerationPrompt(job) {
  const request = currentPosterBrief(job.brief);
  const field = (label, fallback = '') => {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = request.match(new RegExp(`(?:^|\\n)${escaped}[：:]([^\\n]*)`));
    return match ? match[1].trim() : fallback;
  };
  return buildPosterPrompt({
    purpose: field('产品/服务'),
    style: field('风格', field('風格')),
    title: field('主标题', job.project_name || ''),
    brand: field('品牌'),
    facts: field('核心卖点与准确事实'),
    exclusions: field('不能出现', field('不能出現', field('禁止出现', field('禁止出現')))),
    revision: parsePosterRevision(request).background,
    placement: posterPlacement(request).key,
  });
}
