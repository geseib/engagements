/**
 * THE ROOM'S WINDOW NEVER PULLS THE SIGNED-IN FETCH (docs/design/parity/PLAN.md
 * §2.4, B5). The wall will be built on buildScreens.js and the display
 * components in buildroom/screens/; a window on the projector must not carry
 * the host's sign-in. So walking every import, transitively, from those files
 * must never reach auth/authFetch, utils/hostTicketClient, or the host's own
 * client (buildHostApi.js, whose routes /build/state among them are signed in).
 *
 * The existing guard (presentStage.test.jsx) reads present/ one level deep;
 * this one follows the whole tree. Read as text: nothing is imported.
 */
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..');
const FORBIDDEN = [/[\\/]auth[\\/]authFetch\.jsx?$/, /[\\/]utils[\\/]hostTicketClient\.jsx?$/];
/** The host's client: every route on it, /build/state among them, is signed in. */
const HOST_CLIENT = /[\\/]buildroom[\\/]buildHostApi\.js$/;
const IMPORT = /(?:import|export)[^'"]*?from\s*['"]([^'"]+)['"]|import\s*['"]([^'"]+)['"]|require\(\s*['"]([^'"]+)['"]\s*\)|import\(\s*['"]([^'"]+)['"]\s*\)/g;

function resolve(from, spec) {
  if (!spec.startsWith('.')) return null; // packages carry no sign-in of ours
  const base = path.resolve(path.dirname(from), spec);
  return [base, `${base}.js`, `${base}.jsx`, path.join(base, 'index.js'), path.join(base, 'index.jsx')]
    .find((c) => fs.existsSync(c) && fs.statSync(c).isFile()) || null;
}

/** Every module reached from `start`, with the chain that reached it. */
function walk(start) {
  const from = new Map([[start, null]]);
  const queue = [start];
  while (queue.length) {
    const file = queue.shift();
    if (/\.jsx?$/.test(file)) {
      const src = fs.readFileSync(file, 'utf8');
      let m;
      IMPORT.lastIndex = 0;
      while ((m = IMPORT.exec(src))) {
        const hit = resolve(file, m[1] || m[2] || m[3] || m[4]);
        if (hit && !from.has(hit)) { from.set(hit, file); queue.push(hit); }
      }
    }
  }
  return from;
}

const chainTo = (from, file) => {
  const out = [];
  for (let f = file; f; f = from.get(f)) out.unshift(path.relative(SRC, f));
  return out.join(' -> ');
};

/** What the room's window will be built from. */
const SCREENS_DIR = path.join(SRC, 'buildroom', 'screens');
const STARTS = [
  path.join(SRC, 'buildroom', 'buildScreens.js'),
  path.join(SRC, 'buildroom', 'links.js'),
  ...(fs.existsSync(SCREENS_DIR) ? fs.readdirSync(SCREENS_DIR).filter((f) => /\.jsx?$/.test(f)).map((f) => path.join(SCREENS_DIR, f)) : []),
];

describe('the walker itself', () => {
  test('it does find the signed-in fetch where it is: buildHostApi.js reaches it', () => {
    const from = walk(path.join(SRC, 'buildroom', 'buildHostApi.js'));
    expect([...from.keys()].some((f) => FORBIDDEN[0].test(f))).toBe(true);
  });
});

describe.each(STARTS.map((f) => [path.relative(SRC, f), f]))('%s', (name, start) => {
  test('exists', () => {
    expect(fs.existsSync(start)).toBe(true);
  });

  test('reaches no authFetch and no hostTicketClient', () => {
    const from = walk(start);
    const bad = [...from.keys()].filter((f) => FORBIDDEN.some((re) => re.test(f))).map((f) => chainTo(from, f));
    expect(bad).toEqual([]);
  });

  test('reaches no host client: buildHostApi.js is where /build/state is read', () => {
    const from = walk(start);
    const bad = [...from.keys()].filter((f) => HOST_CLIENT.test(f)).map((f) => chainTo(from, f));
    expect(bad).toEqual([]);
  });
});
