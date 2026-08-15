/**
 * THE PROMPT ADMIN STYLESHEET IS NAMESPACED, AND NOTHING GOT ORPHANED DOING IT.
 *
 * `components/AIPromptManager.css` used to declare roughly thirty BARE class
 * names at the whole application — `.btn-primary`, `.btn-secondary`,
 * `.status-badge`, `.form-group`, `.form-actions`, `.tag`, `.empty-state`,
 * `.loading-spinner`, `.modal-header`, `.modal-body`, `.close-button`,
 * `.search-input`, `.form-row`, `.section-description` and more. Every one
 * painted screens the file has never heard of, and which declaration won was
 * decided by webpack's injection order rather than by anybody. `.modal-overlay`
 * and `.modal-content` were the fifth instance of that fault; the guard against
 * those two lives in `modalReachability.test.js`, and this file is the general
 * case.
 *
 * WHY BOTH HALVES ARE HERE. Renaming a scope across a 2,000-line stylesheet is
 * exactly where a selector gets orphaned: the CSS reads beautifully, every rule
 * is namespaced, and one panel silently renders unstyled because the class it
 * waits for no longer appears in any JSX. So this asserts the namespace AND
 * that the markup still carries what the stylesheet now expects — in both
 * directions.
 *
 * WHAT GREEN MEANS. jest maps CSS to `identity-obj-proxy` and loads no
 * stylesheet, so no component test in this repo can see a namespace collision
 * or a dead selector at all; the collision exists only in the bundle. Green
 * here means the text of the stylesheet and the text of its consumers still
 * agree. It does not mean the screen looks right — only a browser says that.
 */
const fs = require('fs');
const path = require('path');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const CSS = read('components', 'AIPromptManager.css');
const GLOBAL_CSS = read('styles.css');

/**
 * Every file that renders markup this stylesheet paints. AdminPage is in the
 * list because it renders the prompt-type cards; AIGenerationPromptEditor is in
 * it because it imports this stylesheet from outside `.pmgr`.
 */
const CONSUMERS = [
  ['components/AIPromptManager.jsx', read('components', 'AIPromptManager.jsx')],
  ['components/PromptLibraryPanel.jsx', read('components', 'PromptLibraryPanel.jsx')],
  ['components/PromptVariableInspector.jsx', read('components', 'PromptVariableInspector.jsx')],
  ['components/PromptPreflightPanel.jsx', read('components', 'PromptPreflightPanel.jsx')],
  ['components/PromptAssembledPreview.jsx', read('components', 'PromptAssembledPreview.jsx')],
  ['components/AIGenerationPromptEditor.jsx', read('components', 'AIGenerationPromptEditor.jsx')],
  ['AdminPage.jsx', read('AdminPage.jsx')],
];
const MARKUP = CONSUMERS.map(([, src]) => src).join('\n');

const stripped = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

/** Every selector in the sheet, one per comma-separated part, media queries flattened. */
function selectors() {
  const out = [];
  for (const chunk of stripped(CSS).split('}')) {
    const head = chunk.split('{')[0];
    if (!head) continue;
    for (const part of head.split(',')) {
      const trimmed = part.trim().replace(/^@media[^{]*/, '').trim();
      if (!trimmed || trimmed.startsWith('@')) continue;
      out.push(trimmed);
    }
  }
  return out;
}

/** The FIRST class in a selector — what the rule is rooted at. */
const rootOf = (selector) => {
  const m = selector.match(/^[a-zA-Z]*\.([\w-]+)/);
  return m ? m[1] : null;
};

/* ---------------------------------------------------------------- the scope */

/**
 * The seven roots, and who owns each. An eighth fails the test below, which is
 * the point: this list is the file's contract, not a description of it.
 */
const SCOPES = {
  pmgr: 'AIPromptManager.jsx — the section, both dialogs, the editor form',
  plib: 'PromptLibraryPanel.jsx — the table, its controls and its empty states',
  pvi: 'PromptVariableInspector.jsx',
  ppf: 'PromptPreflightPanel.jsx',
  pap: 'PromptAssembledPreview.jsx',
  'ai-prompt-editor-modal': 'AIGenerationPromptEditor.jsx — imports this sheet from outside .pmgr',
  'prompt-type-sections': "AdminPage.jsx — the two cards on the prompts tab",
};

/**
 * THE ONE GLOBAL THAT SURVIVES, AND IT IS A DEBT, NOT A DESIGN.
 *
 * `.form-group input[type="text"] / textarea / select` is the only rule in the
 * product that gives a form control its width, padding and border: `styles.css`
 * has no bare `input` rule and styles nothing under `.form-group`. Eighteen
 * components rely on it. Scoping it here would strip the borders off half the
 * forms in the product in order to tidy up a prompt screen, so it stays until
 * it can be moved to `styles.css` — which is outside this change's file set.
 */
const TRANSITIONAL_GLOBALS = ['form-group'];

/** Which scope a selector's first class belongs to — `pmgr-x` is `.pmgr`'s. */
const scopeOf = (root) =>
  Object.keys(SCOPES).find((s) => root === s || root.startsWith(`${s}-`)) || null;

describe('every selector is rooted at a declared scope', () => {
  test('no rule escapes the seven scopes', () => {
    // rejects: a bare `.tag`, `.btn-primary` or `.modal-header` returning to
    // this file — the exact shape of the leak the whole rename was for.
    const escapees = [...new Set(selectors().map(rootOf))].filter(
      (root) => root === null || (!scopeOf(root) && !TRANSITIONAL_GLOBALS.includes(root)),
    );
    expect(escapees).toEqual([]);
  });

  test('every declared scope is actually used, so the list cannot rot', () => {
    // rejects: a scope kept in the allow-list after its rules are gone, which
    // would let the next rename smuggle a bare selector back in under a name
    // nothing checks.
    const used = new Set([...new Set(selectors().map(rootOf))].map((r) => (r ? scopeOf(r) : null)));
    expect(Object.keys(SCOPES).filter((s) => !used.has(s))).toEqual([]);
  });

  test('the transitional global is exactly the one documented, and no more', () => {
    // rejects: a second bare class hiding behind the first one's excuse. The
    // list is short on purpose and each entry needs a paragraph saying why.
    const bare = [...new Set(selectors().map(rootOf))].filter((r) => r && !scopeOf(r));
    expect(bare.sort()).toEqual([...TRANSITIONAL_GLOBALS].sort());
  });

  test('the transitional global still styles only form CONTROLS', () => {
    // rejects: growing it. `.form-group { margin-bottom }` and
    // `.form-group label { … }` were deleted because styles.css already owns
    // both; only the input/textarea/select rules have no other home.
    const bare = selectors().filter((s) => s.startsWith('.form-group'));
    expect(bare.length).toBeGreaterThan(0);
    for (const selector of bare) {
      expect(selector).toMatch(/\.form-group\s+(input|textarea|select)/);
    }
  });

  test('styles.css declares nothing in the .pmgr scope', () => {
    // The other half of the namespace rule: rooting everything at `.pmgr` is
    // only protection if `.pmgr*` belongs to this file alone. `.qs` is the
    // prefix that bit once already.
    const collisions = [...stripped(GLOBAL_CSS).matchAll(/\.(pmgr[\w-]*)/g)].map((m) => m[1]);
    expect([...new Set(collisions)]).toEqual([]);
    // And the premise, so this cannot quietly become vacuous: the name it
    // REPLACED is one styles.css has opinions about.
    expect(stripped(GLOBAL_CSS)).toMatch(/\.btn-primary\s*\{/);
  });
});

/* ------------------------------------------------------------- no orphans -- */

/**
 * Class names the markup composes rather than writes — `priority-${p}`,
 * `pvi-row--${tier}`. Collected from the JSX so the allow-list is derived, not
 * typed: a stem that stops being built stops excusing anything.
 */
function templateStems(source) {
  return [...source.matchAll(/([\w-]+-)\$\{/g)].map((m) => m[1]);
}
const STEMS = [...new Set(CONSUMERS.flatMap(([, src]) => templateStems(src)))];

/** Is this class name reachable from markup — written out, or composed? */
const reachable = (name) =>
  new RegExp(`\\b${name.replace(/-/g, '\\-')}\\b`).test(MARKUP)
  || STEMS.some((stem) => name.startsWith(stem) && name.length > stem.length);

describe('nothing was orphaned by the rename', () => {
  /** Every class name mentioned anywhere in the sheet. */
  const declared = () => {
    const out = new Set();
    for (const selector of selectors()) {
      for (const m of selector.matchAll(/\.([\w-]+)/g)) out.add(m[1]);
    }
    return [...out];
  };

  test('every class the stylesheet targets is rendered by something', () => {
    /*
      rejects: BOTH directions of the rename going wrong. A selector renamed in
      the CSS and not in the JSX leaves a panel unstyled and nothing errors —
      jsdom loads no stylesheet, so no component test can see it. A selector
      left behind after its markup was deleted is dead weight aimed at a class
      name that will be reused one day.
    */
    expect(declared().filter((name) => !reachable(name))).toEqual([]);
  });

  test('the composed-name allow-list is derived from markup that really composes', () => {
    // rejects: `reachable` degenerating into "anything starting with a dash",
    // which would excuse every orphan in the sheet.
    expect(STEMS.length).toBeGreaterThan(0);
    expect(STEMS).toContain('priority-');
  });

  test('each scope root appears in the file that is supposed to render it', () => {
    // rejects: the root itself being renamed on one side only — the failure
    // that unstyles a whole panel rather than one control.
    const owner = (file) => CONSUMERS.find(([name]) => name.endsWith(file))[1];
    expect(owner('AIPromptManager.jsx')).toMatch(/className="pmgr"/);
    expect(owner('PromptLibraryPanel.jsx')).toMatch(/className="plib"/);
    expect(owner('PromptVariableInspector.jsx')).toMatch(/\bpvi\b/);
    expect(owner('PromptPreflightPanel.jsx')).toMatch(/\bppf\b/);
    expect(owner('PromptAssembledPreview.jsx')).toMatch(/\bpap\b/);
    expect(owner('AIGenerationPromptEditor.jsx')).toMatch(/className="ai-prompt-editor-modal"/);
    expect(owner('AdminPage.jsx')).toMatch(/className="prompt-type-sections"/);
  });

  /**
   * The rule that declares `--pc-*`, and the roots it declares them on.
   * There must be exactly one such rule — two copies is the drift this
   * consolidation removed.
   */
  const tokenRule = () => {
    const rules = [...stripped(CSS).matchAll(/(^|\})\s*([^{}@]+?)\s*\{([^}]*--pc-ink\s*:[^}]*)\}/gm)];
    expect(rules).toHaveLength(1);
    return { roots: rules[0][2].split(',').map((s) => s.trim()), body: rules[0][3] };
  };

  /**
   * Which scope roots mount `PromptLibraryPanel`, derived from the JSX. This is
   * the list that MUST carry the tokens, and deriving it means a third mount
   * point added tomorrow fails this test instead of rendering naked.
   */
  const ROOT_OF_FILE = {
    'components/AIPromptManager.jsx': '.pmgr',
    'components/AIGenerationPromptEditor.jsx': '.ai-prompt-editor-modal',
  };
  const mountsTheLibrary = () =>
    CONSUMERS.filter(([name, src]) => ROOT_OF_FILE[name] && /<PromptLibraryPanel/.test(src))
      .map(([name]) => ROOT_OF_FILE[name]);

  test('every root that mounts the library declares the tokens itself', () => {
    /*
      rejects: the live degradation this test was written after. `.plib` mounts
      inside `.pmgr` AND inside `.ai-prompt-editor-modal`, which AdminPage
      renders in the top-level fragment beside <IssueFab> — outside every
      section, so it inherits nothing from `.pmgr`. An undefined custom property
      invalidates the WHOLE declaration, so the table there would lose its
      rules, its focus outline and every chip colour, and NOTHING would error.

      jsdom cannot see this at any price: it loads no stylesheet and resolves no
      custom property, so no rendered test would catch it either. Reading the
      selector list out of the stylesheet is the honest form.
    */
    const { roots } = tokenRule();
    const required = mountsTheLibrary();
    expect(required.length).toBeGreaterThan(1); // the premise: it really is mounted twice
    expect(required.filter((r) => !roots.includes(r))).toEqual([]);
    // `.plib` itself too, so the panel is portable to a third place.
    expect(roots).toContain('.plib');
  });

  test('the token block is complete wherever it is declared', () => {
    // rejects: splitting the palette so one root gets the colours and another
    // gets only half of them — the same invalidation, harder to spot.
    const { body } = tokenRule();
    for (const token of ['--pc-ink', '--pc-muted', '--pc-rule', '--pc-stop', '--pc-silent',
      '--pc-link', '--pc-paper', '--pc-mono', '--pc-row-h']) {
      expect(body).toContain(`${token}:`);
    }
  });
});

/* --------------------------------------------- the dialogs and the exits --- */

describe('the prompt admin has no blocking browser dialogs left', () => {
  /*
    COMMENTS STRIPPED FIRST, and the reason is a shipped bug: an earlier test in
    this repo passed on prose in a header comment (`podium.test.jsx` carries a
    `stripComments()` helper for exactly this). These assertions are about what
    the code DOES, and this file's own comments name every construct it is
    asserting the absence of.
  */
  const JSX = read('components', 'AIPromptManager.jsx')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  test('no alert() and no window.confirm()', () => {
    /*
      rejects: either coming back. `alert` states the severity and leaves
      nothing behind, so "Failed to load prompts" was dismissed into the
      library's "No prompts yet" poster — an outage rendered as an empty
      collection. `window.confirm` is one unformatted line, which is why both
      destructive paths read "Are you sure?" and neither named the prompt, the
      sets pinned to it, or the default it was about to demote.
    */
    expect(JSX).not.toMatch(/(^|[^.\w])alert\s*\(/m);
    expect(JSX).not.toMatch(/window\.confirm\s*\(/);
  });

  test('both dialogs route through the Modal primitive', () => {
    // rejects: a hand-rolled overlay returning. Escape, the focus trap, the
    // scroll lock, the focus restore and role="dialog" all live in Modal, and
    // this file had none of them on the tallest form in the product.
    expect(JSX).toMatch(/import Modal from '\.\/Modal'/);
    expect(JSX).not.toMatch(/className="prompt-(editor|advisor)-overlay"/);
    expect((JSX.match(/<Modal\b/g) || []).length).toBeGreaterThanOrEqual(4);
  });

  test('Escape is gated on unsaved work rather than disabled', () => {
    // rejects: `closeOnEscape={false}`. A draft is protected by asking, not by
    // removing the key — and the gate is a predicate so it is read at keypress
    // time, never closed over stale.
    expect(JSX).toMatch(/closeOnEscape=\{\(\)\s*=>\s*!isDirty\}/);
  });
});
