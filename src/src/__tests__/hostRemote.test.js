import {
  parseGamePhase,
  runsVotePhase,
  remoteStep,
  snapshotFromHostState,
  requestFor,
  roundProgress,
  needsConfirmation,
  phaseSummary,
  waitingOn,
  fieldNotesFrom,
  rosterListing,
  remotePanelTabs,
  TYPES_WITH_NO_VOTE_AT_RUNTIME,
} from '../config/hostRemote';
import { GAME_TYPES, hasVotePhase } from '../config/gameTypes';

const ALL_TYPES = Object.keys(GAME_TYPES);

describe('parseGamePhase', () => {
  it('splits the stored round states into phase and number', () => {
    expect(parseGamePhase('ASK#001')).toMatchObject({ phase: 'ASK', round: 1 });
    expect(parseGamePhase('VOTE#012')).toMatchObject({ phase: 'VOTE', round: 12 });
    expect(parseGamePhase('RESULTS#003')).toMatchObject({ phase: 'RESULTS', round: 3 });
  });

  it('accepts the WebSocket spelling RESULT# as well as the stored RESULTS#', () => {
    // PlayerPage already tolerates both spellings; the remote must not be the
    // one surface that disagrees about what RESULT#002 means.
    expect(parseGamePhase('RESULT#002')).toMatchObject({ phase: 'RESULTS', round: 2 });
  });

  it('recognises the bare lifecycle states', () => {
    expect(parseGamePhase('CREATED').phase).toBe('CREATED');
    expect(parseGamePhase('STARTED').phase).toBe('STARTED');
    expect(parseGamePhase('ENDED').phase).toBe('ENDED');
  });

  it('degrades to UNKNOWN instead of throwing on junk', () => {
    // Every one of these has been observed in a half-loaded payload or a
    // pre-fix version of the remote, which read `gameState.currentState` — a
    // field the API has never emitted — and rendered blank.
    for (const junk of [undefined, null, '', '   ', {}, 42, [], 'voting', 'ASK#']) {
      expect(() => parseGamePhase(junk)).not.toThrow();
      expect(parseGamePhase(junk).phase).toBe('UNKNOWN');
      expect(parseGamePhase(junk).round).toBeNull();
    }
  });
});

describe('runsVotePhase', () => {
  it('matches the config table for every type it does not override', () => {
    for (const type of ALL_TYPES) {
      if (TYPES_WITH_NO_VOTE_AT_RUNTIME.includes(type)) continue;
      expect(runsVotePhase(type)).toBe(hasVotePhase(type));
    }
  });

  it('agrees with config/gameTypes.js for every type', () => {
    // This replaces a test that PINNED a divergence: gameTypes.js claimed
    // wavelength voted (it never has) and that survey did not (it does), so the
    // remote carried an override. The table is corrected, the override is gone,
    // and there is now one answer to "does this type vote?". If anyone
    // reintroduces a second one, this fails.
    for (const type of ALL_TYPES) {
      expect(runsVotePhase(type)).toBe(hasVotePhase(type));
    }

    expect(runsVotePhase('wavelength')).toBe(false);
    expect(runsVotePhase('trivia')).toBe(false);
    // Surveys phase 2: a survey has no rounds, so no vote — the config table
    // says COLLECTING → CLOSED and the remote reads the same table.
    expect(runsVotePhase('survey')).toBe(false);
  });

  it('normalises legacy spellings rather than defaulting them to no-vote', () => {
    expect(runsVotePhase('callandanswer')).toBe(true);
    expect(runsVotePhase('quiz')).toBe(false);
    expect(runsVotePhase(undefined)).toBe(true); // falls back to call-and-answer
  });
});

/*
  THE REMOTE READS roundStep (two-surface Phase 1, R1). `primaryAction` and its
  ACTIONS table restated the dock and drifted three ways (simplify-round
  AUDIT §2); they are gone. The Remote now turns its /host-state payload into
  roundStep's snapshot (`snapshotFromHostState`) and draws whatever comes back.
  These cases are the old primaryAction table, re-asked through the new door.
*/
const stepOf = (state, gameType, stageBeat, extras = {}) =>
  remoteStep({ state, gameType, stageBeat, ...extras.json }, extras);

describe('remoteStep — every game type x every phase, through roundStep', () => {
  it('opens round 1 from CREATED and STARTED', () => {
    for (const type of ALL_TYPES) {
      if (type === 'survey') continue;
      for (const state of ['CREATED', 'STARTED']) {
        const step = stepOf(state, type);
        expect(step.primary.id).toBe('start');
        expect(step.primary.label).toMatch(/^Start \w+ 1$/);
        expect(requestFor(step.primary.id, { gameId: '4821' }).path).toBe('games/4821/next-question');
      }
    }
  });

  it('offers nothing to press for a survey — open, closed, or not yet opened', () => {
    for (const state of ['SURVEY#OPEN', 'SURVEY#CLOSED', 'CREATED', 'STARTED']) {
      const step = stepOf(state, 'survey');
      expect(step.primary).toMatchObject({ id: 'wait', disabled: true });
      expect(step.secondary).toBeNull();
    }
  });

  it('offers voting from ASK only for the types that actually vote', () => {
    for (const type of ALL_TYPES) {
      if (type === 'survey') continue;
      const step = stepOf('ASK#001', type, null, { json: { answerProgress: { answersReceived: 1, totalPlayers: 1 } } });
      expect(step.primary.id).toBe(runsVotePhase(type) ? 'open-vote' : 'reveal-from-ask');
    }
  });

  it('never offers "Start voting" for trivia or wavelength', () => {
    for (const type of ['trivia', 'wavelength']) {
      for (const state of ['CREATED', 'STARTED', 'ASK#001', 'VOTE#001', 'RESULTS#001', 'ENDED']) {
        expect(stepOf(state, type).primary.id).not.toBe('open-vote');
      }
    }
  });

  it('shows results from VOTE for every round type', () => {
    for (const type of ALL_TYPES) {
      if (type === 'survey') continue;
      expect(stepOf('VOTE#004', type).primary).toMatchObject({ id: 'reveal', label: 'Show results' });
    }
  });

  it('offers the read first on RESULTS, for every round type', () => {
    for (const type of ALL_TYPES) {
      if (type === 'survey') continue;
      expect(stepOf('RESULTS#001', type).primary).toMatchObject({ id: 'field-notes', label: 'What we heard' });
    }
  });

  it('advances from the read with the set noun, then the game type noun', () => {
    const onNotes = (type, extras) => stepOf('RESULTS#001', type, 'field-notes', extras);
    expect(onNotes('trivia').primary).toMatchObject({ id: 'next', label: 'Next question' });
    expect(onNotes('call-and-answer').primary.label).toBe('Next round');
    expect(onNotes('wavelength').primary.label).toBe('Next subject');
    expect(onNotes('poll').primary.label).toBe('Next poll');
    // The set's own noun wins, as on the host page (R6).
    expect(onNotes('call-and-answer', { roundNoun: 'Lesson' }).primary.label).toBe('Next lesson');
  });

  it('treats every beat it does not know as the tally beat', () => {
    for (const beat of [undefined, null, '', 'results', 'RESULTS', 'anything']) {
      expect(stepOf('RESULTS#002', 'trivia', beat).primary.id).toBe('field-notes');
    }
  });

  it('does not offer to go backwards during a feedback round', () => {
    const step = stepOf('RESULTS#001', 'call-and-answer', 'feedback');
    expect(step.primary).toMatchObject({ id: 'next', label: 'Next round' });
    expect(step.secondary).toMatchObject({ id: 'close-feedback' });
  });

  it('ignores the beat outside RESULTS', () => {
    expect(stepOf('ASK#001', 'call-and-answer', 'field-notes').primary.id).toBe('open-vote');
    expect(stepOf('ASK#001', 'trivia', 'field-notes').primary.id).toBe('reveal-from-ask');
    expect(stepOf('VOTE#001', 'poll', 'field-notes').primary.id).toBe('reveal');
  });

  it('ENDED offers the report and the way back to the menu', () => {
    for (const type of ALL_TYPES) {
      if (type === 'survey') continue;
      const step = stepOf('ENDED', type);
      expect(step.primary).toMatchObject({ id: 'report', label: 'Open session report', disabled: false });
      expect(step.secondary).toMatchObject({ id: 'leave', label: 'Back to menu' });
    }
  });

  it('an unreadable state waits, and never looks like the lobby', () => {
    for (const state of [undefined, 'nonsense', '']) {
      const step = stepOf(state, 'trivia');
      expect(step.primary).toMatchObject({ id: 'wait', disabled: true });
      expect(step.status.text).toBe('Waiting for the session');
    }
  });

  it('Skip is the secondary while the room answers or votes', () => {
    expect(stepOf('ASK#001', 'call-and-answer').secondary).toMatchObject({ id: 'skip' });
    expect(stepOf('VOTE#001', 'call-and-answer').secondary).toMatchObject({ id: 'skip' });
    expect(stepOf('RESULTS#001', 'call-and-answer').secondary).toBeNull();
  });

  it('the read is paged from the server facts, and never skipped while Workie writes', () => {
    const json = { stageNotes: { page: 0, pages: 3, plan: null, planKey: null, rev: 2 } };
    const paged = stepOf('RESULTS#001', 'call-and-answer', 'field-notes', { json, notesReady: true });
    expect(paged.primary).toMatchObject({ id: 'notes-page', label: 'Next page' });
    expect(paged.secondary).toMatchObject({ id: 'next', label: 'Next round' });
    expect(paged.status.text).toBe('Reading page 1 of 3');

    const writing = stepOf('RESULTS#001', 'call-and-answer', 'field-notes', { json, notesReady: false });
    expect(writing.primary).toMatchObject({ id: 'show-read', disabled: true, hint: 'Workie is writing' });
    expect(writing.secondary).toMatchObject({ id: 'next' });
  });

  it('a response on the wall at RESULTS is the responses moment', () => {
    const json = { stageFocus: { focus: 'answer', index: 0, part: 0, parts: 1, phase: 'RESULTS', rev: 1 } };
    const step = stepOf('RESULTS#001', 'call-and-answer', 'results', { json, answerCount: 3 });
    expect(step.moment).toBe('RESPONSES');
    expect(step.primary).toMatchObject({ id: 'next-response', index: 1 });
    expect(step.secondary).toMatchObject({ id: 'stop-showing' });
  });

  it('progress from /host-state arms the early advance', () => {
    const json = { answerProgress: { answersReceived: 2, totalPlayers: 5 } };
    expect(stepOf('ASK#001', 'call-and-answer', null, { json }).primary.arm)
      .toEqual({ text: '3 still answering. Press again to start voting.' });
  });
});

describe('snapshotFromHostState', () => {
  it('normalises the payload into roundStep\'s snapshot', () => {
    const snap = snapshotFromHostState({
      state: 'VOTE#002', gameType: 'call-and-answer', stageBeat: 'results',
      votingProgress: { votesReceived: 3, totalPlayers: 4, votersIds: ['a'] },
      stageNotes: { page: 1, pages: 2 },
    }, { playerCount: 4, answerCount: 6, roundNoun: 'Lesson', hasQuestionSet: true, notesReady: true });
    expect(snap).toMatchObject({
      state: 'VOTE#002', gameType: 'call-and-answer',
      progress: { received: 3, total: 4, allIn: false },
      notes: { page: 1, pages: 2, ready: true },
      playerCount: 4, answerCount: 6, roundNoun: 'Lesson',
    });
  });

  it('a survey reads as a moment the Remote cannot drive', () => {
    expect(snapshotFromHostState({ state: 'CREATED', gameType: 'survey' }).state).toMatch(/^SURVEY#/);
  });

  it('survives a missing payload', () => {
    expect(() => snapshotFromHostState(null)).not.toThrow();
    expect(remoteStep(null).primary.id).toBe('wait');
  });
});

describe('skip on the Remote always asks twice', () => {
  it('Skip carries a confirmation even when everyone is in', () => {
    // `action: 'skip'` bypasses next-question.js's "already asking" guard, so
    // unlike an ordinary advance a double-fire really does consume two
    // questions and display one.
    const step = stepOf('ASK#001', 'call-and-answer', null, { json: { answerProgress: { answersReceived: 4, totalPlayers: 4 } } });
    expect(needsConfirmation(step.secondary)).toBe(true);
  });
});

describe('requestFor', () => {
  it('builds the same calls the host toolbar makes', () => {
    expect(requestFor('next', { gameId: '4821' })).toEqual({
      path: 'games/4821/next-question',
      body: {},
    });
    expect(requestFor('skip', { gameId: '4821' })).toEqual({
      path: 'games/4821/next-question',
      body: { action: 'skip' },
    });
    expect(requestFor('vote', { gameId: '4821', round: 3 })).toEqual({
      path: 'games/4821/start-vote',
      body: { questionNumber: 3 },
    });
    // Closing the round is the AUTHENTICATED half of the results handler. The
    // public POST /games/get-results may only read a round that is already
    // resolved, so a remote pointed at it would 403 instead of advancing the
    // room — and, before the split, any participant could have driven the room
    // and ended its anonymity from a phone.
    expect(requestFor('results', { gameId: '4821', round: 3 })).toEqual({
      path: 'games/4821/close-round',
      body: { questionNumber: 3 },
    });
    expect(requestFor('results', { gameId: '4821', round: 3 }).path)
      .not.toContain('get-results');
  });

  it('posts the stage beat to the authenticated stage-beat route', () => {
    // The beat is a server fact now, not client state: the projector follows
    // over `stageBeatChanged`, and a host page reload comes back on the same
    // beat. Posting it anywhere else would move the phone and nothing else.
    expect(requestFor('field-notes', { gameId: '4821', round: 3 })).toEqual({
      path: 'games/4821/stage-beat',
      body: { beat: 'field-notes', questionNumber: 3 },
    });
  });

  it('refuses round-addressed calls when the round is unknown', () => {
    // Guessing round 1 here would resolve or vote on the wrong round.
    expect(requestFor('vote', { gameId: '4821' })).toBeNull();
    expect(requestFor('results', { gameId: '4821', round: null })).toBeNull();
    // The beat is written on ROUND#nnn. Defaulting the round would write it on
    // a round that is not on screen: the phone would show it as done and the
    // projector would never move.
    expect(requestFor('field-notes', { gameId: '4821' })).toBeNull();
    expect(requestFor('field-notes', { gameId: '4821', round: null })).toBeNull();
  });

  it('maps every roundStep id the Remote can press to the host page\'s route', () => {
    const at = { gameId: '4821', round: 3 };
    expect(requestFor('start', at)).toEqual({ path: 'games/4821/next-question', body: {} });
    expect(requestFor('open-vote', at)).toEqual({ path: 'games/4821/start-vote', body: { questionNumber: 3 } });
    expect(requestFor('reveal-from-ask', at)).toEqual({ path: 'games/4821/close-round', body: { questionNumber: 3 } });
    expect(requestFor('reveal', at)).toEqual({ path: 'games/4821/close-round', body: { questionNumber: 3 } });
    // The report is built first: the room's devices fetch it as the beat moves.
    expect(requestFor('request-feedback', at)).toEqual({
      before: { path: 'games/4821/report', body: {} },
      path: 'games/4821/stage-beat', body: { beat: 'feedback', questionNumber: 3 },
    });
    expect(requestFor('close-feedback', at)).toEqual({
      path: 'games/4821/stage-beat', body: { beat: 'field-notes', questionNumber: 3 },
    });
  });

  it('turns Workie\'s page relative to the stored page, so two surfaces cannot fight', () => {
    expect(requestFor('notes-page', { gameId: '4821', round: 3 })).toEqual({
      path: 'games/4821/stage-beat', body: { step: 'next', questionNumber: 3 },
    });
    expect(requestFor('notes-back', { gameId: '4821', round: 3 })).toEqual({
      path: 'games/4821/stage-beat', body: { step: 'prev', questionNumber: 3 },
    });
    expect(requestFor('notes-page', { gameId: '4821' })).toBeNull();
  });

  it('the acts that are not a POST have no request', () => {
    for (const id of ['report', 'leave', 'wait', 'show-read', 'show-response', 'next-response', 'stop-showing']) {
      expect(requestFor(id, { gameId: '4821', round: 3 })).toBeNull();
    }
  });

  it('refuses everything without a game id, and ignores unknown actions', () => {
    expect(requestFor('next', {})).toBeNull();
    expect(requestFor('next')).toBeNull();
    expect(requestFor('explode', { gameId: '4821' })).toBeNull();
  });
});

describe('roundProgress', () => {
  const asking = (answersReceived, totalPlayers) => ({
    state: 'ASK#002',
    answerProgress: { answersReceived, totalPlayers },
  });

  it('reads the answer tally while asking', () => {
    expect(roundProgress(asking(12, 14))).toMatchObject({
      kind: 'answers',
      received: 12,
      total: 14,
      allIn: false,
      label: '12 of 14 answered',
    });
  });

  it('reads the vote tally while voting', () => {
    expect(roundProgress({
      state: 'VOTE#002',
      votingProgress: { votesReceived: 5, totalPlayers: 9 },
    })).toMatchObject({ kind: 'votes', received: 5, total: 9, label: '5 of 9 voted' });
  });

  it('is "all in" only when every active player has responded', () => {
    expect(roundProgress(asking(13, 14)).allIn).toBe(false);
    expect(roundProgress(asking(14, 14)).allIn).toBe(true);
  });

  it('is never "all in" for an empty room', () => {
    // 0 of 0 is a room with nobody in it, not a room that has finished. A green
    // badge here would cost a round.
    const empty = roundProgress(asking(0, 0));
    expect(empty.allIn).toBe(false);
    expect(empty.label).toBe('Nobody has answered yet');
  });

  it('clamps a tally that runs ahead of the deduplicated player count', () => {
    // The server counts ANSWER# rows but deduplicates PLAYER# rows by name, so
    // one person who rejoined can push received past total. "15 of 14" reads as
    // a bug to a host standing in front of a room.
    expect(roundProgress(asking(15, 14))).toMatchObject({ received: 14, allIn: true });
  });

  it('reports nothing to wait for outside the responding phases', () => {
    for (const state of ['CREATED', 'STARTED', 'RESULTS#002', 'ENDED']) {
      expect(roundProgress({ state, answerProgress: { answersReceived: 3, totalPlayers: 4 } }))
        .toMatchObject({ applicable: false, kind: null, allIn: false });
    }
  });

  it('degrades without crashing on a missing or partial payload', () => {
    for (const payload of [undefined, null, {}, 'nope', { state: 'ASK#001' },
      { state: 'ASK#001', answerProgress: null },
      { state: 'ASK#001', answerProgress: {} },
      { state: 'ASK#001', answerProgress: { answersReceived: 'x', totalPlayers: undefined } }]) {
      expect(() => roundProgress(payload)).not.toThrow();
      const progress = roundProgress(payload);
      expect(progress.allIn).toBe(false);
      expect(Number.isFinite(progress.received)).toBe(true);
      expect(Number.isFinite(progress.total)).toBe(true);
    }
  });
});

describe('needsConfirmation', () => {
  const ask = (received, total) => stepOf('ASK#001', 'call-and-answer', null,
    { json: { answerProgress: { answersReceived: received, totalPlayers: total } } }).primary;

  it('demands the second tap when advancing would discard responses', () => {
    expect(needsConfirmation(ask(1, 4))).toBe(true);
    expect(needsConfirmation(stepOf('VOTE#001', 'poll', null,
      { json: { votingProgress: { votesReceived: 1, totalPlayers: 4 } } }).primary)).toBe(true);
  });

  it('gets out of the way once the room is done', () => {
    expect(needsConfirmation(ask(4, 4))).toBe(false);
  });

  it('does not gate the beats that discard nothing', () => {
    expect(needsConfirmation(stepOf('RESULTS#001', 'trivia').primary)).toBe(false);
    expect(needsConfirmation(stepOf('CREATED', 'trivia').primary)).toBe(false);
  });

  it('is false when there is no action at all', () => {
    expect(needsConfirmation(null)).toBe(false);
    expect(needsConfirmation(undefined)).toBe(false);
  });
});

describe('waitingOn — who the room is still waiting for', () => {
  /**
   * The shape `GET /games/{id}/players` actually returns
   * (lambda-functions/game/get-players.js:101-152). `isReady` is deliberately
   * NOT what this reads: get-players sets it to `true` for everyone during
   * RESULTS, and to `hasAnswered` during ASK — so a filter on `isReady` gives
   * the right answer in one phase by accident and the wrong one in the others.
   */
  const roster = (players) => ({ players, stats: { totalPlayers: players.length } });
  const person = (playerName, { hasAnswered = false, hasVoted = false } = {}) => ({
    playerName,
    totalScore: 0,
    isConnected: true,
    readiness: { isReady: hasAnswered, type: 'answered', hasAnswered, hasVoted },
  });

  it('lists who has not answered while the room is answering', () => {
    const result = waitingOn(roster([
      person('Dana'),
      person('Ada', { hasAnswered: true }),
      person('Tomás'),
    ]), 'ASK#003');

    expect(result.applicable).toBe(true);
    expect(result.names).toEqual(['Dana', 'Tomás']);
    expect(result.heading).toBe('Still to answer');
  });

  it('lists who has not VOTED while the room is voting', () => {
    // The sharp one. By VOTE everyone has answered, so a filter left on
    // `hasAnswered` yields an empty list and the block silently never appears —
    // during the one phase where "hey George, we are waiting on you" is the
    // whole reason the list exists.
    const result = waitingOn(roster([
      person('Dana', { hasAnswered: true, hasVoted: false }),
      person('Ada', { hasAnswered: true, hasVoted: true }),
    ]), 'VOTE#003');

    expect(result.applicable).toBe(true);
    expect(result.names).toEqual(['Dana']);
    expect(result.heading).toBe('Still to vote');
  });

  it('has nothing to say outside the responding phases', () => {
    // get-players reports hasVoted:false for every player once the round has
    // resolved. Rendering this on RESULTS would name the entire room as
    // holding the session up, on the screen where nobody is being waited for.
    for (const state of ['CREATED', 'STARTED', 'RESULTS#003', 'ENDED', 'garbage', undefined]) {
      const result = waitingOn(roster([person('Dana'), person('Ada')]), state);
      expect(result.applicable).toBe(false);
      expect(result.names).toEqual([]);
    }
  });

  it('is empty, not absent, once everybody is in', () => {
    // "Everyone is in" is a different statement from "the list is not loaded",
    // and the caller has to be able to tell them apart.
    const result = waitingOn(roster([person('Ada', { hasAnswered: true })]), 'ASK#001');
    expect(result.applicable).toBe(true);
    expect(result.names).toEqual([]);
  });

  it('degrades instead of throwing on a partial or absent roster', () => {
    // The remote polls this every six seconds on a phone signal. A TypeError
    // here white-screens the only control the host is holding.
    for (const payload of [undefined, null, {}, 'nope', { players: null },
      { players: [{}] }, { players: [{ playerName: 'Dana' }] },
      { players: [{ playerName: 'Dana', readiness: null }] }]) {
      expect(() => waitingOn(payload, 'ASK#001')).not.toThrow();
      expect(Array.isArray(waitingOn(payload, 'ASK#001').names)).toBe(true);
    }
    // A player row carrying no readiness block has not been seen to act, so it
    // belongs in the list rather than being quietly dropped from the count.
    expect(waitingOn({ players: [{ playerName: 'Dana' }] }, 'ASK#001').names).toEqual(['Dana']);
    // …but a row with no name cannot be called out, so it is not a chip.
    expect(waitingOn({ players: [{}] }, 'ASK#001').names).toEqual([]);
  });
});

describe('fieldNotesFrom — the AI read-back, as the server spells it', () => {
  it('reads discussionQuestions, the name the server actually returns', () => {
    // THE TRAP: GameHostPage renames this to `discussionTopics` on the way into
    // its own state (GameHostPage.jsx:775). Copying that name here reads a
    // field `GET /games/{id}/ai-summary` has never emitted, and the phone shows
    // a headline with no numbered points under it — plausibly, and silently.
    const notes = fieldNotesFrom({
      summary: 'The room wants to defend price.',
      discussionQuestions: ['Who would we let go?', 'Why were the cheap moves popular?'],
      nextSteps: ['Pick one takeaway.'],
    });

    expect(notes.ready).toBe(true);
    expect(notes.lead).toBe('The room wants to defend price.');
    expect(notes.topics).toEqual(['Who would we let go?', 'Why were the cheap moves popular?']);
    expect(notes.nextSteps).toEqual(['Pick one takeaway.']);
  });

  it('falls back to summaryText when there is no summary', () => {
    // get-ai-summary's FRESHLY GENERATED response (get-ai-summary.js:1113-1116)
    // carries summaryText and no `summary` key at all — only the cached read
    // (:568) carries both. Reading `summary` alone gives a blank headline in
    // exactly the moment the beat is used: the first time a round is closed.
    const notes = fieldNotesFrom({ summaryText: 'Nobody proposed telling a customer why.' });
    expect(notes.lead).toBe('Nobody proposed telling a customer why.');
    expect(notes.ready).toBe(true);
  });

  it('is not ready when the summary has not been generated yet', () => {
    // The endpoint answers 404 with `{ status: 'not_ready' }` on a cache miss,
    // which is the normal state for the first second or two of RESULTS.
    for (const payload of [undefined, null, {}, 'nope', { status: 'not_ready' },
      { summary: '', discussionQuestions: [] }]) {
      expect(() => fieldNotesFrom(payload)).not.toThrow();
      expect(fieldNotesFrom(payload).ready).toBe(false);
      expect(fieldNotesFrom(payload).topics).toEqual([]);
    }
  });

  it('is ready on points alone, even with no headline', () => {
    expect(fieldNotesFrom({ discussionQuestions: ['One point'] })).toMatchObject({
      ready: true, lead: '', topics: ['One point'],
    });
  });

  it('never hands the renderer something it cannot map over', () => {
    // These have all been observed from the parser's fallback paths, where an
    // unparsed section yields a bare string rather than a list.
    const notes = fieldNotesFrom({
      summary: 'ok',
      discussionQuestions: 'not a list',
      nextSteps: null,
    });
    expect(notes.topics).toEqual([]);
    expect(notes.nextSteps).toEqual([]);
  });

  it('drops blank entries rather than rendering empty numbered rows', () => {
    expect(fieldNotesFrom({
      summary: 'ok',
      discussionQuestions: ['Real question', '', '   ', null],
    }).topics).toEqual(['Real question']);
  });
});

describe('phaseSummary', () => {
  it('names the round with the game type\'s own noun', () => {
    expect(phaseSummary({ state: 'ASK#003', gameType: 'trivia' })).toMatchObject({
      headline: 'Question 3',
      detail: 'Collecting responses',
    });
    expect(phaseSummary({ state: 'VOTE#003', gameType: 'call-and-answer' }).headline).toBe('Round 3');
  });

  it('falls back to gameMetadata.gameType when the top-level field is absent', () => {
    expect(phaseSummary({ state: 'ASK#001', gameMetadata: { gameType: 'wavelength' } }).headline)
      .toBe('Subject 1');
  });

  it('never renders undefined for a missing or unreadable payload', () => {
    for (const payload of [undefined, null, {}, { state: 'garbage' }]) {
      const summary = phaseSummary(payload);
      expect(summary.headline).toBe('Waiting…');
      expect(summary.detail).toBe('No game state yet');
    }
  });
});

/* ------------------------------------------------- the session panel's data */

describe('remotePanelTabs', () => {
  // Rejects: renaming the rounds tab's id on this surface. The desktop panel
  // calls it `history` (config/setupPanel.js:32) and labels it `Rounds`; two
  // surfaces showing one list under two internal names is how they drift.
  it('uses the desktop panel\'s ids', () => {
    expect(remotePanelTabs().map((t) => t.id)).toEqual(['players', 'history', 'questions']);
    expect(remotePanelTabs().map((t) => t.label)).toEqual(['Players', 'Rounds', 'Questions']);
  });

  // Rejects: adding Settings "for parity". Everything in the desktop's fourth
  // tab is already on the remote's round view — the join QR, the categories,
  // the big-screen pad and Switch game — one tap away and visible without
  // opening anything.
  it('offers exactly the three lists the owner named', () => {
    expect(remotePanelTabs()).toHaveLength(3);
    expect(remotePanelTabs().some((t) => t.id === 'settings')).toBe(false);
  });
});

describe('rosterListing', () => {
  const person = (playerName, extra = {}) => ({
    playerName, totalScore: 0, isConnected: true,
    readiness: { isReady: false, type: 'none', hasAnswered: false, hasVoted: false },
    ...extra,
  });

  // THE REPORTED DEFECT: *"it no longer list the players that joined in the
  // beginning"*. The roster array has been in the remote's memory since
  // pollRoster stopped discarding it, and nothing read it outside ASK/VOTE.
  it('names everyone who has joined, before a round has been dealt', () => {
    const listing = rosterListing({ players: [person('Ada'), person('Dana')] }, 'STARTED');
    expect(listing.rows.map((r) => r.name)).toEqual(['Ada', 'Dana']);
    expect(listing.heading).toBe('Already joined · 2 players');
  });

  // Rejects: labelling the lobby list with a waiting caption, or the running
  // list with the lobby's. RoomMeter.jsx makes the same distinction and for the
  // same reason — a joined list under a waiting heading is an accusation — and
  // `kind` is what a test can hold on to when the copy changes.
  it('says which SET the list is, in the data rather than in the copy', () => {
    const players = [person('Ada')];
    expect(rosterListing({ players }, 'CREATED').kind).toBe('joined');
    expect(rosterListing({ players }, 'STARTED').kind).toBe('joined');
    expect(rosterListing({ players }, 'ASK#001').kind).toBe('everyone');
    expect(rosterListing({ players }, 'RESULTS#001').kind).toBe('everyone');
    expect(rosterListing({ players }, 'ENDED').kind).toBe('everyone');
  });

  // A state poll that has not landed yet reads as UNKNOWN, and the roster poll
  // can land first. Nothing has been asked of anyone in either case.
  it('treats an unreadable state as the lobby rather than as a running round', () => {
    expect(rosterListing({ players: [person('Ada')] }, undefined).kind).toBe('joined');
    expect(rosterListing({ players: [person('Ada')] }, 'garbage').rows[0].done).toBeNull();
  });

  // Rejects: reading `isReady`. get-players computes that per phase and returns
  // literally `true` for everyone during RESULTS, so a tick keyed off it is
  // right in one phase by accident and wrong in the rest.
  it('ticks who has ANSWERED during ASK and who has VOTED during VOTE', () => {
    const players = [
      person('Ada', { readiness: { hasAnswered: true, hasVoted: false, isReady: true } }),
      person('Dana', { readiness: { hasAnswered: false, hasVoted: true, isReady: true } }),
    ];
    const asking = rosterListing({ players }, 'ASK#002').rows;
    expect(asking.find((r) => r.name === 'Ada').done).toBe(true);
    expect(asking.find((r) => r.name === 'Dana').done).toBe(false);

    const voting = rosterListing({ players }, 'VOTE#002').rows;
    expect(voting.find((r) => r.name === 'Ada').done).toBe(false);
    expect(voting.find((r) => r.name === 'Dana').done).toBe(true);
  });

  // Rejects: a permanently pending timer beside every name on a screen where
  // nobody is being waited for.
  it('has no tick at all outside ASK and VOTE', () => {
    for (const state of ['CREATED', 'STARTED', 'RESULTS#002', 'ENDED']) {
      expect(rosterListing({ players: [person('Ada')] }, state).rows[0].done).toBeNull();
    }
  });

  // Rejects: recomputing the ranking here. `config/setupPanel.js:rosterRows` is
  // the desktop session tab's own function; "the same menu as the main screen"
  // has to mean the same order and the same ranks or the two disagree in front
  // of a room. Equal scores share a rank and the next rank skips.
  it('sorts by score and ranks the way the desktop session tab does', () => {
    const listing = rosterListing({
      players: [
        person('Low', { totalScore: 1 }),
        person('High', { totalScore: 9 }),
        person('Tie', { totalScore: 9 }),
      ],
    }, 'RESULTS#002');
    expect(listing.rows.map((r) => [r.name, r.rank, r.score])).toEqual([
      ['High', 1, 9], ['Tie', 1, 9], ['Low', 3, 1],
    ]);
  });

  // `totalScore` is get-players' spelling; the host page keeps `score`. One
  // adapter has to serve either payload or the phone shows everyone on zero.
  it('reads either spelling of the score', () => {
    expect(rosterListing({ players: [{ playerName: 'Ada', totalScore: 4 }] }, 'ENDED').rows[0].score)
      .toBe(4);
    expect(rosterListing({ players: [{ playerName: 'Ada', score: 7 }] }, 'ENDED').rows[0].score)
      .toBe(7);
  });

  // Rejects: passing nameless rows through. `rosterRows` would print them as
  // "Unknown Player" — a ghost in a count the host cannot account for.
  it('drops rows with no name rather than inventing one', () => {
    const listing = rosterListing({
      players: [person('Ada'), { totalScore: 3 }, null, 'nope'],
    }, 'STARTED');
    expect(listing.rows.map((r) => r.name)).toEqual(['Ada']);
    expect(listing.heading).toBe('Already joined · 1 player');
  });

  // A remote that white-screens mid-session is worse than one that says the
  // room is empty. Every one of these is a real half-loaded poll.
  it('never throws on a payload that has not arrived', () => {
    for (const payload of [undefined, null, {}, 'nope', { players: null }, { players: 'no' }]) {
      expect(() => rosterListing(payload, 'ASK#001')).not.toThrow();
      expect(rosterListing(payload, 'ASK#001').rows).toEqual([]);
      expect(rosterListing(payload, 'ASK#001').heading).toBe('Nobody has joined yet');
    }
  });
});
