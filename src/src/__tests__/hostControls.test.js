/**
 * The host's advance control is the one thing that must never be missing,
 * ambiguous, or duplicated — a live room is watching while the host looks for
 * it. These tests pin the invariant that used to be spread across four inline
 * JSX blocks in GameHostPage.jsx.
 */
import {
  HOST_PHASES,
  HOST_INTENTS,
  hostRunsVotePhase,
  hostPhaseSequence,
  phaseOfGameState,
  hostControlsFor,
} from '../config/hostControls';
import { GAME_TYPE_LIST } from '../config/gameTypes';

const ALL_TYPES = GAME_TYPE_LIST.map((t) => t.id);

const READY = {
  playerCount: 6,
  answeredCount: 6,
  votedCount: 6,
  answerCount: 6,
  hasQuestionSet: true,
};

describe('phaseOfGameState', () => {
  it('maps the live state markers onto host phases', () => {
    expect(phaseOfGameState('ASK#003')).toBe('ASK');
    expect(phaseOfGameState('VOTE#012')).toBe('VOTE');
    expect(phaseOfGameState('RESULTS#001')).toBe('RESULTS');
  });

  it('treats every non-round state as the lobby, like isWaitingState()', () => {
    ['CREATED', 'STARTED', 'voting', '', null, undefined].forEach((state) => {
      expect(phaseOfGameState(state)).toBe('LOBBY');
    });
  });
});

describe('runtime phase graph', () => {
  it('skips VOTE for exactly the types the host code special-cases', () => {
    expect(hostRunsVotePhase('trivia')).toBe(false);
    expect(hostRunsVotePhase('wavelength')).toBe(false);
    expect(hostRunsVotePhase('call-and-answer')).toBe(true);
    expect(hostRunsVotePhase('poll')).toBe(true);
    // survey has no special case in handleFinishQuestion(), so it votes —
    // even though GAME_TYPES.survey.phases claims ASK -> RESULTS.
    expect(hostRunsVotePhase('survey')).toBe(true);
  });

  it('normalises storage spellings', () => {
    expect(hostRunsVotePhase('callandanswer')).toBe(true);
    expect(hostRunsVotePhase('quiz')).toBe(false); // alias for trivia
  });

  it('always starts at the lobby and ends at results', () => {
    ALL_TYPES.forEach((type) => {
      const seq = hostPhaseSequence(type);
      expect(seq[0]).toBe('LOBBY');
      expect(seq[seq.length - 1]).toBe('RESULTS');
    });
  });
});

describe('every (gameType, phase) pair yields exactly one primary action', () => {
  ALL_TYPES.forEach((type) => {
    HOST_PHASES.forEach((phase) => {
      it(`${type} / ${phase}`, () => {
        const controls = hostControlsFor({ gameType: type, phase, ...READY });

        expect(controls.primary).toBeTruthy();
        expect(typeof controls.primary.label).toBe('string');
        expect(controls.primary.label.trim().length).toBeGreaterThan(0);
        expect(Object.values(HOST_INTENTS)).toContain(controls.primary.intent);
        expect(controls.primary.disabled).toBe(false);

        // At most one secondary, and it must not be a second way to advance.
        if (controls.secondary) {
          expect(controls.secondary.intent).toBe(HOST_INTENTS.SKIP);
          expect(controls.secondary.intent).not.toBe(controls.primary.intent);
        }

        expect(controls.status.text.trim().length).toBeGreaterThan(0);
      });
    });
  });

  it('never strands a type in a phase it should not reach', () => {
    // trivia/wavelength never open a VOTE, but bad restored state must still
    // leave the host a way out rather than a screen with no button.
    ['trivia', 'wavelength'].forEach((type) => {
      const controls = hostControlsFor({ gameType: type, phase: 'VOTE', ...READY });
      expect(controls.primary.intent).toBe(HOST_INTENTS.REVEAL);
    });
  });

  it('falls back to the lobby for an unknown phase', () => {
    const controls = hostControlsFor({ gameType: 'poll', phase: 'NONSENSE', ...READY });
    expect(controls.phase).toBe('LOBBY');
    expect(controls.primary.intent).toBe(HOST_INTENTS.START);
  });
});

describe('the primary action per phase', () => {
  it('opens voting for vote types and reveals for the rest', () => {
    expect(hostControlsFor({ gameType: 'poll', phase: 'ASK', ...READY }).primary.label)
      .toBe('Start Voting');
    expect(hostControlsFor({ gameType: 'survey', phase: 'ASK', ...READY }).primary.label)
      .toBe('Start Voting');
    expect(hostControlsFor({ gameType: 'trivia', phase: 'ASK', ...READY }).primary.label)
      .toBe('Show Results');
    expect(hostControlsFor({ gameType: 'wavelength', phase: 'ASK', ...READY }).primary.label)
      .toBe('Show Results');
  });

  it('names the round the way the question set names it', () => {
    const trivia = hostControlsFor({ gameType: 'trivia', phase: 'RESULTS', roundNoun: 'Lesson', ...READY });
    expect(trivia.primary.label).toBe('Next Lesson');

    const lobby = hostControlsFor({ gameType: 'trivia', phase: 'LOBBY', roundNoun: 'Lesson', ...READY });
    expect(lobby.primary.label).toBe('Start First Lesson');

    const ask = hostControlsFor({ gameType: 'trivia', phase: 'ASK', roundNoun: 'Lesson', ...READY });
    expect(ask.secondary.label).toBe('Skip Lesson');
  });

  it('offers the skip escape hatch only while answering', () => {
    expect(hostControlsFor({ gameType: 'poll', phase: 'ASK', ...READY }).secondary).toBeTruthy();
    ['LOBBY', 'VOTE', 'RESULTS'].forEach((phase) => {
      expect(hostControlsFor({ gameType: 'poll', phase, ...READY }).secondary).toBeNull();
    });
  });
});

describe('enablement', () => {
  it('cannot start without a question set', () => {
    const controls = hostControlsFor({
      gameType: 'poll', phase: 'LOBBY', ...READY, hasQuestionSet: false,
    });
    expect(controls.primary.disabled).toBe(true);
    expect(controls.primary.hint).toMatch(/question set/i);
    expect(controls.status.tone).toBe('error');
  });

  it('cannot start with an empty room', () => {
    const controls = hostControlsFor({
      gameType: 'poll', phase: 'LOBBY', ...READY, playerCount: 0,
    });
    expect(controls.primary.disabled).toBe(true);
    expect(controls.status.tone).toBe('pending');
  });

  it('cannot close answering before anyone has answered', () => {
    ALL_TYPES.forEach((type) => {
      const controls = hostControlsFor({
        gameType: type, phase: 'ASK', ...READY, answerCount: 0, answeredCount: 0,
      });
      expect(controls.primary.disabled).toBe(true);
      // …but skipping the round is still available, so the host is never stuck.
      expect(controls.secondary.disabled).toBe(false);
    });
  });

  it('always allows revealing and advancing', () => {
    ALL_TYPES.forEach((type) => {
      ['VOTE', 'RESULTS'].forEach((phase) => {
        expect(hostControlsFor({ gameType: type, phase, ...READY }).primary.disabled).toBe(false);
      });
    });
  });
});

describe('status line', () => {
  it('reads as pending while the room is still working', () => {
    const ask = hostControlsFor({
      gameType: 'poll', phase: 'ASK', ...READY, answeredCount: 2, playerCount: 8,
    });
    expect(ask.status.text).toBe('2 of 8 answered…');
    expect(ask.status.tone).toBe('pending');

    const vote = hostControlsFor({
      gameType: 'poll', phase: 'VOTE', ...READY, votedCount: 3, playerCount: 8,
    });
    expect(vote.status.text).toBe('3 of 8 voted…');
    expect(vote.status.tone).toBe('pending');
  });

  it('reads as success once the room is done', () => {
    const ask = hostControlsFor({
      gameType: 'poll', phase: 'ASK', ...READY, answeredCount: 8, playerCount: 8,
    });
    expect(ask.status.text).toBe('All 8 answered');
    expect(ask.status.tone).toBe('success');
  });

  it('counts one player without pluralising', () => {
    const lobby = hostControlsFor({ gameType: 'poll', phase: 'LOBBY', ...READY, playerCount: 1 });
    expect(lobby.status.text).toBe('1 player ready');
  });
});
