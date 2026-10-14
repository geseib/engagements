/**
 * `.ui-row` (components/ui/Row.css, unit L11): hover and selected states for a row.
 *
 * Reads the stylesheet as TEXT and resolves the roles it reads through the skin
 * harness, for every skin x theme. jsdom loads no stylesheet and has no layout,
 * so green means "the contract has not been reverted", not "it looks right":
 * the gallery (#gallery-ui-row) is where it is looked at.
 *
 * Named *Palette.test.js, never *token* (.gitignore:35).
 */
const fs = require('fs');
const path = require('path');
const React = require('react');
const { render } = require('@testing-library/react');
const H = require('../testing/skinHarness');
const S = require('../testing/skinScan');

const ROW_CSS = fs.readFileSync(path.join(__dirname, '..', 'components', 'ui', 'Row.css'), 'utf8');
const strip = (css) => css.replace(/\/\*[\s\S]*?\*\//g, ' ');
const BODY = strip(ROW_CSS);

/** [{ selectors: string[], decls: [[prop, value]] }] for every top-level rule. */
function rules(css) {
  const out = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(css))) {
    out.push({
      selectors: m[1].split(',').map((s) => s.trim()).filter(Boolean),
      decls: m[2].split(';').map((d) => d.trim()).filter(Boolean).map((d) => {
        const i = d.indexOf(':');
        return [d.slice(0, i).trim(), d.slice(i + 1).trim()];
      }),
    });
  }
  return out;
}
const RULES = rules(BODY);
const reads = [...new Set([...BODY.matchAll(/var\((--[\w-]+)/g)].map((m) => m[1]))].sort();

describe('Row.css is a skin-clean, state-only mixin', () => {
  test('no colour literal, no font family, no --primary/--secondary, and no pragma needed', () => {
    const { counts } = S.scanCss(ROW_CSS);
    expect(S.gateCounts(counts)).toEqual({ colour: 0, font: 0, primary: 0 });
    expect(S.filePragma(ROW_CSS)).toBeNull();
  });

  test('reads exactly the three row roles, and never a --sk-* value', () => {
    expect(reads).toEqual(['--row-hover', '--row-selected', '--select-mark']);
    expect(BODY).not.toMatch(/--sk-/);
  });

  // rejects: a "state" class that also sets padding, height or a border, which
  //          would move boxes on every surface that adopts it (SPEC §1 non-goal).
  test('declares only background and box-shadow: it paints state, never layout', () => {
    const props = new Set(RULES.flatMap((r) => r.decls.map(([p]) => p)));
    expect([...props].sort()).toEqual(['background', 'box-shadow']);
  });

  test('every selector is rooted in .ui-row, and no shared sheet declares .ui-row', () => {
    for (const r of RULES) for (const s of r.selectors) expect(s).toMatch(/^(tr)?\.ui-row[\s\S]*/);
    for (const shared of ['styles.css', 'styles/stage.css', 'styles/roles.css']) {
      const text = strip(fs.readFileSync(path.join(__dirname, '..', shared), 'utf8'));
      expect(text).not.toMatch(/\.ui-row\b/);
    }
  });

  // rejects: a hover grey painted over the selected tint under the pointer.
  test('the hover rule excludes every selected state', () => {
    const hover = RULES.find((r) => r.selectors.some((s) => s.includes(':hover')));
    for (const s of hover.selectors) {
      expect(s).toContain(':not(.is-selected)');
      expect(s).toContain(':not([aria-selected="true"])');
      expect(s).toContain(':not([aria-current])');
    }
  });

  // rejects: a translucent tint laid down twice (on the <tr> AND its cells), which
  //          darkens the row past the measured value; and a select mark on every cell.
  test('a <tr> paints its cells, anything else paints itself, and the mark sits on the first cell only', () => {
    for (const r of RULES) {
      for (const s of r.selectors) {
        if (s.startsWith('tr.')) expect(s).toMatch(/> (td|th|:first-child)$/);
        else expect(s).toMatch(/:not\(tr\)/);
      }
    }
    const mark = RULES.find((r) => r.decls.some(([p]) => p === 'box-shadow'));
    for (const s of mark.selectors.filter((x) => x.startsWith('tr.'))) expect(s).toMatch(/> :first-child$/);
  });

  test('each selected form is covered: .is-selected, aria-selected, aria-current', () => {
    const selected = RULES.find((r) => r.decls.some(([p, v]) => p === 'background' && v === 'var(--row-selected)'));
    const all = selected.selectors.join('\n');
    expect(all).toContain('.is-selected');
    expect(all).toContain('[aria-selected="true"]');
    expect(all).toContain('[aria-current]:not([aria-current="false"])');
  });
});

describe('the select mark is Present\'s, and Classic has none', () => {
  test('Classic: no mark (today\'s rows carry none)', () => {
    for (const theme of H.THEMES) expect(H.role('--select-mark', { skin: 'classic', theme })).toBe('none');
  });
  const present = H.CASES.filter(([s]) => s === 'present');
  if (present.length) {
    test.each(present)('%s / %s: an inset accent bar on the leading edge', (skin, theme) => {
      expect(H.role('--select-mark', { skin, theme })).toBe(`inset 3px 0 0 ${H.role('--accent', { skin, theme })}`);
    });
  }
});

describe.each(H.CASES)('%s / %s: copy on a hovered or selected row clears AA', (skin, theme) => {
  const r = (n) => H.role(n, { skin, theme });
  const grounds = ['--bg', '--surface'];
  const states = ['--row-hover', '--row-selected'];

  test.each(grounds.flatMap((g) => states.map((st) => [g, st])))('%s + %s', (ground, state) => {
    for (const fg of ['--text', '--muted', '--accent-text']) {
      const ratio = H.on(r(fg), [r(ground), r(state)]);
      if (ratio < H.AA) throw new Error(`${fg} on ${ground} + ${state} = ${ratio.toFixed(2)} (${skin}/${theme})`);
    }
  });

  test('--text on --surface-2 + either state', () => {
    for (const st of states) expect(H.on(r('--text'), [r('--surface-2'), r(st)])).toBeGreaterThanOrEqual(H.AA);
  });

  // Status copy in a row (a "Live" or "Failed" cell). Classic paper's --success-text
  // and --danger-text are the dusk tints, under AA on paper today (records/0a.md,
  // CLASSIC AMENDMENTS 2-3): not this component's to fix, so skipped there only.
  test('status copy on --bg and --surface + either state', () => {
    if (skin === 'classic' && theme === 'light') return;
    for (const g of grounds) {
      for (const st of states) {
        for (const fg of ['--success-text', '--danger-text']) {
          expect(H.on(r(fg), [r(g), r(st)])).toBeGreaterThanOrEqual(H.AA);
        }
      }
    }
  });
});

describe('the gallery fixture', () => {
  test('renders every selected form in dusk and paper with no colour literal', () => {
    const Fixture = require('../components/ui/fixtures/Row').default;
    const html = render(React.createElement(Fixture)).container.innerHTML;
    expect(html).toContain('data-theme="dark"');
    expect(html).toContain('data-theme="light"');
    expect(html).toMatch(/class="ui-row" aria-selected="true"/);
    expect(html).toMatch(/class="ui-row"[^>]*aria-current="page"/);
    expect(html).toContain('class="ui-row is-selected"');
    const src = fs.readFileSync(path.join(__dirname, '..', 'components', 'ui', 'fixtures', 'Row.jsx'), 'utf8');
    expect(S.scanJsx(src).findings).toEqual([]);
  });
});
