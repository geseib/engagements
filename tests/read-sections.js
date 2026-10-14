/**
 * THE READ'S SECTIONS AND POINTS: one way of counting, on the server and on the
 * host page (lambda-functions/game/read-sections.js, src/src/config/readSections.js).
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { readSections, pointAt } = require('../lambda-functions/game/read-sections');

let pass = 0; let fail = 0;
function check(label, fn) {
  try { fn(); console.log(`  PASS  ${label}`); pass++; } catch (e) { console.log(`  FAIL  ${label}\n        ${e.message}`); fail++; }
}

const READ = [
  '## The wording the room voted up',
  '> Every meeting ends with one owner and one date.',
  '',
  '**The top-voted wording**, Bea\'s line, puts a concrete check on the meeting.',
  '',
  '## What every rewrite added',
  '- **A checkable element**: tie the sentence to something someone can count.',
  '- **Direction, not words**: every answer is a usable replacement.',
  '',
  '## Discussion topics',
  '1. Does the room agree that Cal\'s line is the only one that could be said here?',
  '2. Must a replacement name a number or a person?',
  '3. What would the room put in that slot?',
  '',
  '## Next steps:',
  '1. Paste Bea\'s line in place of the current sentence.',
].join('\n');

check('sections in order, points counted per section', () => {
  const s = readSections(READ);
  assert.deepStrictEqual(s.map((x) => [x.heading, x.points.length]), [
    ['The wording the room voted up', 0], ['What every rewrite added', 2], ['Discussion topics', 3], ['Next steps:', 1],
  ]);
  assert.strictEqual(s[2].points[1], 'Must a replacement name a number or a person?');
});
check('an anchor finds its point; case, trailing colon and bold ignored in the heading', () => {
  assert.deepStrictEqual(pointAt(READ, { section: 'discussion topics', point: 3 }),
    { section: 'Discussion topics', point: 3, text: 'What would the room put in that slot?' });
  assert.strictEqual(pointAt(READ, { section: '**Next steps**', point: 1 }).point, 1);
});
check('a heading the read never printed, or a point past the list, is no anchor', () => {
  assert.strictEqual(pointAt(READ, { section: 'Risks', point: 1 }), null);
  assert.strictEqual(pointAt(READ, { section: 'Discussion topics', point: 4 }), null);
  assert.strictEqual(pointAt(READ, { section: 'Discussion topics', point: 0 }), null);
  assert.strictEqual(pointAt(READ, null), null);
});
check('the host page counts the same way: the shared body is identical in both copies', () => {
  const grab = (p) => {
    const s = fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
    return s.slice(s.indexOf('// ---- shared body'), s.indexOf('// ---- end shared body ----')).replace(/^export /gm, '');
  };
  assert.strictEqual(grab('src/src/config/readSections.js'), grab('lambda-functions/game/read-sections.js'));
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
