/**
 * A HOOK DEPENDENCY ARRAY THAT NAMES SOMETHING NOT DECLARED YET.
 *
 * ── THE BUG THIS EXISTS FOR ────────────────────────────────────────────────
 *
 * Reported as *"I tried launching a QuickStart game and it goes to a blank
 * screen"*. The whole host page failed to render, on every route, because of
 * one line:
 *
 *     useEffect(() => {
 *       if (setupPanelOpen) loadRounds();
 *     }, [setupPanelOpen, lessonNumber, loadRounds]);   // line 214
 *     ...
 *     const [lessonNumber, setLessonNumber] = useState(0);   // line 303
 *
 * `ReferenceError: Cannot access 'lessonNumber' before initialization`, thrown
 * during render, which React turns into a blank page.
 *
 * ── WHY IT IS SPECIFICALLY THE DEPENDENCY ARRAY ────────────────────────────
 *
 * A function BODY may safely reference a `const` declared further down: the
 * body runs after the component function has finished, by which time every
 * binding exists. That is why the same file legitimately has effects and
 * handlers that call things defined hundreds of lines below them, and why
 * moving a block "up for readability" feels safe.
 *
 * A DEPENDENCY ARRAY IS NOT A BODY. It is an argument — an array literal
 * constructed the moment `useEffect(fn, [...])` is evaluated, during render,
 * while the later `const` is still in its temporal dead zone. So the exact same
 * identifier is fine on one line of the call and fatal on the next.
 *
 * ── WHY NOTHING ELSE CATCHES IT ────────────────────────────────────────────
 *
 * THERE IS NO ESLINT IN THIS PROJECT (see `undeclaredSetters.test.js` for the
 * longer version). Raw webpack plus babel-loader transpiles without resolving
 * identifiers, so this is a clean production build. `react-hooks/exhaustive-deps`
 * — which would flag it — is not installed, and `no-undef` would not catch it
 * anyway, because the name IS defined, just not yet.
 *
 * And the file it happened in cannot be mounted in jsdom: GameHostPage's own
 * suite is one of the five that have never run. So the one file where a
 * thousand lines of hooks are declared in a hand-maintained order is the file
 * with no runtime coverage. That is the same blind spot that produced four
 * calls to setters that did not exist.
 *
 * ── WHAT THIS CHECKS, AND WHAT IT DOES NOT ────────────────────────────────
 *
 * For each component file: find every hook dependency array, find every
 * top-level `const`/`let` declaration in that component, and fail if an array
 * names a binding declared after it.
 *
 * It is a source scan, not a scope analyser. It does not understand nested
 * functions, shadowing, or a dependency array built by a helper. Those are
 * shapes this codebase does not use in hook deps, and a scan that tried to
 * handle them would be a parser. The honest fix is still ESLint with
 * `react-hooks/exhaustive-deps`; until then this covers the case that has
 * actually taken the product down.
 */
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..');

function sourceFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
      sourceFiles(full, out);
    } else if (/\.jsx?$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

/** Comments stripped — this repo discusses hook ordering in prose constantly. */
function code(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}

/**
 * Every hook dependency array, with the offset it appears at.
 *
 * Matches the closing `}, [ ... ])` of useEffect/useMemo/useCallback/useLayoutEffect.
 * Anchored on `}` so it cannot match an ordinary array literal, and the
 * contents are restricted to identifier-ish characters so a dep array holding a
 * call or a member expression is skipped rather than guessed at.
 */
const DEP_ARRAY = /\}\s*,\s*\[([A-Za-z0-9_$,.\s?]*)\]\s*\)/g;

/**
 * Component-scope `const`/`let` declarations, with the offset each appears at.
 * Two-space indent is this codebase's component body level; deeper indents are
 * inside a nested function, where the TDZ question does not arise the same way.
 */
const DECL = /^ {2}(?:const|let)\s+(?:\[([^\]]+)\]|\{([^}]+)\}|([A-Za-z0-9_$]+))/gm;

function declarationOffsets(src) {
  const at = new Map();
  for (const m of src.matchAll(DECL)) {
    const names = (m[1] || m[2] || m[3] || '')
      .split(',')
      .map((n) => n.split(':').pop().trim().replace(/^\.\.\./, ''))
      .filter((n) => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(n));
    for (const name of names) {
      // FIRST declaration wins. A name re-declared in a nested scope later must
      // not make the outer one look late.
      if (!at.has(name)) at.set(name, m.index);
    }
  }
  return at;
}

function lateDeps(src) {
  const declared = declarationOffsets(src);
  const problems = [];
  for (const m of src.matchAll(DEP_ARRAY)) {
    const deps = m[1].split(',').map((d) => d.trim()).filter(Boolean);
    for (const dep of deps) {
      // `a.b` in a dep array depends on `a`; only the root binding can be in a
      // temporal dead zone.
      const root = dep.split(/[.?]/)[0];
      if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(root)) continue;
      const declaredAt = declared.get(root);
      if (declaredAt !== undefined && declaredAt > m.index) {
        problems.push(root);
      }
    }
  }
  return [...new Set(problems)];
}

describe('a hook never depends on something declared later', () => {
  // rejects: THE BLANK SCREEN. A dependency array is an argument, evaluated
  //          during render — unlike a function body, which runs after every
  //          binding exists. So a `const` declared below is a ReferenceError
  //          in the array and perfectly fine one line above it, which is
  //          exactly why this survived review and a green build.
  test.each(sourceFiles(SRC).map((f) => [path.relative(SRC, f), f]))(
    '%s',
    (_rel, file) => {
      expect(lateDeps(code(fs.readFileSync(file, 'utf8')))).toEqual([]);
    },
  );
});

/*
 * THE SCAN HAS TO BE ABLE TO FAIL.
 *
 * A clean codebase and a broken matcher produce the same green. These are the
 * real bug's shape and the two shapes that must NOT be flagged, because a check
 * that cries wolf on correct code is one people delete.
 */
describe('the scan can actually fail', () => {
  // rejects: the matcher silently missing the reported bug.
  test('it catches the exact line that shipped', () => {
    const src = code(`
  const [setupPanelOpen, setSetupPanelOpen] = useState(false);
  useEffect(() => {
    if (setupPanelOpen) loadRounds();
  }, [setupPanelOpen, lessonNumber, loadRounds]);
  const [lessonNumber, setLessonNumber] = useState(0);
`);
    expect(lateDeps(src)).toEqual(['lessonNumber']);
  });

  // rejects: flagging the ordinary, correct case — a dep declared above.
  test('a dependency declared earlier is fine', () => {
    const src = code(`
  const [gameId, setGameId] = useState('');
  useEffect(() => { load(); }, [gameId]);
`);
    expect(lateDeps(src)).toEqual([]);
  });

  // rejects: flagging a function BODY that calls something declared later,
  //          which is legal, common in this file, and not the bug. If this
  //          fired, the check would be unusable here.
  test('a body may call something declared later', () => {
    const src = code(`
  const [open, setOpen] = useState(false);
  useEffect(() => { if (open) laterFn(); }, [open]);
  const laterFn = () => {};
`);
    expect(lateDeps(src)).toEqual([]);
  });

  // rejects: a scan that gives up on a member expression instead of checking
  //          its root, which is where the dead zone actually bites.
  test('a member dependency is judged by its root binding', () => {
    const src = code(`
  useEffect(() => {}, [thing.current]);
  const thing = useRef(null);
`);
    expect(lateDeps(src)).toEqual(['thing']);
  });
});
