// Pure helpers for the chat poster: how the customer's brief becomes (1) the
// background-image prompt and (2) the structured copy the renderer lays out.
// No I/O. Nothing here invents a fact: every printed string is a substring of
// what the customer wrote, and a missing field is simply not rendered.

const PRICE_PATTERN = /(?:RM|HK\$|S\$|US\$|NT\$|\$)\s?\d[\d,]*(?:\.\d+)?|\d[\d,]*(?:\.\d+)?\s?(?:令吉|港币|港幣|新币|新幣|美元|元)/i;

/** Splits "RM98 首次体验 · 60 分钟｜预约送护手霜" into a price block and short lines. */
export function parsePosterFacts(facts) {
  const text = String(facts || '').trim();
  if (!text) return { price: '', qualifier: '', lines: [] };
  const segments = text
    .split(/[｜|\n；;]+|\s·\s/u)
    .map((segment) => segment.trim())
    .filter(Boolean);
  let price = '';
  let qualifier = '';
  const lines = [];
  for (const segment of segments) {
    const match = !price ? segment.match(PRICE_PATTERN) : null;
    if (match) {
      price = match[0].replace(/\s+/g, ' ').trim();
      qualifier = segment.replace(match[0], '').replace(/^[\s,，、:：-]+|[\s,，、:：-]+$/gu, '').trim();
      continue;
    }
    lines.push(segment);
  }
  return { price, qualifier: qualifier.slice(0, 14), lines: lines.slice(0, 3) };
}

const STYLE_HINTS = [
  [/高端|奢|大气/u, 'luxurious and refined, deep tones with gold accents'],
  [/节庆|节日|七夕|情人|新年|圣诞|中秋|气氛/u, 'festive and romantic, warm celebratory mood fitting the occasion'],
  [/温馨|治愈|柔和|可爱/u, 'soft, cozy and healing, gentle pastel light'],
  [/简洁|极简|干净|价格/u, 'clean, bright and minimal with generous negative space'],
];

export function styleHint(style) {
  const text = String(style || '');
  const hit = STYLE_HINTS.find(([pattern]) => pattern.test(text));
  return hit ? hit[1] : 'polished and professional';
}

/** Background prompt. The customer's own words (what the business is, the
 * occasion, the style) steer the scene; the model is told to draw a real
 * service moment rather than an empty room, and to draw no lettering. */
export function buildPosterPrompt({ purpose, style, title, brand, facts }) {
  const context = [purpose, title].filter(Boolean).join(' / ');
  return [
    `Create a premium vertical advertising photograph for a local beauty / lifestyle business${brand ? ` named "${brand}"` : ''}.`,
    context ? `The business and campaign, in the customer's words: ${context}.` : '',
    facts ? `Offer context (do not draw it as text): ${facts}.` : '',
    `Mood and style: ${styleHint(style)}${style ? ` (customer asked for: ${style})` : ''}.`,
    'Show a real, believable moment of the service or product being enjoyed - a relaxed client with hands, product or result clearly visible, natural anatomy, warm professional lighting, one strong focal subject.',
    'Compose for a social-media ad: keep the lower 40 percent calm and darker so overlaid typography stays legible, and keep faces out of the lower third.',
    'Absolutely no words, letters, numbers, prices, logos, watermarks, UI, QR codes or captions anywhere in the image.',
  ].filter(Boolean).join(' ');
}

function rgbToHsl(r, g, b) {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === rn) h = (gn - bn) / d + (gn < bn ? 6 : 0);
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;
  return [h / 6, s, l];
}

function hslToRgb(h, s, l) {
  if (s === 0) return [l, l, l].map((v) => Math.round(v * 255));
  const hue = (p, q, t) => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [hue(p, q, h + 1 / 3), hue(p, q, h), hue(p, q, h - 1 / 3)].map((v) => Math.round(v * 255));
}

const hex = (rgb) => `#${rgb.map((v) => v.toString(16).padStart(2, '0')).join('')}`;

/** Accent colour taken from the picture's own dominant tone (never a fixed
 * brand-unrelated green), lifted so it reads on the dark bottom shade, plus a
 * text colour that stays readable on top of it. */
export function accentFromDominant({ r, g, b }) {
  const [h, s, l] = rgbToHsl(r, g, b);
  const rgb = hslToRgb(h, Math.max(0.5, Math.min(0.85, s)), Math.max(0.58, Math.min(0.72, l)));
  const luminance = (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255;
  return { accent: hex(rgb), onAccent: luminance > 0.5 ? '#1a1410' : '#ffffff' };
}
