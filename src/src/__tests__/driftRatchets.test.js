/**
 * THE DRIFT RATCHETS (docs/design/experience-plan/PLAN.md §5.3, Phase 0).
 *
 * Four of the plan's guards, so the visual system and the names cannot drift back while
 * Phases 1-5 move surfaces onto them. Each counts one kind of drift per file and holds it
 * to the number src/src/testing/driftAllowances.js records, in both directions, like the
 * skins gate (skinLiteralsPalette.test.js, which is guard 1, colour literals):
 *   count > allowance  ->  fail: "N new <thing> in X", each with its line, and the fix
 *   count < allowance  ->  fail: "lower X's allowance to N", so an allowance never goes stale
 *
 *   Browser dialogs  alert( / confirm( / window.alert( / window.confirm( calls
 *   Close glyph      a JSX element whose whole text is × or ✕ (<button>×</button>)
 *   Button classes   a stylesheet's *btn*--primary / *-btn-primary classes, per file; and
 *                    the total of button class FAMILIES across all stylesheets (a family
 *                    is a class name up to its first btn/button word: .qsets-btn--primary
 *                    and .qsets-btn-ghost are both family qsets-btn; driftScan.js)
 *   Banned words     PLAN §3.6's replaced labels in JSX text and words/config files, per
 *                    file per label. Allowed: tests, code comments, code-only strings
 *                    (class names, comparisons, console), and help's "what changed"
 *                    notes (text that says "used to be called", "renamed", "formerly"…)
 *
 * What counts is src/src/testing/driftScan.js, the same scanner `node
 * scripts/drift-baselines.js` prints today's numbers with. After a merge that lowers
 * counts: `node scripts/drift-baselines.js --module > src/src/testing/driftAllowances.js`.
 *
 * What green means: nothing new of these kinds appeared and no allowance is stale. It
 * does NOT mean a surface uses the system; only that it drifted no further.
 */
const D = require('../testing/driftScan');
const A = require('../testing/driftAllowances');

const JS = D.jsFiles();
const CSS = D.cssFiles();

/** test.each rows: every file with a count or an allowance, so stale entries are caught too. */
function rows(counts, allowances) {
  const files = new Set([...Object.keys(counts), ...Object.keys(allowances || {})]);
  const out = [...files].sort().map((f) => [f]);
  // A guard at zero (close glyphs since experience plan 5b) still runs one row,
  // which fails the moment any file gains one: jest refuses an empty table.
  return out.length ? out : [['(no file has any)']];
}
function expectRatchet(opts) {
  const problems = D.ratchet(opts);
  if (problems.length) throw new Error(problems.join('\n\n'));
}

/* ---------------------------------------------------- browser dialogs ---- */

describe('browser dialogs: alert/confirm calls only ever fall', () => {
  const found = {};
  for (const r of JS) {
    const f = D.scanDialogs(D.read(r), r);
    if (f.length) found[r] = f;
  }
  const FIX = 'say it on the page instead. A message or failure: <StatusMessage> (components/StatusMessage.jsx) or the surface\'s own status line. '
    + 'A decision: <ConfirmDialog> (components/ConfirmDialog.jsx) or press-twice-in-place (host standards §3). '
    + 'A browser dialog stops the page and, on one screen, lands on the projector (PLAN §5.1, audit B §2.3 #8).';
  const list = rows(found, A.dialogs);
  test.each(list)('%s', (r) => {
    expectRatchet({ file: r, found: found[r] || [], allowed: A.dialogs[r], what: 'browser dialog call(s)', fix: FIX, allowanceKey: 'dialogs' });
  });
  test('the guard can fail: a planted window.confirm is reported with its line and the fix', () => {
    const src = 'function go() {\n  if (window.confirm("Sure?")) alert("done");\n}\n';
    const f = D.scanDialogs(src, 'fixture.jsx');
    expect(f.map((x) => x.literal)).toEqual(['window.confirm(', 'alert(']);
    const msg = D.ratchet({ file: 'fixture.jsx', found: f, allowed: 1, what: 'browser dialog call(s)', fix: FIX, allowanceKey: 'dialogs' }).join('');
    expect(msg).toMatch(/1 new browser dialog call\(s\) in fixture\.jsx[\s\S]*line 2[\s\S]*StatusMessage[\s\S]*ConfirmDialog/);
  });
  test('a confirm the file defines itself, and someone.confirm(), are not the browser\'s', () => {
    const src = 'const confirm = useConfirm();\nconfirm("x");\napi.confirm(1);\nconst o = { alert: 1 };\n';
    expect(D.scanDialogs(src, 'fixture.jsx')).toEqual([]);
  });
});

/* -------------------------------------------------------- close glyph ---- */

describe('close glyph: a text × or ✕ close only ever falls', () => {
  const found = {};
  for (const r of JS.filter((x) => x.endsWith('.jsx'))) {
    const f = D.scanCloseGlyphs(D.read(r), r);
    if (f.length) found[r] = f;
  }
  const FIX = 'use <Icon name="X" /> (components/Icon.jsx) with aria-label="Close" on the button, or the shared Modal\'s own close (PLAN §5.1: "Close: Icon name=X, always").';
  test.each(rows(found, A.closeGlyphs))('%s', (r) => {
    expectRatchet({ file: r, found: found[r] || [], allowed: A.closeGlyphs[r], what: 'text close glyph(s)', fix: FIX, allowanceKey: 'closeGlyphs' });
  });
  test('the guard can fail: ×, ✕, &times; and {"×"} alone count; "2 × 3" does not', () => {
    const src = [
      'const a = <button aria-label="Close">×</button>;',
      'const b = <button>\n  ✕\n</button>;',
      'const c = <span>&times;</span>;',
      "const d = <button>{'×'}</button>;",
      'const e = <p>2 × 3</p>;',
    ].join('\n');
    const f = D.scanCloseGlyphs(src, 'fixture.jsx');
    expect(f.map((x) => x.line)).toEqual([1, 2, 5, 6]);
    expect(D.ratchet({ file: 'fixture.jsx', found: f, allowed: 4, what: 'text close glyph(s)', fix: FIX, allowanceKey: 'closeGlyphs' })).toEqual([]);
    expect(D.ratchet({ file: 'fixture.jsx', found: f, allowed: 3, what: 'text close glyph(s)', fix: FIX, allowanceKey: 'closeGlyphs' }).join('')).toMatch(/Icon name="X"/);
  });
});

/* ----------------------------------------------------- button classes ---- */

describe('button classes: no new scoped primary, and the families only ever fall', () => {
  const primaries = {};
  const families = new Map(); // family -> first stylesheet declaring it
  for (const r of CSS) {
    const { primaries: p, families: f } = D.scanButtonClasses(D.read(r));
    if (p.length) primaries[r] = p;
    for (const fam of f) if (!families.has(fam)) families.set(fam, r);
  }
  const FIX = 'use the shared <Button> (components/ui/Button.jsx: variant="action" for the one main action, "quiet" or "accent" otherwise) and delete the scoped class, instead of declaring a new one (PLAN §5.1).';
  test.each(rows(primaries, A.primaryButtons))('%s', (r) => {
    expectRatchet({ file: r, found: primaries[r] || [], allowed: A.primaryButtons[r], what: 'primary button class(es)', fix: FIX, allowanceKey: 'primaryButtons' });
  });
  test('the total of button class families does not rise, and the allowance is not stale', () => {
    const have = families.size;
    const known = new Set(A.buttonFamilyNames || []);
    if (have > A.buttonFamilies) {
      const fresh = [...families].filter(([f]) => !known.has(f)).map(([f, r]) => `    .${f}  (${r})`);
      throw new Error(`${have - A.buttonFamilies} new button class famil${have - A.buttonFamilies === 1 ? 'y' : 'ies'} (allowance buttonFamilies=${A.buttonFamilies}, found ${have}). Not in the recorded list:\n${fresh.join('\n')}\n  fix: ${FIX}`);
    }
    if (have < A.buttonFamilies) {
      throw new Error(`lower buttonFamilies to ${have} in src/src/testing/driftAllowances.js (it says ${A.buttonFamilies}). Run: node scripts/drift-baselines.js --module > src/src/testing/driftAllowances.js`);
    }
  });
  test('the guard can fail: families and primaries are read from selectors only', () => {
    const css = '/* .ghost-btn--primary in a comment */\n.qsets-btn { x: 1 }\n.qsets-btn--primary, .qsets-btn-ghost:hover { x: 1 }\n.host-btn-primary { x: 1 }\n@media (min-width: 40.5em) { .start-button-row { x: 1 } }\n.card { margin: .5rem }\n';
    const { families: f, primaries: p } = D.scanButtonClasses(css);
    expect(f).toEqual(['host-btn', 'qsets-btn', 'start-button']);
    expect(p.map((x) => x.literal)).toEqual(['.qsets-btn--primary', '.host-btn-primary']);
    expect(D.ratchet({ file: 'fixture.css', found: p, allowed: 1, what: 'primary button class(es)', fix: FIX, allowanceKey: 'primaryButtons' }).join('')).toMatch(/1 new primary button class\(es\) in fixture\.css[\s\S]*line 4[\s\S]*\.host-btn-primary[\s\S]*components\/ui\/Button\.jsx/);
  });
});

/* ------------------------------------------------------- banned words ---- */

describe('banned words: PLAN §3.6\'s replaced labels only ever fall', () => {
  const found = {};
  for (const r of JS.filter(D.isWordsFile)) {
    const f = D.scanBannedWords(D.read(r), r);
    if (f.length) found[r] = f;
  }
  const labels = new Set(D.BANNED_WORDS.map((w) => w.not));
  const cells = [];
  for (const r of new Set([...Object.keys(found), ...Object.keys(A.bannedWords)])) {
    const have = D.bannedCounts(found[r] || []);
    for (const label of new Set([...Object.keys(have), ...Object.keys(A.bannedWords[r] || {})])) cells.push([r, label]);
  }
  cells.sort((a, b) => (a[0] + a[1]).localeCompare(b[0] + b[1]));
  const FIX = (say) => `say "${say}" (PLAN §3.6 "Names, once"). Running words belong in a words file (config/*Words.js). `
    + 'Naming an old label to say it changed is allowed: write "used to be called …" or "renamed".';
  test.each(cells)('%s: "%s"', (r, label) => {
    expect(labels.has(label)).toBe(true); // an allowance for a label no longer banned is stale
    const f = (found[r] || []).filter((x) => x.not === label);
    const allowed = (A.bannedWords[r] || {})[label];
    const say = D.BANNED_WORDS.find((w) => w.not === label).say;
    expectRatchet({ file: `${r} "${label}"`, found: f, allowed, what: `use(s) of "${label}"`, fix: FIX(say), allowanceKey: `bannedWords["${r}"]["${label}"]` });
  });
  test('the guard can fail: JSX text and labels count; comments, class names, comparisons and "what changed" notes do not', () => {
    const src = [
      '// Back to Menu in a comment',
      'const a = <button>Back to Menu</button>;',
      "const b = <h2>{open ? 'Settings' : 'Session tools'}</h2>;",
      "const c = <div className=\"session-setup\" data-x={phase === 'Results'} />;",
      "const d = { text: 'The Session menu used to be called SESSION.' };",
      "const e = <p title=\"Open the big screen\">Players</p>;",
      "console.log('Back to menu pressed');",
      "const f = 'SETTINGS';",
    ].join('\n');
    const f = D.scanBannedWords(src, 'fixture.jsx');
    expect(f.map((x) => `${x.line} ${x.not}`)).toEqual(['2 Back to Menu', '3 Settings', '3 Session tools', '6 big screen', '6 Players']);
    const one = f.filter((x) => x.not === 'Back to Menu');
    expect(D.ratchet({ file: 'fixture.jsx "Back to Menu"', found: one, allowed: 0, what: 'use(s) of "Back to Menu"', fix: FIX('Main menu'), allowanceKey: 'x' }).join('')).toMatch(/1 new use\(s\) of "Back to Menu"[\s\S]*line 2[\s\S]*say "Main menu"/);
  });
});

/* ------------------------------------------------------ the ratchet ---- */

describe('the ratchet asks for a stale allowance to be lowered, and names where it lives', () => {
  test('below the allowance', () => {
    const msg = D.ratchet({ file: 'X.jsx', found: [{ line: 1, literal: 'alert(' }], allowed: 3, what: 'x', fix: 'y', allowanceKey: 'dialogs' }).join('');
    expect(msg).toMatch(/lower X\.jsx's allowance to 1 in src\/src\/testing\/driftAllowances\.js → dialogs \(it says 3\)/);
  });
  test('at zero, the entry is removed', () => {
    const msg = D.ratchet({ file: 'X.jsx', found: [], allowed: 2, what: 'x', fix: 'y', allowanceKey: 'dialogs' }).join('');
    expect(msg).toMatch(/remove X\.jsx from src\/src\/testing\/driftAllowances\.js → dialogs/);
  });
});
