/**
 * The Build Room's four screens: the pure rules (buildroom/buildScreens.js).
 */
import {
  defaultDirection,
  SCREENS, PROJECTED, isProjected, screenForKey, togglePresent, waitingCount, askPill, latestBuild, stageModel, settleMove,
  queueItems, filterQueue, laterIdeas, claudeState, latestDecisionLine, doingLine, roomStory, filterStory,
  decisionChoices, winnerOf, directionFor, questionAnswer, decisionMethod, RATING_SCALE, ratingAnswer, ratingStep,
  askPathStep, askPathSummaries, whatsNextMoves, combineLine, combineText, mockupsReady, looksWords, decideBody, roomChoice,
} from '../buildroom/buildScreens';
import { W } from '../buildroom/words';

describe('the screens', () => {
  test('Host, Stage, Build and History, on keys 1 to 4', () => {
    expect(SCREENS.map((s) => [s.key, s.label, s.shortcut])).toEqual([
      ['host', 'Host', '1'], ['stage', 'Stage', '2'], ['build', 'Build', '3'], ['history', 'History', '4'],
    ]);
    expect(['1', '2', '3', '4', '5', 'p'].map(screenForKey)).toEqual(['host', 'stage', 'build', 'history', null, null]);
  });

  test('every screen but Host is made for the room', () => {
    expect(PROJECTED).toEqual(['stage', 'build', 'history']);
    expect(isProjected('host')).toBe(false);
    expect(isProjected('build')).toBe(true);
  });

  test('P goes from Host to the last screen the room saw, Stage the first time, and back', () => {
    expect(togglePresent('host', null)).toBe('stage');
    expect(togglePresent('host', 'build')).toBe('build');
    expect(togglePresent('history', 'history')).toBe('host');
    expect(togglePresent('stage', 'stage')).toBe('host');
  });
});

describe('what the header counts', () => {
  test('waiting: Claude\'s proposed asks plus the room\'s new ideas', () => {
    expect(waitingCount(null)).toBe(0);
    expect(waitingCount({
      asks: [{ status: 'proposed' }, { status: 'live' }, { status: 'proposed' }],
      ideas: [{ status: 'new' }, { status: 'dismissed' }, { status: 'promoted' }],
    })).toBe(3);
  });

  test('the queue: Claude\'s asks first, then everything else oldest first; later is its own fold', () => {
    const room = {
      asks: [
        { askId: '004', status: 'proposed', source: 'host', createdAt: 't3' },
        { askId: '005', status: 'proposed', source: 'agent', createdAt: 't5' },
        { askId: '002', status: 'live', source: 'agent', createdAt: 't0' },
      ],
      ideas: [
        { ideaId: 'i1', status: 'new', source: 'room', createdAt: 't1' },
        { ideaId: 'i2', status: 'new', source: 'host', createdAt: 't4' },
        { ideaId: 'i3', status: 'later', source: 'room', createdAt: 't2' },
        { ideaId: 'i4', status: 'promoted', source: 'room', createdAt: 't2' },
      ],
    };
    const q = queueItems(room);
    expect(q.map((x) => [x.id, x.from])).toEqual([['ask:005', 'claude'], ['idea:i1', 'room'], ['ask:004', 'you'], ['idea:i2', 'you']]);
    expect(filterQueue(q, 'you').map((x) => x.id)).toEqual(['ask:004', 'idea:i2']);
    expect(filterQueue(q, 'all')).toBe(q);
    expect(laterIdeas(room).map((i) => i.ideaId)).toEqual(['i3']);
    expect(waitingCount(room)).toBe(4);
  });

  test('the ask pill: answered of here, votes while voting, results when closed', () => {
    const room = (ask) => ({ currentAskId: '003', playerCount: 18, asks: [{ askId: '003', ...ask }] });
    expect(askPill(room({ status: 'live', kind: 'choice', answerCount: 5 }))).toEqual({ text: 'Ask 3 · 5 of 18', results: false });
    expect(askPill(room({ status: 'voting', kind: 'suggest', answerCount: 9, voteCount: 4 }))).toEqual({ text: 'Ask 3 · 4 of 18', results: false });
    expect(askPill(room({ status: 'results', kind: 'rating' }))).toEqual({ text: 'Ask 3 · results', results: true });
    expect(askPill(room({ status: 'decided', kind: 'rating' }))).toBeNull();
    expect(askPill({ currentAskId: null, asks: [] })).toBeNull();
  });
});

describe('what the Build screen shows', () => {
  test('the newest link Claude posted, and the newest screenshot that is not a mockup', () => {
    const room = {
      log: [
        { by: 'agent', kind: 'showing', link: 'http://localhost:5173/a' },
        { by: 'host', kind: 'verbal', link: 'http://example.com/no' },
        { by: 'agent', kind: 'progress', link: 'http://localhost:5173/' },
        { by: 'agent', kind: 'progress', link: 'javascript:alert(1)' },
      ],
      images: [{ imageId: 'p1', kind: 'progress' }, { imageId: 'm1', kind: 'mockup' }],
    };
    expect(latestBuild(room)).toEqual({ link: 'http://localhost:5173/', shot: { imageId: 'p1', kind: 'progress' } });
  });

  test('falls back to the wrap-up demo, and to nothing', () => {
    expect(latestBuild({ log: [], images: [], outcome: { links: [{ url: 'http://localhost:3000/' }] } }).link).toBe('http://localhost:3000/');
    expect(latestBuild({})).toEqual({ link: '', shot: null });
  });
});

describe('the Stage screen, as the regular stage draws it', () => {
  const room = (extra = {}) => ({ playerCount: 18, agent: { connected: true }, ...extra });

  test('a live Choose: answering, the count of here, Close on Space', () => {
    expect(stageModel(room(), { askId: '003', kind: 'choice', status: 'live', answerCount: 5 })).toEqual({
      phase: 'ASK',
      context: { category: 'Choose', round: 3, noun: 'Ask' },
      meter: { heading: 'Answered', count: 5, of: 18 },
      status: '5 of 18 answered',
      primary: { action: 'close', label: 'Show results' },
      secondary: { action: 'wheel', label: 'Spin the wheel' },
    });
  });

  test('Ideas collecting opens voting; voting closes; results go back to the Host to decide', () => {
    expect(stageModel(room(), { askId: '004', kind: 'suggest', status: 'live', answerCount: 1 }))
      .toMatchObject({ phase: 'ASK', status: '1 idea', primary: { action: 'vote' } });
    expect(stageModel(room(), { askId: '004', kind: 'suggest', status: 'voting', voteCount: 7 }))
      .toMatchObject({ phase: 'VOTE', meter: { heading: 'Voted', count: 7, of: 18 }, primary: { action: 'close' } });
    expect(stageModel(room(), { askId: '004', kind: 'rating', status: 'results', results: { total: 15 } }))
      .toMatchObject({ phase: 'RESULTS', meter: { count: 15, of: 18 }, primary: { action: 'reopen', label: 'Reopen' } });
  });

  test('between asks: no chip, who is here, and what Claude is doing, in room-safe words', () => {
    expect(stageModel(room(), null)).toMatchObject({ phase: null, meter: { heading: 'In the room', count: 18 }, status: 'Send an idea any time.', primary: null });
    expect(stageModel(room({ agent: {} }), null).status).toBe('Send an idea any time.');
    expect(stageModel(room({ outcome: { summary: 'A sign-up page.' } }), null).status).toBe('Here is what we built.');
  });

  test('ended: complete, no move', () => {
    expect(stageModel(room({ state: 'ENDED' }), { askId: '003', kind: 'choice', status: 'live' })).toMatchObject({ phase: 'ENDED', primary: null });
  });
});

describe('the Stage with the wheel up', () => {
  const room = { playerCount: 18, agent: { connected: true } };
  const results = (wheel) => ({ askId: '003', kind: 'choice', status: 'results', results: { total: 4 }, wheel });
  test('someone has the turn; the host can always spin; deciding stays on the Host', () => {
    expect(stageModel(room, results({ spinner: 'Dee', armed: true, landed: null, spins: [] }))).toMatchObject({
      status: 'Dee spins the wheel', wheel: true,
      primary: { action: 'spin', label: 'Spin the wheel' }, secondary: { action: 'edit', label: 'Change before sending' },
    });
  });
  test('landed: Send B to Claude leads and Spin again sits beside it, as on the Host', () => {
    const ask = { ...results({ spinner: 'Dee', armed: false, landed: 'B', spins: [{}] }), options: [{ label: 'A', title: 'One' }, { label: 'B', title: 'Two' }], results: { total: 4, options: [{ label: 'A', count: 2 }, { label: 'B', count: 2 }] } };
    expect(stageModel(room, ask)).toMatchObject({
      status: 'The wheel landed on B', primary: { action: 'to-claude', label: 'Send B to Claude' }, secondary: { action: 'spin', label: 'Spin again' },
    });
  });
  test('while it turns the result is not given away: a disabled "The wheel is turning…", Spin again disabled', () => {
    const ask = { ...results({ spinner: 'Dee', armed: false, landed: 'B', spins: [{}] }), options: [{ label: 'A', title: 'One' }, { label: 'B', title: 'Two' }], results: { total: 4, options: [{ label: 'A', count: 2 }, { label: 'B', count: 2 }] } };
    const m = stageModel(room, ask, Date.now(), { turning: true });
    expect(m.status).toBe('The wheel is turning');
    expect(m.primary).toEqual({ action: 'noop', label: 'The wheel is turning…', disabled: true });
    expect(m.secondary).toMatchObject({ label: 'Spin again', disabled: true });
    expect(JSON.stringify(m)).not.toMatch(/\bB\b/);
  });
  test('after a revote, the old ask is plain results', () => {
    expect(stageModel(room, { ...results({ spinner: null, armed: false, landed: null, spins: [] }), revotedAs: '004' })).toMatchObject({
      status: 'Results', primary: { action: 'edit' },
    });
  });
});

describe('the wheel instead of a vote (owner, 2026-10-06)', () => {
  const room = { playerCount: 18, agent: { connected: true } };
  test('a Choose, an Ideas ask with two or more ideas, and a vote all offer it; a rating does not', () => {
    expect(stageModel(room, { askId: '1', kind: 'suggest', status: 'live', answerCount: 1 }).secondary).toBeUndefined();
    expect(stageModel(room, { askId: '1', kind: 'suggest', status: 'live', answerCount: 2 }).secondary).toEqual({ action: 'wheel', label: 'Spin the wheel' });
    expect(stageModel(room, { askId: '1', kind: 'suggest', status: 'voting', voteCount: 3 }).secondary.action).toBe('wheel');
    expect(stageModel(room, { askId: '1', kind: 'rating', status: 'live', answerCount: 3 }).secondary).toBeUndefined();
  });
});

describe('deciding: the winner by default, any other on a click (owner, 2026-10-06)', () => {
  const choose = (counts, wheel) => ({
    kind: 'choice', status: 'results', prompt: 'What should we build?',
    options: [{ label: 'A', title: 'Bold banner' }, { label: 'B', title: 'Calm photo' }, { label: 'C', title: 'Dark' }],
    results: { options: counts.map((count, i) => ({ label: 'ABC'[i], count })) },
    ...(wheel ? { wheel } : {}),
  });
  test('the single top answer is the default; a tie has none; the wheel\'s landing wins', () => {
    expect(winnerOf(choose([1, 3, 0]))).toBe('B');
    expect(winnerOf(choose([2, 2, 0]))).toBeNull();
    expect(winnerOf(choose([0, 0, 0]))).toBeNull();
    expect(winnerOf(choose([2, 2, 0], { landed: 'A' }))).toBe('A');
  });
  test('the sentence for each pick is the question and the answer (owner, 2026-10-06)', () => {
    expect(directionFor(choose([1, 3, 0]), 'B')).toBe('What should we build: Calm photo');
    expect(directionFor(choose([1, 3, 0]), 'C')).toBe('What should we build: Dark');
    expect(directionFor(choose([2, 2, 0], { landed: 'A' }), 'A')).toBe('What should we build: Bold banner');
    const ideas = { kind: 'suggest', prompt: 'What should the background color be?', results: { ranked: [{ respId: 'r1', text: 'blue', votes: 4 }, { respId: 'r2', text: 'green', votes: 1 }] } };
    expect(decisionChoices(ideas).map((c) => c.id)).toEqual(['r1', 'r2']);
    expect(directionFor(ideas, 'r1')).toBe('What should the background color be: blue');
    expect(directionFor(ideas, 'r2')).toBe('What should the background color be: green');
    expect(questionAnswer('Which?', 'B')).toBe('Which: B');
  });
  test('how it was decided: the vote, the wheel, the host, or said out loud', () => {
    expect(decisionMethod(choose([1, 3, 0]), ['B'], false)).toBe('vote');
    expect(decisionMethod(choose([1, 3, 0]), ['C'], false)).toBe('host');
    expect(decisionMethod(choose([2, 2, 0], { landed: 'A' }), ['A'], false)).toBe('wheel');
    expect(decisionMethod(choose([0, 0, 0]), ['A'], true)).toBe('spoken');
  });
  test('on the Stage the winning vote goes to Claude, and Edit sits beside it', () => {
    const m = stageModel({ playerCount: 3 }, { askId: '3', ...choose([1, 3, 0]) });
    expect(m.primary).toEqual({ action: 'to-claude', label: 'Send B to Claude', verb: 'send' });
    expect(m.secondary).toEqual({ action: 'edit', label: 'Change before sending' });
  });
  test('B3a status lines: who leads, a tie, the average', () => {
    expect(stageModel({ playerCount: 3 }, { askId: '3', ...choose([4, 7, 0]) }).status).toBe('B leads, 7 to 4');
    expect(stageModel({ playerCount: 3 }, { askId: '3', ...choose([5, 5, 0]) }).status).toBe('Tied, 5 to 5');
    const rated = stageModel({ playerCount: 3 }, { askId: '5', kind: 'rating', status: 'results', results: { total: 10, rating: { avg: 3.4, count: 10, dist: [] } } });
    expect(rated.status).toBe('Average 3.4 from 10');
    expect(rated.primary.label).toBe('Send 3.4 to Claude');
  });
  test('a draft the host changed on the Host screen is what the Stage sends: kind and words', () => {
    const ask = { askId: '3', ...choose([1, 3, 0]) };
    const draft = { pickId: 'B', direction: 'Calm, with big dates', chosen: ['B'], as: 'keep' };
    expect(settleMove(ask, draft)).toMatchObject({ kind: 'keep', direction: 'Calm, with big dates', chosen: ['B'], label: 'Send B to Claude' });
    expect(settleMove(ask, { ...draft, pickId: 'A' })).toMatchObject({ kind: 'do-now', direction: 'What should we build: Calm photo' });
    expect(settleMove(ask, { ...draft, as: 'later' })).toMatchObject({ kind: 'later', label: 'Save for later' });
  });
  test('a set that says Later: the primary saves, with the Host\'s label', () => {
    const m = stageModel({ playerCount: 3 }, { askId: '3', ...choose([1, 3, 0]), claudeGets: 'later' });
    expect(m.primary).toEqual({ action: 'to-claude', label: 'Save for later', verb: 'save for later' });
  });
  test('a tie or no votes has nothing to send: Spin the wheel leads and Change before sending sits beside it', () => {
    for (const ask of [choose([2, 2, 0]), choose([0, 0, 0])]) {
      const m = stageModel({ playerCount: 3 }, { askId: '3', ...ask });
      expect(m.primary).toEqual({ action: 'wheel', label: 'Spin the wheel' });
      expect(m.secondary).toEqual({ action: 'edit', label: 'Change before sending' });
    }
  });
  test('a rating sends its average; no ratings yet has none to send', () => {
    const rated = stageModel({ playerCount: 3 }, { askId: '5', kind: 'rating', status: 'results', results: { total: 3, rating: { avg: 4.2, count: 3, dist: [0, 0, 0, 2, 1] } } });
    expect(rated.primary).toEqual({ action: 'to-claude', label: 'Send 4.2 to Claude', verb: 'send' });
    expect(rated.secondary).toEqual({ action: 'edit', label: 'Change before sending' });
  });
  test('the ideas winner reads as the top idea', () => {
    const m = stageModel({ playerCount: 3 }, { askId: '4', kind: 'suggest', status: 'results', results: { total: 3, ranked: [{ respId: 'r1', text: 'One', votes: 3 }, { respId: 'r2', text: 'Two', votes: 1 }] } });
    expect(m.primary.label).toBe('Send the top idea to Claude');
  });
  test('decideBody is the one body: `as` is always said when sending', () => {
    const ask = choose([1, 3, 0]);
    expect(decideBody(ask, { direction: ' go ', chosen: ['B'], as: 'do-now' })).toEqual({ action: 'decide', direction: 'go', chosen: ['B'], note: '', sendToAgent: true, method: 'vote', as: 'do-now' });
    expect(decideBody(ask, { direction: 'go', chosen: ['B'], as: 'later' })).toMatchObject({ as: 'later', sendToAgent: true });
    expect(roomChoice(ask)).toMatchObject({ chosen: ['B'] });
  });
});

describe('the fixed rating scale (owner, 2026-10-06)', () => {
  test('1 needs work, 5 is great, and a rating answer says so', () => {
    expect(RATING_SCALE).toEqual({ min: 1, max: 5, lowLabel: 'Needs work', highLabel: 'Great' });
    expect(ratingAnswer(4.2)).toBe('4.2 out of 5 (5 is great, 1 needs work)');
    expect(ratingAnswer(null)).toBe('');
    expect(questionAnswer('How close is this?', ratingAnswer('4'))).toBe('How close is this: 4 out of 5 (5 is great, 1 needs work)');
    expect([1, 3, 5].map(ratingStep)).toEqual(['1 · Needs work', '3', '5 · Great']);
  });
});

describe('the room\'s story (step 5, C9 and C11)', () => {
  const { roomStory, decisionChain, filterStory, artifactsOf } = require('../buildroom/buildScreens');
  const at = (m) => `2026-10-06T10:${String(m).padStart(2, '0')}:00.000Z`;
  const LOG = [
    { logId: 'l1', kind: 'verbal', text: 'It has to work on old phones', createdAt: at(22) },
    { logId: 'l2', kind: 'progress', text: 'Scaffolded', createdAt: at(25) },
    { logId: 'l3', kind: 'showing', text: 'The shift calendar is up', link: 'http://localhost:5173', createdAt: at(46) },
    { logId: 'l4', kind: 'image', text: 'The calendar', detail: 'img-cal', createdAt: at(47) },
    { logId: 'l5', kind: 'image', text: 'Choice A', detail: 'img-a', createdAt: at(24) },
    { logId: 'l6', kind: 'image', text: 'Later shot', detail: 'img-late', createdAt: at(55) },
  ];
  const IMAGES = [
    { imageId: 'img-cal', kind: 'progress', by: 'agent', createdAt: at(47) },
    { imageId: 'img-a', kind: 'mockup', askId: '001', label: 'A', by: 'agent', createdAt: at(24), caption: 'Bold banner' },
    { imageId: 'img-b', kind: 'mockup', askId: '001', label: 'B', by: 'agent', createdAt: at(24) },
    { imageId: 'img-late', kind: 'final', by: 'agent', createdAt: at(55) },
  ];
  const ASK1 = {
    askId: '001', kind: 'choice', status: 'decided', source: 'host', fromIdeas: ['i1', 'i2'],
    results: { total: 14, options: [{ label: 'A', count: 5 }, { label: 'B', count: 9 }] },
    decision: { direction: 'Calm photo and the shift calendar', chosen: ['B'], method: 'vote', sentToAgent: true, deliveredAt: at(32), decidedAt: at(31) },
  };

  test('newest first: a picture joins what Claude showed; a mockup joins its decision, the chosen one first', () => {
    const s = roomStory({ log: LOG, asks: [ASK1], images: IMAGES });
    expect(s.map((i) => i.type)).toEqual(['picture', 'showed', 'decided', 'said']);
    expect(s[0]).toMatchObject({ heading: 'The finished product', imageIds: ['img-late'] });
    expect(s[1]).toMatchObject({ heading: 'Claude showed', text: 'The shift calendar is up', imageIds: ['img-cal'] });
    expect(s[2]).toMatchObject({ heading: 'Decided · Ask 1', text: 'Calm photo and the shift calendar', imageIds: ['img-b', 'img-a'] });
    expect(s[2].chain).toEqual(['2 ideas from the room', '9 of 14 picked it', 'Claude has it']);
    expect(s.some((i) => i.text === 'Scaffolded')).toBe(false);
  });

  test('a phone: decisions from its own list, and "your idea was in this vote"', () => {
    const s = roomStory({ log: LOG, decisions: [{ askId: '001', direction: 'Calm photo', decidedAt: at(31) }], images: IMAGES, myIdeas: [{ promotedTo: '001' }] });
    const d = s.find((i) => i.type === 'decided');
    expect(d).toMatchObject({ text: 'Calm photo', chain: [], mine: true });
  });

  test('the chain says how: the wheel, out loud, the host, a rating, and recorded only', () => {
    expect(decisionChain({ ...ASK1, fromIdeas: null, source: 'agent', decision: { ...ASK1.decision, method: 'wheel', deliveredAt: null } }))
      .toEqual(['Claude asked', 'the wheel picked it', 'waiting for Claude']);
    expect(decisionChain({ kind: 'rating', fromQuestion: 'x', results: { rating: { avg: 4.2, count: 9 } }, decision: { method: 'vote', sentToAgent: false } }))
      .toEqual(['a ready question', 'rated 4.2 of 5 by 9', 'recorded only']);
    expect(decisionChain({ kind: 'suggest', decision: { method: 'spoken', deliveredAt: 'x' } })).toEqual(['said out loud', 'Claude has it']);
  });

  test('filters: decisions only, or anything with a picture', () => {
    const s = roomStory({ log: LOG, asks: [ASK1], images: IMAGES });
    expect(filterStory(s, 'decisions').map((i) => i.type)).toEqual(['decided']);
    expect(filterStory(s, 'pictures').map((i) => i.type)).toEqual(['picture', 'showed', 'decided']);
  });

  test('artifacts say what each was for, newest first', () => {
    const a = artifactsOf({ images: IMAGES, asks: [ASK1] });
    expect(a.map((x) => [x.title, x.meta])).toEqual([
      ['A screenshot', 'Claude · the finished product'],
      ['A screenshot', 'Claude · progress'],
      ['Bold banner', 'Claude · Ask 1 mockup'],
      ['Choice B', 'Claude · Ask 1 mockup · chosen'],
    ]);
  });
});

describe('the host picks, and is told what that means (owner, 2026-10-06)', () => {
  const { pickVerdict } = require('../buildroom/buildScreens');
  const ask = (over = {}) => ({
    kind: 'choice',
    options: [{ label: 'A', title: 'Bold' }, { label: 'B', title: 'Calm' }, { label: 'C', title: 'Pair' }],
    results: { total: 14, options: [{ label: 'A', count: 3 }, { label: 'B', count: 9 }, { label: 'C', count: 2 }] },
    ...over,
  });
  test('the room\'s top pick is the preferred one; anything else is an alternate', () => {
    expect(pickVerdict(ask(), 'B')).toMatchObject({ isPreferred: true, by: 'vote', preferred: { label: 'B', count: 9 }, total: 14 });
    expect(pickVerdict(ask(), 'C')).toMatchObject({ isPreferred: false, by: 'vote', preferred: { label: 'B' }, pick: { label: 'C', text: 'Pair' } });
  });
  test('after a spin, the wheel\'s landing is the preferred one', () => {
    const spun = ask({ wheel: { landed: 'A', slices: [] } });
    expect(pickVerdict(spun, 'A')).toMatchObject({ isPreferred: true, by: 'wheel' });
    expect(pickVerdict(spun, 'B')).toMatchObject({ isPreferred: false, by: 'wheel', preferred: { label: 'A' } });
  });
  test('a tie, or no votes yet: no preferred choice', () => {
    const tie = ask({ results: { total: 4, options: [{ label: 'A', count: 2 }, { label: 'B', count: 2 }, { label: 'C', count: 0 }] } });
    expect(pickVerdict(tie, 'C')).toMatchObject({ isPreferred: false, preferred: null, tied: ['A', 'B'] });
    expect(pickVerdict(ask({ results: { total: 0, options: [] } }), 'A')).toMatchObject({ preferred: null, tied: [] });
  });
});

describe('the wall during the opening (owner, 2026-10-06)', () => {
  const { stageModel } = require('../buildroom/buildScreens');
  test('says the room is framing the build, not that Claude is building', () => {
    const room = { playerCount: 4, agent: { connected: true }, opening: { phase: 'opening' } };
    expect(stageModel(room, null).status).toBe('Framing the build.');
    expect(stageModel({ ...room, opening: { phase: 'building' } }, null).status).toBe('Send an idea any time.');
  });
});

describe('claudeState: the one status the stage, dock, host line and chip share', () => {
  const NOW = Date.parse('2026-10-07T15:00:00.000Z');
  const at = (sec) => new Date(NOW - sec * 1000).toISOString();
  const post = (sec, text = 'The dot grid', kind = 'progress') => ({ by: 'agent', kind, text, createdAt: at(sec) });
  const base = (extra = {}) => ({ agent: { connected: true, listening: false, lastSeenAt: at(5) }, log: [], activity: [], ...extra });

  test('building: an agent post in the last 90 s, with the post as the line and the time as since', () => {
    const s = claudeState(base({ log: [post(30, 'The dot grid')] }), NOW);
    expect(s).toEqual({ key: 'building', headline: 'Claude is building', line: 'The dot grid', since: at(30) });
  });

  test('building: a tool-activity line alone counts, and is the line when there is no post', () => {
    const s = claudeState(base({ activity: [{ at: at(10), kind: 'edit', text: 'Editing App.jsx' }] }), NOW);
    expect(s).toMatchObject({ key: 'building', line: 'Editing App.jsx', since: at(10) });
  });

  test('the 90 s boundary: 90 s is still building, 91 s is waiting', () => {
    expect(claudeState(base({ log: [post(90)] }), NOW).key).toBe('building');
    expect(claudeState(base({ log: [post(91)] }), NOW).key).toBe('waiting');
  });

  test('a host note or a room post is not Claude doing something', () => {
    const log = [{ by: 'host', kind: 'note', text: 'Hi', createdAt: at(5) }];
    expect(claudeState(base({ log }), NOW).key).toBe('waiting');
  });

  test('waiting: connected or listening with nothing in 90 s names what it finished', () => {
    const s = claudeState(base({ agent: { listening: true, lastSeenAt: at(3) }, log: [post(300, 'The dot grid.')] }), NOW);
    expect(s).toEqual({ key: 'waiting', headline: 'Claude is ready', line: 'Done: The dot grid.', since: null });
    expect(claudeState(base(), NOW).line).toBe('');
  });

  test('paused: seen before, neither connected nor listening', () => {
    const s = claudeState({ agent: { connected: false, listening: false, lastSeenAt: at(400) }, log: [post(500)] }, NOW);
    expect(s).toEqual({ key: 'paused', headline: 'Claude has paused', line: '', since: null });
  });

  test('none: Claude never connected', () => {
    expect(claudeState({ agent: {} }, NOW)).toEqual({ key: 'none', headline: 'Waiting for Claude Code', line: '', since: null });
    expect(claudeState({}, NOW).key).toBe('none');
  });

  test('now may be a number or an ISO string', () => {
    const room = base({ log: [post(30)] });
    expect(claudeState(room, NOW)).toEqual(claudeState(room, new Date(NOW).toISOString()));
  });

  test('on the host\'s own screen the line never speaks of the host', () => {
    const waiting = base({ agent: { listening: true, lastSeenAt: at(3) }, log: [post(300, 'The dot grid.')] });
    expect(claudeState(waiting, NOW, { host: true })).toMatchObject({ key: 'waiting', headline: 'Claude is ready', line: 'Done: The dot grid.' });
    expect(claudeState(base(), NOW, { host: true }).line).toBe('');
    const paused = { agent: { connected: false, listening: false, lastSeenAt: at(400) }, log: [post(500)] };
    expect(claudeState(paused, NOW, { host: true, continueOn: true }).line).toBe('Copy the Continue prompt.');
    expect(claudeState(paused, NOW, { host: true }).line).toBe('');
    // The Stage keeps its wording, for the room.
    expect(claudeState(paused, NOW).line).toBe('');
    for (const r of [waiting, paused, base({ log: [post(10)] })]) {
      expect(claudeState(r, NOW, { host: true, continueOn: true }).line).not.toMatch(/\bthe host\b/i);
    }
  });

  test('the latest decision reads as question and answer', () => {
    const room = { asks: [
      { askId: '001', prompt: 'Who is it for?', status: 'decided', decidedAt: at(300), decision: { direction: 'Who is it for: everyone' } },
      { askId: '002', prompt: 'What colour?', status: 'decided', decidedAt: at(100), decision: { direction: 'Blue' } },
    ] };
    expect(latestDecisionLine(room)).toBe('What colour: Blue');
    expect(latestDecisionLine({ asks: [room.asks[0]] })).toBe('Who is it for: everyone');
    expect(latestDecisionLine({ asks: [] })).toBe('');
  });
});

describe('the dock line between asks', () => {
  const room = (extra = {}) => ({ playerCount: 4, agent: { connected: true }, ...extra });
  test('Wi-Fi sharing live adds the one sentence; off or still starting does not', () => {
    const now = Date.now();
    const live = { wanted: true, status: 'live', open: 2, liveSince: new Date(now - 1000).toISOString() };
    expect(stageModel(room({ lan: live }), null, now).status).toBe('Send an idea any time. Open the build on this Wi-Fi.');
    expect(stageModel(room({ lan: { wanted: true, status: 'starting' } }), null, now).status).toBe('Send an idea any time.');
    expect(stageModel(room(), null, now).status).toBe('Send an idea any time.');
  });
});

describe('the dock never carries Claude\'s status', () => {
  const NOW = Date.now();
  const rooms = {
    building: { agent: { connected: true, lastSeenAt: new Date(NOW).toISOString() }, log: [{ by: 'agent', kind: 'progress', text: 'x', createdAt: new Date(NOW - 5000).toISOString() }] },
    waiting: { agent: { listening: true, connected: true, lastSeenAt: new Date(NOW).toISOString() } },
    paused: { agent: { lastSeenAt: new Date(NOW - 600000).toISOString() } },
    none: { agent: {} },
  };
  test.each(Object.keys(rooms))('%s: the same idea line, no Claude', (key) => {
    const room = { playerCount: 3, ...rooms[key] };
    expect(claudeState(room, NOW).key).toBe(key);
    const status = stageModel(room, null, NOW).status;
    expect(status).toBe('Send an idea any time.');
    expect(status).not.toMatch(/Claude/);
  });
});

describe('askPathStep: where the host is in one ask', () => {
  const ask = (over) => ({ askId: '004', kind: 'choice', status: 'live', prompt: 'How should it look and feel?', options: [{ label: 'A', title: 'Calm' }, { label: 'B', title: 'Playful' }], results: { total: 0, options: [] }, ...over });
  test('live and voting are Collect', () => {
    expect(askPathStep(ask())).toBe('collect');
    expect(askPathStep(ask({ kind: 'suggest', status: 'voting' }))).toBe('collect');
  });
  test('results with nothing picked is Settle', () => {
    expect(askPathStep(ask({ status: 'results' }))).toBe('settle');
  });
  test('a pick, or answering for the room, is Send', () => {
    expect(askPathStep(ask({ status: 'results' }), { pickId: 'B' })).toBe('send');
    expect(askPathStep(ask({ status: 'results', wheel: { landed: 'A', spins: [{ landed: 'A' }] } }), { pickId: 'A' })).toBe('send');
    expect(askPathStep(ask({ status: 'live' }), { answering: true })).toBe('send');
  });
  test('a landed wheel with nothing picked is still Settle: the host goes with it, or spins again (H3)', () => {
    expect(askPathStep(ask({ status: 'results', wheel: { landed: 'A', spins: [{ landed: 'A' }] } }))).toBe('settle');
  });
});

describe('askPathSummaries: what a folded step says', () => {
  test('ask, collect and settle in plain words', () => {
    const a = { askId: '004', kind: 'choice', status: 'results', prompt: 'How should it look and feel?', openedAt: '2026-10-07T14:51:00.000Z',
      options: [{ label: 'A', title: 'Calm' }, { label: 'B', title: 'Playful' }],
      results: { total: 11, options: [{ label: 'A', title: 'Calm', count: 4 }, { label: 'B', title: 'Playful', count: 7 }] } };
    const s = askPathSummaries(a, { pickId: 'B', playerCount: 12 });
    expect(s.ask).toMatch(/^Opened \d{1,2}:\d{2}/);
    expect(s.collect).toBe('11 of 12 voted');
    expect(s.settle).toBe("B \u00b7 the room's choice, 7 to 4");
  });
  test('an alternate pick says so; a wheel says so', () => {
    const a = { askId: '004', kind: 'choice', status: 'results', prompt: 'Look?', options: [{ label: 'A', title: 'Calm' }, { label: 'B', title: 'Playful' }],
      results: { total: 11, options: [{ label: 'A', title: 'Calm', count: 4 }, { label: 'B', title: 'Playful', count: 7 }] } };
    expect(askPathSummaries(a, { pickId: 'A', playerCount: 12 }).settle).toBe('A \u00b7 your pick, not B');
    expect(askPathSummaries({ ...a, wheel: { landed: 'A', spins: [{ landed: 'A' }] } }, { playerCount: 12 }).settle).toBe('The wheel picked A');
  });
});

describe('whatsNextMoves: the host between asks, most likely first', () => {
  const room = (over) => ({ asks: [], ideas: [], ...over });
  test('mockups ready lead, above vote-ideas, with the letters the Stage says', () => {
    const asks = [{ askId: '005', kind: 'choice', status: 'proposed', options: [{ label: 'A', imageId: 'i1' }, { label: 'B', imageId: 'i2' }] }];
    const ideas = [{ ideaId: 'i1', status: 'new' }, { ideaId: 'i2', status: 'new' }];
    const m = whatsNextMoves(room({ asks, ideas }));
    expect(m.map((x) => x.key)).toEqual(['vote-mockups', 'vote-ideas', 'ask-room', 'tell']);
    expect(m[0]).toEqual({ key: 'vote-mockups', askId: '005', title: "Open voting on Claude's mockups", hint: 'A and B are ready', button: 'Open voting' });
    expect(whatsNextMoves(room({ asks, opening: { phase: 'opening' } })).map((x) => x.key)).not.toContain('vote-mockups');
    expect(whatsNextMoves(room({ asks, outcome: { summary: 'Done.' } })).map((x) => x.key)).not.toContain('vote-mockups');
    expect(whatsNextMoves(room()).map((x) => x.key)).not.toContain('vote-mockups');
  });
  test('the vote-ideas title counts what the dialog takes: six at most', () => {
    const ideas = (n) => Array.from({ length: n }, (_, i) => ({ ideaId: `i${i}`, status: 'new' }));
    expect(whatsNextMoves(room({ ideas: ideas(9) }))[0]).toMatchObject({ key: 'vote-ideas', count: 6, title: 'Put 6 ideas to a vote', hint: '6 of 9 waiting' });
    expect(whatsNextMoves(room({ ideas: ideas(6) }))[0]).toMatchObject({ count: 6, title: 'Put 6 ideas to a vote', hint: '' });
    expect(whatsNextMoves(room({ ideas: ideas(3) }))[0]).toMatchObject({ count: 3, title: 'Put 3 ideas to a vote' });
  });
  test('two or more new ideas lead', () => {
    const m = whatsNextMoves(room({ ideas: [{ ideaId: 'i1', status: 'new' }, { ideaId: 'i2', status: 'new' }] }), { ticked: 3 });
    expect(m[0]).toMatchObject({ key: 'vote-ideas', count: 2, button: 'To a vote' });
    expect(m.map((x) => x.key)).toEqual(['vote-ideas', 'combine', 'ask-room', 'tell']);
  });
  test('ticked answers lead when fewer than two ideas wait', () => {
    expect(whatsNextMoves(room(), { ticked: 3 })[0]).toMatchObject({ key: 'combine', count: 3, button: 'Combine' });
  });
  test('M1: a waiting question of Claude\'s leads; no Claude connected leads over everything', () => {
    const asks = [{ askId: '006', kind: 'choice', status: 'proposed', prompt: 'Which header?', options: [{ label: 'A' }, { label: 'B' }] }];
    const m = whatsNextMoves(room({ asks }));
    expect(m[0]).toMatchObject({ key: 'open-proposed', askId: '006', title: "Open Claude's question", button: 'Open it' });
    expect(whatsNextMoves(room({ asks, agent: { connected: false } }))[0]).toMatchObject({ key: 'connect', button: 'Connect' });
    expect(whatsNextMoves(room({ agent: { key: 'k1' } })).map((x) => x.key)).not.toContain('connect');
    expect(whatsNextMoves(room()).find((x) => x.key === 'tell').hint).toBe('Do now, keep in mind, or ask Claude');
  });
  test('otherwise the starter questions lead, and combine is not offered with nothing ticked', () => {
    const m = whatsNextMoves(room(), { ticked: 0 });
    expect(m.map((x) => x.key)).toEqual(['ask-room', 'tell']);
  });
});

describe('combine: decided answers into one prompt', () => {
  test('one line per ask, question then answer, oldest decided first', () => {
    const asks = [
      { askId: '002', prompt: 'Who is it for?', decidedAt: '2026-10-07T14:40:00Z', decision: { direction: 'Who is it for: Everyone' } },
      { askId: '001', prompt: 'What are we building?', decidedAt: '2026-10-07T14:30:00Z', decision: { direction: 'An app' } },
    ];
    expect(combineLine(asks[1])).toBe('What are we building? An app');
    expect(combineLine(asks[0])).toBe('Who is it for? Everyone');
    expect(combineText(asks)).toBe('What are we building? An app\nWho is it for? Everyone');
  });
});

describe('mockupsReady: something for the room to look at before a vote', () => {
  test('a proposed choice ask whose options all have pictures', () => {
    const room = { asks: [{ askId: '005', kind: 'choice', status: 'proposed', options: [{ label: 'A', title: 'Calm', imageId: 'im1' }, { label: 'B', title: 'Playful', imageId: 'im2' }] }], images: [] };
    expect(mockupsReady(room)).toMatchObject({ ask: { askId: '005' }, images: [{ label: 'A', imageId: 'im1' }, { label: 'B', imageId: 'im2' }] });
  });
  test('nothing when an option has no picture yet, or there is no proposed choice', () => {
    expect(mockupsReady({ asks: [{ askId: '005', kind: 'choice', status: 'proposed', options: [{ label: 'A', imageId: 'im1' }, { label: 'B' }] }], images: [] })).toBeNull();
    expect(mockupsReady({ asks: [], images: [] })).toBeNull();
  });
});

describe('fix round 1: honest summaries and combine lines', () => {
  const base = (over) => ({ askId: '004', kind: 'choice', status: 'results', prompt: 'Look?', options: [{ label: 'A', title: 'Calm' }, { label: 'B', title: 'Playful' }],
    results: { total: 11, options: [{ label: 'A', title: 'Calm', count: 4 }, { label: 'B', title: 'Playful', count: 7 }] }, ...over });
  const tie = { total: 8, options: [{ label: 'A', count: 4 }, { label: 'B', count: 4 }] };
  test('tie, no votes and rating asks say it was the host\'s pick', () => {
    expect(askPathSummaries(base({ results: tie }), { pickId: 'B' }).settle).toBe('B \u00b7 your pick');
    expect(askPathSummaries(base({ results: { total: 0, options: [] } }), { pickId: 'A' }).settle).toBe('A \u00b7 your pick');
    expect(askPathSummaries({ askId: '9', kind: 'rating', status: 'results', prompt: 'Rate', results: { total: 3 } }, { pickId: '4' }).settle).toBe('4 \u00b7 your pick');
  });
  test('wheel equal to the pick, and wheel then a different pick', () => {
    const w = base({ wheel: { landed: 'A', spins: [{ landed: 'A' }] } });
    expect(askPathSummaries(w, { pickId: 'A' }).settle).toBe('The wheel picked A');
    expect(askPathSummaries(w, { pickId: 'B' }).settle).toBe("B \u00b7 your pick, not the wheel's A");
  });
  test('collect never reads more voted than the room size', () => {
    expect(askPathSummaries(base(), { playerCount: 9 }).collect).toBe('11 of 11 voted');
  });
  test('combineLine keeps the prompt ending', () => {
    const l = (prompt, direction) => combineLine({ prompt, decision: { direction } });
    expect(l('Pick a colour:', 'blue')).toBe('Pick a colour: blue');
    expect(l('Name the app', 'Summit')).toBe('Name the app: Summit');
    expect(l('Name the app', 'Name the app: Summit')).toBe('Name the app: Summit');
    expect(l('Who is it for?', '')).toBe('Who is it for?');
  });
});

describe('S4: the stage says the mockups are ready', () => {
  const ready = { playerCount: 12, state: 'STARTED', asks: [{ askId: '005', kind: 'choice', status: 'proposed', options: [{ label: 'A', title: 'Calm', imageId: 'i1' }, { label: 'B', title: 'Playful', imageId: 'i2' }] }], images: [] };
  test('stageModel offers Open voting with the ask id', () => {
    const m = stageModel(ready, null, Date.now());
    expect(m.status).toBe('Mockups ready');
    expect(m.primary).toEqual({ action: 'open', label: 'Open voting', askId: '005' });
  });
  test('not while the opening frames the build, nor on the crew board', () => {
    const framing = { ...ready, opening: { phase: 'opening' } };
    expect(stageModel(framing, null, Date.now()).primary).toBeNull();
    expect(stageModel({ ...ready, opening: { phase: 'building' } }, null, Date.now()).primary).toMatchObject({ action: 'open' });
    expect(stageModel(ready, null, Date.now(), { crewOn: true }).primary).toBeNull();
    expect(stageModel(ready, null, Date.now(), { crewOn: true }).status).not.toMatch(/Mockups ready/);
  });
  test('no primary without mockups, or once an ask is current', () => {
    expect(stageModel({ ...ready, asks: [] }, null, Date.now()).primary).toBeNull();
    expect(stageModel(ready, { askId: '006', kind: 'rating', status: 'live' }, Date.now()).primary.action).toBe('close');
  });
  test('the words: Two looks, and N looks for more', () => {
    expect(looksWords([{ label: 'A' }, { label: 'B' }])).toMatchObject({ headline: 'Two looks to compare', line: 'Claude made A and B.' });
    expect(looksWords([{ label: 'A' }, { label: 'B' }, { label: 'C' }])).toMatchObject({ headline: '3 looks to compare', line: 'Claude made A, B and C.' });
  });
});

describe('the direction carries what the room voted on (owner, 2026-10-10)', () => {
  const ask = {
    kind: 'choice', prompt: 'What should we build next?',
    options: [
      { label: 'A', title: 'Scroll to scale', detail: '' },
      { label: 'B', title: 'What could it fix?', detail: 'Their fortune against real price tags: ending hunger, clean water' },
    ],
    results: { options: [{ label: 'A', title: 'Scroll to scale', count: 1 }, { label: 'B', title: 'What could it fix?', count: 3 }] },
  };
  test('a winning option sends its title and its detail', () => {
    expect(defaultDirection(ask)).toBe('What should we build next: What could it fix? (Their fortune against real price tags: ending hunger, clean water)');
    expect(directionFor(ask, 'B')).toBe(defaultDirection(ask));
    expect(roomChoice(ask).direction).toBe(defaultDirection(ask));
  });
  test('an option without detail sends its title alone', () => {
    expect(directionFor(ask, 'A')).toBe('What should we build next: Scroll to scale');
  });
  test('the wheel landing on an option carries its detail too', () => {
    const w = { ...ask, wheel: { landed: 'B', slices: [{ id: 'A', label: 'A', text: 'Scroll to scale' }, { id: 'B', label: 'B', text: 'What could it fix?' }] } };
    expect(defaultDirection(w)).toMatch(/What could it fix\? \(Their fortune against real price tags/);
  });
});

describe('the doing line (docs/design/build-room-doing D1-D5)', () => {
  const NOW = Date.parse('2026-10-10T10:30:00.000Z');
  const at = (sec) => new Date(NOW - sec * 1000).toISOString();
  const doing = (over = {}) => ({
    text: 'Mocking up 3 graph options', past: '', source: 'claude', startedAt: at(250), stale: false, helper: '', lastActiveAt: at(10), ...over,
  });
  const room = (d, extra = {}) => ({ agent: { connected: true, listening: false, lastSeenAt: at(5) }, log: [], activity: [], doing: d, ...extra });

  test('the screens prepend Claude is, lower-case the first letter and say how long', () => {
    expect(doingLine(doing(), NOW)).toMatchObject({ headline: 'Claude is mocking up 3 graph options', stale: false, mins: 4, dur: '4 min', helper: '' });
    expect(doingLine(doing({ startedAt: at(20) }), NOW).dur).toBe('under 1 min');
    expect(doingLine(null, NOW)).toBeNull();
    expect(doingLine(doing({ text: '  ' }), NOW)).toBeNull();
  });

  test('stale is re-derived from lastActiveAt as time passes, not read from the snapshot', () => {
    expect(doingLine(doing({ stale: true, lastActiveAt: at(10) }), NOW).stale).toBe(false);
    const d = doing({ stale: false, lastActiveAt: at(181) });
    expect(doingLine(d, NOW)).toMatchObject({ stale: true, headline: 'Claude was mocking up 3 graph options' });
    expect(doingLine(d, NOW - 60 * 1000).stale).toBe(false);
  });

  test('a line is the building status: headline, the helper as the line, the start as since', () => {
    const s = claudeState(room(doing({ helper: 'Researching contrast rules' })), NOW);
    expect(s).toMatchObject({ key: 'building', headline: 'Claude is mocking up 3 graph options', line: 'A helper is researching contrast rules', since: at(250) });
    expect(s.doing.dur).toBe('4 min');
  });

  test('a line holds the building status past the old 90 seconds', () => {
    expect(claudeState(room(doing({ lastActiveAt: at(150) })), NOW).key).toBe('building');
  });

  test('a stale line is paused, in the past tense, with the same follow-ups as today', () => {
    const r = room(doing({ lastActiveAt: at(300) }));
    expect(claudeState(r, NOW)).toMatchObject({ key: 'paused', headline: 'Claude was mocking up 3 graph options', line: '' });
    expect(claudeState(r, NOW, { host: true, continueOn: true }).line).toBe('Copy the Continue prompt.');
    expect(claudeState(r, NOW, { host: true }).line).toBe('');
  });

  test('Claude waiting for direction is never Claude is: the status stays ready', () => {
    const r = room(doing(), { agent: { connected: true, listening: true, lastSeenAt: at(5) } });
    expect(claudeState(r, NOW).key).toBe('waiting');
  });

  test('no line leaves the status exactly as it was', () => {
    expect(claudeState(room(null), NOW)).toEqual(claudeState({ ...room(null), doing: undefined }, NOW));
    expect(claudeState(room(null, { log: [{ by: 'agent', kind: 'progress', text: 'x', createdAt: at(30) }] }), NOW).headline).toBe('Claude is building');
  });

  describe('History: a finished step groups what it produced', () => {
    const step = (id, startS, endS, text) => ({
      logId: id, kind: 'step', text, createdAt: at(endS), by: 'agent', step: { startedAt: at(startS), endedAt: at(endS), durationMs: (startS - endS) * 1000, source: 'todo' },
    });
    const log = [
      step('p1', 2000, 1640, 'Done: Set up the project'),
      step('p2', 1600, 1000, 'Scaffolded the site'),
      { logId: 'm1', kind: 'milestone', by: 'agent', text: 'The first page runs', createdAt: at(1200) },
      { logId: 's1', kind: 'showing', by: 'agent', text: 'The empty dashboard', createdAt: at(1100) },
      { logId: 'v1', kind: 'verbal', by: 'host', text: 'Between steps', createdAt: at(900) },
    ];

    test('the step is the entry; its checkpoint and showing hang under it, oldest first', () => {
      const story = roomStory({ log });
      expect(story.map((i) => i.type)).toEqual(['said', 'step', 'step']);
      const s = story[1];
      expect(s).toMatchObject({ heading: 'Scaffolded the site', dur: '10 min' });
      expect(s.kids.map((k) => k.text)).toEqual(['The first page runs', 'The empty dashboard']);
      expect(story[2]).toMatchObject({ heading: 'Done: Set up the project', dur: '6 min', kids: [] });
    });

    test('a to-do step keeps the item words with Done:, and one under a minute says so', () => {
      const story = roomStory({ log: [step('q', 30, 0, 'Done: Rename it')] });
      expect(story[0].heading).toBe('Done: Rename it');
      expect(story[0].dur).toBe('under 1 min');
      expect(roomStory({ log: [{ logId: 'z', kind: 'step', text: 'Done: X marks', createdAt: at(0), step: { startedAt: at(0), endedAt: at(0), durationMs: 0 } }] })[0].dur).toBe('');
    });

    test('commands never reach History: a run or agent line in the log is not an entry', () => {
      const noisy = [...log, { logId: 'c1', kind: 'run', by: 'agent', text: 'Ran npm test', createdAt: at(1150) }, { logId: 'c2', kind: 'agent', by: 'agent', text: 'Asked a helper agent', createdAt: at(1120) }];
      const all = roomStory({ log: noisy }).flatMap((i) => [i, ...(i.kids || [])]);
      expect(all.some((i) => /Ran npm|helper agent/.test(i.heading + i.text))).toBe(false);
      expect(all.length).toBeGreaterThan(3);
    });

    test('a step under two minutes is floored: 119 s is 1 min', () => {
      expect(roomStory({ log: [step('f', 119, 0, 'Done: Quick')] })[0].dur).toBe('1 min');
    });

    test('the step in progress sits first, with how long so far; a stale one writes nothing', () => {
      const live = doingLine(doing({ text: 'Building the bar chart', startedAt: at(125) }), NOW);
      const top = roomStory({ log, doing: live })[0];
      expect(top).toMatchObject({ type: 'step', now: true, heading: 'Building the bar chart', dur: '2 min so far' });
      const stale = doingLine(doing({ lastActiveAt: at(400) }), NOW);
      expect(roomStory({ log, doing: stale }).some((i) => i.now)).toBe(false);
    });

    test('the Decisions and Pictures filters still find what a step holds', () => {
      const dlog = [
        step('p2', 600, 100, 'Scaffolded the site'),
        { logId: 'i1', kind: 'image', by: 'agent', text: 'Home', detail: 'img1', createdAt: at(300) },
      ];
      const story = roomStory({
        log: dlog, images: [{ imageId: 'img1', createdAt: at(300) }],
        asks: [{ askId: '002', status: 'decided', decision: { direction: 'Bars', decidedAt: at(200), chosen: [] }, decidedAt: at(200) }],
      });
      expect(filterStory(story, 'decisions').map((i) => i.type)).toEqual(['decided']);
      expect(filterStory(story, 'pictures').map((i) => i.type)).toEqual(['picture']);
    });
  });
});

describe('a helper with no line of Claude\'s own (docs/design/build-room-doing)', () => {
  const NOW = Date.parse('2026-10-10T10:30:00.000Z');
  const at = (sec) => new Date(NOW - sec * 1000).toISOString();
  const helperOnly = (over = {}) => ({ text: '', source: '', startedAt: null, stale: false, helper: 'Researching contrast rules', lastActiveAt: at(10), ...over });
  const room = (d, extra = {}) => ({
    agent: { connected: true, listening: false, lastSeenAt: at(5) }, log: [], activity: [{ at: at(20), kind: 'run', text: 'Ran npm test' }], doing: d, ...extra,
  });

  test('doingLine gives a view for a helper alone, with no headline', () => {
    expect(doingLine(helperOnly(), NOW)).toMatchObject({ text: '', headline: '', helperLine: 'A helper is researching contrast rules' });
    expect(doingLine({ text: '', helper: '' }, NOW)).toBeNull();
  });

  test('the status keeps today\'s headline and carries the helper line', () => {
    const s = claudeState(room(helperOnly()), NOW);
    expect(s).toMatchObject({ key: 'building', headline: 'Claude is building', helperLine: 'A helper is researching contrast rules' });
    expect(s.doing).toBeUndefined();
    expect(claudeState(room(null), NOW).helperLine).toBeUndefined();
  });

  test('History writes no step in progress for a helper alone', () => {
    expect(roomStory({ log: [], doing: doingLine(helperOnly(), NOW) }).some((i) => i.now)).toBe(false);
  });
});

describe('the doing line against a wrong clock', () => {
  const NOW = Date.parse('2026-10-10T10:30:00.000Z');
  const at = (sec) => new Date(NOW - sec * 1000).toISOString();
  test('a start in the future counts as 0 min, not negative', () => {
    expect(doingLine({ text: 'Building it now', startedAt: at(-90), lastActiveAt: at(0) }, NOW).mins).toBe(0);
  });
  test('a laptop clock more than 2 min behind the server falls back to the server flag', () => {
    expect(doingLine({ text: 'Building it now', startedAt: at(-600), lastActiveAt: at(-400), stale: true }, NOW).stale).toBe(true);
    expect(doingLine({ text: 'Building it now', startedAt: at(-600), lastActiveAt: at(-400), stale: false }, NOW).stale).toBe(false);
    // Within 2 min of agreeing, the client's own clock rules.
    expect(doingLine({ text: 'Building it now', startedAt: at(100), lastActiveAt: at(-60), stale: true }, NOW).stale).toBe(false);
  });
});

describe('copy pass (2026-10-10): the Stage says the fewest words', () => {
  const NOW = Date.now();
  const words = (t) => String(t || '').trim().split(/\s+/).filter(Boolean).length;
  const base = { playerCount: 12, state: 'STARTED', agent: { connected: true } };
  const live = { wanted: true, status: 'live', open: 2, liveSince: new Date(NOW - 1000).toISOString() };
  const CHOICE = { askId: '003', kind: 'choice', status: 'live', answerCount: 5, options: [{ label: 'A', title: 'Calm' }, { label: 'B', title: 'Bold' }] };
  const results = (o = {}) => ({ ...CHOICE, status: 'results', results: { total: 7, options: [{ label: 'A', count: 2 }, { label: 'B', count: 5 }] }, ...o });
  const ready = { ...base, asks: [{ askId: '005', kind: 'choice', status: 'proposed', options: [{ label: 'A', title: 'Calm', imageId: 'i1' }, { label: 'B', title: 'Bold', imageId: 'i2' }] }] };
  const waiting = { ...base, agent: { listening: true, lastSeenAt: new Date(NOW - 3000).toISOString() }, log: [{ by: 'agent', kind: 'progress', text: 'The dot grid.', createdAt: new Date(NOW - 300000).toISOString() }] };
  /** Every sentence the Stage can put on the wall in these states, with the Claude line the room reads. */
  const stageStrings = () => [
    stageModel(base, null, NOW).status,
    stageModel({ ...base, lan: live }, null, NOW).status,
    stageModel({ ...base, opening: { phase: 'opening' } }, null, NOW).status,
    stageModel({ ...base, state: 'ENDED' }, null, NOW).status,
    stageModel(ready, null, NOW).status,
    looksWords(ready.asks[0].options).line,
    looksWords(ready.asks[0].options).next,
    stageModel(base, CHOICE, NOW).status,
    stageModel(base, { ...CHOICE, status: 'voting', voteCount: 4 }, NOW).status,
    stageModel(base, { askId: '004', kind: 'suggest', status: 'live', answerCount: 3 }, NOW).status,
    stageModel(base, results(), NOW).status,
    stageModel(base, results({ results: { total: 4, options: [{ label: 'A', count: 2 }, { label: 'B', count: 2 }] } }), NOW).status,
    claudeState(waiting, NOW).headline,
    claudeState(waiting, NOW).line,
    W.talkPrompt,
  ];

  test('no Stage line runs past twelve words, and together they stay under 70', () => {
    const all = stageStrings();
    all.forEach((s) => expect(words(s)).toBeLessThanOrEqual(12));
    const total = all.reduce((n, s) => n + words(s), 0);
    expect(total).toBeLessThanOrEqual(70);
  });

  test('the Stage names no device and says nothing the host alone needs', () => {
    const all = stageStrings().join(' | ');
    expect(all).not.toMatch(/phone|laptop|tablet/i);
    expect(all).not.toMatch(/the host (will|opens)/i);
  });

  test('a paused Claude says nothing about the host to the room', () => {
    const s = claudeState({ agent: { connected: false, listening: false, lastSeenAt: new Date(NOW - 400000).toISOString() }, log: [] }, NOW);
    expect(s.line).toBe('');
    expect(claudeState({ ...base, agent: { listening: true }, log: [] }, NOW).line).toBe('');
  });

  test('the Space hint is words; it lives only in the dock\'s hover state (see buildStageDecide)', () => {
    expect(W.spaceTo('send')).toBe('Press Space to send');
  });
});

/* Revy review (2026-10-10): after three people suggested, the header said
   "3 of 3" while the folded step said "0 of 3 answered" (it counted votes).
   Both now count the people who suggested; the step adds ideas and votes. */
describe('an Ideas ask counts the people who suggested, in the header and the step alike', () => {
  const suggest = (extra) => ({ askId: '3', kind: 'suggest', status: 'live', prompt: 'What else?', answerCount: 5, respondents: 3, voteCount: 0, results: { total: 0 }, ...extra });
  test('the header pill', () => {
    expect(askPill({ currentAskId: '3', playerCount: 4, asks: [suggest()] }).text).toBe('Ask 3 · 3 of 4');
  });
  test('the step: who suggested and how many ideas, then the votes once voting starts', () => {
    expect(askPathSummaries(suggest(), { playerCount: 4 }).collect).toBe('3 of 4 suggested · 5 ideas');
    expect(askPathSummaries(suggest({ status: 'voting', voteCount: 2, results: { total: 2 } }), { playerCount: 4 }).collect).toBe('3 of 4 suggested · 5 ideas · 2 voted');
    expect(askPathSummaries(suggest({ answerCount: 1, respondents: 1 }), { playerCount: 4 }).collect).toBe('1 of 4 suggested · 1 idea');
  });
  test('an older server without respondents: the ideas stand in', () => {
    expect(askPathSummaries(suggest({ respondents: undefined }), { playerCount: 4 }).collect).toBe('5 of 5 suggested · 5 ideas');
  });
});
