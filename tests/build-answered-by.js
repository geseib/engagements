/**
 * WHO HAS ANSWERED, BY NAME, ON THE HOST'S LAPTOP ONLY (parity PLAN §2.9b,
 * answer (e); the Build Room console, B8). build-store.js askView gives the
 * host's read of each ask `answeredBy`: the names of the people who have
 * answered (suggested while an Ideas ask collects, voted once it votes),
 * once each. Never what they chose, and never on a phone, the room's window,
 * or Claude's own read.
 *
 *   node tests/build-answered-by.js
 */
const suiteFinished = require('./helpers/finish-guard');
const assert = require('assert');
const S = require('../lambda-functions/game/build-store');

const NOW = new Date().toISOString();
const ago = (s) => new Date(Date.now() - s * 1000).toISOString();
const PLAYERS = ['Ana', 'Dee', 'Priya', 'Sam'];

const CHOICE = {
  SK: 'BUILD#ASK#003', AskId: '003', Kind: 'choice', Prompt: 'Which header?', Detail: '', MaxPicks: 1, Source: 'agent', CreatedAt: ago(600),
  Options: [{ label: 'A', title: 'Bold banner' }, { label: 'B', title: 'Calm photo' }],
};
const IDEAS = { SK: 'BUILD#ASK#004', AskId: '004', Kind: 'suggest', Prompt: 'What stops sign-up?', Detail: '', Options: [], MaxPicks: 3, Source: 'agent', CreatedAt: ago(600) };
const ans = (who, choice) => ({ SK: `BUILD#ANS#003#${who}`, AskId: '003', PlayerName: who, Choice: choice, CreatedAt: ago(200) });
const resp = (id, who, text, source = 'player') => ({ SK: `BUILD#RESP#004#${id}`, AskId: '004', RespId: id, Text: text, PlayerName: who, Source: source, CreatedAt: ago(300) });
const vote = (who, ids) => ({ SK: `BUILD#VOTE#004#${who}`, AskId: '004', PlayerName: who, RespIds: ids, CreatedAt: ago(100) });

function view(rows, audience = 'host') {
  const room = S.roomFromRows([{ SK: 'BUILD#STATE', Rev: 3, Phase: 'building', CurrentAskId: rows[0].AskId }, ...rows]);
  return S.hostView({ gameId: '4821', meta: { Title: 'Volunteer sign-up', Details: '' }, sessionState: 'STARTED', room, players: PLAYERS, now: NOW, audience });
}
const askOf = (v, id) => v.asks.find((a) => a.askId === id);

let pass = 0;
let failed = 0;
function check(name, fn) {
  try { fn(); pass += 1; console.log(`PASS ${name}`); } catch (e) { failed += 1; console.log(`FAIL ${name}\n  ${e.message}`); }
}

(async () => {
  check('a Choose ask: the names of the people who answered, once each, and nothing they chose', () => {
    const a = askOf(view([{ ...CHOICE, Status: 'live' }, ans('Ana', ['B']), ans('Priya', ['A']), ans('Sam', ['B'])]), '003');
    assert.deepStrictEqual([...a.answeredBy].sort(), ['Ana', 'Priya', 'Sam']);
    assert.ok(a.answeredBy.every((x) => typeof x === 'string'));
    assert.ok(!JSON.stringify(a.answeredBy).includes('Calm photo'));
  });

  check('nobody yet: an empty list, not missing', () => {
    const a = askOf(view([{ ...CHOICE, Status: 'live' }]), '003');
    assert.deepStrictEqual(a.answeredBy, []);
  });

  check('an Ideas ask collecting: the people who suggested, once however many ideas; the host\'s own idea is not a person', () => {
    const a = askOf(view([{ ...IDEAS, Status: 'live' }, resp('r1', 'Ana', 'An account'), resp('r2', 'Ana', 'No shifts'), resp('r3', 'Dee', 'Too long'), resp('r4', 'Host', 'Mine', 'host')]), '004');
    assert.deepStrictEqual(a.answeredBy, ['Ana', 'Dee']);
  });

  check('an Ideas ask voting: the people who voted', () => {
    const a = askOf(view([{ ...IDEAS, Status: 'voting' }, resp('r1', 'Ana', 'An account'), resp('r3', 'Dee', 'Too long'), vote('Sam', ['r1']), vote('Priya', ['r3'])]), '004');
    assert.deepStrictEqual([...a.answeredBy].sort(), ['Priya', 'Sam']);
  });

  check('Claude\'s read (the agent audience) carries no list of names', () => {
    const a = askOf(view([{ ...CHOICE, Status: 'live' }, ans('Ana', ['B'])], 'agent'), '003');
    assert.strictEqual(a.answeredBy, undefined);
  });

  check('a phone and the room\'s window never carry it', () => {
    const room = S.roomFromRows([{ SK: 'BUILD#STATE', Rev: 3, Phase: 'building', CurrentAskId: '003' }, { ...CHOICE, Status: 'live' }, ans('Ana', ['B'])]);
    const phone = S.publicView({ gameId: '4821', meta: { Title: 'x', Details: '' }, sessionState: 'STARTED', room, players: PLAYERS, me: { playerName: 'Dee' }, now: NOW });
    const wall = S.wallView({ gameId: '4821', meta: { Title: 'x', Details: '' }, sessionState: 'STARTED', room, players: PLAYERS, now: NOW });
    assert.ok(!JSON.stringify(phone).includes('answeredBy'));
    assert.ok(!JSON.stringify(wall).includes('answeredBy'));
  });

  console.log(`\n${pass} passed, ${failed} failed`);
  suiteFinished();
  process.exit(failed ? 1 : 0);
})();
