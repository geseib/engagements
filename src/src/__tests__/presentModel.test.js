import { presentModel } from '../present/presentModel';

const Q = { title: 'What should we stop doing', detail: 'Name one habit.', category: 'Retro', setRoundNoun: null };
const base = (over = {}) => ({
  gameId: '5479',
  gameType: 'call-and-answer',
  gameMetadata: { title: 'Q4 Wrap up' },
  state: 'ASK#005',
  currentQuestion: 5,
  currentQuestionData: Q,
  stageBeat: 'results',
  stageFocus: { focus: 'none', index: null, part: 0, parts: 1, phase: null, rev: 0 },
  stageNotes: { page: 0, pages: null, plan: null, planKey: null, rev: 0 },
  stageProfile: null,
  scoreboard: { open: false },
  authorsRevealed: false,
  roomCounts: { joined: 5, answered: 3, voted: 0 },
  ...over,
});

const NAMED = [
  { answer: 'Design our incident runbooks now. Test them cheaply.', playerName: 'Maya-Chen-7', name: 'Maya-Chen-7' },
  { answer: 'Usage pricing, with ten shadow invoices.', playerName: 'Sam-Okafor-7', name: 'Sam-Okafor-7' },
  { answer: 'A support playbook for dropping logins.', playerName: 'Priya-Nair-7' },
];
const TALLIES = {
  0: { playerName: 'Maya-Chen-7', answerText: NAMED[0].answer, totalScore: 8, firstPlace: 2, secondPlace: 1, thirdPlace: 0 },
  1: { playerName: 'Sam-Okafor-7', answerText: NAMED[1].answer, totalScore: 7, firstPlace: 1, secondPlace: 2, thirdPlace: 0 },
  2: { playerName: 'Priya-Nair-7', answerText: NAMED[2].answer, totalScore: 9, firstPlace: 3, secondPlace: 0, thirdPlace: 0 },
};

describe('presentModel: the moment', () => {
  it('no snapshot is WAITING; a missing game is NOT_FOUND', () => {
    expect(presentModel(null).moment).toBe('WAITING');
    expect(presentModel({ notFound: true }).moment).toBe('NOT_FOUND');
  });
  it('LOBBY carries the code, the join address and the joined count', () => {
    const m = presentModel(base({ state: 'CREATED', currentQuestion: 0, currentQuestionData: null }), { origin: 'https://engage.dev.seibtribe.us' });
    expect(m.moment).toBe('LOBBY');
    expect(m.code).toBe('5479');
    expect(m.joinUrl).toBe('https://engage.dev.seibtribe.us/play?gameId=5479');
    expect(m.joinHost).toBe('engage.dev.seibtribe.us/play');
    expect(m.joined).toBe(5);
    expect(m.nextLabel).toBe('Round 1');
  });
  it('ANSWERING carries the question and counts only', () => {
    const m = presentModel(base());
    expect(m.moment).toBe('ANSWERING');
    expect(m.title).toBe(Q.title);
    expect(m.task).toBe(Q.detail);
    expect(m.counts).toEqual({ done: 3, of: 5, line: '3 of 5 answered' });
    expect(m.roundLabel).toBe('Round 5');
  });
  it('the set\'s own round noun names the round', () => {
    expect(presentModel(base({ currentQuestionData: { ...Q, setRoundNoun: 'Lesson' } })).roundLabel).toBe('Lesson 5');
  });
  it('VOTING shows the count and how many answers are on the devices', () => {
    const m = presentModel(base({ state: 'VOTE#005', roomCounts: { joined: 5, answered: 4, voted: 2 } }));
    expect(m.moment).toBe('VOTING');
    expect(m.lead).toBe('4 answers are on your phone, laptop or tablet.');
    expect(m.counts.line).toBe('2 of 5 voted');
  });
  it('RESULTS: tally order, top five and "and N more"', () => {
    const many = {};
    for (let i = 0; i < 9; i += 1) many[i] = { playerName: `P${i}`, answerText: `answer ${i}`, totalScore: i, firstPlace: 0, secondPlace: 0, thirdPlace: 0 };
    const m = presentModel(base({ state: 'RESULTS#005', authorsRevealed: true }), { results: { voteTallies: many } });
    expect(m.moment).toBe('RESULTS');
    expect(m.rows.map((r) => r.points)).toEqual([8, 7, 6, 5, 4]);
    expect(m.more).toBe(4);
  });
  it('RESULTS honours names: a revealed round names, a hidden one says Response N', () => {
    const named = presentModel(base({ state: 'RESULTS#005', authorsRevealed: true }), { results: { voteTallies: TALLIES } });
    expect(named.rows[0].label).toBe('Priya-Nair-7');
    const hidden = presentModel(base({ state: 'RESULTS#005', authorsRevealed: false }), { results: { voteTallies: TALLIES } });
    expect(JSON.stringify(hidden)).not.toMatch(/Chen|Okafor|Nair/);
  });
  it('RESPONSES: the focused response in tally order, with its part', () => {
    const m = presentModel(base({
      state: 'RESULTS#005', authorsRevealed: true,
      stageFocus: { focus: 'answer', index: 1, part: 1, parts: 2, phase: 'RESULTS', rev: 3 },
    }), { results: { voteTallies: TALLIES } });
    expect(m.moment).toBe('RESPONSES');
    expect(m.index).toBe(1);
    expect(m.total).toBe(3);
    expect(m.focused.label).toBe('Maya-Chen-7');
    expect(m.focused.meta).toBe('8 vote points');
    expect(m.part).toBe(1);
    expect(m.parts).toBe(2);
    expect(m.text).toBe('Test them cheaply.');
    expect(m.position).toBe('Response 2 of 3');
  });
  it('VOTE_RESPONSE: voting order, no name, no points anywhere, even when the input has names', () => {
    const m = presentModel(base({
      state: 'VOTE#005', stageFocus: { focus: 'answer', index: 1, part: 0, parts: 1, phase: 'VOTE', rev: 2 },
    }), { answers: NAMED });
    expect(m.moment).toBe('VOTE_RESPONSE');
    expect(m.focused.label).toBe('Response 2 · name hidden');
    expect(m.text).toBe(NAMED[1].answer);
    const json = JSON.stringify(m);
    expect(json).not.toMatch(/Chen|Okafor|Nair|playerName|points/i);
  });
  it('a VOTE focus read at RESULTS is no focus (never a tally rank)', () => {
    const m = presentModel(base({
      state: 'RESULTS#005', stageFocus: { focus: 'answer', index: 0, part: 0, parts: 1, phase: 'VOTE', rev: 2 },
    }), { results: { voteTallies: TALLIES } });
    expect(m.moment).toBe('RESULTS');
  });
  it('READ: the page the server holds, sliced as the host page slices it', () => {
    const md = '## What the room said\n\n- one\n\n## Discussion topics\n\n1. two';
    const m = presentModel(base({ state: 'RESULTS#005', stageBeat: 'field-notes', stageNotes: { page: 1, pages: 2, rev: 4 } }), { summary: { markdownResponse: md } });
    expect(m.moment).toBe('READ');
    expect(m.page).toBe(1);
    expect(m.pages).toBe(2);
    expect(m.content).toMatch(/Discussion topics/);
    expect(m.position).toBe('Page 2 of 2');
  });
  it('READ before Workie has written is a quiet "Workie is writing"', () => {
    const m = presentModel(base({ state: 'RESULTS#005', stageBeat: 'field-notes' }), { summary: null });
    expect(m.moment).toBe('READ_WAIT');
  });
  it('QUESTION_FOCUS, SCOREBOARD over any moment, ENDED', () => {
    expect(presentModel(base({ state: 'RESULTS#005', stageFocus: { focus: 'question', index: null, part: 0, parts: 1, phase: null, rev: 1 } })).moment).toBe('QUESTION_FOCUS');
    expect(presentModel(base({ scoreboard: { open: true, look: 'departure' } })).scoreboard).toEqual({ open: true, look: 'departure' });
    expect(presentModel(base({ state: 'ENDED' })).moment).toBe('ENDED');
  });
  it('FEEDBACK carries the round and the title, not the task (owner, 2026-10-13)', () => {
    const m = presentModel(base({ state: 'RESULTS#005', stageBeat: 'feedback' }));
    expect(m.moment).toBe('FEEDBACK');
    expect(m.roundLabel).toBe('Round 5');
    expect(m.title).toBe('What should we stop doing');
    expect(m.task).toBeUndefined();
  });
  it('FEEDBACK carries the comment the host put up: the newest featured, credited as the laptop does', () => {
    const comments = [
      { text: 'Old pick', featured: true, featuredAt: '2026-10-13T10:00:00Z', playerName: 'Bea', anchorKind: 'summary' },
      { text: 'Not up', featured: false, playerName: 'Ada', anchorKind: 'results' },
      { text: 'Name the customer.', featured: true, featuredAt: '2026-10-13T10:05:00Z', playerName: 'Said in the room', fromHost: true, anchorKind: 'results' },
    ];
    const m = presentModel(base({ state: 'RESULTS#005', stageBeat: 'feedback' }), { comments });
    expect(m.featured).toEqual({ text: 'Name the customer.', who: '', credit: 'Said in the room' });
    const named = presentModel(base({ state: 'RESULTS#005', stageBeat: 'feedback' }), { comments: comments.slice(0, 2) });
    expect(named.featured).toEqual({ text: 'Old pick', who: 'Bea', credit: 'on the summary' });
    expect(presentModel(base({ state: 'RESULTS#005', stageBeat: 'feedback' }), { comments: [] }).featured).toBeNull();
  });
  it('the profile is the session fact, Room by default', () => {
    expect(presentModel(base()).profile).toBe('room');
    expect(presentModel(base({ stageProfile: 'tv' })).profile).toBe('tv');
    expect(presentModel(base({ stageProfile: 'bogus' })).profile).toBe('room');
  });
  it('ANSWERING carries counts only: no names, even if a stray list arrives', () => {
    const m = presentModel(base({ answererNames: ['Maya-Chen-7'] }), { answers: NAMED });
    expect(JSON.stringify(m)).not.toMatch(/Chen|Okafor|Nair/);
  });
});

describe('the join code mid-session (owner, 2026-10-13)', () => {
  it('a join focus during a round shows the code, the QR address and the room count', () => {
    const m = presentModel(base({ state: 'VOTE#005', stageFocus: { focus: 'join', index: null, part: 0, parts: 1, phase: null, rev: 2 } }),
      { origin: 'https://engage.dev.seibtribe.us' });
    expect(m.moment).toBe('JOIN');
    expect(m.code).toBe('5479');
    expect(m.joinUrl).toBe('https://engage.dev.seibtribe.us/play?gameId=5479');
    expect(m.joined).toBe(5);
    expect(m.roundLabel).toBe('Round 5');
  });
});
