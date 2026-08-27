/**
 * THE HOST'S CONTROL FOR A FEEDBACK ROUND.
 *
 * The owner asked for *"a request feedback button during the AI feedback
 * phase"*. That phase is FIELD_NOTES — the stage's "What We Heard" read-back
 * (`docs/design/host-redesign/09-field-notes.html`), whose bottom bar today
 * reads `⋯ Setup | Discussion prompt on screen | ‹ Results | SPACE | Next
 * Round`.
 *
 * ── THE INVARIANT THIS CROSSES, AND THE ARGUMENT FOR CROSSING IT ───────────
 *
 * `hostControls.test.js:328` asserts *"FIELD_NOTES adds no secondary"*, with
 * the reason *"FIELD_NOTES is mid-round: a second button there is one more
 * thing to aim at while a room reads"*. That rule is deliberate and it is not
 * being quietly widened.
 *
 * It already carries one exception, granted mid-document because the single
 * button was the worse aim: with pages left, the primary is Next Page and the
 * secondary is Skip the rest. So FIELD_NOTES ALREADY HAS A TWO-BUTTON BAR.
 * Request feedback does not introduce one — it fills the slot that bar already
 * has, on the one page where it is currently empty. The maximum number of aim
 * points on this phase is unchanged.
 *
 * The alternatives are worse. Mid-round is where the invariant's reason bites
 * hardest. The setup panel is reachable but buried, and a control the host has
 * to go hunting for while a room waits is not "a button during the AI feedback
 * phase".
 *
 * What the `:129` assertion says it is really protecting — *"a secondary must
 * never duplicate the primary's intent"* — still holds everywhere.
 */
import {
  hostControlsFor, hostPhaseForBeat, HOST_PHASES, HOST_INTENTS, STAGE_BEATS,
} from '../config/hostControls';

/** A round whose read-back is a single page: the last-page case. */
const ONE_PAGE = { notesPage: 0, notesPages: 1 };
/** A round mid-document, where the secondary is already spoken for. */
const MID_DOC = { notesPage: 0, notesPages: 3 };

describe('the vocabulary', () => {
  test('FEEDBACK is a host phase', () => {
    // hostControlsFor opens with `HOST_PHASES.includes(phase) ? phase : 'LOBBY'`.
    // A phase missing from this array does not fail loudly — it silently
    // renders the lobby, mid-session, in front of a room.
    expect(HOST_PHASES).toContain('FEEDBACK');
  });

  test('there is a FEEDBACK intent, and it is the beat the server spells', () => {
    expect(HOST_INTENTS.FEEDBACK).toBe('feedback');
    expect(STAGE_BEATS).toContain(HOST_INTENTS.FEEDBACK);
  });
});

describe('hostPhaseForBeat — one derivation, not two copies', () => {
  /*
    GameHostPage derives the phase from the beat in TWO places (the auto-mode
    timer and the render), because one of them sits above the early returns.
    They were the same expression written twice, and a third value is exactly
    the kind of change that gets made in one copy. So the mapping moves here.
  */
  test('maps each beat onto the phase that draws it', () => {
    expect(hostPhaseForBeat('RESULTS', 'results')).toBe('RESULTS');
    expect(hostPhaseForBeat('RESULTS', 'field-notes')).toBe('FIELD_NOTES');
    expect(hostPhaseForBeat('RESULTS', 'feedback')).toBe('FEEDBACK');
  });

  test('a beat means nothing outside RESULTS', () => {
    // A beat left over from the previous round must never rewrite ASK or VOTE:
    // FIELD_NOTES' control is an advance, offered while the room is typing.
    expect(hostPhaseForBeat('ASK', 'feedback')).toBe('ASK');
    expect(hostPhaseForBeat('VOTE', 'field-notes')).toBe('VOTE');
    expect(hostPhaseForBeat('LOBBY', 'feedback')).toBe('LOBBY');
  });

  test('an unrecognised beat leaves the phase alone', () => {
    expect(hostPhaseForBeat('RESULTS', 'from-the-future')).toBe('RESULTS');
    expect(hostPhaseForBeat('RESULTS', undefined)).toBe('RESULTS');
    expect(hostPhaseForBeat('RESULTS', null)).toBe('RESULTS');
  });
});

describe('Request feedback sits on the last page of the read-back', () => {
  const onLastPage = hostControlsFor({
    gameType: 'call-and-answer', phase: 'FIELD_NOTES', ...ONE_PAGE,
  });

  test('the primary is still the advance, untouched', () => {
    // The host who wants the next round must not have to look for it.
    expect(onLastPage.primary.intent).toBe(HOST_INTENTS.NEXT);
  });

  test('the secondary asks the room for feedback', () => {
    expect(onLastPage.secondary).toMatchObject({
      id: 'request-feedback',
      label: 'Request feedback',
      intent: HOST_INTENTS.FEEDBACK,
      disabled: false,
    });
  });

  test('it does not displace Skip the rest mid-document', () => {
    /*
      THE POINT OF THE WHOLE PLACEMENT. Mid-document the secondary is already
      earning its slot — the owner asked for *"a clear way to go to next page of
      workie vs skip the rest"*. Request feedback must wait for the last page
      rather than take that slot, or fixing one complaint reopens the other.
    */
    const midDoc = hostControlsFor({
      gameType: 'call-and-answer', phase: 'FIELD_NOTES', ...MID_DOC,
    });
    expect(midDoc.primary.intent).toBe(HOST_INTENTS.PAGE);
    // `skip-notes`, whose intent is NEXT — it advances the round, it just says
    // out loud that it is doing so rather than looking like a page turn.
    expect(midDoc.secondary.id).toBe('skip-notes');
  });
});

describe('the host is never trapped in a feedback round', () => {
  // `roundNoun` is an explicit parameter here, not derived from the game type —
  // it is a per-question-set override ("Round", "Lesson", "Subject"), which is
  // why the page passes it in rather than this module looking it up.
  const inFeedback = hostControlsFor({
    gameType: 'call-and-answer', phase: 'FEEDBACK', roundNoun: 'Round',
  });

  test('the primary advances the session', () => {
    expect(inFeedback.primary.intent).toBe(HOST_INTENTS.NEXT);
    expect(inFeedback.primary.label).toBe('Next Round');
    expect(inFeedback.primary.disabled).toBe(false);
  });

  test('the secondary goes back to the read-back, not forward', () => {
    // A one-way door into a beat is how a host ends up using the browser's back
    // button in front of a room — the defect ENDED's "Back to Menu" was added
    // for. Going back is also what closes the composer on every phone.
    expect(inFeedback.secondary.intent).toBe(HOST_INTENTS.FIELD_NOTES);
  });

  test('and never offers two ways to do the same thing', () => {
    // The rule hostControls.test.js:130 says it is really protecting.
    expect(inFeedback.secondary.intent).not.toBe(inFeedback.primary.intent);
  });

  test('it carries whatever round noun the session was given', () => {
    // A feedback round must not be the one screen that calls a Lesson a
    // Question — the set-level override has to reach it like every other phase.
    expect(hostControlsFor({ gameType: 'trivia', phase: 'FEEDBACK', roundNoun: 'Lesson' })
      .primary.label).toBe('Next Lesson');
    expect(hostControlsFor({ gameType: 'wavelength', phase: 'FEEDBACK', roundNoun: 'Subject' })
      .primary.label).toBe('Next Subject');
    // And the house default when the set names nothing.
    expect(hostControlsFor({ gameType: 'trivia', phase: 'FEEDBACK' }).primary.label)
      .toBe('Next Question');
  });
});

describe('the new phase does not break what every phase must satisfy', () => {
  /*
    The contract `hostControls.test.js:102-135` holds every (type, phase) pair
    to. Restated here for the phase that did not exist when that loop was
    written, so a FEEDBACK regression fails in a file that names it.
  */
  ['call-and-answer', 'trivia', 'poll', 'wavelength', 'survey'].forEach((gameType) => {
    test(`${gameType} / FEEDBACK yields exactly one usable primary`, () => {
      const controls = hostControlsFor({ gameType, phase: 'FEEDBACK' });
      expect(controls.primary).toBeTruthy();
      expect(controls.primary.label.trim().length).toBeGreaterThan(0);
      expect(Object.values(HOST_INTENTS)).toContain(controls.primary.intent);
      expect(controls.primary.disabled).toBe(false);
      expect(controls.status.text.trim().length).toBeGreaterThan(0);
    });
  });
});
