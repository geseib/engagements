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

/**
 * A HOOK BELOW AN EARLY RETURN — the second way this file's ordering kills the
 * page, and the one that actually reached a host.
 *
 * Reported as *"I also still see blank page once starting the quick start"*,
 * with `Minified React error #310` — "rendered more hooks than during the
 * previous render". A different fault from the dependency-array one above, in a
 * different commit, with the identical symptom.
 *
 *     if (showQuickstartMenu) { return (<QuickstartMenu … />); }   // line 3276
 *     …
 *     const [spotlightIndex, setSpotlightIndex] = useState(null);  // line 3739
 *
 * On the Quick Start menu the component returns at 3276 and that `useState`
 * never runs. Pick a lesson, the flag clears, the render carries past it — and
 * React counts one more hook than last time. It only breaks on the TRANSITION,
 * which is why it survived every other route.
 *
 * The rule is React's first: hooks run unconditionally, in the same order,
 * every render. A plain function may live below an early return; a hook may not.
 *
 * `hookDepOrder`'s scan above cannot see this — it compares a dep array against
 * declaration offsets and has no notion of a return statement. Two rules, two
 * scans, one file.
 */
const HOOK = /\buse(?:State|Effect|Memo|Callback|Ref|LayoutEffect|Reducer|Context)\s*\(/;

/**
 * Every top-level function in a file, as `{ name, start, end }` line offsets.
 *
 * BRACE DEPTH, NOT INDENTATION, and the first version of this used indentation
 * and produced three false positives on its first run — `useStageFit.js`,
 * `UserManagement.jsx` and `VerificationForm.jsx` all have module-level helpers
 * full of perfectly correct `if (!value) return '—';` guard clauses, which sit
 * at the same two-space indent as a component's own early return. A check that
 * cries wolf on correct code is one that gets deleted, so it has to know the
 * difference between "in the component body" and "in some function".
 */
function topLevelFunctions(lines) {
  const out = [];
  const OPENS = /^(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+([A-Za-z0-9_$]+)|^(?:export\s+)?const\s+([A-Za-z0-9_$]+)\s*=\s*(?:async\s*)?\(/;
  for (let i = 0; i < lines.length; i += 1) {
    const m = lines[i].match(OPENS);
    if (!m) continue;
    let depth = 0;
    let started = false;
    for (let j = i; j < lines.length; j += 1) {
      for (const ch of lines[j]) {
        if (ch === '{') { depth += 1; started = true; }
        else if (ch === '}') depth -= 1;
      }
      if (started && depth <= 0) {
        out.push({ name: m[1] || m[2], start: i, end: j });
        i = j;
        break;
      }
    }
  }
  return out;
}

/** Depth of the body of `fn`, per line — 1 means directly in that body. */
function depthMap(lines, fn) {
  const at = new Map();
  let depth = 0;
  for (let i = fn.start; i <= fn.end; i += 1) {
    at.set(i, depth);
    for (const ch of lines[i]) {
      if (ch === '{') depth += 1;
      else if (ch === '}') depth -= 1;
    }
  }
  return at;
}

function hooksBelowEarlyReturn(src) {
  const lines = src.split('\n');
  const found = [];
  for (const fn of topLevelFunctions(lines)) {
    const depth = depthMap(lines, fn);
    // Only functions that use hooks are components or custom hooks; a helper
    // with guard clauses and no hooks cannot have this bug.
    const usesHooks = [];
    for (let i = fn.start; i <= fn.end; i += 1) {
      if (depth.get(i) === 1 && HOOK.test(lines[i])) usesHooks.push(i);
    }
    if (usesHooks.length === 0) continue;

    let firstReturn = null;
    for (let i = fn.start + 1; i <= fn.end; i += 1) {
      if (depth.get(i) !== 1) continue;
      const isGuardBlock = /^\s*if \(.*\) \{\s*$/.test(lines[i])
        && (() => {
          for (let j = i + 1; j <= Math.min(i + 6, fn.end); j += 1) {
            if (depth.get(j) === 2 && /^\s*return\b/.test(lines[j])) return true;
          }
          return false;
        })();
      const isGuardLine = /^\s*if \(.*\)\s*return\b/.test(lines[i]);
      if (isGuardBlock || isGuardLine) { firstReturn = i; break; }
    }
    if (firstReturn === null) continue;

    for (const i of usesHooks) {
      if (i > firstReturn) found.push(`${fn.name}:${i + 1}: ${lines[i].trim().slice(0, 50)}`);
    }
  }
  return found;
}

describe('no hook runs below an early return', () => {
  // rejects: THE QUICK START BLANK PAGE. A hook past a `return` is skipped on
  //          the renders that take that branch and runs on the ones that do
  //          not, so the count changes and React throws #310. It breaks only on
  //          the transition between the two, which is why every other route
  //          looked fine.
  test.each(sourceFiles(SRC).map((f) => [path.relative(SRC, f), f]))(
    '%s',
    (_rel, file) => {
      expect(hooksBelowEarlyReturn(code(fs.readFileSync(file, 'utf8')))).toEqual([]);
    },
  );
});

describe('the early-return scan can actually fail', () => {
  // rejects: the matcher missing the exact shape that shipped.
  test('it catches a useState below a guard clause', () => {
    const src = code(`
function Thing() {
  const [a, setA] = useState(0);
  if (a) {
    return (<div />);
  }
  const [b, setB] = useState(null);
}
`);
    expect(hooksBelowEarlyReturn(src)).toHaveLength(1);
  });

  // rejects: flagging the correct arrangement, which is most of this codebase.
  test('hooks above every early return are fine', () => {
    const src = code(`
function Thing() {
  const [a, setA] = useState(0);
  const [b, setB] = useState(null);
  if (a) {
    return (<div />);
  }
  const helper = () => setB(1);
}
`);
    expect(hooksBelowEarlyReturn(src)).toEqual([]);
  });

  // rejects: flagging a `return` inside a nested function, which bounds
  //          nothing about hook order and is everywhere in this file.
  test('a return inside a callback is not an early return', () => {
    const src = code(`
function Thing() {
  const go = () => {
    if (x) return;
  };
  const [b, setB] = useState(null);
}
`);
    expect(hooksBelowEarlyReturn(src)).toEqual([]);
  });
});

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
