/**
 * HISTORY'S WORDS LIVE IN ONE PLACE (docs/design/parity/PLAN.md §2.8, H4;
 * host standards §2: "No user-facing sentence is written inline").
 *
 * The functions that build History's story and its marks may name kinds and
 * types ('showing', 'decided', 'not-sent'), never words a person reads: those
 * come from buildroom/words.js. A sentence typed back in fails here.
 */
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '../buildroom/buildScreens.js'), 'utf8');
const HISTORY_FUNCTIONS = ['decisionChain', 'gaveChain', 'roomStory', 'askOutcome', 'contributionsOf', 'placeInAsk', 'historyFromView'];

/** The body of a top-level function, from its declaration to the closing brace at column 0. */
function bodyOf(name) {
  const start = SRC.search(new RegExp(`^(export )?function ${name}\\(`, 'm'));
  if (start < 0) throw new Error(`no function ${name}`);
  const end = SRC.indexOf('\n}\n', start);
  return SRC.slice(start, end);
}

/** Every string and template literal in a piece of source, comments removed. */
function literals(src) {
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '');
  const out = [];
  const re = /'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g;
  let m;
  while ((m = re.exec(code))) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

/** Words a person reads: two words with a space between, or a capitalised word. */
const reads = (lit) => {
  const plain = lit.replace(/\$\{[^}]*\}/g, '');
  return /[A-Za-z]\s+[A-Za-z]/.test(plain) || /(^|[^A-Za-z])[A-Z][a-z]/.test(plain);
};

describe("History's words come from words.js", () => {
  test.each(HISTORY_FUNCTIONS)('%s types no sentence of its own', (name) => {
    const typed = literals(bodyOf(name)).filter(reads);
    expect(typed).toEqual([]);
  });

  test('no word in words.js is written twice: a second key silently replaces the first', () => {
    // It happened (H4): a History word named `saidOutLoud` was overridden by the Stage's
    // "Pick what the room said out loud." further down, and lint does not catch it here.
    const words = fs.readFileSync(path.join(__dirname, '../buildroom/words.js'), 'utf8');
    const keys = [...words.matchAll(/^ {2}([A-Za-z0-9_]+):/gm)].map((m) => m[1]);
    expect(keys.length).toBeGreaterThan(100);
    expect(keys.filter((k, i) => keys.indexOf(k) !== i)).toEqual([]);
  });

  test('the checker itself catches a typed sentence and lets a kind through', () => {
    expect(reads('Claude has it')).toBe(true);
    expect(reads('Picture')).toBe(true);
    expect(reads('${n} ideas from the room')).toBe(true);
    expect(reads('not-sent')).toBe(false);
    expect(reads('decided:${d.askId}')).toBe(false);
    expect(reads('ENDED')).toBe(false);
  });
});
