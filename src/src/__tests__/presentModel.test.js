import { presentModel, ordinal, ladderOf, voteChipsOf } from '../present/presentModel';

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
    // Session 7924 finding #4: the task is the instruction, not the story.
    expect(m.task).toBe('How could you adapt this lesson to your work, project, or team?');
    expect(m.story).toBe(Q.detail);
    expect(m.counts).toEqual({ done: 3, of: 5, line: '3 of 5 answered' });
    expect(m.roundLabel).toBe('Round 5');
  });
  it('the task is the question\'s own instruction, then the set\'s, on the wall while answering and voting', () => {
    const own = { ...Q, customInstructions: 'Name one habit to drop.', setCustomInstruction: 'Set says this.' };
    expect(presentModel(base({ currentQuestionData: own })).task).toBe('Name one habit to drop.');
    const set = { ...Q, setCustomInstruction: 'Which structure must go, and who gains?' };
    expect(presentModel(base({ currentQuestionData: set })).task).toBe('Which structure must go, and who gains?');
    // Voting carries the lesson, "The question", when there is one (owner, 18 Oct 2026).
    expect(presentModel(base({ state: 'VOTE#005', currentQuestionData: { ...set, detail: '' } })).task).toBe('Which structure must go, and who gains?');
    const voting = presentModel(base({ state: 'VOTE#005', currentQuestionData: set }));
    expect(voting.task).toBe(String(Q.detail || Q.questionDetail));
    expect(voting.taskLabel).toBe('The question');
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
  // THE END, AS THE STAGE ENDS (19 Oct 2026): the window said only "Thank
  // you"; the one-screen stage says how many rounds were played, how many
  // are in the room, and the podium where its own rule allows one.
  describe('ENDED matches the stage\'s end', () => {
    const PLAYERS = [
      { playerName: 'Ada', totalScore: 12 }, { playerName: 'Ben', totalScore: 9 },
      { playerName: 'Cleo', totalScore: 4 }, { playerName: 'Dev', totalScore: 2 }, { playerName: 'Eve', totalScore: 0 },
    ];
    const ended = (over = {}) => base({ state: 'ENDED', currentQuestion: 4, ...over });
    it('rounds played and the room count, in the stage\'s words', () => {
      const m = presentModel(ended(), {});
      expect(m.moment).toBe('ENDED');
      expect(m.played).toBe('4 rounds played');
      expect(m.inRoom).toBe('5 in the room · the full write-up is in the session report');
      expect(presentModel(ended({ currentQuestion: 1 }), {}).played).toBe('1 round played');
    });
    it('the podium: top three who scored, only once the names are out (the stage\'s podiumEntries)', () => {
      const m = presentModel(ended({ authorsRevealed: true }), { players: PLAYERS });
      expect(m.podium.map((e) => [e.name, e.score])).toEqual([['Ada', 12], ['Ben', 9], ['Cleo', 4]]);
      expect(m.podium[0].label).toBeTruthy();
    });
    it('no podium while a round\'s authors are still hidden, nor before the players are read', () => {
      expect(presentModel(ended({ authorsRevealed: false }), { players: PLAYERS }).podium).toEqual([]);
      expect(presentModel(ended({ authorsRevealed: true }), {}).podium).toEqual([]);
    });
    it('trivia names no answers, so its podium needs no reveal; wavelength scores nothing, so has none', () => {
      expect(presentModel(ended({ gameType: 'trivia' }), { players: PLAYERS }).podium).toHaveLength(3);
      expect(presentModel(ended({ gameType: 'wavelength', authorsRevealed: true }), { players: PLAYERS.map((p) => ({ ...p, totalScore: 0 })) }).podium).toEqual([]);
    });
  });

  // A COMMENT PUT UP DURING RESULTS OR THE READ (19 Oct 2026): the stage
  // shows it (FeedbackWall, once one is featured); the window read comments
  // only on the feedback beat, so it never did.
  it('RESULTS and the read carry the featured comment, as FEEDBACK does', () => {
    const comments = [{ text: 'Name the customer.', featured: true, featuredAt: '2026-10-13T10:05:00Z', playerName: 'Said in the room', fromHost: true, anchorKind: 'results' }];
    const want = { text: 'Name the customer.', who: '', credit: 'Said in the room' };
    expect(presentModel(base({ state: 'RESULTS#005' }), { comments }).featured).toEqual(want);
    expect(presentModel(base({ state: 'RESULTS#005', stageBeat: 'field-notes', stageNotes: { page: 0, pages: 2 } }), { comments, summary: { markdownResponse: '## A\n\nb' } }).featured).toEqual(want);
    expect(presentModel(base({ state: 'RESULTS#005', stageBeat: 'field-notes' }), { comments }).featured).toEqual(want);
    expect(presentModel(base({ state: 'RESULTS#005' }), { comments: [] }).featured).toBeNull();
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

describe('the QR beside the moment (owner, 18 Oct 2026: "it moves the screen around a bit so all content is there")', () => {
  const ORIGIN = { origin: 'https://engage.dev.seibtribe.us' };
  it('stageFocus.join during a round keeps the moment and carries the join facts beside it', () => {
    const m = presentModel(base({ state: 'VOTE#005', stageFocus: { focus: 'none', index: null, join: true } }), ORIGIN);
    expect(m.moment).toBe('VOTING');
    expect(m.join.code).toBe('5479');
    expect(m.join.joinUrl).toBe('https://engage.dev.seibtribe.us/play?gameId=5479');
    expect(m.join.joinHost).toBe('engage.dev.seibtribe.us/play');
    expect(m.join.joined).toBe(5);
  });
  it('a legacy focus of join reads the same way', () => {
    const m = presentModel(base({ state: 'ASK#005', stageFocus: { focus: 'join', index: null } }), ORIGIN);
    expect(m.moment).toBe('ANSWERING');
    expect(m.join.code).toBe('5479');
  });
  it('the QR sits beside an answer put up, and beside the results', () => {
    const vote = presentModel(base({ state: 'VOTE#005', stageFocus: { focus: 'answer', index: 1, phase: 'VOTE', join: true } }), { ...ORIGIN, answers: NAMED });
    expect(vote.moment).toBe('VOTE_RESPONSE');
    expect(vote.join).toBeTruthy();
    const results = presentModel(base({ state: 'RESULTS#005', stageFocus: { focus: 'none', join: true } }), ORIGIN);
    expect(results.moment).toBe('RESULTS');
    expect(results.join).toBeTruthy();
  });
  it('a moment with nothing of its own gives the wall to the join code whole', () => {
    const m = presentModel(base({ state: 'RESULTS#005', stageBeat: 'field-notes', stageFocus: { focus: 'none', join: true } }), ORIGIN);
    expect(m.moment).toBe('JOIN');
    expect(m.code).toBe('5479');
    expect(m.roundLabel).toBe('Round 5');
  });
  it('join: false, or no round, is no panel', () => {
    expect(presentModel(base({ state: 'VOTE#005', stageFocus: { focus: 'none', join: false } }), ORIGIN).join).toBeUndefined();
    expect(presentModel(base({ state: 'CREATED', stageFocus: { focus: 'none', join: true } }), ORIGIN).join).toBeUndefined();
  });
});

describe('voting opens on all the answers when they fit (owner, 18 Oct 2026, frame 4)', () => {
  const SHORT = [{ answer: 'Shadow mode for two weeks.' }, { answer: 'A buddy for the first on-call.' }, { answer: 'Feature flags at 1%, 10%, 50%.' }];
  it('every answer, whole and numbered, no name; the overview flag for the keys', () => {
    const m = presentModel(base({ state: 'VOTE#005', roomCounts: { joined: 5, answered: 3, voted: 1 } }), { answers: SHORT.map((a, i) => ({ ...a, playerName: `P${i}` })) });
    expect(m.moment).toBe('VOTING');
    expect(m.overview).toBe(true);
    expect(m.total).toBe(3);
    expect(m.answers).toEqual(SHORT.map((a, i) => ({ n: i + 1, text: a.answer })));
    expect(JSON.stringify(m)).not.toMatch(/P0|P1|P2|points/);
    expect(m.counts.line).toBe('1 of 5 voted');
  });
  it('when they do not fit, answer 1 is up as before, and the model says so', () => {
    const long = Array.from({ length: 7 }, (_, i) => ({ answer: `Answer ${i} is long enough to count. `.repeat(3) }));
    const m = presentModel(base({ state: 'VOTE#005' }), { answers: long });
    expect(m.moment).toBe('VOTE_RESPONSE');
    expect(m.overview).toBe(false);
    expect(m.index).toBe(0);
  });
  it('an answer put up while voting is the one up, with chips for where it sits', () => {
    const m = presentModel(base({ state: 'VOTE#005', stageFocus: { focus: 'answer', index: 2, phase: 'VOTE' } }), { answers: SHORT });
    expect(m.moment).toBe('VOTE_RESPONSE');
    expect(m.overview).toBe(true);
    expect(m.chips.map((c) => [c.n, c.current])).toEqual([[1, false], [2, false], [3, true]]);
  });
});

describe('one result up (frame 12)', () => {
  const TALLY = { voteTallies: { 0: { playerName: 'Maya', answerText: 'A', totalScore: 4 }, 1: { playerName: 'Sam', answerText: 'B', totalScore: 8 } } };
  it('carries its place and a ladder of shares; names hidden means no points anywhere', () => {
    const m = presentModel(base({ state: 'RESULTS#005', stageFocus: { focus: 'answer', index: 1, phase: 'RESULTS' } }), { results: TALLY });
    expect(m.moment).toBe('RESPONSES');
    expect(m.place).toBe('2nd');
    expect(m.ladder.map((r) => [r.label, r.share, r.current, r.points])).toEqual([['1', 1, false, null], ['2', 0.5, true, null]]);
    expect(m.credit).toBeNull();
    expect(JSON.stringify(m)).not.toMatch(/Maya|Sam/);
  });
  it('a named round adds the credit', () => {
    const m = presentModel(base({ state: 'RESULTS#005', authorsRevealed: true, stageFocus: { focus: 'answer', index: 0, phase: 'RESULTS' } }), { results: TALLY });
    expect(m.place).toBe('1st');
    expect(m.credit).toBe('8 points — Sam');
  });
});

describe('the small helpers behind frames 11 and 12', () => {
  it('ordinal says a place out loud', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 103].map(ordinal)).toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '103rd']);
  });
  const rows = (n) => Array.from({ length: n }, (_, i) => ({ n: i + 1, share: 1 - i * 0.1, top: i === 0, points: null }));
  it('the ladder shows up to five rungs and folds the rest into a range', () => {
    expect(ladderOf(rows(4), 1).map((r) => r.label)).toEqual(['1', '2', '3', '4']);
    expect(ladderOf(rows(9), 1).map((r) => r.label)).toEqual(['1', '2', '3', '4', '5–9']);
    expect(ladderOf(rows(9), 6).map((r) => [r.label, r.current])).toEqual([
      ['1', false], ['2', false], ['3', false], ['4–6', false], ['7', true], ['8–9', false],
    ]);
    expect(ladderOf(rows(6), 5).map((r) => r.label)).toEqual(['1', '2', '3', '4–5', '6']);
  });
  it('the chips are every number up to twelve, else a window with an ellipsis', () => {
    expect(voteChipsOf(3, 1).map((c) => c.n)).toEqual([1, 2, 3]);
    const long = voteChipsOf(30, 15);
    expect(long[0].gap).toBe(true);
    expect(long[long.length - 1].gap).toBe(true);
    expect(long.filter((c) => !c.gap)).toHaveLength(11);
    expect(long.find((c) => c.current).n).toBe(16);
  });
});
