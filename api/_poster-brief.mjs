// Historical poster lessons, scoped to the current customer's request.
export function briefValue(brief, label, fallback = '') {
  const text = String(brief || '').replaceAll('\\n', '\n');
  const request = text.includes('【本次制作需求】') ? text.split('【本次制作需求】').at(-1) : text;
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = request.match(new RegExp(`(?:^|\\n)${escaped}[：:]([^\\n]+)`));
  return match ? match[1].trim() : fallback;
}

export const POSTER_STYLES = {
  brand_green: { accent: '#28d57e', ink: '#021b0f', text: '#ffffff', detail: '#e2f4ea', shade: '#020b07', description: 'deep green and clean white', layout: 'bottom' },
  black_gold: { accent: '#e6c17c', ink: '#221709', text: '#f7dfaa', detail: '#fff1cf', shade: '#120c07', description: 'charcoal black and warm champagne gold, restrained premium salon photography', layout: 'top' },
  burgundy: { accent: '#a51130', ink: '#ffffff', text: '#ffffff', detail: '#ffedf1', shade: '#310917', description: 'burgundy red and soft blush white, clean premium salon photography', layout: 'top' },
};

export function posterBrief(job) {
  const revision = String(job.revision_prompt || '').replaceAll('\\n', '\n');
  const source = String(job.brief || '').replaceAll('\\n', '\n');
  const field = (label, fallback = '') => briefValue(revision, label, briefValue(source, label, fallback));
  const size = field('尺寸', '1080x1350').match(/(\d+)[x×](\d+)/i);
  const width = Math.max(640, Math.min(2160, Number(size?.[1] || 1080)));
  const height = Math.max(640, Math.min(2160, Number(size?.[2] || 1350)));
  const styleText = field('视觉风格', field('風格', field('风格', 'brand_green')));
  const style = /black_gold|黑金/.test(styleText) ? 'black_gold' : /burgundy|酒红|酒紅/.test(styleText) ? 'burgundy' : 'brand_green';
  const result = {
    width, height, style, palette: POSTER_STYLES[style],
    purpose: field('制作方式', '新做一张营销海报'),
    title: field('主标题', job.project_name || '营销海报'),
    facts: field('核心卖点与准确事实', field('准确价格/优惠/事实')),
    cta: field('行动引导', '立即了解'),
    // Never brand a client's massage/facial ad as LULIAN by default.
    brand: field('品牌', field('客户', '')),
    audience: field('目标客户'),
    revision,
  };
  for (const [key, max] of [['title', 90], ['facts', 220], ['cta', 48], ['brand', 64], ['audience', 80]]) {
    if ([...result[key]].length > max) throw new Error(`poster_copy_too_long_${key}`);
  }
  return result;
}

export function posterGenerationPrompt(job, { hasMain = false, referenceCount = 0 } = {}) {
  const b = posterBrief(job);
  return `Create ONE standalone commercial advertising background, ${b.width}:${b.height} aspect ratio. Customer brand: ${b.brand}. Current campaign only: ${b.title}. Confirmed facts: ${b.facts}. Audience: ${b.audience}. Visual direction: ${b.palette.description}. One focal subject, natural anatomy, believable service environment, polished lighting, no collage or dashboard. ${hasMain ? 'Image 1 is the actual customer subject/product/venue: preserve its identity, shape and service details. Never replace it with the person/product from style references.' : 'Do not present invented people or scenes as actual customers or documented results.'} ${referenceCount ? `The ${referenceCount} remaining image(s) are STYLE references only. Learn their palette, photographic treatment and hierarchy; do not reuse their claims, prices, logos, text, subjects or business.` : ''} Place the subject in the ${b.palette.layout === 'top' ? 'lower-right half; leave the top 45% calm and dark' : 'upper half; leave the lower half calm and dark'} for accurate typography added separately. Do not render any words, numbers, letters, prices, logos, watermarks, UI or QR codes. Requested revision: ${b.revision || 'none'}. Never add guarantees, statistics, offers or medical claims absent from the confirmed facts.`;
}

// References are loaded as real bytes. Generation is injected for contract tests.
export async function preparePosterSource({ job, main, references = [], load, generate }) {
  const b = posterBrief(job);
  if (references.length > 3) throw new Error('poster_reference_limit');
  if (references.some(item => !String(item.type || '').startsWith('image/'))) throw new Error('poster_reference_requires_image');
  if (/参考上传海报重制/.test(b.purpose) && !references.length) throw new Error('poster_remake_requires_reference');
  if (/检验并优化现有海报/.test(b.purpose) && !main) throw new Error('poster_optimize_requires_main');
  const source = main ? await load(main) : null;
  const shouldGenerate = !source || references.length > 0 || /检验并优化现有海报/.test(b.purpose);
  if (!shouldGenerate) return { source, metadata: { poster_style: b.style, reference_count: 0, composition: 'customer_image_with_typeset_copy' } };
  const referenceImages = [];
  if (source) referenceImages.push({ data: source });
  for (const item of references) referenceImages.push({ data: await load(item) });
  const generated = await generate({ prompt: posterGenerationPrompt(job, { hasMain: Boolean(main), referenceCount: references.length }), referenceImages });
  return { source: generated.data, metadata: { generated_background: true, poster_style: b.style, reference_count: references.length, image_provider: generated.provider, image_model: generated.model, source_sha256: generated.sha256, composition: 'reference_guided_background_with_typeset_copy' } };
}
