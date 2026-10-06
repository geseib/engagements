/**
 * The Build Room's four screens: the pure rules (buildroom/buildScreens.js).
 */
import {
  SCREENS, PROJECTED, isProjected, screenForKey, togglePresent, waitingCount, askPill, latestBuild, stageModel,
  queueItems, filterQueue, laterIdeas,
  decisionChoices, winnerOf, directionFor, questionAnswer, decisionMethod, RATING_SCALE, ratingAnswer, ratingStep,
} from '../buildroom/buildScreens';

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
      status: '5 of 18 have answered',
      primary: { action: 'close', label: 'Close and show results' },
      secondary: { action: 'wheel', label: 'Spin the wheel instead' },
    });
  });

  test('Ideas collecting opens voting; voting closes; results go back to the Host to decide', () => {
    expect(stageModel(room(), { askId: '004', kind: 'suggest', status: 'live', answerCount: 1 }))
      .toMatchObject({ phase: 'ASK', status: '1 idea so far', primary: { action: 'vote' } });
    expect(stageModel(room(), { askId: '004', kind: 'suggest', status: 'voting', voteCount: 7 }))
      .toMatchObject({ phase: 'VOTE', meter: { heading: 'Voted', count: 7, of: 18 }, primary: { action: 'close' } });
    expect(stageModel(room(), { askId: '004', kind: 'rating', status: 'results', results: { total: 15 } }))
      .toMatchObject({ phase: 'RESULTS', meter: { count: 15, of: 18 }, primary: { action: 'decide', label: 'Decide on Host' } });
  });

  test('between asks: no chip, who is here, and what Claude is doing, in room-safe words', () => {
    expect(stageModel(room(), null)).toMatchObject({ phase: null, meter: { heading: 'In the room', count: 18 }, status: 'Claude is building. Send an idea from your phone any time.', primary: null });
    expect(stageModel(room({ agent: {} }), null).status).toBe('Waiting for Claude Code.');
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
      primary: { action: 'spin', label: 'Spin' }, secondary: { action: 'decide', label: 'Decide on Host' },
    });
  });
  test('landed: Spin again', () => {
    expect(stageModel(room, results({ spinner: 'Dee', armed: false, landed: 'B', spins: [{}] }))).toMatchObject({
      status: 'The wheel has picked', primary: { label: 'Spin again' },
    });
  });
  test('after a revote, the old ask is plain results', () => {
    expect(stageModel(room, { ...results({ spinner: null, armed: false, landed: null, spins: [] }), revotedAs: '004' })).toMatchObject({
      status: 'Results', primary: { action: 'decide' },
    });
  });
});

describe('the wheel instead of a vote (owner, 2026-10-06)', () => {
  const room = { playerCount: 18, agent: { connected: true } };
  test('a Choose, an Ideas ask with two or more ideas, and a vote all offer it; a rating does not', () => {
    expect(stageModel(room, { askId: '1', kind: 'suggest', status: 'live', answerCount: 1 }).secondary).toBeUndefined();
    expect(stageModel(room, { askId: '1', kind: 'suggest', status: 'live', answerCount: 2 }).secondary).toEqual({ action: 'wheel', label: 'Spin the wheel instead' });
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
  test('on the Stage the winning vote is the button', () => {
    expect(stageModel({ playerCount: 3 }, { askId: '3', ...choose([1, 3, 0]) }).primary).toEqual({ action: 'decide', label: 'Go with B' });
    expect(stageModel({ playerCount: 3 }, { askId: '3', ...choose([2, 2, 0]) }).primary.label).toBe('Decide on Host');
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
