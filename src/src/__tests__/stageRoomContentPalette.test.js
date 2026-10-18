/**
 * THE ROOM'S SCREENS, REDRAWN, AS A CSS CONTRACT (owner, 18 Oct 2026,
 * docs/design/room-content-v2; engage-design skill §5).
 *
 * jsdom loads no stylesheet, so the one-screen stage's new rules are read
 * from styles/stage.css as text and their contrast is measured against both
 * skins' values (styles/skins/*.css), composited up the paint stack:
 *
 *   - the lesson sits at the secondary step and the title leads at hero /
 *     primary (roomContentPalette holds the lead); "Your turn" reads the
 *     secondary step; the generic instruction (Call) the body step;
 *   - the pick is painted with the skin's gold ROLE, never a literal;
 *   - every new pairing clears 4.5:1 in Classic and Present;
 *   - the new blocks carry no colour literal and no pixel font size.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const read = (...p) => readFileSync(join(__dirname, '..', ...p), 'utf8');
const STAGE = read('styles', 'stage.css');

function rule(css, sel) {
  const at = css.indexOf(`\n${sel}{`);
  if (at < 0) return null;
  const open = css.indexOf('{', at);
  return css.slice(open + 1, css.indexOf('}', open));
}
const decl = (body, prop) => {
  const m = new RegExp(`(?:^|;|\\s)${prop}:\\s*([^;]+)`).exec(body || '');
  return m ? m[1].trim() : null;
};

/* ---- colour arithmetic ---- */
const hex = (h) => {
  const s = h.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16));
};
const mix = (fg, bg, a) => fg.map((c, i) => c * a + bg[i] * (1 - a));
const lum = (rgb) => {
  const [r, g, b] = rgb.map((c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

/** One skin's values, read from its file. */
function skin(name) {
  const css = read('styles', 'skins', `${name}.css`);
  const v = (k) => {
    const m = new RegExp(`--sk-${k}:\\s*(#[0-9A-Fa-f]{6})`).exec(css);
    if (!m) throw new Error(`${name}: --sk-${k} not found`);
    return hex(m[1]);
  };
  return {
    accent: v('accent'), accentText: v('dark-accent-text'), gold: v('gold'),
    onAccent: v('dark-on-accent'), surface: v('dark-surface'),
  };
}
// The stage re-enters dusk with these (styles/stage.css `.stage{…}`).
const BG = hex('#0F1A2E');
const TEXT = hex('#F4EDE4');
const MUTED = hex('#B6C2D4');
// `.card` paints rgba(27,41,66,.74) over the field.
const CARD = mix(hex('#1B2942'), BG, 0.74);

describe.each(['classic', 'present'])('%s', (name) => {
  const s = skin(name);

  it('"Your turn": the text and its label on the band (accent at .10 over the field)', () => {
    const band = mix(s.accent, BG, 0.10);
    expect(contrast(TEXT, band)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(s.accentText, band)).toBeGreaterThanOrEqual(4.5);
  });

  it('the category eyebrow and the talk label on the field', () => {
    expect(contrast(s.accentText, BG)).toBeGreaterThanOrEqual(4.5);
  });

  it('the pick: its words and its gold label on the gold card (gold 16% into the field)', () => {
    const pick = mix(s.gold, BG, 0.16);
    expect(contrast(TEXT, pick)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(s.gold, pick)).toBeGreaterThanOrEqual(4.5);
  });

  it('a runner\'s words over its bar (accent at .22 over the card)', () => {
    expect(contrast(TEXT, mix(s.accent, CARD, 0.22))).toBeGreaterThanOrEqual(4.5);
  });

  it('the ballot number on its badge (accent at .14 over the card)', () => {
    expect(contrast(s.accentText, mix(s.accent, CARD, 0.14))).toBeGreaterThanOrEqual(4.5);
  });

  it('the current chip, and the QR panel\'s words on its surface', () => {
    expect(contrast(s.onAccent, s.accent)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(TEXT, s.surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(MUTED, s.surface)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('the rules (styles/stage.css)', () => {
  it('ANSWERING: the lesson and "Your turn" at the secondary step; the generic line at body', () => {
    expect(decl(rule(STAGE, '.q-lesson'), 'font-size')).toBe('var(--t-secondary)');
    expect(decl(rule(STAGE, '.q-turn-t'), 'font-size')).toBe('var(--t-secondary)');
    expect(decl(rule(STAGE, '.qdetail'), 'font-size')).toBe('var(--t-body)');
    expect(decl(rule(STAGE, '.q-turn-k'), 'font-size')).toBe('var(--t-meta)');
  });

  it('VOTING: every answer at the secondary step; the title reminder at primary', () => {
    expect(decl(rule(STAGE, '.cards.is-ballot .card .ans'), 'font-size')).toBe('var(--t-secondary)');
    expect(decl(rule(STAGE, '.q-remind'), 'font-size')).toBe('var(--t-primary)');
  });

  it('RESULTS: the pick on the gold role, the runners\' bars in the accent channel', () => {
    const pick = rule(STAGE, '.cards.is-ideas .card.is-pick');
    expect(pick).toMatch(/var\(--gold\)/);
    expect(decl(rule(STAGE, '.cards.is-ideas .card.is-pick .pick-k'), 'color')).toBe('var(--gold)');
    expect(decl(rule(STAGE, '.cards.is-ideas .card.is-runner .fill'), 'background')).toBe('rgb(var(--accent-rgb) / .22)');
  });

  it('the results text is never clamped by the base sheet, only behind [data-clamped="on"]', () => {
    expect(rule(STAGE, '.cards.is-ideas .card .ans')).not.toMatch(/line-clamp/);
    expect(STAGE).toMatch(/\.content\[data-clamped="on"\] \.cards\.is-ideas \.card \.ans\{[^}]*line-clamp:3/);
  });

  it('the QR panel: the content keeps a column beside it', () => {
    expect(decl(rule(STAGE, '.content[data-join]'), 'flex-direction')).toBe('row');
    expect(decl(rule(STAGE, '.content[data-join] > .fitbox'), 'min-width')).toBe('0');
  });

  it('the new blocks carry no colour literal and no pixel font size', () => {
    const from = (marker) => STAGE.lastIndexOf('/*', STAGE.indexOf(marker));
    const blocks = [
      STAGE.slice(from('THE TITLE AND THE LESSON LEAD'), STAGE.indexOf('/* GATHERING RESPONSES')),
      STAGE.slice(from("THE ROOM'S SCREENS, REDRAWN")),
    ];
    blocks.forEach((b) => {
      expect(b.length).toBeGreaterThan(200);
      expect(b.replace(/\/\*[\s\S]*?\*\//g, '')).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\((?!var\()/);
      expect(b).not.toMatch(/font-size:\s*\d/);
    });
  });
});
