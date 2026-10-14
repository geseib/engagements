/**
 * THE MEMBERS SCREEN'S CSS CONTRACT — components/TeamPanel.css.
 *
 * jest maps CSS to identity-obj-proxy and jsdom resolves no custom property
 * across files, so the only honest way to pin a design contract here is to read
 * the stylesheet AS TEXT and do the arithmetic on it. The compositing walk
 * below is lifted verbatim from docs/design/admin-redesign/audit.html, which is
 * where every other *Palette test in this repo got it.
 *
 * THE FILE IS NAMED `*Palette` AND NOT `*Token*` ON PURPOSE. `.gitignore:35` is
 * an unanchored `*token*`: a file named teamPanelTokens.test.js runs locally,
 * passes, and never reaches CI. Do not rename it back.
 *
 * WHAT GREEN MEANS HERE: the contrast arithmetic holds and the geometry rules
 * that jsdom cannot see have not been reverted. It cannot prove the screen is
 * readable on a real panel — only a real panel can.
 */
const fs = require('fs');
const path = require('path');
const H = require('../testing/skinHarness');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const GLOBAL_CSS = require('../testing/classicGlobalCss')();
const MY_CSS = read('components', 'TeamPanel.css');
const MY_JSX = read('components', 'TeamPanel.jsx');

/* ---- colour: the audit's lin/lum/ratio/alphaOver/bgOf (docs/design/admin-redesign/
        audit.html) live verbatim in testing/skinHarness.js; H.on / H.composite are its
        bgOf as arithmetic, so a role value written `rgb(r g b / a)` composites without
        jsdom having to parse it. ---- */

/* ---- tokens, READ rather than retyped: change a token and these numbers move */
const CLASSIC_DUSK = { skin: 'classic', theme: 'dark' };
/** A scope-local token with every var() it reads resolved for one skin x theme. */
function token(css, block, name, opts = CLASSIC_DUSK) {
  return H.scopeVar(css, block, name, opts);
}
function tint(name, opts = CLASSIC_DUSK) {   // a translucent layer from MY_CSS's .team block
  const v = token(MY_CSS, '.team {', name, opts);
  if (!(H.parseColor(v).a < 1)) throw new Error(`${name} in TeamPanel.css is not a translucent tint`);
  return v;
}
/** Colour equality tolerant to spelling: rgb channels, alpha to 3 dp. */
const norm = (c) => {
  const p = H.parseColor(c);
  return { rgb: p.rgb.map((n) => Math.round(n)), a: Math.round(p.a * 1000) / 1000 };
};

const palette = (opts) => ({
  bg: H.role('--bg', opts),
  surface: H.role('--surface', opts),
  surface2: H.role('--surface-2', opts),
  text: H.role('--text', opts),
  muted: H.role('--muted', opts),
  primary: H.role('--primary', opts),
  danger: H.role('--danger', opts),
  dangerText: H.role('--danger-text', opts),
  dangerDeep: H.role('--danger-deep', opts),
  successText: token(MY_CSS, '.team {', '--team-success-text', opts),
});

const on = (fg, layers) => H.on(fg, layers);
const AA = H.AA;
const DUSK_CASES = H.CASES.filter(([, t]) => t === 'dark');

function block(css, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`(^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`, 'm'));
  if (!match) throw new Error(`No rule for "${selector}" — renamed?`);
  return match[2];
}

const stripped = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

/* ========================================================================== */

describe('Classic stays pinned: the .team block resolves to what it used to spell out', () => {
  test.each([
    ['--team-success-text', '#6FD0A4'],
    ['--team-rule', 'rgba(155, 168, 190, .20)'],
    ['--team-rule-strong', 'rgba(155, 168, 190, .34)'],
    ['--team-row-hover', 'rgba(155, 168, 190, .055)'],
    ['--team-tint-warn', 'rgba(246, 169, 76, .06)'],
    ['--team-tint-danger', 'rgba(229, 100, 94, .09)'],
    ['--team-tint-ok', 'rgba(79, 178, 134, .10)'],
  ])('%s in Classic / dark is %s', (name, literal) => {
    expect(norm(token(MY_CSS, '.team {', name))).toEqual(norm(literal));
  });
});

describe.each(DUSK_CASES)('%s / %s', (skin, theme) => {
  const opts = { skin, theme };
  const T = palette(opts);
  const FIELD = [T.bg];              // AdminShell's work body under a dark section
  const PANEL = [T.bg, T.surface];   // the invitations panel, and the dialogs

  describe('the flat pairings this screen paints', () => {
    // rejects: any token swap that makes a control unreadable on the surface it
    // is actually painted on — the Question sets tab shipped at 1.4:1 this way.
    const pairs = [
      ['names and row values on the work field', T.text, FIELD],
      ['emails, dates and column heads on the work field', T.muted, FIELD],
      ['the expiry warning on the work field', T.primary, FIELD],
      ['Revoke and Remove on the work field', T.dangerText, FIELD],
      ['panel copy on the invitations panel', T.text, PANEL],
      ['the panel note and the lock reason on the panel', T.muted, PANEL],
      ['the Owner chip on the panel', T.primary, PANEL],
      ['the "invitation sent" line on the panel', T.successText, PANEL],
      ['Invite someone, filled', T.bg, [T.primary]],
      ['the filled destructive button', T.text, [T.dangerDeep]],
      ['avatar initials on --surface-2', T.text, [T.bg, T.surface2]],
    ];
    test.each(pairs)('%s clears AA', (_label, fg, layers) => {
      expect(on(fg, layers)).toBeGreaterThanOrEqual(AA);
    });
  });

  describe('the tinted composites — the half a token table cannot show', () => {
    // rejects: deepening a tint until the text on it drops under AA. Every stack
    // below is the real nesting the markup produces.
    const t = (name) => tint(name, opts);
    test('the live invitations panel header, tinted amber', () => {
      expect(on(T.text, [T.bg, T.surface, t('--team-tint-warn')])).toBeGreaterThanOrEqual(AA);
      expect(on(T.muted, [T.bg, T.surface, t('--team-tint-warn')])).toBeGreaterThanOrEqual(AA);
    });
    test('the error alert on the work field and inside a dialog', () => {
      expect(on(T.dangerText, [T.bg, t('--team-tint-danger')])).toBeGreaterThanOrEqual(AA);
      expect(on(T.dangerText, [T.bg, T.surface, t('--team-tint-danger')])).toBeGreaterThanOrEqual(AA);
    });
    test('the success alert on the work field and inside a dialog', () => {
      expect(on(T.successText, [T.bg, t('--team-tint-ok')])).toBeGreaterThanOrEqual(AA);
      expect(on(T.successText, [T.bg, T.surface, t('--team-tint-ok')])).toBeGreaterThanOrEqual(AA);
    });
    test('a hovered row, on the field and inside the panel', () => {
      expect(on(T.text, [T.bg, t('--team-row-hover')])).toBeGreaterThanOrEqual(AA);
      expect(on(T.muted, [T.bg, t('--team-row-hover')])).toBeGreaterThanOrEqual(AA);
      expect(on(T.text, [T.bg, T.surface, t('--team-row-hover')])).toBeGreaterThanOrEqual(AA);
      expect(on(T.muted, [T.bg, T.surface, t('--team-row-hover')])).toBeGreaterThanOrEqual(AA);
    });
    test('the standing note box, which is a row-hover tint carrying muted copy', () => {
      expect(on(T.muted, [T.bg, t('--team-row-hover')])).toBeGreaterThanOrEqual(AA);
    });
  });

  test('the premise of "--danger never carries text": --danger is under AA on --surface', () => {
    expect(H.ratio(T.danger, T.surface)).toBeLessThan(AA);
  });
});

describe('the rules that are about what must NOT be there', () => {
  // rejects: `color: var(--danger)` creeping in. It is 4.38:1 on --surface —
  // under AA — which is the whole reason --danger-text exists.
  test('--danger never carries text here', () => {
    // The premise (--danger under AA on --surface) is asserted per skin above.
    const offenders = MY_CSS.split('\n')
      .filter((line) => /(^|[^-])\bcolor\s*:\s*var\(--danger\)/.test(line));
    expect(offenders).toEqual([]);
  });

  // rejects: a paper-theme literal pasted in from the mockup. Comments are
  // stripped first — a previous test in this repo passed on prose in a header.
  test('no hex literal survives outside the token block', () => {
    const declarations = stripped(MY_CSS);
    const literals = [...declarations.matchAll(/(?:^|[\s:])(#[0-9A-Fa-f]{3,8})\b/g)].map((m) => m[1]);
    // #6FD0A4 was this scope's own --success-text before the roles existed (it
    // is var(--success-text) now) and #FFBB66 is the hover lift of --primary.
    // Both are named, both have a comment in the stylesheet saying why.
    const allowed = ['#6FD0A4', '#FFBB66'];
    expect(literals.filter((h) => !allowed.includes(h.toUpperCase()))).toEqual([]);
  });

  // rejects: a var() typo, or borrowing a token from a stylesheet that merely
  // happens to be in the bundle. An undefined custom property invalidates the
  // WHOLE declaration, so the failure is silent and total.
  test('every custom property the stylesheet uses is declared somewhere', () => {
    const declared = new Set();
    for (const css of [GLOBAL_CSS, MY_CSS, read('components', 'AdminShell.css')]) {
      for (const m of css.matchAll(/(--[a-z0-9-]+)\s*:/gi)) declared.add(m[1]);
    }
    const used = [...MY_CSS.matchAll(/var\((--[a-z0-9-]+)/gi)].map((m) => m[1]);
    expect([...new Set(used)].filter((name) => !declared.has(name))).toEqual([]);
  });
});

describe('the namespace, both ways', () => {
  const roots = () => {
    const out = new Set();
    for (const blk of stripped(MY_CSS).split('}')) {
      const head = blk.split('{')[0];
      if (!head || head.includes('@')) continue;
      for (const sel of head.split(',')) {
        const m = sel.trim().match(/^[a-zA-Z]*\.([\w-]+)/);
        if (m) out.add(m[1]);
      }
    }
    return [...out];
  };

  // rejects: a bare .btn / .chip / .modal / .form-group declared from a
  // component stylesheet. UserManagement.css used to hand six of those to every
  // screen that imported later.
  test('every selector is rooted at the .team scope class', () => {
    expect(roots().filter((name) => !name.startsWith('team'))).toEqual([]);
  });

  // rejects: the `.qs` collision one polarity over — styles.css already owning
  // a prefix this screen assumes is its own.
  test('styles.css declares nothing in this scope', () => {
    const global = [...stripped(GLOBAL_CSS).matchAll(/\.(team[\w-]*)/g)].map((m) => m[1]);
    expect([...new Set(global)]).toEqual([]);
  });
});

describe('the ladder', () => {
  const LADDER = { floor: '12px', label: '13px', body: '15px', head: '19px' };
  // rejects: a ladder step quietly moved off the one derived for a laptop at
  // 24in. The stage's four ladders must not be imported here.
  test.each(Object.entries(LADDER))('--team-t-%s is %s', (step, value) => {
    expect(MY_CSS).toMatch(new RegExp(`--team-t-${step}:\\s*${value}`));
  });

  // rejects: anything under the 12px floor.
  test('nothing is declared below the 12px floor', () => {
    const px = [...MY_CSS.matchAll(/font-size:\s*(\d+)px/g)].map((m) => Number(m[1]));
    expect(px.filter((n) => n < 12)).toEqual([]);
  });

  // rejects: cards. 41 of them is a wall; rows are 36px.
  test('rows are 36px, because cards were rejected', () => {
    expect(MY_CSS).toMatch(/--team-row-h:\s*36px/);
  });

  // rejects: a 13px input feeding a 15px table — illegible exactly where a
  // mistake is most expensive (RATIONALE §3.2).
  test('the input renders at body size, not at label size', () => {
    expect(block(MY_CSS, '.team-input')).toMatch(/font:[^;]*var\(--team-t-body\)/);
  });
});

describe('the geometry contracts jsdom cannot see', () => {
  // rejects: `justify-content: flex-end` inside an overflow:hidden cell.
  // Flex-end overflows towards the START of the row, where a hidden overflow is
  // unreachable — that is how Edit and Rename were clipped on their left edge.
  test('row actions right-align with margin-left:auto and wrap', () => {
    const group = block(MY_CSS, '.team-rowact');
    expect(group).not.toMatch(/justify-content/);
    expect(group).toMatch(/flex-wrap:\s*wrap/);
    expect(MY_CSS).toMatch(/\.team-rowact\s*>\s*:first-child\s*\{[^}]*margin-left:\s*auto/);
  });

  // rejects: auto table layout, under which declared widths are hints and one
  // nowrap chip sets a min-content width that grows the whole table.
  test('the table is table-layout: fixed', () => {
    expect(block(MY_CSS, '.team-tbl')).toMatch(/table-layout:\s*fixed/);
  });

  // rejects: an action column too narrow for its widest pair. "Make member" +
  // "Remove" does not fit in a tenth of the table; the slack comes out of the
  // person column, which ellipsizes and degrades gracefully.
  test('each table\'s columns sum to 100% with a wide action column', () => {
    const width = (sel) => Number(block(MY_CSS, sel).match(/width:\s*(\d+)%/)[1]);
    const invites = ['.team-col-email', '.team-col-irole', '.team-col-sent', '.team-col-iacts'];
    const roster = ['.team-col-person', '.team-col-role', '.team-col-joined', '.team-col-acts'];
    expect(invites.reduce((sum, sel) => sum + width(sel), 0)).toBe(100);
    expect(roster.reduce((sum, sel) => sum + width(sel), 0)).toBe(100);
    expect(width('.team-col-acts')).toBeGreaterThanOrEqual(26);
    expect(width('.team-col-iacts')).toBeGreaterThanOrEqual(20);
  });

  // rejects: a truncating element built as a flex container with span children.
  // `text-overflow` is inert there and the text is silently cut instead.
  test('the truncating cells are single text nodes with min-width:0', () => {
    for (const sel of ['.team-nm', '.team-sub']) {
      const rule = block(MY_CSS, sel);
      expect(rule).toMatch(/min-width:\s*0/);
      expect(rule).toMatch(/text-overflow:\s*ellipsis/);
      expect(rule).not.toMatch(/display:\s*flex/);
    }
  });

  // rejects: truncating "11 days ago · expires in 3". Cutting that cell ate the
  // half that prompts action — tenancy RATIONALE, and the reason this cell
  // wraps instead.
  test('the sent cell is never truncated', () => {
    const rule = block(MY_CSS, '.team-when');
    expect(rule).not.toMatch(/text-overflow/);
    expect(rule).not.toMatch(/white-space:\s*nowrap/);
  });

  // rejects: `align-items: center` on a scrolling scrim. It overflows in BOTH
  // directions and only one of them is reachable. This bug has recurred four
  // times in this repo.
  test('the scrim scrolls and does not centre with the flex container', () => {
    const scrim = block(MY_CSS, '.team-scrim');
    expect(scrim).toMatch(/overflow-y:\s*auto/);
    expect(scrim).toMatch(/align-items:\s*flex-start/);
    expect(scrim).not.toMatch(/align-items:\s*center/);
    expect(scrim).toMatch(/padding:\s*\S+/);
  });
  test('the dialog still centres itself while it fits', () => {
    expect(MY_CSS).toMatch(/\.team-scrim\s*>\s*\*\s*\{[^}]*margin:\s*auto/);
  });
});

describe('the theme travels with the markup', () => {
  // rejects: relying on an ancestor's contentTheme. public/index.html puts
  // data-theme="light" on <html>, so a dusk surface that inherits its theme
  // renders paper tokens under dusk copy — 1.4:1, the exact defect the Question
  // sets tab shipped with.
  test('the root element declares data-theme="dark" itself', () => {
    expect(MY_JSX).toMatch(/className="team"\s+data-theme="dark"/);
  });

  // rejects: a dialog rendered outside the scope, which would resolve --team-*
  // against nothing and lose every declaration that uses one.
  test('both dialog overlays carry the scope class as well as the scrim', () => {
    const overlays = [...MY_JSX.matchAll(/overlayClassName="([^"]*)"/g)].map((m) => m[1]);
    expect(overlays.length).toBeGreaterThanOrEqual(2);
    for (const value of overlays) expect(value).toBe('team team-scrim');
  });
});
