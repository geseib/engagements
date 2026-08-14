/**
 * CALLS TO SETTERS THAT DO NOT EXIST.
 *
 * ── WHY THIS FILE EXISTS ───────────────────────────────────────────────────
 *
 * Four separate bugs, one cause, none of them caught by 1,859 passing tests or
 * by a green production build:
 *
 *   1. `setAuthorsHiddenOnStage` in `handleNextQuestion`. Threw mid-update, so
 *      `setCurrentQuestionId` and `setQuestions` never ran and the host got
 *      "The round moved on, but this screen could not refresh."
 *   2. `setAuthorsHiddenOnStage` again in `handleShowResults`, where it cost
 *      the players their RESULT#nnn frame.
 *   3. `setNewGameSetId` as the FIRST statement of `handleSwitchGame`, so
 *      Switch game ran, threw, and changed nothing at all. Reported twice.
 *   4. `setBigScreenMode` in the remote-command handler, so the projector
 *      button on the host's phone did nothing.
 *
 * Every one is the same shape: a refactor removed a piece of state, removed
 * every READ of it, and left a WRITE behind. (1) and (2) came from one commit,
 * (3) from the GameSetupDialog extraction, (4) from the boolean-to-profiles
 * change in config/displayProfile.js — three unrelated refactors making the
 * identical mistake, which is what makes it worth a test rather than a note.
 *
 * ── WHY NOTHING ELSE COULD SEE THEM ────────────────────────────────────────
 *
 * THERE IS NO ESLINT IN THIS PROJECT. Not misconfigured — absent. The frontend
 * builds with raw webpack + babel-loader, which transpiles and does not resolve
 * identifiers, so `no-undef` never runs and a call to an undeclared binding is
 * a clean production build. It is a ReferenceError at the moment the line
 * executes and not one second earlier.
 *
 * And the tests could not see them either: GameHostPage.jsx cannot be mounted
 * in jsdom at all — its own suite is one of the five that have never run, which
 * is why sessionSetupPanel.test.jsx and stageShell.test.jsx read it as text.
 * So the file where this keeps happening is the file with no runtime coverage.
 *
 * ── WHAT THIS BUYS, AND WHAT IT DOES NOT ───────────────────────────────────
 *
 * It is a source scan for one specific naming convention, not a linter. It
 * checks `setSomething(` calls only, because that is where every instance has
 * occurred and because the convention is unambiguous enough to scan without a
 * parser. A call to any other undeclared name still ships silently.
 *
 * The honest fix is ESLint with `no-undef` over the whole frontend. That is a
 * toolchain change with its own risk and its own review, and it should still
 * happen. Until it does, this covers the case that has actually bitten, four
 * times, in the file that cannot be covered any other way.
 */
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..');

/** Every .js/.jsx under src/src, excluding tests. */
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

/**
 * Comments stripped, because this repo's comments are long and discuss retired
 * setters by name constantly — including, deliberately, the four above. A scan
 * that read them would flag every doc-block that explains a past bug, which
 * would train the next person to ignore this test.
 *
 * Strings are NOT stripped: `setFoo(` inside a string literal is not a call and
 * the trailing paren makes a false positive vanishingly unlikely, whereas a
 * string-stripper that got template literals wrong would eat real code.
 */
function code(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}

/** Platform setters. Global, always defined, never declared in a source file. */
const GLOBALS = new Set(['setTimeout', 'setInterval', 'setImmediate']);

/**
 * `setFoo(` where the name is not preceded by a dot — so `client.setFoo()` and
 * `props.setFoo()` are member access on some object, not a bare binding, and
 * cannot be a ReferenceError.
 */
const CALLED = /(?<![.\w$])(set[A-Z]\w*)\s*\(/g;

/**
 * Is this name bound anywhere in the file?
 *
 * Four forms, matching how this codebase actually binds setters:
 *   - `const [x, setX] = useState(...)`  — the overwhelming majority
 *   - `const setX = ...` / `function setX(...)`  — the debug wrapper at :108
 *   - `import { setX }` or a destructured prop/param `{ setX }`
 *   - `(setX) =>` / `(a, setX) =>`  — a callback parameter
 *
 * Deliberately generous. A false NEGATIVE here means one undeclared setter
 * slips through; a false POSITIVE means a green suite goes red on correct code,
 * and a test that cries wolf gets deleted rather than heeded.
 */
function isBound(name, src) {
  return (
    new RegExp(`,\\s*${name}\\s*\\]`).test(src)
    || new RegExp(`\\b(?:const|let|var|function)\\s+${name}\\b`).test(src)
    || new RegExp(`[{,]\\s*${name}\\s*[,}=:]`).test(src)
    || new RegExp(`[(,]\\s*${name}\\s*[,)]`).test(src)
  );
}

describe('every setter that is called is a setter that exists', () => {
  // rejects: ALL FOUR REPORTED BUGS, and the general shape of them — a refactor
  //          that deletes a piece of state and its reads but leaves a write
  //          behind. Each one was a live control that ran, threw, and did
  //          nothing: Next Question, Show Results, Switch game, and the
  //          remote's big-screen button.
  test.each(sourceFiles(SRC).map((f) => [path.relative(SRC, f), f]))(
    '%s',
    (_rel, file) => {
      const src = code(fs.readFileSync(file, 'utf8'));
      const undeclared = [...new Set(
        [...src.matchAll(CALLED)].map((m) => m[1])
      )].filter((name) => !GLOBALS.has(name) && !isBound(name, src));

      expect(undeclared).toEqual([]);
    },
  );
});

/*
 * A SECOND CHECK, BECAUSE THE SCAN ABOVE CAN ONLY SEE WHAT IT IS POINTED AT.
 *
 * The scan proves it finds nothing today. It cannot prove it would find
 * something — a broken regex, a `code()` that ate the whole file, or a
 * `sourceFiles` that returned an empty list would all produce the same green.
 * The three cases below are the four real bugs' exact shapes, run through the
 * same predicates.
 */
describe('the scan can actually fail', () => {
  // rejects: the scan silently passing because its matcher stopped matching.
  test('it catches a call with no declaration', () => {
    const src = code('function f() { setAuthorsHiddenOnStage(false); }');
    expect([...src.matchAll(CALLED)].map((m) => m[1])).toEqual(['setAuthorsHiddenOnStage']);
    expect(isBound('setAuthorsHiddenOnStage', src)).toBe(false);
  });

  // rejects: a matcher so eager it flags correct useState pairs — which is the
  //          failure mode that gets a test like this deleted.
  test('it does not flag a normal useState pair', () => {
    const src = code('const [a, setA] = useState(0); setA(1);');
    expect(isBound('setA', src)).toBe(true);
  });

  // rejects: flagging a method call. `webSocketClient.setFoo()` is member
  //          access and can never be a ReferenceError.
  test('it does not flag a method call', () => {
    const src = code('client.setThing(1);');
    expect([...src.matchAll(CALLED)].map((m) => m[1])).toEqual([]);
  });

  // rejects: a `code()` that strips too little. This repo's doc-blocks name
  //          every retired setter, so comments MUST be gone before the scan.
  test('it ignores setters named only in comments', () => {
    const src = code('/* setAuthorsHiddenOnStage(false) was here */\n// setBigScreenMode(true) too\n');
    expect([...src.matchAll(CALLED)].map((m) => m[1])).toEqual([]);
  });
});
