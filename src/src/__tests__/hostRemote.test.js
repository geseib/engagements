import {
  parseGamePhase,
  runsVotePhase,
  primaryAction,
  skipAction,
  requestFor,
  roundProgress,
  needsConfirmation,
  phaseSummary,
  waitingOn,
  fieldNotesFrom,
  ACTIONS,
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
    expect(runsVotePhase('survey')).toBe(true);
  });

  it('normalises legacy spellings rather than defaulting them to no-vote', () => {
    expect(runsVotePhase('callandanswer')).toBe(true);
    expect(runsVotePhase('quiz')).toBe(false);
    expect(runsVotePhase(undefined)).toBe(true); // falls back to call-and-answer
  });
});

describe('primaryAction — every game type x every phase', () => {
  it('opens the first round from CREATED and STARTED', () => {
    for (const type of ALL_TYPES) {
      for (const state of ['CREATED', 'STARTED']) {
        const action = primaryAction(state, type);
        expect(action).not.toBeNull();
        expect(action.id).toBe('next');
        expect(action.label).toBe('Start First Round');
      }
    }
  });

  it('offers voting from ASK only for the types that actually vote', () => {
    for (const type of ALL_TYPES) {
      const action = primaryAction('ASK#001', type);
      expect(action.id).toBe(runsVotePhase(type) ? 'vote' : 'results');
    }
  });

  it('never offers "Start Voting" for trivia or wavelength', () => {
    // The failure this guards: a trivia round has no VOTE phase, so pushing the
    // room into VOTE#001 strands every player on a screen the host never shows.
    for (const type of TYPES_WITH_NO_VOTE_AT_RUNTIME) {
      for (const state of ['CREATED', 'STARTED', 'ASK#001', 'VOTE#001', 'RESULTS#001', 'ENDED']) {
        const action = primaryAction(state, type);
        expect(action && action.id).not.toBe('vote');
      }
    }
  });

  it('shows results from VOTE for every type', () => {
    for (const type of ALL_TYPES) {
      expect(primaryAction('VOTE#004', type).id).toBe('results');
    }
  });

  it('offers the AI read-back first on RESULTS, for every game type', () => {
    // THE GAP THIS CLOSES: the remote used to return `next` here, so the phone
    // skipped the "What We Heard" beat entirely while the host's own toolbar
    // (config/hostControls.js:190-198) offered it. Two controls for one room
    // that disagreed about how many beats RESULTS has.
    for (const type of ALL_TYPES) {
      expect(primaryAction('RESULTS#001', type)).toMatchObject({
        id: 'field-notes',
        label: 'What We Heard',
      });
    }
  });

  it('advances from RESULTS using the game type\'s own round noun ONCE the beat has moved', () => {
    // Second half of the two-step. Without this the phone would offer "What We
    // Heard" forever and the room could never leave the round.
    const onNotes = (type) => primaryAction('RESULTS#001', type, 'field-notes');
    expect(onNotes('trivia')).toMatchObject({ id: 'next', label: 'Next Question' });
    expect(onNotes('call-and-answer').label).toBe('Next Round');
    expect(onNotes('wavelength').label).toBe('Next Subject');
    expect(onNotes('poll').label).toBe('Next Poll');
  });

  it('treats every beat that is not field-notes as the tally beat', () => {
    // The comparison is against the ONE value, not truthiness. `stageBeat`
    // arrives from the server (get-game-state), and a truthy check would read
    // the explicit default 'results' as "already past the read-back" and skip
    // the beat again — reinstating the exact defect above.
    for (const beat of [undefined, null, '', 'results', 'RESULTS', 'anything']) {
      expect(primaryAction('RESULTS#002', 'trivia', beat).id).toBe('field-notes');
    }
  });

  it('ignores the beat outside RESULTS', () => {
    // A beat left over from the previous round must never rewrite the ASK or
    // VOTE control. This fails if the check is hoisted above the phase switch.
    expect(primaryAction('ASK#001', 'call-and-answer', 'field-notes').id).toBe('vote');
    expect(primaryAction('ASK#001', 'trivia', 'field-notes').id).toBe('results');
    expect(primaryAction('VOTE#001', 'poll', 'field-notes').id).toBe('results');
    expect(primaryAction('CREATED', 'trivia', 'field-notes').label).toBe('Start First Round');
    expect(primaryAction('ENDED', 'trivia', 'field-notes')).toBeNull();
  });

  it('offers nothing once the session has ended or the state is unreadable', () => {
    for (const type of ALL_TYPES) {
      expect(primaryAction('ENDED', type)).toBeNull();
      expect(primaryAction(undefined, type)).toBeNull();
      expect(primaryAction('nonsense', type)).toBeNull();
    }
  });

  it('returns a copy, so a caller cannot mutate the shared ACTIONS table', () => {
    const action = primaryAction('RESULTS#001', 'trivia');
    action.label = 'MUTATED';
    expect(ACTIONS.next.label).toBe('Next Round');
  });
});

describe('skipAction', () => {
  it('is available only mid-round', () => {
    expect(skipAction('ASK#001')).toMatchObject({ id: 'skip', destructive: true });
    expect(skipAction('VOTE#001')).toMatchObject({ id: 'skip' });
    expect(skipAction('RESULTS#001')).toBeNull();
    expect(skipAction('CREATED')).toBeNull();
    expect(skipAction('ENDED')).toBeNull();
    expect(skipAction(undefined)).toBeNull();
  });

  it('always demands confirmation', () => {
    // `action: 'skip'` bypasses next-question.js's "already asking" guard, so
    // unlike an ordinary advance a double-fire really does consume two
    // questions and display one.
    expect(needsConfirmation(skipAction('ASK#001'), { applicable: true, allIn: true })).toBe(true);
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
  const partial = { applicable: true, allIn: false };
  const done = { applicable: true, allIn: true };

  it('demands the second tap when advancing would discard responses', () => {
    expect(needsConfirmation(primaryAction('ASK#001', 'call-and-answer'), partial)).toBe(true);
    expect(needsConfirmation(primaryAction('ASK#001', 'trivia'), partial)).toBe(true);
    expect(needsConfirmation(primaryAction('VOTE#001', 'poll'), partial)).toBe(true);
  });

  it('gets out of the way once the room is done', () => {
    expect(needsConfirmation(primaryAction('ASK#001', 'call-and-answer'), done)).toBe(false);
    expect(needsConfirmation(primaryAction('VOTE#001', 'poll'), done)).toBe(false);
  });

  it('does not gate the beats that discard nothing', () => {
    // Moving on from RESULTS, or dealing the first round, throws away no input.
    expect(needsConfirmation(primaryAction('RESULTS#001', 'trivia'), { applicable: false })).toBe(false);
    expect(needsConfirmation(primaryAction('CREATED', 'trivia'), { applicable: false })).toBe(false);
  });

  it('is false when there is no action at all', () => {
    expect(needsConfirmation(null, partial)).toBe(false);
    expect(needsConfirmation(undefined, undefined)).toBe(false);
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
