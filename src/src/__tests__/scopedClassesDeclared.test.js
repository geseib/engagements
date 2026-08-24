/**
 * EVERY SCOPED CLASS THE MARKUP USES IS A CLASS THE STYLESHEET DECLARES.
 *
 * ── THE BUG ────────────────────────────────────────────────────────────────
 *
 * `CreateOrgDialog.jsx` opened its Modal with `overlayClassName="corg
 * corg-scrim"` and `CreateOrgDialog.css` never declared `.corg-scrim`.
 *
 * `Modal` puts that string on the backdrop element and applies NO styling of
 * its own — the caller owns the entire overlay: the fixed position, the inset,
 * the dark scrim, the centring, the z-index. With the class missing, the dialog
 * rendered as an ordinary unpositioned block at the end of the document. It was
 * in the DOM, it was focusable, and it was invisible.
 *
 * Reported from dev as "i dont get anything for pressing create and
 * organization button".
 *
 * ── WHY THE EXISTING TESTS COULD NOT SEE IT ────────────────────────────────
 *
 * jsdom has no layout engine. `createOrgDialog.test.jsx` asserts the request,
 * the validation, the refusal and both exits, and every one of them passed
 * against a dialog nobody could see — because all of them query the DOM, and
 * the DOM was fine. This repo's own rule says it out loud: no geometric
 * assertions, jsdom cannot answer them.
 *
 * What CAN be checked without a layout engine is whether the class exists at
 * all. That is a string-to-string question, and it catches the whole family:
 * a renamed class, a scrim that was never written, a stylesheet whose scope
 * prefix drifted from its component's.
 *
 * ── WHAT THIS DOES NOT CLAIM ───────────────────────────────────────────────
 *
 * That the declaration is CORRECT — only that it is there. A `.corg-scrim {}`
 * with nothing in it would satisfy this and still be invisible. It closes the
 * gap between "the markup names a class" and "the stylesheet has heard of it",
 * which is where this defect lived.
 */
const fs = require('fs');
const path = require('path');

const COMPONENTS = path.join(__dirname, '..', 'components');

/**
 * Every component that owns a paired stylesheet, with the scope prefix its
 * classes share. Listed rather than derived: the prefix is a deliberate choice
 * per surface (`.porgs`, `.corg`, `.pmode`), not a transform of the filename.
 */
const SURFACES = [
  ['CreateOrgDialog', 'corg'],
  ['PlatformOrgsPanel', 'porgs'],
  ['ActingAsBanner', 'pmode'],
  ['PendingInvites', 'pinv'],
  ['OrgSwitcher', 'orgsw'],
  ['TeamPanel', 'team'],
  ['BillingPanel', 'bill'],
  ['PrivacyPanel', 'priv'],
  ['UsageMeter', 'usg'],
];

/** Class names appearing in string literals and template literals in the JSX. */
function classesUsed(jsx, prefix) {
  const found = new Set();
  const pattern = new RegExp(`\\b${prefix}(?:-[a-z0-9]+)*\\b`, 'g');
  /* Only inside className / overlayClassName / contentClassName values, so a
     prefix mentioned in a comment or a doc-block is not mistaken for markup. */
  const attr = /(?:className|overlayClassName|contentClassName)\s*=\s*(?:"([^"]*)"|\{([^}]*)\})/g;
  for (const m of jsx.matchAll(attr)) {
    const value = m[1] || m[2] || '';
    for (const hit of value.matchAll(pattern)) found.add(hit[0]);
  }
  return [...found];
}

/** Class names the stylesheet declares, anywhere in a selector. */
function classesDeclared(css) {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, ' ');
  return new Set([...stripped.matchAll(/\.([a-z][a-z0-9-]*)/g)].map((m) => m[1]));
}

describe.each(SURFACES)('%s', (name, prefix) => {
  const jsxPath = path.join(COMPONENTS, `${name}.jsx`);
  const cssPath = path.join(COMPONENTS, `${name}.css`);

  // rejects: a suite that quietly checks nothing because a file moved or was
  // renamed — the failure mode that makes a green scan worthless.
  test('both files exist and the markup uses the scope prefix', () => {
    expect(fs.existsSync(jsxPath)).toBe(true);
    expect(fs.existsSync(cssPath)).toBe(true);
    const used = classesUsed(fs.readFileSync(jsxPath, 'utf8'), prefix);
    expect(used.length).toBeGreaterThan(0);
  });

  // rejects: THE DIALOG THAT DID NOT APPEAR — a class named in the markup that
  // the stylesheet has never heard of. Modal applies the caller's class and
  // nothing else, so a missing overlay class is a missing overlay.
  test('every scoped class it uses is declared in its stylesheet', () => {
    const used = classesUsed(fs.readFileSync(jsxPath, 'utf8'), prefix);
    const declared = classesDeclared(fs.readFileSync(cssPath, 'utf8'));
    const missing = used.filter((cls) => !declared.has(cls));
    expect(missing).toEqual([]);
  });
});

describe('the scan can actually fail', () => {
  /* The checks above prove they find nothing today. They cannot prove they
     would find something — a broken regex or an empty file list produces the
     same green. These run the real predicates over the real defect's shape. */

  // rejects: a matcher that stopped matching.
  test('it catches a class used and not declared', () => {
    const jsx = '<Modal overlayClassName="corg corg-scrim" contentClassName="corg-dialog" />';
    const css = '.corg { color: red; } .corg-dialog { width: 10px; }';
    const used = classesUsed(jsx, 'corg');
    const declared = classesDeclared(css);
    expect(used).toEqual(expect.arrayContaining(['corg', 'corg-scrim', 'corg-dialog']));
    expect(used.filter((c) => !declared.has(c))).toEqual(['corg-scrim']);
  });

  // rejects: reading class names out of prose. Every stylesheet here has a long
  // header naming its own classes, and a scan that counted those would flag
  // classes no markup uses.
  test('it ignores a prefix mentioned outside a className attribute', () => {
    const jsx = '/* .corg-ghost is documented here */ <div className="corg-real" />';
    expect(classesUsed(jsx, 'corg')).toEqual(['corg-real']);
  });

  // rejects: treating a commented-out rule as a declaration.
  test('it does not count a class declared only inside a CSS comment', () => {
    expect(classesDeclared('/* .corg-old {} */ .corg-new {}').has('corg-old')).toBe(false);
    expect(classesDeclared('/* .corg-old {} */ .corg-new {}').has('corg-new')).toBe(true);
  });
});
