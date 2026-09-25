/**
 * THE SESSION'S STATE ROW IS UPDATED, NEVER REPLACED — except once, when the
 * session is created.
 *
 * `GAME#<id> / STATE` carries far more than where the room is. Beside `State`
 * and `LessonNumber` sit the scoreboard (`Scoreboard`, `ScoreboardRev` —
 * lambda-functions/game/scoreboard-state.js), the round the scores were last
 * counted after (`ScoresAfterRound`, `ScoresAt`, `PrevScoresAt` —
 * get-results.js), `Started`, and whatever the next feature puts there. A
 * PutCommand of a fresh STATE item wipes every one of them.
 *
 * `ScoreboardRev` is the sharp one. The host page applies a server copy of
 * the board only when its rev is at least the one it holds
 * (src/src/components/stage/scoreboard/useScoreboardSync.js). A wipe restarts
 * the count at 1, so the page would ignore every later copy — the phone's
 * page turns, the close when a question starts — until the count climbed back
 * past the old number.
 *
 * `lambda-functions/websocket/start-question.js` PUT the whole row, and had no
 * caller anywhere: not the host page, not the remote (config/hostRemote.js
 * builds its paths), not another handler. It was deleted with its route
 * rather than rewritten, and this suite keeps both halves gone.
 *
 * rejects: a handler (other than the session's creator) that PUTs STATE;
 *          the start-question route or its handler coming back;
 *          a template Handler that names a file that does not exist.
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const REPO = path.join(__dirname, '..');
const LAMBDAS = path.join(REPO, 'lambda-functions');
const TEMPLATE = path.join(REPO, 'template-clean.yaml');
const { routesFromTemplate, findRoute, assertScannerWorks } = require('./helpers/template-routes');

let pass = 0; let fail = 0;
const check = (label, fn) => {
  try { fn(); console.log(`  ok   - ${label}`); pass += 1; } catch (e) {
    console.log(`  FAIL - ${label}\n         ${e.message}`); fail += 1;
  }
};

/** The one handler allowed to write a whole STATE row: it creates the session. */
const CREATOR = 'lambda-functions/websocket/schema-compliant-manager.js';

/** Every handler source, minus installed and built copies. */
function handlerFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.aws-sam', 'dist'].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) handlerFiles(full, out);
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

/*
  Every `SK: 'STATE'` (exactly STATE — not STATE#CATS), and the command it
  belongs to: the nearest `new XCommand(` / `Put: {` / `PutRequest: {` before
  it. A PUT with the key inside its `Item` is a replacement; the same key in
  an Update's or Get's `Key` is not.
*/
const STATE_KEY = /SK:\s*(['"`])STATE\1/g;
const OPENER = /new\s+(\w+)Command\s*\(|\b(Put|PutRequest|Update|Delete|ConditionCheck)\s*:\s*\{/g;

function stateReplacements(src) {
  const hits = [];
  for (const m of src.matchAll(STATE_KEY)) {
    let opener = null;
    for (const o of src.slice(0, m.index).matchAll(OPENER)) opener = o;
    if (!opener) continue;
    const kind = opener[1] || opener[2];
    const between = src.slice(opener.index, m.index);
    if (/^Put(Request)?$/.test(kind) && /\bItem\s*:/.test(between)) {
      hits.push(src.slice(0, m.index).split('\n').length);
    }
  }
  return hits;
}

const files = handlerFiles(LAMBDAS).map((f) => [path.relative(REPO, f), fs.readFileSync(f, 'utf8')]);
const replacers = files
  .map(([rel, src]) => [rel, stateReplacements(src)])
  .filter(([, lines]) => lines.length > 0);

console.log('\n1. nothing but the session\'s creator replaces the STATE row');

// Proves the scanner sees a PUT of STATE at all; one that matches nothing
// would pass the check below for every handler in the repo.
check('the scanner finds the creator\'s own PUT', () =>
  assert.ok(replacers.some(([rel]) => rel === CREATOR),
    `${CREATOR} writes the first STATE row and the scanner did not see it`));

check('and finds nothing else', () => {
  const others = replacers.filter(([rel]) => rel !== CREATOR);
  assert.deepStrictEqual(others.map(([rel, lines]) => `${rel}:${lines.join(',')}`), [],
    'these PUT a whole STATE row, wiping the scoreboard and the counted round');
});

console.log('\n2. POST /games/{gameId}/start-question is gone, route and handler');

const routes = routesFromTemplate(TEMPLATE);
assertScannerWorks(routes);
const template = fs.readFileSync(TEMPLATE, 'utf8');

check('no route', () =>
  assert.strictEqual(findRoute(routes, 'POST', '/games/{gameId}/start-question'), undefined));
check('no function', () =>
  assert.ok(!/start-question\.handler|StartQuestionFunction/.test(template),
    'template-clean.yaml still defines the start-question function'));
check('no handler file', () =>
  assert.ok(!fs.existsSync(path.join(LAMBDAS, 'websocket', 'start-question.js'))));

console.log('\n3. every Handler in the template names a file that exists');
// So deleting a handler without its function (or the reverse) fails here,
// not as an import error on the first request after a deploy.
{
  const lines = template.split('\n');
  const functions = [];
  let current = null;
  for (const line of lines) {
    const resource = /^ {2}(\w+):\s*$/.exec(line);
    if (resource) { current = { name: resource[1] }; functions.push(current); continue; }
    if (!current) continue;
    const code = /^ {6}CodeUri:\s*(\S+)\s*$/.exec(line);
    if (code) current.codeUri = code[1];
    const handler = /^ {6}Handler:\s*(\S+)\s*$/.exec(line);
    if (handler) current.handler = handler[1];
  }
  const withHandlers = functions.filter((f) => f.codeUri && f.handler);

  check('the scan found the template\'s functions', () =>
    assert.ok(withHandlers.length > 50, `only ${withHandlers.length} functions with a CodeUri and Handler`));

  const missing = withHandlers
    .map((f) => ({ ...f, file: path.join(REPO, f.codeUri, `${f.handler.replace(/\.[^./]+$/, '')}.js`) }))
    .filter((f) => !fs.existsSync(f.file))
    .map((f) => `${f.name} → ${path.relative(REPO, f.file)}`);
  check('none of them is missing', () => assert.deepStrictEqual(missing, []));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
