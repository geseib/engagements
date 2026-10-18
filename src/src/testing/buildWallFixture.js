/* eslint-env node */
/**
 * A REAL WALL BODY (parity PLAN §2.9a): what GET build-play/wall answers,
 * built by the server's own pure half (lambda-functions/game/build-store.js:
 * roomFromRows, then wallView), never typed by hand. The rows name people the
 * wall must never name (List names off): the players, an idea's author, the
 * voters, the wheel's spinner, a log line that mentions one of them.
 *
 *   const F = require('../testing/buildWallFixture');
 *   F.wallBody({ screen: 'history' })      // a wallView body
 *   F.NAMES                                // every name in the rows
 *
 * Used by __tests__/buildWall.test.jsx and buildScreensDisplay.test.jsx.
 */
const S = require('../../../lambda-functions/game/build-store');

const NAMES = ['Zebulon', 'Quintessa', 'Ottoline', 'Marisol'];
const [ZEB, QUI, OTT, MAR] = NAMES;

const ago = (s, now) => new Date(now - s * 1000).toISOString();
const pad = (n) => String(n).padStart(13, '0');

/** One long option title: the fit check wants 130 to 320 characters. */
const long = (n, label) => `${label}: ${'a volunteer sign-up page that shows the shift, the place and who to ask, '.repeat(n).trim()}`;

/**
 * rows for one room. `ask`: null (between asks) | 'live' | 'voting' | 'results' | 'wheel';
 * `history`: how many extra decided asks and log entries to add; `longAsk`: six long options.
 */
function rows({ ask = null, history = 0, longAsk = false, now = Date.now(), wall = {}, image = true } = {}) {
  const out = [];
  const st = {
    SK: 'BUILD#STATE', Rev: 9, AgentSeenAt: ago(6, now), Phase: 'building', WallKey: 'K'.repeat(43), WallRev: 3,
    ...(ask ? { CurrentAskId: '003' } : {}),
    ...(wall.screen ? { WallScreen: wall.screen } : {}),
    ...(wall.codes ? { WallCodes: wall.codes } : {}),
    ...(wall.profile ? { WallProfile: wall.profile } : {}),
  };
  out.push(st);
  const options = longAsk
    ? ['A', 'B', 'C', 'D', 'E', 'F'].map((label, i) => ({ label, title: long(2 + (i % 3), label).slice(0, 130 + i * 38), detail: '', url: '' }))
    : [{ label: 'A', title: 'Bold banner', detail: '', url: 'http://localhost:5173/a' }, { label: 'B', title: 'Calm photo', detail: '', url: '' }];
  // A decided ask the room saw, decided by a vote, with the host's note.
  out.push({
    SK: 'BUILD#ASK#002', AskId: '002', Source: 'agent', Kind: 'choice', Prompt: 'Which colour should the header be?', Detail: '', MaxPicks: 1,
    Options: [{ label: 'A', title: 'Blue', detail: '' }, { label: 'B', title: 'Orange', detail: '' }],
    Status: 'decided', CreatedAt: ago(900, now), OpenedAt: ago(890, now), DecidedAt: ago(700, now),
    Decision: { direction: 'Go with the calm blue header', chosen: ['A'], note: 'HOST-NOTE-77', method: 'vote' },
  });
  for (let i = 0; i < history; i += 1) {
    const id = String(100 + i).padStart(3, '0');
    out.push({
      SK: `BUILD#ASK#${id}`, AskId: id, Source: 'agent', Kind: 'choice', Prompt: `Earlier question number ${i + 1}: which of these should the page lead with for the volunteers?`, Detail: '', MaxPicks: 1,
      Options: [{ label: 'A', title: 'The map', detail: '' }, { label: 'B', title: 'The rota', detail: '' }],
      Status: 'decided', CreatedAt: ago(5000 - i * 100, now), OpenedAt: ago(4990 - i * 100, now), DecidedAt: ago(4950 - i * 100, now),
      Decision: { direction: `Lead with the map, decision ${i + 1}`, chosen: ['A'], note: '', method: 'vote' },
    });
    out.push({ SK: `BUILD#LOG#${pad(now - (6000 - i * 100) * 1000)}#h${i}`, LogId: `h${i}`, Kind: 'milestone', Text: `Milestone ${i + 1}: the page now shows the shifts for the weekend`, By: 'agent', CreatedAt: ago(6000 - i * 100, now) });
  }
  if (ask) {
    const status = ask === 'wheel' ? 'results' : ask;
    out.push({
      SK: 'BUILD#ASK#003', AskId: '003', Source: 'agent', Kind: 'choice', Prompt: 'Which header should volunteers see first?', Detail: '', MaxPicks: 1,
      Options: options, Status: status, CreatedAt: ago(600, now), OpenedAt: ago(590, now),
      ...(ask === 'wheel' ? { Wheel: { Slices: [{ id: 'A', label: 'A', text: 'Bold' }, { id: 'B', label: 'B', text: 'Calm' }], Spinner: QUI, Armed: false, Spins: [{ SpinId: 's1', At: ago(30, now), By: QUI, Result: 'B', Turns: 5 }] } } : {}),
    });
    [[ZEB, ['A']], [QUI, ['B']], [MAR, ['B']]].forEach(([who, choice]) => out.push({ SK: `BUILD#ANS#003#${who}`, AskId: '003', PlayerName: who, Choice: choice, Why: "Because it reads well", CreatedAt: ago(200, now) }));
  }
  // Ideas: one sent to Claude (its author named on the row), one never used.
  out.push({ SK: `BUILD#IDEA#${pad(now - 500000)}#i1`, IdeaId: '1-i1', Status: 'promoted', PromotedVia: 'claude', Source: 'room', PlayerName: ZEB, Text: 'Add a parking map', CreatedAt: ago(500, now) });
  out.push({ SK: `BUILD#IDEA#${pad(now - 400000)}#i2`, IdeaId: '2-i2', Status: 'new', Source: 'room', PlayerName: QUI, Text: 'UNUSED-IDEA-77', CreatedAt: ago(400, now) });
  out.push({ SK: `BUILD#LOG#${pad(now - 450000)}#d1`, LogId: 'd1', Kind: 'idea', Text: 'Add a parking map', Detail: ZEB, IdeaId: '1-i1', AsWritten: true, ForAgent: true, By: 'host', CreatedAt: ago(450, now) });
  out.push({ SK: `BUILD#LOG#${pad(now - 300000)}#n1`, LogId: 'n1', Kind: 'verbal', Text: `${OTT} said the form is too long`, By: 'host', CreatedAt: ago(300, now) });
  out.push({ SK: `BUILD#LOG#${pad(now - 90000)}#s1`, LogId: 's1', Kind: 'showing', Text: 'Header is live', Link: 'http://localhost:5173/', By: 'agent', CreatedAt: ago(90, now) });
  if (image) {
    out.push({ SK: `BUILD#IMG#${pad(now - 80000)}#m1`, ImageId: 'img-shot-1', Kind: 'progress', Caption: 'The sign-up form', ContentType: 'image/png', By: 'agent', CreatedAt: ago(80, now) });
    out.push({ SK: `BUILD#LOG#${pad(now - 80000)}#g1`, LogId: 'g1', Kind: 'image', Text: 'The sign-up form', Detail: 'img-shot-1', By: 'agent', CreatedAt: ago(80, now) });
  }
  return out;
}

/** A wallView body, as the server answers GET build-play/wall. */
function wallBody(opts = {}) {
  const now = opts.now || Date.now();
  const body = S.wallView({
    gameId: '4821',
    meta: { Title: 'Volunteer sign-up', Details: 'A one-page site to pick a shift in a minute.' },
    sessionState: opts.ended ? 'ENDED' : 'STARTED',
    room: S.roomFromRows(rows({ ...opts, now })),
    players: NAMES.slice(),
    now: new Date(now).toISOString(),
  });
  if (opts.rev !== undefined) body.rev = opts.rev;
  if (opts.wallRev !== undefined) body.wall = { ...body.wall, rev: opts.wallRev };
  return body;
}

module.exports = { NAMES, wallBody, rows };
