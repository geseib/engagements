/**
 * "if a player switches away from the tab after answering or voting, the screen
 *  resets as if they have not already answered."
 *
 * Reported from a live session. The harm is not the layout — it is that the
 * form comes back in front of somebody who is already done, which invites a
 * duplicate submission and tells them their response was lost.
 *
 * The end-to-end proof is in `playerAnswerPersistence.test.jsx`, which mounts
 * PlayerPage and fires real `visibilitychange` events at it. What is here is
 * the decision itself: the combinations of (what the screen believes) ×
 * (what the server said) × (is this a new round) that would each need their own
 * mounted fixture, and the two source-scanned call-site rules that a mounted
 * test cannot express at all.
 */
import {
  participationUrl, participationFrom, nextParticipation,
} from '../utils/playerParticipation';

describe('asking the server about one player', () => {
  // rejects: THE FIRST FAULT. Both checks read `/state` with no identity on it,
  //          so get-game-state.js answered on its host branch and the client
  //          rummaged through the host's roster lists — which exist only during
  //          their own phase. This route reads the player's own answer and vote
  //          rows and keeps answering after the round moves on.
  test('it addresses the per-player route, not the bare one', () => {
    expect(participationUrl('/api/', '7410', 'Dana')).toBe('/api/games/7410/state/Dana');
  });

  // rejects: pasting a typed name straight into a path. Player names are free
  //          text entered on a phone and they are the primary key in this
  //          system (`PLAYER#{playerName}`), so "Dana R/W" would address a
  //          route that does not exist and a '#' would truncate the request at
  //          the fragment — both reported as "you have not answered".
  test('a name with path characters survives', () => {
    expect(participationUrl('/api/', '7410', 'Dana R/W')).toBe('/api/games/7410/state/Dana%20R%2FW');
    expect(participationUrl('/api/', '7410', 'C#')).toBe('/api/games/7410/state/C%23');
  });
});

describe('reading what the payload actually said', () => {
  const payload = (round) => ({ playerQuestionState: round });

  test('a real answer is reported as itself', () => {
    expect(participationFrom(payload({ hasAnswered: true, hasVoted: false })))
      .toMatchObject({ answered: true, voted: false });
  });

  // rejects: THE SECOND FAULT, at its source. "I could not find out" and "you
  //          did not respond" are different facts, and every way of failing to
  //          learn has to produce the first one.
  test('a payload that says nothing yields null, not false', () => {
    for (const body of [undefined, null, {}, { playerQuestionState: null }, { playerQuestionState: {} }]) {
      expect(participationFrom(body)).toMatchObject({ answered: null, voted: null });
    }
  });

  // rejects: coercing with Boolean(). `Boolean("false")` is true, which would
  //          mark an unanswered player as done and hide the form from them for
  //          the whole round.
  test('a non-boolean is unknown rather than coerced', () => {
    expect(participationFrom(payload({ hasAnswered: 'false', hasVoted: 1 })))
      .toMatchObject({ answered: null, voted: null });
  });

  // rejects: losing the round the answer is about. A payload that raced the
  //          host onto the next question describes a different round than the
  //          screen does.
  test('it carries which round it is talking about', () => {
    expect(participationFrom(payload({ hasAnswered: true, questionNumber: 2 })).questionNumber).toBe(2);
    expect(participationFrom(payload({ hasAnswered: true })).questionNumber).toBeNull();
  });
});

describe('what the player is shown after a resync', () => {
  // rejects: ignoring the server when it knows. It read the row directly; it is
  //          the authority, in both directions.
  test('the server wins whenever it has an opinion', () => {
    expect(nextParticipation({ current: false, server: true, isNewQuestion: false })).toBe(true);
    expect(nextParticipation({ current: true, server: false, isNewQuestion: false })).toBe(false);
    // Even on a new question — a server that says "answered" about the round it
    // was asked about beats the client's assumption that a new round is empty.
    expect(nextParticipation({ current: false, server: true, isNewQuestion: true })).toBe(true);
  });

  // rejects: THE REPORTED BUG, in one line. An unreadable resync on the SAME
  //          round must leave the screen alone. This is the case the vote path
  //          got wrong: it returned a confident `false` from three exits and
  //          assigned it straight into state, so returning to the tab un-voted
  //          the player before anything else had a say.
  test('an unknown result on the same round never lowers the flag', () => {
    expect(nextParticipation({ current: true, server: null, isNewQuestion: false })).toBe(true);
  });

  // rejects: carrying a stale `true` into a fresh question, which would suppress
  //          the form for someone who has not responded to it. The asymmetry is
  //          deliberate and this is the half that keeps it honest.
  test('a genuinely new question does clear it, when the server is silent', () => {
    expect(nextParticipation({ current: true, server: null, isNewQuestion: true })).toBe(false);
  });

  // rejects: returning undefined into a boolean prop, which React renders as an
  //          uncontrolled flip rather than a hidden form.
  test('it always returns a boolean', () => {
    for (const current of [true, false, undefined, null]) {
      for (const server of [true, false, null, undefined]) {
        for (const isNewQuestion of [true, false]) {
          expect(typeof nextParticipation({ current, server, isNewQuestion })).toBe('boolean');
        }
      }
    }
  });
});

/*
 * THE CALL SITES, READ AS TEXT.
 *
 * The rules above are only worth anything if PlayerPage actually asks them, and
 * PlayerPage cannot be mounted here to check. The specific regressions in view
 * are the ones that were live: a bare `/state` fetch in either check, and a raw
 * assignment of a check's result into state.
 */
describe('PlayerPage asks these questions rather than its own', () => {
  const fs = require('fs');
  const path = require('path');
  const source = fs.readFileSync(path.join(__dirname, '..', 'PlayerPage.jsx'), 'utf8');
  const markup = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

  /**
   * SCOPED TO EACH FUNCTION'S OWN BODY, and the first version of this test was
   * not — it asserted `participationUrl(...)` appeared SOMEWHERE in the file.
   * Reverting checkPlayerAnswer alone left checkPlayerVote's call to match it,
   * so the mutation survived and the test was green over a live regression.
   * Found by mutating, which is the only reason it is not still like that.
   *
   * A blanket ban on `${API_BASE}games/${gameId}/state` is not available: two
   * other readers on this page legitimately want the game-wide payload
   * (`currentQuestionData` in loadVotingData, and loadResultsData). What must
   * not use it is these two functions.
   */
  const bodyOf = (name) => {
    const at = markup.indexOf(`const ${name} = async (`);
    expect(at).toBeGreaterThan(-1);
    return markup.slice(at, markup.indexOf('\n  };', at));
  };

  // rejects: EITHER check drifting back to the identity-free endpoint, which is
  //          what made the server answer as though a host had asked — and the
  //          roster lists it returns exist only during their own phase.
  test.each(['checkPlayerAnswer', 'checkPlayerVote'])('%s asks the per-player route', (name) => {
    const body = bodyOf(name);
    expect(body).toMatch(/participationUrl\(API_BASE, gameId, playerName\)/);
    expect(body).not.toMatch(/\$\{API_BASE\}games\/\$\{gameId\}\/state[`?]/);
  });

  // rejects: the host roster lists coming back as the source for either check.
  test('the host roster lists are not what a player reads', () => {
    expect(markup).not.toMatch(/answerProgress\?\.answererIds/);
    expect(markup).not.toMatch(/votingProgress\.votersIds/);
  });

  // rejects: either check reporting a confident "no" for a failure. Both must
  //          return null from every exit that did not actually learn anything —
  //          this is the fault that made returning to the tab un-vote someone.
  test.each(['checkPlayerAnswer', 'checkPlayerVote'])('%s never returns a bare false', (name) => {
    expect(bodyOf(name)).not.toMatch(/return false;/);
  });

  // rejects: THE EXACT LINE THAT SHIPPED — `setHasVoted(hasAlreadyVoted)` with
  //          the check's raw result, which is how a `false` meaning "unknown"
  //          reached the screen as "you have not voted".
  test('the vote flag goes through the rule, not straight into state', () => {
    expect(markup).toMatch(/nextParticipation\(\{[\s\S]{0,200}?server: votedOnServer/);
  });

  // rejects: restoring the ballot-clearing check that compared `gameState`
  //          against the server's. That binding is frozen at join time inside
  //          the resume effect's closure, so it was true on every resync and
  //          wiped a cast vote each time the player came back to the tab.
  test('the ballot clears on a round change, not on a phase comparison', () => {
    expect(markup).toMatch(/questionNumber !== voteRoundRef\.current/);
    expect(markup).not.toMatch(/if \(gameState !== serverGameState\) \{\s*setVotes/);
  });
});
