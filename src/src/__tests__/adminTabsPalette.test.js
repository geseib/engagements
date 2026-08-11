/**
 * THE COLOUR PAIRINGS INTRODUCED BY WAVE D'S TWO SCREENS.
 *
 * Same method as adminShellPalette.test.js and for the same reason: jsdom has
 * no layout engine and does not resolve custom properties across stylesheets,
 * so nothing here asks the DOM anything. It reads the CSS text and does the
 * arithmetic — which is the only honest way to assert contrast in this
 * environment. The ratio function is the one
 * docs/design/admin-redesign/audit.html uses for its A4 assertion, the one that
 * found `--danger` at 4.38:1 on `--surface` and is why `--danger-text` exists.
 *
 * NAMED "Palette", not "Tokens": .gitignore:35 is `*token*`, so a file named
 * for tokens is invisible to git — it would pass locally and never reach CI.
 */
const fs = require('fs');
const path = require('path');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const GLOBAL_CSS = read('styles.css');
const USERS_CSS = read('components', 'UserManagement.css');
const SESSIONS_CSS = read('components', 'SessionsPanel.css');

/* ------------------------------------------------------------------ colour */
const lin = (c) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
};
const parseHex = (h) => [1, 3, 5].map((i) => parseInt(h.substr(i, 2), 16));
const lum = (rgb) => 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
const ratioOf = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
const ratio = (a, b) => ratioOf(parseHex(a), parseHex(b));

/** An alpha tint painted over an opaque background, as the compositor does it. */
const over = (hex, alpha, baseHex) => {
  const fg = parseHex(hex);
  const bg = parseHex(baseHex);
  return fg.map((c, i) => c * alpha + bg[i] * (1 - alpha));
};
const ratioOnTint = (textHex, tintHex, alpha, baseHex) =>
  ratioOf(parseHex(textHex), over(tintHex, alpha, baseHex));

/** Read a token's hex out of a `:root`-style block. */
function token(css, block, name) {
  const start = css.indexOf(block);
  if (start < 0) throw new Error(`no ${block} block`);
  const body = css.slice(start, css.indexOf('}', start));
  const m = body.match(new RegExp(`${name}\\s*:\\s*(#[0-9A-Fa-f]{6})`));
  if (!m) throw new Error(`${name} not declared in ${block}`);
  return m[1];
}

const ROOT = ':root {';
const DUSK = '[data-theme="dark"] {';

const T = {
  bg: token(GLOBAL_CSS, DUSK, '--bg'),
  surface: token(GLOBAL_CSS, DUSK, '--surface'),
  surface2: token(GLOBAL_CSS, DUSK, '--surface-2'),
  text: token(GLOBAL_CSS, DUSK, '--text'),
  muted: token(GLOBAL_CSS, DUSK, '--muted'),
  primary: token(GLOBAL_CSS, ROOT, '--primary'),
  danger: token(GLOBAL_CSS, ROOT, '--danger'),
  dangerText: token(GLOBAL_CSS, ROOT, '--danger-text'),
  dangerDeep: token(GLOBAL_CSS, ROOT, '--danger-deep'),
  // NOT a global token: styles.css has never declared --success-text. The two
  // screens declare their own, `--um-`/`--sp-` prefixed, the way auth.css:865
  // declares --au-success-text. See the "tokens that do not exist" suite below.
  successText: token(USERS_CSS, '.um {', '--um-success-text'),
};

const AA = 4.5;

describe('every pairing these two screens introduce clears AA for normal text', () => {
  // AdminPage passes contentTheme="dark" for both sections, so the work body is
  // --bg and the panels are --surface. These are the surfaces the copy sits on.
  const pairs = [
    ['--text on --surface (row values)', T.text, T.surface],
    ['--muted on --surface (secondary row text, column heads)', T.muted, T.surface],
    ['--muted on --bg (the table, which sits on the work body)', T.muted, T.bg],
    ['--primary on --surface (Admin chip, wait age, unconfirmed email)', T.primary, T.surface],
    ['--success-text on --surface (Host chip, "nobody is waiting")', T.successText, T.surface],
    ['--danger-text on --surface (Reject, Remove, the delete-all modal)', T.dangerText, T.surface],
    ['--danger-text on --bg (Delete, on the table)', T.dangerText, T.bg],
    ['--bg on --primary (the filled "Approve as host")', T.bg, T.primary],
    ['--text on --danger-deep (the filled "Delete all N")', T.text, T.dangerDeep],
  ];

  test.each(pairs)('%s', (_label, fg, bg) => {
    expect(ratio(fg, bg)).toBeGreaterThanOrEqual(AA);
  });

  test('the tinted queue header does not eat the contrast under it', () => {
    // The approval queue's header is --primary at 6% over --surface, and the
    // "Oldest has waited 21 days" line sits on it. A tint is invisible in a
    // token table and is exactly where a pairing quietly drops under AA.
    expect(ratioOnTint(T.muted, T.primary, 0.06, T.surface)).toBeGreaterThanOrEqual(AA);
    expect(ratioOnTint(T.primary, T.primary, 0.06, T.surface)).toBeGreaterThanOrEqual(AA);
    expect(ratioOnTint(T.text, T.primary, 0.06, T.surface)).toBeGreaterThanOrEqual(AA);
  });

  test('the error banner is readable on its own tint', () => {
    // rgba(--danger, .09) over the work body, carrying --danger-text.
    expect(ratioOnTint(T.dangerText, T.danger, 0.09, T.bg)).toBeGreaterThanOrEqual(AA);
  });

  test('the filled primary button is still legible when hovered', () => {
    // .um-btn--primary:hover lightens to #FFBB66 and keeps --bg as its label.
    expect(ratio(T.bg, '#FFBB66')).toBeGreaterThanOrEqual(AA);
  });
});

describe('the token that is under AA, and must never carry text here', () => {
  test('--danger is under AA on --surface, which is why --danger-text exists', () => {
    // The premise. If this ever stops being true the rule below is pointless
    // and should be revisited rather than silently kept.
    expect(ratio(T.danger, T.surface)).toBeLessThan(AA);
  });

  test('neither stylesheet paints text with plain --danger', () => {
    // rejects: `color: var(--danger)` creeping into either screen — 4.38:1 on
    // --surface and 3.56:1 on --surface-2, and destructive copy is precisely
    // the text a person must read carefully. --danger keeps borders and tints.
    for (const [name, css] of [['UserManagement.css', USERS_CSS], ['SessionsPanel.css', SESSIONS_CSS]]) {
      const offenders = css
        .split('\n')
        .filter((line) => /(^|[^-])\bcolor\s*:\s*var\(--danger\)/.test(line));
      expect({ [name]: offenders }).toEqual({ [name]: [] });
    }
  });
});

describe('tokens that do not exist, and the declaration they silently kill', () => {
  /**
   * An undefined custom property makes the WHOLE declaration invalid — not just
   * the value. `styles/stage.css:648-666` documents this happening once already:
   * `border: var(--hair) solid var(--rule)` against tokens styles.css does not
   * have dropped every card border on the floor in three of four profiles.
   *
   * So: every `var(--x)` these two screens reference must be declared
   * somewhere. rejects: reaching for a token by its host-spec name because
   * another stylesheet happens to have it — `--success-text` exists only on
   * `styles/stage.css`'s :root, which is in this bundle solely because a stage
   * component is imported, and would vanish the day that import moves.
   */
  const DECLARED = new Set();
  for (const css of [GLOBAL_CSS, USERS_CSS, SESSIONS_CSS, read('components', 'AdminShell.css')]) {
    for (const m of css.matchAll(/(--[a-z0-9-]+)\s*:/gi)) DECLARED.add(m[1]);
  }

  test.each([['UserManagement.css', USERS_CSS], ['SessionsPanel.css', SESSIONS_CSS]])(
    '%s references no custom property that nothing declares',
    (_name, css) => {
      const used = [...css.matchAll(/var\((--[a-z0-9-]+)/gi)].map((m) => m[1]);
      const undeclared = [...new Set(used)].filter((name) => !DECLARED.has(name));
      expect(undeclared).toEqual([]);
    }
  );
});

describe('the type ladder these screens are built on', () => {
  // RATIONALE §3: 12 floor / 13 label / 15 body / 19 head, derived for one
  // person at 24in — NOT the host stage's 20px angular floors, which are for a
  // projected image read at 25 feet.
  const LADDER = { floor: '12px', label: '13px', body: '15px', head: '19px' };

  test.each([['UserManagement.css', USERS_CSS, 'um'], ['SessionsPanel.css', SESSIONS_CSS, 'sp']])(
    '%s declares the ladder and nothing below its floor',
    (_name, css, prefix) => {
      for (const [step, value] of Object.entries(LADDER)) {
        expect(css).toMatch(new RegExp(`--${prefix}-t-${step}:\\s*${value}`));
      }
      // rejects: a hardcoded 10px or 11px slipping in below the 12px floor.
      // 14px is allowed and used deliberately: monospace runs ~1px small at the
      // same optical size, so .sp-mono / .inp.mono are 14px in the mockups too.
      const literals = [...css.matchAll(/font-size:\s*(\d+)px/g)].map((m) => Number(m[1]));
      expect(literals.filter((px) => px < 12)).toEqual([]);
    }
  );

  test('rows are 36px, because cards were rejected', () => {
    // RATIONALE §4: a card is a good container for one object read across a
    // room; forty-one of them is a wall. Every list here is a table.
    expect(USERS_CSS).toMatch(/--um-row-h:\s*36px/);
    expect(SESSIONS_CSS).toMatch(/--sp-row-h:\s*36px/);
  });
});
