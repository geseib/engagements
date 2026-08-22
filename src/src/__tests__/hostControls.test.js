/**
 * The host's advance control is the one thing that must never be missing,
 * ambiguous, or duplicated — a live room is watching while the host looks for
 * it. These tests pin the invariant that used to be spread across four inline
 * JSX blocks in GameHostPage.jsx.
 */
import fs from 'fs';
import path from 'path';
import {
  HOST_PHASES,
  HOST_INTENTS,
  hostRunsVotePhase,
  hostPhaseSequence,
  phaseOfGameState,
  isLobbyState,
  hostControlsFor,
  stageBeatFromFrame,
} from '../config/hostControls';
import { GAME_TYPE_LIST } from '../config/gameTypes';

const HOST_PAGE = path.join(__dirname, '..', 'GameHostPage.jsx');

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

/**
 * The headline defect of the stage change, pinned.
 *
 * `isWaitingState()` answered "does this state fail to start with
 * ASK#/VOTE#/RESULTS#", so it answered TRUE for `ENDED` and a finished session
 * rendered the lobby — "Waiting for players to join…" to a room that had just
 * applauded. Until now that was guarded only by an absence assertion on the
 * old NAME, which any reimplementation of the same mistake under a new name
 * would sail past. This is the behaviour.
 */
describe('isLobbyState', () => {
  it('is false for a finished session — the defect, stated directly', () => {
    // Rejects `state => phaseOfGameState(state) === 'LOBBY'`, i.e. the old
    // predicate renamed, which is the likeliest way for this to come back.
    expect(isLobbyState('ENDED')).toBe(false);
  });

  it('is true only for the states that really are waiting to begin', () => {
    ['CREATED', 'STARTED', 'voting', '', null, undefined].forEach((state) => {
      expect(isLobbyState(state)).toBe(true);
    });
  });

  it('is false once a round is running', () => {
    ['ASK#001', 'VOTE#001', 'RESULTS#001'].forEach((state) => {
      expect(isLobbyState(state)).toBe(false);
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

        /*
          At most one secondary, and it must not be a second way to advance.

          TWO INTENTS ARE LEGITIMATE HERE, not one. Skip is ASK's escape from a
          round going nowhere. Leave is ENDED's way back to the host menu —
          added because the only action on a finished session's screen was Open
          Session Report, which was a dead end rather than a design ("when the
          session is done need a way to get back to the host menu").

          The rule this assertion actually protects is the NEXT line: a
          secondary must never duplicate the primary's intent. That still holds
          for both.
        */
        if (controls.secondary) {
          expect([HOST_INTENTS.SKIP, HOST_INTENTS.LEAVE]).toContain(controls.secondary.intent);
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
    // "Next <round>" moved from RESULTS to FIELD_NOTES when RESULTS became two
    // beats — the noun still has to follow it there.
    const trivia = hostControlsFor({ gameType: 'trivia', phase: 'FIELD_NOTES', roundNoun: 'Lesson', ...READY });
    expect(trivia.primary.label).toBe('Next Lesson');

    const lobby = hostControlsFor({ gameType: 'trivia', phase: 'LOBBY', roundNoun: 'Lesson', ...READY });
    expect(lobby.primary.label).toBe('Start First Lesson');

    const ask = hostControlsFor({ gameType: 'trivia', phase: 'ASK', roundNoun: 'Lesson', ...READY });
    expect(ask.secondary.label).toBe('Skip Lesson');
  });

  it('offers the skip escape hatch only while answering', () => {
    expect(hostControlsFor({ gameType: 'poll', phase: 'ASK', ...READY }).secondary).toBeTruthy();
    /*
      LOBBY left this list when it grew its own secondary — Back to Menu, the
      owner's "easy way to go back out" — so the phases with NO second button
      are now exactly the mid-round ones, where a room is watching and a second
      control is one more thing to aim at.
    */
    expect(hostControlsFor({ gameType: 'poll', phase: 'LOBBY', ...READY }).secondary)
      .toMatchObject({ intent: 'leave', label: 'Back to Menu' });
    ['VOTE', 'RESULTS'].forEach((phase) => {
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

/**
 * The two additions the stage needs.
 *
 * RESULTS becomes two beats (the tally, then "what we heard") rather than one
 * long screen, and a finished session stops being a dead end.
 */
describe('the two additions the stage needs', () => {
  // The trap first: an unknown phase resolves to LOBBY, so a new phase that is
  // not in HOST_PHASES looks like it works and is actually rendering the lobby.
  test('both new phases are recognised rather than falling back to LOBBY', () => {
    expect(HOST_PHASES).toContain('FIELD_NOTES');
    expect(HOST_PHASES).toContain('ENDED');
    expect(hostControlsFor({ gameType: 'call-and-answer', phase: 'ENDED' }).phase).toBe('ENDED');
    expect(hostControlsFor({ gameType: 'call-and-answer', phase: 'FIELD_NOTES' }).phase).toBe('FIELD_NOTES');
  });

  // RESULTS becomes two beats rather than one long screen.
  test('RESULTS advances to the Field Notes beat before the next round', () => {
    expect(hostControlsFor({ gameType: 'call-and-answer', phase: 'RESULTS' }).primary.id)
      .toBe('field-notes');
    expect(hostControlsFor({ gameType: 'call-and-answer', phase: 'FIELD_NOTES' }).primary.id)
      .toBe('next');
  });

  // Today ENDED is a dead end: isWaitingState('ENDED') returns true, so a
  // finished session renders the lobby.
  test('ENDED offers a way forward', () => {
    expect(hostControlsFor({ gameType: 'call-and-answer', phase: 'ENDED' }).primary)
      .toEqual(expect.objectContaining({ id: 'report', label: 'Open Session Report' }));
  });

  // Every primary has to name an intent the page can actually run, or the
  // advance control is a button that does nothing — which is worse than a
  // missing one, because the host keeps pressing it.
  //
  // The first version of this test asserted that `primary.intent` was a member
  // of HOST_INTENTS, which primaryFor guarantees by construction: it can only
  // return the constants, so the assertion could not fail and could not detect
  // the bug it is named after. The bug it is named after is a `case` missing
  // from GameHostPage's `runHostAction` switch — which is exactly what shipped
  // for HOST_INTENTS.REPORT and had to be fixed in 6e5a5fd3. So ask the page.
  test('the page has a dispatch case for every intent the new phases name', () => {
    const source = fs.readFileSync(HOST_PAGE, 'utf8');
    for (const phase of ['RESULTS', 'FIELD_NOTES', 'ENDED']) {
      const { primary } = hostControlsFor({ gameType: 'call-and-answer', phase });
      const constant = Object.keys(HOST_INTENTS).find((k) => HOST_INTENTS[k] === primary.intent);
      expect(constant).toBeTruthy();
      expect(source).toContain(`case HOST_INTENTS.${constant}:`);
    }
    // Named explicitly too, so deleting a phase above cannot quietly shrink
    // what this covers.
    expect(source).toContain('case HOST_INTENTS.FIELD_NOTES:');
    expect(source).toContain('case HOST_INTENTS.REPORT:');
  });

  // The existing invariant, restated because these additions are exactly the
  // kind of change that breaks it.
  test('every (type × phase) pair still yields exactly one primary', () => {
    for (const type of ['call-and-answer', 'trivia', 'poll', 'wavelength', 'survey']) {
      for (const phase of hostPhaseSequence(type).concat(['FIELD_NOTES', 'ENDED'])) {
        const controls = hostControlsFor({ gameType: type, phase });
        expect(controls.primary).toBeTruthy();
        expect(controls.primary.id).toBeTruthy();
      }
    }
  });

  // ASK is the one phase with a secondary. Adding phases must not grow that.
  test('FIELD_NOTES adds no secondary, and ENDED adds the way out', () => {
    // FIELD_NOTES is mid-round: a second button there is one more thing to aim
    // at while a room reads. (The ONE exception is the read-back mid-document,
    // tested in its own block below — there the second button exists precisely
    // because the single button was the worse aim.)
    expect(hostControlsFor({ gameType: 'call-and-answer', phase: 'FIELD_NOTES' }).secondary).toBeNull();

    /*
      ENDED is not mid-round, and this assertion used to say it had no way out —
      which was true, and was the bug. Open Session Report was the only action
      on the last screen of a session, so a host who did not want the report had
      nowhere to go but the browser's back button.
    */
    const ended = hostControlsFor({ gameType: 'call-and-answer', phase: 'ENDED' }).secondary;
    expect(ended).not.toBeNull();
    expect(ended.intent).toBe(HOST_INTENTS.LEAVE);
    expect(ended.label).toBe('Back to Menu');
  });

  // statusTextFor is keyed on phase and falls through to the lobby's copy for
  // anything it does not name — so a finished session would announce
  // "Waiting for players to join…" to a room that has just applauded.
  test('the new phases get their own status copy, not the lobby default', () => {
    const lobby = hostControlsFor({ gameType: 'call-and-answer', phase: 'LOBBY', playerCount: 0 }).status.text;
    for (const phase of ['FIELD_NOTES', 'ENDED']) {
      const text = hostControlsFor({ gameType: 'call-and-answer', phase, playerCount: 0 }).status.text;
      expect(text).not.toBe(lobby);
      expect(text.length).toBeGreaterThan(0);
    }
  });

  // FIELD_NOTES is a beat inside RESULTS and ENDED is a session state. Folding
  // either into the round sequence makes the phase bar draw a fifth segment
  // per round.
  test('neither new phase joins the round sequence', () => {
    for (const type of ['call-and-answer', 'trivia']) {
      expect(hostPhaseSequence(type)).not.toContain('FIELD_NOTES');
      expect(hostPhaseSequence(type)).not.toContain('ENDED');
    }
  });
});

/**
 * The stage beat, now that it is a SERVER fact.
 *
 * `resultsBeat` used to be client-only React state, so the phone could not
 * drive it and the projector could not announce it. It is written by
 * `POST /games/{id}/stage-beat`, announced as `stageBeatChanged`, and read back
 * by get-game-state — one source of truth for both surfaces.
 */
describe('stageBeatFromFrame — which beat announcements the stage may act on', () => {
  const frame = (beat, questionNumber) => ({
    type: 'stageBeatChanged', gameId: '4821', beat, questionNumber,
  });

  test('accepts a beat for the round that is on screen', () => {
    expect(stageBeatFromFrame(frame('field-notes', '003'), 'RESULTS#003')).toBe('field-notes');
    expect(stageBeatFromFrame(frame('results', '003'), 'RESULTS#003')).toBe('results');
  });

  test('reads the padded round number the broadcast actually carries', () => {
    // stage-beat.js pads to three digits before it writes the SK and puts the
    // padded string on the wire. A strict === against the number 3 never
    // matches, and the stage would ignore every frame it is sent.
    expect(stageBeatFromFrame(frame('field-notes', '003'), 'RESULTS#003')).toBe('field-notes');
    expect(stageBeatFromFrame(frame('field-notes', 3), 'RESULTS#003')).toBe('field-notes');
  });

  test('IGNORES a beat for a round that is no longer on screen', () => {
    // The race: the host taps "What We Heard" and then "Next Round" inside one
    // socket round trip. The round-3 announcement lands after the room is
    // already on round 4, and applying it would open round 4's fresh tally on
    // round 3's discussion prompt. Same class of defect as the one that cost
    // the beat in the first place (GameHostPage.jsx:313).
    expect(stageBeatFromFrame(frame('field-notes', '003'), 'RESULTS#004')).toBeNull();
    expect(stageBeatFromFrame(frame('field-notes', '004'), 'RESULTS#003')).toBeNull();
  });

  test('ignores a beat it does not recognise', () => {
    // The server validates its own closed set, but an older deploy or a
    // hand-rolled frame must not push `resultsBeat` to a value nothing renders.
    for (const beat of [undefined, null, '', 'FIELD-NOTES', 'fieldnotes', 'tally', 42]) {
      expect(stageBeatFromFrame(frame(beat, '003'), 'RESULTS#003')).toBeNull();
    }
  });

  test('ignores a frame that does not say which round it is about', () => {
    expect(stageBeatFromFrame(frame('field-notes', undefined), 'RESULTS#003')).toBeNull();
    expect(stageBeatFromFrame(frame('field-notes', 'three'), 'RESULTS#003')).toBeNull();
  });

  test('never throws on junk, whatever the socket delivers', () => {
    for (const junk of [undefined, null, {}, 'nope', 42, []]) {
      expect(() => stageBeatFromFrame(junk, 'RESULTS#003')).not.toThrow();
      expect(stageBeatFromFrame(junk, 'RESULTS#003')).toBeNull();
      expect(() => stageBeatFromFrame(frame('results', '003'), junk)).not.toThrow();
    }
  });

  test('ignores a beat while the room is not showing results at all', () => {
    // A beat is a beat OF RESULTS. Acting on one during ASK would put the stage
    // into FIELD_NOTES, whose control is "Next Round" — an advance offered
    // while the room is still typing.
    for (const state of ['ASK#003', 'VOTE#003', 'ENDED', 'CREATED']) {
      expect(stageBeatFromFrame(frame('field-notes', '003'), state)).toBeNull();
    }
  });
});

/**
 * The wiring. config/hostRemote.js shipped a correct OAuth-shaped fix as dead
 * code once already; a handler that is never registered, or never removed, is
 * the same failure with a socket attached.
 */
describe('GameHostPage listens for the beat, and lets go of it', () => {
  const source = fs.readFileSync(HOST_PAGE, 'utf8');
  // This file is heavily commented, and a comment is not an implementation.
  // Assertions about what the page DOES run against the code with the prose
  // removed, so a deleted call cannot be covered for by the note above it.
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').filter((line) => !/^\s*(\/\/|\*)/.test(line)).join('\n');

  test('every WebSocket handler it registers, it also removes', () => {
    // The teardown list is maintained by hand next to a growing registration
    // list. A handler left registered survives a gameId change and fires with a
    // stale closure over the previous session's state.
    const registered = [...source.matchAll(/webSocketClient\.onMessage\('([^']+)'/g)].map((m) => m[1]);
    const removed = [...source.matchAll(/webSocketClient\.offMessage\('([^']+)'/g)].map((m) => m[1]);
    expect(registered.length).toBeGreaterThan(11);
    expect([...new Set(registered)].sort()).toEqual([...new Set(removed)].sort());
  });

  test('stageBeatChanged is one of them', () => {
    expect(source).toContain("webSocketClient.onMessage('stageBeatChanged'");
  });

  test('the beat handler does NOT re-sync the whole game state', () => {
    // restoreGameState rewrites `currentQuestionId`, and that is a dependency of
    // the effect at GameHostPage.jsx:313 which resets `resultsBeat` to the
    // tally. A beat handler that re-syncs therefore throws away the beat it was
    // sent to apply — the precise mechanism of the defect fixed in Wave 0.
    const start = code.indexOf("webSocketClient.onMessage('stageBeatChanged'");
    expect(start).toBeGreaterThan(-1);
    const body = code.slice(start, code.indexOf('});', start));
    expect(body).toContain('setResultsBeat');
    expect(body).not.toContain('restoreGameState');
  });

  test('the beat handler reads the CURRENT round, not the one it was registered with', () => {
    // The WebSocket effect's deps are [gameId, useWebSocket], so every handler
    // in it is frozen at the render that registered it — `gameState` is
    // 'CREATED' there, forever. stageBeatFromFrame is round-addressed, so a
    // closure over the frozen value makes it reject EVERY announcement and the
    // projector silently never follows the phone: a green module, a dead
    // feature. The same trap `remoteActionsRef` exists for.
    const start = code.indexOf("webSocketClient.onMessage('stageBeatChanged'");
    const body = code.slice(start, code.indexOf('});', start));
    expect(body).toContain('gameStateRef.current');
    expect(body).not.toMatch(/stageBeatFromFrame\(\s*\w+\s*,\s*gameState\s*\)/);
  });

  test('a reload comes back on the beat the room is actually reading', () => {
    // get-game-state carries `stageBeat` so BOTH surfaces read one record. If
    // the host page ignores it, reloading mid-discussion snaps the projector to
    // the tally while the phone — which polls the same field — still offers
    // "Next Round". The two controls disagree, which is the whole failure this
    // stream exists to remove.
    expect(code).toContain('gameStateData.stageBeat');
    expect(code).toContain('serverStageBeatRef.current');
    // The reset must consult it rather than hardcoding the tally.
    expect(code).toMatch(/setResultsBeat\(\s*seen/);
    expect(code).not.toMatch(/useEffect\(\(\)\s*=>\s*\{\s*setResultsBeat\('results'\)/);
  });

  test('the remembered beat is addressed to one game state and cannot outlive it', () => {
    // A bare beat outlives its round. The host opens the read-back on round 2,
    // a restore stamps 'field-notes', the room moves to round 3, and the
    // `questionStarted` broadcast that would have refreshed the ref never
    // arrives — host connections HAVE been evicted mid-session, and that is the
    // defect this whole feature is built on top of. Round 3's results would
    // then open straight on the AI paragraph with the tally never shown, which
    // is exactly what the reset exists to prevent. Refreshing the ref is not a
    // guarantee; addressing it is.
    //
    // Rejects: storing a bare string in serverStageBeatRef, and reading the
    // beat back without comparing the state it was stamped with.
    expect(code).toMatch(/serverStageBeatRef\s*=\s*useRef\(\{\s*state:/);
    expect(code).toMatch(/state:\s*gameStateData\.state/);
    expect(code).toMatch(/seen\.state === gameState \? seen\.beat : 'results'/);
  });

  test('the stage button posts the beat instead of only setting it locally', () => {
    // Bidirectional is the point: tap it on the projector and the phone
    // follows. A purely local setState leaves the phone offering "What We
    // Heard" for a beat the room is already reading.
    //
    // Comments are stripped first: the earlier version of this test matched a
    // sentence in the comment above the call and would have passed with the
    // call itself deleted.
    const start = code.indexOf('case HOST_INTENTS.FIELD_NOTES:');
    expect(start).toBeGreaterThan(-1);
    const body = code.slice(start, code.indexOf('break;', start));
    expect(body).toContain("publishStageBeat('field-notes')");
  });

  test('publishStageBeat actually posts to the stage-beat route', () => {
    // …and the call above is only worth anything if the thing it calls talks to
    // the server. Authenticated, because /stage-beat carries the Cognito
    // authorizer like /close-round: a plain fetch would 401 every tap.
    const start = code.indexOf('const publishStageBeat');
    expect(start).toBeGreaterThan(-1);
    const body = code.slice(start, start + 700);
    expect(body).toContain('/stage-beat');
    expect(body).toContain('authFetch');
    expect(body).toContain("method: 'POST'");
  });
});

/**
 * THE READ-BACK'S PAGE-VS-SKIP CONTROLS — the owner: "there should be a clear
 * way to go to next page of workie vs skip the rest of the workie response."
 *
 * The → key had paged before advancing since the pager shipped; the dock
 * button said "Next Round" throughout, so CLICKING it mid-document silently
 * threw away the unread pages. Mid-document the primary is now the page turn
 * (the same act as the key) and the skip is an explicit secondary; on the
 * last page one button suffices again.
 */
describe('FIELD_NOTES pages before it advances', () => {
  const fs = require('fs');
  const path = require('path');
  const HOST_PAGE_SRC = path.join(__dirname, '..', 'GameHostPage.jsx');

  test('mid-document: the primary turns the page and the skip is explicit', () => {
    const controls = hostControlsFor({
      gameType: 'call-and-answer', phase: 'FIELD_NOTES', notesPage: 0, notesPages: 3,
    });
    expect(controls.primary.intent).toBe(HOST_INTENTS.PAGE);
    expect(controls.primary.label).toBe('Next Page');
    expect(controls.secondary).not.toBeNull();
    expect(controls.secondary.intent).toBe(HOST_INTENTS.NEXT);
    expect(controls.secondary.label).toContain('Skip to Next');
    // The dock's own answer to "am I about to skip something unread?"
    expect(controls.status.text).toBe('Reading page 1 of 3');
  });

  test('last page: back to one button, and it is Next Round', () => {
    // rejects: a Next Page button on the last page — a control that would do
    // nothing — and rejects the skip surviving where there is nothing left to
    // skip.
    const controls = hostControlsFor({
      gameType: 'call-and-answer', phase: 'FIELD_NOTES', notesPage: 2, notesPages: 3,
    });
    expect(controls.primary.intent).toBe(HOST_INTENTS.NEXT);
    expect(controls.secondary).toBeNull();
  });

  test('one page (or callers that pass nothing): unchanged Next Round', () => {
    // rejects: the defaults changing any existing caller — the phone remote
    // and every test above call without page inputs and must see what they
    // always saw.
    const bare = hostControlsFor({ gameType: 'call-and-answer', phase: 'FIELD_NOTES' });
    expect(bare.primary.intent).toBe(HOST_INTENTS.NEXT);
    expect(bare.secondary).toBeNull();
    expect(bare.status.text).toBe('Discussion prompt on screen');
  });

  test('the page dispatches PAGE without clearing the chrome', () => {
    // A page turn is a content move: it must not close the setup panel the
    // host is reading beside, nor unpin the QR — the round-advance intents
    // still do both.
    const code = fs.readFileSync(HOST_PAGE_SRC, 'utf8');
    expect(code).toContain('case HOST_INTENTS.PAGE:');
    expect(code).toMatch(/if \(action\.intent !== HOST_INTENTS\.PAGE\) \{/);
  });

  test('the dock is fed the same page arithmetic the stage uses', () => {
    // rejects: a second, drifting computation — the call site must hand
    // hostControlsFor the notesPage/notesPages pair derived from the shared
    // beat-keyed index.
    const code = fs.readFileSync(HOST_PAGE_SRC, 'utf8');
    expect(code).toMatch(/notesPage,\s*notesPages,\s*\}\)/);
    expect(code).toContain('prosePageSlice(');
  });
});
