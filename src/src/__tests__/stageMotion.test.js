/**
 * THE STAGE'S MOTION CONTRACT — refresh-2026-09-22 RATIONALE §6 step 4.
 *
 * Read from stage.css as text, since jsdom runs no animation. Three rules:
 *
 *   1. `--rv` (the reveal's start, after the wipe has dwelt) is declared on
 *      `.stage`, with Table shorter than Room/TV — the host reads Table at
 *      arm's length and the wipe would only be in the way (§7 Q4).
 *   2. Every keyframe touches only transform, opacity, border-color and
 *      visibility. Anything else (width, height, font-size, margin) reflows
 *      the fitter's measured layout mid-round.
 *   3. Everything that animates has a reduced-motion rule, and the wipe on
 *      Call is a solid plate — no blur under a video codec.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const CSS = readFileSync(join(__dirname, '..', 'styles', 'stage.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');

/* Walk top-level and @media-nested rules; keyframes are handed to
   onKeyframes(name, body). Same shape as marketingPalette's walker. */
function walk(text, { onRule, onKeyframes, media = null } = {}) {
  let i = 0;
  const close = (open) => {
    let depth = 0;
    for (let k = open; k < text.length; k += 1) {
      if (text[k] === '{') depth += 1;
      if (text[k] === '}') { depth -= 1; if (depth === 0) return k; }
    }
    return text.length;
  };
  while (i < text.length) {
    const b = text.indexOf('{', i);
    if (b === -1) break;
    const head = text.slice(i, b).trim();
    const c = close(b);
    const body = text.slice(b + 1, c);
    if (/^@(?:-\w+-)?keyframes\b/.test(head)) {
      const m = head.match(/^@(?:-\w+-)?keyframes\s+([\w-]+)/);
      if (onKeyframes) onKeyframes(m[1], body);
    } else if (/^@media\b/.test(head)) {
      walk(body, { onRule, onKeyframes, media: head });
    } else if (!head.startsWith('@') && head) {
      if (onRule) onRule(head, body, media);
    }
    i = c + 1;
  }
}

const rules = [];
const keyframes = {};
walk(CSS, {
  onRule: (sel, body, media) => rules.push({ sel, body, media }),
  onKeyframes: (name, body) => { keyframes[name] = body; },
});
const declared = (sel, prop) => rules.filter((r) => r.sel === sel && !r.media)
  .some((r) => new RegExp(`(^|;)\\s*${prop}\\s*:`).test(r.body));

describe('the reveal clock', () => {
  test('--rv is declared on .stage, and Table is shorter than Room/TV', () => {
    const stage = rules.find((r) => r.sel === '.stage' && !r.media && /--rv\s*:/.test(r.body));
    expect(stage).toBeDefined();
    const room = Number(stage.body.match(/--rv\s*:\s*([\d.]+)s/)[1]);
    const table = rules.find((r) => /^:root\.d-table \.stage$/.test(r.sel) && /--rv\s*:/.test(r.body));
    expect(table).toBeDefined();
    expect(Number(table.body.match(/--rv\s*:\s*([\d.]+)s/)[1])).toBeLessThan(room);
    // The wipe dwells for the whole of --rv: its animation lasts exactly that long.
    expect(declared('.wipe', 'animation')).toBe(true);
    expect(rules.find((r) => r.sel === '.wipe' && !r.media).body).toMatch(/animation:\s*wipe var\(--rv\)/);
  });
});

describe('keyframes', () => {
  test('the wipe, grow, land, flagin and arrive keyframes exist', () => {
    for (const name of ['wipe', 'grow', 'land', 'flagin', 'arrive']) expect(keyframes[name]).toBeDefined();
  });

  test('every keyframe touches only transform, opacity, border-color and visibility', () => {
    const allowed = new Set(['transform', 'opacity', 'border-color', 'visibility']);
    for (const [name, body] of Object.entries(keyframes)) {
      const props = [...body.matchAll(/([a-z-]+)\s*:/g)].map((m) => m[1]);
      expect({ name, props: props.filter((p) => !allowed.has(p)) }).toEqual({ name, props: [] });
    }
  });
});

describe('reduced motion', () => {
  test('every animated selector is stilled under prefers-reduced-motion', () => {
    const animated = rules
      .filter((r) => !r.media && /(^|;)\s*animation\s*:\s*(?!none)/.test(r.body))
      .map((r) => r.sel);
    expect(animated.length).toBeGreaterThan(5);
    const stilledText = rules
      .filter((r) => r.media && /prefers-reduced-motion/.test(r.media) && /animation\s*:\s*none/.test(r.body))
      .map((r) => r.sel.split(',').map((x) => x.trim())).flat();
    for (const sel of animated) {
      expect({ sel, stilled: stilledText.includes(sel) }).toEqual({ sel, stilled: true });
    }
  });

  test('the wipe is a solid plate on Call: no backdrop-filter anywhere near it', () => {
    const call = rules.find((r) => r.sel === ':root.d-call .wipe');
    expect(call).toBeDefined();
    expect(call.body).toMatch(/background:\s*var\(--bg\)/);
    for (const r of rules.filter((x) => /\.wipe/.test(x.sel))) expect(r.body).not.toMatch(/backdrop-filter/);
  });
});
