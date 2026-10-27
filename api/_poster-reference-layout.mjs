import crypto from 'node:crypto';

const MARKER = 'Reference design grammar: ';
const ENUMS = {
  subject: ['SERVICE_SCENE', 'PRODUCT', 'PERSON', 'PLACE', 'GRAPHIC', 'COMPARISON'],
  hook: ['BENEFIT', 'PROBLEM', 'OFFER', 'EDUCATION', 'PROOF'],
  offer: ['PRICE_FIRST', 'PACKAGE', 'CONSULTATION', 'NONE'],
  proof: ['PROCESS', 'CUSTOMER_ASSET', 'CREDENTIAL', 'NONE'],
  direction: ['BENEFIT_THEN_OFFER', 'PROBLEM_THEN_SOLUTION', 'EXPLAIN_THEN_CTA', 'OFFER_THEN_DETAILS'],
};
const ROLES = ['HEADLINE', 'SUBJECT', 'PRICE', 'PROOF', 'CTA', 'BRAND', 'DISCLAIMER'];
const fail = () => { throw new Error('poster_reference_design_invalid'); };
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

/** Read only allowlisted visual grammar, never arbitrary reference instructions. */
export function posterReferenceDesign(style) {
  const text = String(style || '');
  const at = text.lastIndexOf(MARKER);
  if (at < 0) return null;
  const json = text.slice(at + MARKER.length);
  if (json.length > 4096) fail();
  let input;
  try { input = JSON.parse(json); } catch { fail(); }
  if (!input || typeof input !== 'object' || Array.isArray(input) || input.version !== 'visual-blueprint-v1') fail();
  const expected = ['version', 'palette', 'regions', ...Object.keys(ENUMS)];
  if (Object.keys(input).some(key => !expected.includes(key))) fail();
  if (!Array.isArray(input.palette) || input.palette.length < 1 || input.palette.length > 6 || input.palette.some(color => typeof color !== 'string' || !/^#[a-f\d]{6}$/iu.test(color))) fail();
  for (const [key, values] of Object.entries(ENUMS)) if (!values.includes(input[key])) fail();
  if (!Array.isArray(input.regions) || input.regions.length < 1 || input.regions.length > 12) fail();
  const regions = input.regions.map(region => {
    if (!region || typeof region !== 'object' || Object.keys(region).some(key => !['role', 'x', 'y', 'width', 'height'].includes(key)) || !ROLES.includes(region.role)) fail();
    if (['x', 'y', 'width', 'height'].some(key => typeof region[key] !== 'number' || !Number.isFinite(region[key]) || region[key] < 0 || region[key] > 1) || region.width <= 0 || region.height <= 0 || region.x + region.width > 1.000001 || region.y + region.height > 1.000001) fail();
    return { role: region.role, x: region.x, y: region.y, width: region.width, height: region.height };
  });
  return { version: input.version, palette: input.palette.map(color => color.toLowerCase()), regions, ...Object.fromEntries(Object.keys(ENUMS).map(key => [key, input[key]])) };
}

function foreground(color) {
  const n = Number.parseInt(color.slice(1), 16);
  const luminance = 0.2126 * (n >> 16) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255);
  return luminance > 140 ? '#1a1410' : '#ffffff';
}

function colorFamily(color) {
  const values = color.slice(1).match(/../g).map(value => Number.parseInt(value,16));
  const [r,g,b] = values;
  const max = Math.max(...values), min = Math.min(...values), delta = max-min;
  if (max < 60) return 'black';
  if (min > 220) return 'white';
  if (!delta) return 'neutral';
  let hue = max===r ? ((g-b)/delta)%6 : max===g ? (b-r)/delta+2 : (r-g)/delta+4;
  hue=(hue*60+360)%360;
  return hue<20 || hue>=345 ? 'red' : hue>=180 && hue<265 ? 'blue' : hue>=285 && hue<345 ? 'pink' : hue>=75 && hue<180 ? 'green' : 'other';
}

function requestedPaletteColor(style, palette) {
  const colors = /#[a-f\d]{6}\b|深绿|深綠|dark\s*green|红色?|紅色?|\bred\b|蓝色?|藍色?|\bblue\b|粉色?|\bpink\b|黑色?|\bblack\b|白色?|\bwhite\b/giu;
  const directives = /(?:不要|不用|别用|不使用|不想要|不想用|禁止|禁用|避免|排除)(?:再)?(?:使用|用|改成|改为|改|换成|选择)?|(?:do\s+not|don't|not|no|avoid|without)(?:\s+(?:to\s+)?(?:use|choose|select|change\s+to))?\b|使用|改成|改为|改為|换成|換成|改|换|換|用|\buse\b|[，,；;。\n]|\bbut\b|但是|但/giu;
  const negative = /^(?:不要|不用|别用|不使用|不想要|不想用|禁止|禁用|避免|排除|do\s+not|don't|not|no|avoid|without)/iu;
  const latest = new Map();
  const requests = [];
  for (const hit of style.matchAll(colors)) {
    let denied=false;
    for (const instruction of style.slice(0,hit.index).matchAll(directives)) denied=negative.test(instruction[0]);
    const token=hit[0];
    const color=token.startsWith('#') ? token.toLowerCase() : /深绿|深綠|dark/iu.test(token) ? '#006341' : /红|紅|red/iu.test(token) ? '#d32f2f' : /蓝|藍|blue/iu.test(token) ? '#1565c0' : /粉|pink/iu.test(token) ? '#e87aa0' : /黑|black/iu.test(token) ? '#151515' : '#f3f3f3';
    const family=token.startsWith('#') ? color : colorFamily(color);
    latest.set(family,denied);
    requests.push({color,family,denied});
  }
  const explicit=requests.findLast(item=>!item.denied && !latest.get(item.family));
  if (explicit) return explicit.color;
  const allowed=palette.find(color=>!latest.get(color.toLowerCase()) && !latest.get(colorFamily(color)));
  if (!allowed) throw new Error('poster_reference_palette_conflict');
  return allowed;
}

/** Current explicit palette wins; reference colors are a fallback, never a brand override. */
export function referenceComposition(style, width, height, safe) {
  const design = posterReferenceDesign(style);
  if (!design) return null;
  const customerStyle = String(style).split('Use this reference only')[0].split(MARKER)[0];
  const accent = requestedPaletteColor(customerStyle,design.palette);
  const anchor = design.regions.find(region => region.role === 'HEADLINE');
  const padding = Math.round(width * 0.075);
  const left = anchor ? Math.round(clamp(anchor.x * width, padding, width * 0.25)) : padding;
  const contentWidth = anchor ? Math.round(clamp(anchor.width * width, width * 0.6, width - padding - left)) : width - padding * 2;
  return {
    palette: { accent, onAccent: foreground(accent), priceColor: foreground(accent) === '#ffffff' ? '#ffffff' : accent },
    left, contentWidth,
    titleTop: anchor ? Math.round(clamp(anchor.y * height, safe.top + 110, height - safe.bottom - 200)) : null,
    priceFirst: design.offer === 'PRICE_FIRST' || Boolean(anchor && design.regions.some(region => region.role === 'PRICE' && region.y < anchor.y)),
    manifest: {
      schema: 'poster-reference-render-v1',
      designHash: crypto.createHash('sha256').update(JSON.stringify(design)).digest('hex'),
      applied: ['palette', ...(anchor ? ['layout'] : [])],
    },
  };
}

export function referenceBackgroundInstruction(style, renderPlan) {
  const design = posterReferenceDesign(style);
  if (!design) return '';
  const width=renderPlan?.placement?.width, height=renderPlan?.placement?.height;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width<=0 || height<=0 || !renderPlan?.layout?.title || !/^#[a-f\d]{6}$/iu.test(renderPlan?.palette?.accent || '')) throw new Error('poster_reference_layout_plan_required');
  const groups=[['title','price','facts','qualifier','qualifierPill','button','cta','icon'],['brand','brandPill']];
  const regions=groups.map((roles,index)=>{
    const boxes=roles.map(role=>renderPlan.layout[role]).filter(Boolean);
    if (!boxes.length) return null;
    if (boxes.some(box=>['left','top','width','height'].some(key=>!Number.isFinite(box[key])) || box.left<0 || box.top<0 || box.width<=0 || box.height<=0 || box.left+box.width>width || box.top+box.height>height)) throw new Error('poster_reference_layout_plan_invalid');
    const left=Math.max(0,Math.min(...boxes.map(box=>box.left))-16),top=Math.max(0,Math.min(...boxes.map(box=>box.top))-20);
    const right=Math.min(width,Math.max(...boxes.map(box=>box.left+box.width))+16),bottom=Math.min(height,Math.max(...boxes.map(box=>box.top+box.height))+20);
    return {role:index===0?'COPY_GROUP':'BRAND',x:left/width,y:top/height,width:(right-left)/width,height:(bottom-top)/height};
  }).filter(Boolean);
  return ` For this request the exact final compositor plan overrides generic bottom-space defaults and raw reference positions. Keep these normalized bounding rectangles calm, uncluttered and free of faces for the separate text overlay: ${JSON.stringify(regions)}. Use the confirmed compositor accent ${renderPlan.palette.accent}; excluded colors from any raw reference palette must not be reintroduced. Current customer facts, explicit brand colors and exclusions take priority. Do not render any letters or numbers.`;
}

/** Move the whole copy group together, preserving safe spacing and exact parent boxes. */
export function positionReferenceCopy(layout, composites, layerIndices, reference, height, safe, locked = false) {
  if (!reference || reference.titleTop === null || !layout.title) return;
  if (!locked && reference.priceFirst && layout.price && layout.price.top > layout.title.top) {
    const title = layout.title;
    const priceRoles = ['price','qualifier','qualifierPill'].filter(role => layout[role]);
    const priceTop = Math.min(...priceRoles.map(role => layout[role].top));
    const priceBottom = Math.max(...priceRoles.map(role => layout[role].top + layout[role].height));
    const gap = Math.max(10, priceTop - title.top - title.height);
    const oldTitleTop = title.top;
    for (const role of priceRoles) {
      layout[role].top += oldTitleTop - priceTop;
      composites[layerIndices[role]].top = layout[role].top;
    }
    title.top = Math.round(oldTitleTop + priceBottom - priceTop + gap);
    composites[layerIndices.title].top = title.top;
  }
  const roles = ['title', 'facts', 'price', 'qualifier', 'qualifierPill', 'button', 'icon', 'cta'].filter(role => layout[role]);
  const top = Math.min(...roles.map(role => layout[role].top));
  const bottom = Math.max(...roles.map(role => layout[role].top + layout[role].height));
  const minimumTop = safe.top + (layout.brandPill ? layout.brandPill.height + 35 : 10);
  const delta = locked ? 0 : Math.round(clamp(reference.titleTop - layout.title.top, minimumTop - top, height - safe.bottom - bottom));
  for (const role of roles) {
    layout[role].top += delta;
    composites[layerIndices[role]].top = layout[role].top;
  }
  const left = Math.min(...roles.map(role => layout[role].left));
  const right = Math.max(...roles.map(role => layout[role].left + layout[role].width));
  const panelTop = Math.max(safe.top, top + delta - 20);
  const panelBottom = Math.min(height - safe.bottom + 15, bottom + delta + 20);
  const panel = Buffer.from(`<svg width="${right - left + 32}" height="${panelBottom - panelTop}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" rx="20" fill="#080808" fill-opacity=".48"/></svg>`);
  composites.splice(1, 0, { input: panel, left: Math.max(0, left - 16), top: panelTop });
}
