/**
 * Seeded remix planner for the cloud video worker (#564 / A3 video employee).
 *
 * A remix job is an ordered storyboard whose slots are filled from the
 * customer's uploaded footage: the opening from the hook pool, the middle
 * slots from the middle pool, and the ending from the ending pool. Each pool
 * is built from windows of the uploaded clips, so one long clip can feed
 * several slots at different start points.
 *
 * Determinism: the plan depends only on the job id (the seed), the clips and
 * the storyboard slot count. The same job always renders the same order, so a
 * customer revision can be reproduced and compared.
 *
 * Honesty: no footage -> a typed failure, never a silent fallback to other
 * material. Clip reuse is reported, not hidden.
 */

export const REMIX_WINDOW_SECONDS = 6;
export const REMIX_ROLES = Object.freeze(['hook', 'middle', 'ending']);

/** Stable 32-bit seed from a job id. */
export function seedFromText(text) {
  let hash = 0x811c9dc5;
  for (const char of String(text)) {
    hash ^= char.codePointAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** Mulberry32: small, fast, deterministic PRNG. */
export function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled(items, random) {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [copy[index], copy[swap]] = [copy[swap], copy[index]];
  }
  return copy;
}

/** Windows cut from one input. A clip shorter than the window keeps one
 * window at 0 (the renderer loops it, as the non-remix path already does). */
export function windowsForInput(input, durationSeconds) {
  const isImage = String(input.type || '').startsWith('image/');
  if (isImage) return [{ start: 0, duration: 0, isImage: true }];
  const duration = Number(durationSeconds) || 0;
  if (duration <= 0) return [];
  if (duration <= REMIX_WINDOW_SECONDS) return [{ start: 0, duration }];
  const windows = [];
  for (let start = 0; start + REMIX_WINDOW_SECONDS <= duration + 0.01; start += REMIX_WINDOW_SECONDS) {
    windows.push({ start: Math.round(start * 100) / 100, duration });
  }
  return windows;
}

function labelOf(input) {
  return REMIX_ROLES.includes(input.role) ? input.role : null;
}

/**
 * @param {object} args
 * @param {Array<{role?:string,type?:string,localPath:string,name?:string}>} args.inputs
 * @param {Map<string, number>} args.durations  localPath -> seconds
 * @param {string} args.seedText                job id
 * @param {number} args.slotCount               storyboard scenes
 * @returns {{ok:true, seed:number, slots:Array, reusedSlots:number}|{ok:false, reason:string}}
 */
export function planRemix({ inputs, durations, seedText, slotCount }) {
  const visual = inputs.filter((item) => /^(video|image)\//.test(String(item.type || '')) && item.role !== 'reference' && item.role !== 'character_reference');
  if (visual.length === 0) return { ok: false, reason: 'REMIX_NO_FOOTAGE' };
  if (!Number.isInteger(slotCount) || slotCount < 1) return { ok: false, reason: 'REMIX_INVALID_SLOT_COUNT' };

  const pools = { hook: [], middle: [], ending: [] };
  const shared = [];
  for (const input of visual) {
    const windows = windowsForInput(input, durations.get(input.localPath) || 0);
    const clips = windows.map((window) => ({ localPath: input.localPath, type: input.type, name: input.name || '', ...window }));
    const label = labelOf(input);
    if (label) pools[label].push(...clips);
    else shared.push(...clips);
  }
  if (pools.hook.length + pools.middle.length + pools.ending.length + shared.length === 0) {
    return { ok: false, reason: 'REMIX_NO_USABLE_WINDOW' };
  }

  const seed = seedFromText(seedText);
  const random = seededRandom(seed);
  const decks = new Map();
  const drawFrom = (role) => {
    const pool = pools[role].length ? pools[role] : shared.length ? shared : [...pools.hook, ...pools.middle, ...pools.ending];
    const key = pool === shared ? 'shared' : pools[role].length ? role : 'all';
    if (!decks.has(key)) decks.set(key, { items: shuffled(pool, random), next: 0, pass: 0 });
    const deck = decks.get(key);
    if (deck.next >= deck.items.length) {
      deck.items = shuffled(pool, random);
      deck.next = 0;
      deck.pass += 1;
    }
    const clip = deck.items[deck.next];
    deck.next += 1;
    return { clip, reused: deck.pass > 0 };
  };

  const slots = [];
  for (let index = 0; index < slotCount; index += 1) {
    const role = index === 0 ? 'hook' : index === slotCount - 1 ? 'ending' : 'middle';
    const { clip, reused } = drawFrom(role);
    slots.push({ index, role, clip, reused });
  }
  return { ok: true, seed, slots, reusedSlots: slots.filter((slot) => slot.reused).length };
}

