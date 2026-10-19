/**
 * THE STAGE'S MOVES IN THE SHARED SHAPE (docs/design/parity/PLAN.md §2.6, §2a
 * D1). buildControls turns stageModel's moves into the `controls` HostActionBar
 * reads, as roundStep does for Call & Answer: exactly one primary, at most one
 * secondary, a third move in the bar's third slot (never dropped), labels from
 * words.js, and an early or lossy advance armed in place.
 *
 * Rooms come from the REAL server's pure half (build-store.js roomFromRows +
 * hostView), as the page tests do.
 */
import { buildControls } from '../buildroom/buildControls';
import { W } from '../buildroom/words';

const S = require('../../../lambda-functions/game/build-store');

const NOW = new Date().toISOString();
const ago = (s) => new Date(Date.now() - s * 1000).toISOString();
const PLAYERS = ['Ana', 'Dee', 'Priya', 'Sam'];

const CHOICE = {
  AskId: '003', Kind: 'choice', Prompt: 'Which header should volunteers see first?', Detail: '', MaxPicks: 1,
  Options: [{ label: 'A', title: 'Bold banner', detail: '', url: '' }, { label: 'B', title: 'Calm photo', detail: '', url: '' }],
};
const ans = (askId, who, choice) => ({ SK: `BUILD#ANS#${askId}#${who}`, AskId: askId, PlayerName: who, Choice: choice, CreatedAt: ago(200) });
const POINT = (n, over = {}) => ({
  SK: `BUILD#POINT#${`p${n}`.padStart(13, '0')}`, PointId: `p${n}`, Kind: 'idea', Text: `Point ${n}`, Status: 'new', By: 'claude', ByRole: 'agent', BatchId: 'b1', CreatedAt: ago(300 - n), Sources: [], ...over,
});
const RUN = (cur, marks, done) => ({
  SK: 'BUILD#RUN', RunId: 'r1', Status: 'running', Cur: cur, Ver: 2, StartedAt: ago(500),
  Marks: marks, SentAt: marks.map((m) => (m === 'pending' ? '' : ago(300))), DoneAt: marks.map((m, i) => (m === 'done' || (done && i === cur - 1) ? ago(100) : '')),
  Items: [1, 2, 3].map((n) => ({ pointId: `p${n}`, text: `Point ${n}`, kind: 'idea', site: '', dir: `dir ${n}` })),
});

function room({ st = {}, rows = [] } = {}) {
  return S.hostView({
    gameId: '4821',
    meta: { Title: 'Volunteer sign-up', Details: '' },
    sessionState: 'STARTED',
    room: S.roomFromRows([{ SK: 'BUILD#STATE', Rev: 7, AgentSeenAt: ago(6), Phase: 'building', ...st }, ...rows]),
    players: PLAYERS,
    now: NOW,
  });
}
const currentOf = (r) => (r.asks || []).find((a) => a.askId === r.currentAskId && ['live', 'voting', 'results'].includes(a.status)) || null;
const controlsFor = (r, opts) => buildControls(r, currentOf(r), Date.now(), opts);

const live = (answers) => room({ st: { CurrentAskId: '003' }, rows: [{ SK: 'BUILD#ASK#003', Source: 'agent', CreatedAt: ago(600), ...CHOICE, Status: 'live' }, ...answers] });
const ANSWERS3 = [ans('003', 'Ana', ['B']), ans('003', 'Priya', ['B']), ans('003', 'Sam', ['A'])];

const MOMENTS = {
  idle: () => room(),
  'mockups ready': () => room({
    rows: [{ SK: 'BUILD#ASK#005', Source: 'agent', CreatedAt: ago(600), AskId: '005', Kind: 'choice', Prompt: 'Which look?', Detail: '', MaxPicks: 1, Status: 'proposed', Options: [{ label: 'A', title: 'Bold', imageId: 'i1' }, { label: 'B', title: 'Calm', imageId: 'i2' }] }],
  }),
  'choice live, 3 of 4': () => live(ANSWERS3),
  'choice live, all in': () => live([...ANSWERS3, ans('003', 'Dee', ['A'])]),
  'choice live, nobody yet': () => live([]),
  'ideas live': () => room({
    st: { CurrentAskId: '004' },
    rows: [
      { SK: 'BUILD#ASK#004', Source: 'agent', CreatedAt: ago(600), AskId: '004', Kind: 'suggest', Prompt: 'What stops sign-up?', Detail: '', Options: [], MaxPicks: 3, Status: 'live' },
      { SK: 'BUILD#RESP#004#r1', AskId: '004', RespId: 'r1', Text: 'An account', PlayerName: 'Ana', Source: 'player', CreatedAt: ago(300) },
      { SK: 'BUILD#RESP#004#r2', AskId: '004', RespId: 'r2', Text: 'No shifts shown', PlayerName: 'Dee', Source: 'player', CreatedAt: ago(300) },
    ],
  }),
  'results, a winner': () => room({ st: { CurrentAskId: '003' }, rows: [{ SK: 'BUILD#ASK#003', Source: 'agent', CreatedAt: ago(600), ...CHOICE, Status: 'results' }, ...ANSWERS3] }),
  'results, a tie': () => room({ st: { CurrentAskId: '003' }, rows: [{ SK: 'BUILD#ASK#003', Source: 'agent', CreatedAt: ago(600), ...CHOICE, Status: 'results' }, ans('003', 'Ana', ['A']), ans('003', 'Sam', ['B'])] }),
  'a talking point up': () => room({ st: { ShownPoint: { id: 'p4', at: ago(30) } }, rows: [POINT(4, { Status: 'shown' })] }),
  'the run list, Claude still on it': () => room({ rows: [POINT(1, { Status: 'sent' }), POINT(2, { Status: 'sent' }), POINT(3, { Status: 'queued' }), RUN(2, ['done', 'doing', 'pending'], false)] }),
  'the run list, Claude done': () => room({ rows: [POINT(1, { Status: 'sent' }), POINT(2, { Status: 'sent' }), POINT(3, { Status: 'queued' }), RUN(2, ['done', 'done', 'pending'], true)] }),
  'the run list, the last item': () => room({ rows: [POINT(1, { Status: 'sent' }), POINT(2, { Status: 'sent' }), POINT(3, { Status: 'sent' }), RUN(3, ['done', 'done', 'doing'], false)] }),
};

describe('the shape: one primary, at most one secondary, every label a word', () => {
  test.each(Object.keys(MOMENTS))('%s', (name) => {
    const c = controlsFor(MOMENTS[name]());
    const all = [c.primary, c.secondary, c.tertiary].filter(Boolean);
    if (name === 'idle') {
      expect(c.primary).toBeNull();
      expect(all).toEqual([]);
      return;
    }
    expect(c.primary).toBeTruthy();
    expect(Array.isArray(c.secondary)).toBe(false);
    // ids are unique in a moment: HostActionBar arms by id
    expect(new Set(all.map((x) => x.id)).size).toBe(all.length);
    all.forEach((x) => {
      expect(typeof x.label).toBe('string');
      expect(x.label.length).toBeGreaterThan(0);
      expect(x.icon).toBeTruthy();
      if (x.arm) expect(x.arm).toMatchObject({ inPlace: true, text: expect.any(String), confirmLabel: W.armedLabel(x.label) });
    });
    expect(typeof c.status).toBe('string');
  });
});

describe('each moment', () => {
  test('mockups ready: Open voting', () => {
    const c = controlsFor(MOMENTS['mockups ready']());
    expect(c.primary).toMatchObject({ action: 'open', label: W.openVoting, askId: '005' });
    expect(c.secondary).toBeNull();
  });

  test('3 of 4 answered: Show results arms in place, saying who is still answering; Spin the wheel beside it', () => {
    const c = controlsFor(MOMENTS['choice live, 3 of 4']());
    expect(c.primary).toMatchObject({ action: 'close', label: W.showResults, arm: { text: W.armStill(1, 4, 'answering'), confirmLabel: 'Show results anyway', inPlace: true } });
    expect(W.armStill(1, 4, 'answering')).toBe('1 of 4 still answering. Press again to show results.');
    expect(c.secondary).toMatchObject({ action: 'wheel', label: W.spin });
  });

  test('everyone in: Show results goes in one press', () => {
    expect(controlsFor(MOMENTS['choice live, all in']()).primary.arm).toBeUndefined();
  });

  test('nobody yet says so, never "4 of 4 still answering"', () => {
    expect(controlsFor(MOMENTS['choice live, nobody yet']()).primary.arm.text).toBe('Nobody has answered yet. Press again to show results.');
  });

  test('ideas: Open voting, the wheel beside it, no arm (nobody is counted as still writing)', () => {
    const c = controlsFor(MOMENTS['ideas live']());
    expect(c.primary).toMatchObject({ action: 'vote', label: W.openVoting });
    expect(c.primary.arm).toBeUndefined();
    expect(c.secondary).toMatchObject({ action: 'wheel' });
  });

  // QA walk 2026-10-18 C2: one press opened voting on an empty ballot, and
  // the room's later ideas were refused. With nothing to vote on the button
  // says why not and what to do instead (C&A disables Start voting at 0).
  test('C2: ideas with none yet: Open voting is held, saying why and what to do instead', () => {
    const r = room({ st: { CurrentAskId: '004' }, rows: [{ SK: 'BUILD#ASK#004', Source: 'agent', CreatedAt: ago(600), AskId: '004', Kind: 'suggest', Prompt: 'What stops sign-up?', Detail: '', Options: [], MaxPicks: 3, Status: 'live' }] });
    const c = controlsFor(r);
    expect(c.primary).toMatchObject({ action: 'vote', label: W.openVoting, disabled: true, hint: W.noIdeasToVote });
    expect(W.noIdeasToVote).toMatch(/^No ideas yet/);
    expect(W.noIdeasToVote).toMatch(/Close without a vote/);
    expect(c.secondary).toBeNull();
  });

  // QA walk 2026-10-18 C3: Show results with nobody in the room closed at once
  // (stillToAct was null at 0 of 0). It arms, and says nobody has joined.
  test('C3: nobody in the room: Show results arms in place, saying nobody has joined', () => {
    const r = S.hostView({
      gameId: '4821', meta: { Title: 'Volunteer sign-up', Details: '' }, sessionState: 'STARTED',
      room: S.roomFromRows([{ SK: 'BUILD#STATE', Rev: 7, AgentSeenAt: ago(6), Phase: 'building', CurrentAskId: '003' }, { SK: 'BUILD#ASK#003', Source: 'agent', CreatedAt: ago(600), ...CHOICE, Status: 'live' }]),
      players: [], now: NOW,
    });
    const c = controlsFor(r);
    expect(c.primary).toMatchObject({ action: 'close', label: W.showResults, arm: { text: W.armNobodyHere, confirmLabel: 'Show results anyway', inPlace: true } });
    expect(W.armNobodyHere).toBe('Nobody has joined yet. Press again to show results.');
  });

  test('voting with votes to come arms Show results with the voting words', () => {
    const r = room({ st: { CurrentAskId: '003' }, rows: [{ SK: 'BUILD#ASK#003', Source: 'agent', CreatedAt: ago(600), ...CHOICE, Kind: 'suggest', Status: 'voting' }, { SK: 'BUILD#VOTE#003#Ana', AskId: '003', PlayerName: 'Ana', Picks: ['r1'], CreatedAt: ago(100) }] });
    const c = controlsFor(r);
    expect(c.primary.action).toBe('close');
    expect(c.primary.arm.text).toMatch(/still voting\. Press again to show results\.$|^Nobody has voted yet/);
  });

  test('results with a winner: Send B to Claude, Change before sending beside it', () => {
    const c = controlsFor(MOMENTS['results, a winner']());
    expect(c.primary).toMatchObject({ action: 'to-claude', label: W.send('B') });
    expect(c.secondary).toMatchObject({ action: 'edit', label: W.change });
  });

  test('a tie: Spin the wheel leads', () => {
    expect(controlsFor(MOMENTS['results, a tie']()).primary).toMatchObject({ action: 'wheel', label: W.spin });
  });

  test('a turning wheel: the main button is disabled, and so is Spin again', () => {
    const r = room({ st: { CurrentAskId: '003' }, rows: [{ SK: 'BUILD#ASK#003', Source: 'agent', CreatedAt: ago(600), ...CHOICE, Status: 'results', Wheel: { Slices: [{ id: 'A', label: 'A', text: 'Bold' }, { id: 'B', label: 'B', text: 'Calm' }], Spinner: null, Armed: false, Spins: [{ SpinId: 's1', At: NOW, By: 'host', Result: 'B', Turns: 5 }] } }, ans('003', 'Ana', ['A']), ans('003', 'Sam', ['B'])] });
    const c = controlsFor(r, { turning: true });
    expect(c.primary.disabled).toBe(true);
    expect(c.secondary).toMatchObject({ action: 'spin', disabled: true });
  });

  test('a talking point: Take it down, Save for later beside it', () => {
    const c = controlsFor(MOMENTS['a talking point up']());
    expect(c.primary).toMatchObject({ action: 'take-down', label: W.takeItDown });
    expect(c.secondary).toMatchObject({ action: 'point-later', label: W.saveLater });
  });

  test('the run list before Claude reports: Next arms in place; Skip beside it; Stop in the third slot, never dropped', () => {
    const c = controlsFor(MOMENTS['the run list, Claude still on it']());
    expect(c.primary).toMatchObject({ action: 'run-next', label: W.nextShort(3), arm: { text: W.armRunEarly(2, 3), inPlace: true } });
    expect(c.secondary).toMatchObject({ action: 'run-skip', label: W.skipItem(3) });
    expect(c.tertiary).toMatchObject({ action: 'run-stop', label: W.stop });
  });

  test('the run list once Claude reports: Next in one press', () => {
    const c = controlsFor(MOMENTS['the run list, Claude done']());
    expect(c.primary.action).toBe('run-next');
    expect(c.primary.arm).toBeUndefined();
  });

  test('the last item: Stop is the only move, so it is the main one, and it asks twice', () => {
    const c = controlsFor(MOMENTS['the run list, the last item']());
    expect(c.primary).toMatchObject({ action: 'run-stop', label: W.stop, arm: { text: W.armStop, inPlace: true } });
    expect(c.secondary).toBeNull();
    expect(c.tertiary).toBeNull();
  });

  test('the codes card: its one move is to take it down', () => {
    const c = controlsFor(MOMENTS['results, a winner'](), { codesUp: true, codesBoth: true });
    expect(c.primary).toMatchObject({ action: 'hide-codes', label: W.hideCodes });
    expect(c.secondary).toBeNull();
    expect(controlsFor(MOMENTS.idle(), { codesUp: true }).primary.label).toBe(W.hideCode);
  });

  test('ended: no moves', () => {
    const r = { ...MOMENTS['results, a winner'](), state: 'ENDED' };
    expect(controlsFor(r).primary).toBeNull();
    expect(controlsFor(r, { codesUp: true }).primary).toBeNull();
  });

  test('busy: every button waits', () => {
    const c = controlsFor(MOMENTS['the run list, Claude done'](), { busy: true });
    [c.primary, c.secondary, c.tertiary].forEach((x) => expect(x.disabled).toBe(true));
  });

  test('a points vote at results: Send highlighted, Work in turn beside it, Save the rest in the third slot', () => {
    const TEXT = (n) => `Point ${n}`;
    const VOTE = {
      SK: 'BUILD#ASK#005', Source: 'host', CreatedAt: ago(600), AskId: '005', Kind: 'choice', Prompt: 'Which next?', Detail: '', MaxPicks: 3, Status: 'results',
      FromPoints: ['p1', 'p2', 'p3'], Options: [1, 2, 3].map((n, i) => ({ label: String.fromCharCode(65 + i), title: TEXT(n), detail: '', url: '', pointId: `p${n}` })),
    };
    const r = room({ st: { CurrentAskId: '005' }, rows: [VOTE, ...[1, 2, 3].map((n) => POINT(n, { Status: 'voting', PromotedTo: '005' })), ans('005', 'Ana', ['A', 'B']), ans('005', 'Sam', ['A'])] });
    const c = controlsFor(r);
    expect(c.primary.action).toBe('points-send');
    expect(c.secondary.action).toBe('points-run');
    expect(c.tertiary).toMatchObject({ action: 'points-later', label: W.saveRest });
  });
});
