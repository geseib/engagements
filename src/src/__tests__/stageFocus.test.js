/**
 * WHAT THE ROOM IS LOOKING AT CLOSELY — config/stageFocus.js, called directly.
 *
 * No DOM. Every rule that decides whether a frame is applied, and what it means
 * once it is, lives in this one module precisely so it can be enumerated here
 * rather than driven through two surfaces that cannot both be mounted at once.
 *
 * The assertions cluster around one hazard: a focus is an INDEX INTO A ROUND'S
 * ANSWERS, so applying a stale one puts a named person's response on a wall by
 * accident. Most of what follows is about refusing to do that.
 */
import {
  NO_FOCUS,
  roundOfState,
  focusFromFrame,
  normaliseFocus,
  focusToStage,
  focusRequest,
  sameFocus,
} from '../config/stageFocus';

describe('which round a state is on', () => {
  test('the three round-bearing phases report their number', () => {
    expect(roundOfState('ASK#001')).toBe('1');
    expect(roundOfState('VOTE#012')).toBe('12');
    expect(roundOfState('RESULTS#007')).toBe('7');
  });

  test('the roundless states report null', () => {
    // rejects: treating ENDED as round 0 and letting a late frame open a
    // spotlight over a finished session's podium.
    for (const state of ['LOBBY', 'CREATED', 'STARTED', 'ENDED', '', null, undefined]) {
      expect(roundOfState(state)).toBeNull();
    }
  });

  test('a padded number and a bare one are the same round', () => {
    // rejects: string comparison. `'007' === '7'` is false, and the frame
    // carries the padded form while the state string does too — but the phone
    // and the report both hand around bare numbers.
    expect(roundOfState('RESULTS#007')).toBe(roundOfState('RESULTS#7'));
  });
});

describe('applying a frame', () => {
  const frame = (over = {}) => ({ questionNumber: '004', focus: 'answer', index: 2, ...over });

  test('a frame for the round we are on is applied', () => {
    expect(focusFromFrame(frame(), 'RESULTS#004')).toEqual({ focus: 'answer', index: 2 });
  });

  test('a frame for a DIFFERENT round is ignored, and ignored is not "close it"', () => {
    /*
      THE ASSERTION THIS FILE EXISTS FOR.

      null and NO_FOCUS are opposites. NO_FOCUS CLOSES whatever is open, so
      answering a stale frame with it would let a late arrival from round 3 shut
      the spotlight the host just opened on round 4 — a control that works
      except when the network is slow, which is when a host is already unsure
      whether their tap registered.
    */
    const result = focusFromFrame(frame({ questionNumber: '003' }), 'RESULTS#004');
    expect(result).toBeNull();
    expect(result).not.toEqual(NO_FOCUS);
  });

  test('a frame arriving in a roundless state is ignored', () => {
    expect(focusFromFrame(frame(), 'ENDED')).toBeNull();
    expect(focusFromFrame(frame(), 'LOBBY')).toBeNull();
  });

  test('padding does not stop a frame matching its own round', () => {
    // rejects: comparing '004' to '4' as strings, which drops every frame.
    expect(focusFromFrame(frame({ questionNumber: 4 }), 'RESULTS#004')).toEqual({ focus: 'answer', index: 2 });
  });

  test('junk is ignored rather than thrown on', () => {
    expect(focusFromFrame(null, 'RESULTS#004')).toBeNull();
    expect(focusFromFrame('nope', 'RESULTS#004')).toBeNull();
  });

  test('a close travels like anything else', () => {
    // rejects: special-casing 'none' out of the frame path. Closing is a thing
    // the host DID and the other surface has to hear about it.
    expect(focusFromFrame(frame({ focus: 'none', index: null }), 'RESULTS#004')).toEqual(NO_FOCUS);
  });
});

describe('normalising', () => {
  test('index 0 survives', () => {
    // rejects: `value.index || null`. Index 0 is the FIRST response and the one
    // a host is most likely to enlarge, so this mistake ships a button that
    // works for every response except the top one.
    expect(normaliseFocus({ focus: 'answer', index: 0 })).toEqual({ focus: 'answer', index: 0 });
  });

  test('a non-integer or negative index is no focus at all', () => {
    for (const index of [-1, 1.5, 'two', null, undefined, NaN]) {
      expect(normaliseFocus({ focus: 'answer', index })).toEqual(NO_FOCUS);
    }
  });

  test('a numeric string index is accepted', () => {
    // The wire carries JSON, and a client that sent "3" meant 3.
    expect(normaliseFocus({ focus: 'answer', index: '3' })).toEqual({ focus: 'answer', index: 3 });
  });

  test('an unknown kind resolves to no focus, not to itself', () => {
    // rejects: passing an unrecognised kind onward. A client from another
    // deploy is the one case where doing nothing visibly beats handing the
    // value to three more layers that will each fail to recognise it.
    expect(normaliseFocus({ focus: 'zoom' })).toEqual(NO_FOCUS);
    expect(normaliseFocus({})).toEqual(NO_FOCUS);
  });

  test('a question focus carries no index', () => {
    expect(normaliseFocus({ focus: 'question', index: 4 })).toEqual({ focus: 'question', index: null });
  });
});

describe('turning a focus into the stage\'s two pieces of state', () => {
  test('the question and a response are mutually exclusive', () => {
    // rejects: leaving `lessonExpanded` set while opening a spotlight. Both are
    // independent client state on GameHostPage set by separate buttons, so the
    // page CAN hold both and stack one overlay on the other. Deriving both from
    // one value is what makes that unrepresentable.
    expect(focusToStage({ focus: 'question' }, { answerCount: 5 }))
      .toEqual({ lessonExpanded: true, spotlightIndex: null });
    expect(focusToStage({ focus: 'answer', index: 1 }, { answerCount: 5 }))
      .toEqual({ lessonExpanded: false, spotlightIndex: 1 });
  });

  test('nothing focused closes both', () => {
    expect(focusToStage(NO_FOCUS, { answerCount: 5 }))
      .toEqual({ lessonExpanded: false, spotlightIndex: null });
  });

  test('an index past the end opens nothing', () => {
    // rejects: an empty spotlight. The writer deliberately does not range-check
    // — that would mean querying the answers on every tap, while a room waits,
    // against a count that is still moving — so the clamp lives here.
    expect(focusToStage({ focus: 'answer', index: 9 }, { answerCount: 3 }))
      .toEqual({ lessonExpanded: false, spotlightIndex: null });
  });

  test('index 0 with one answer opens it', () => {
    // The boundary the clamp above is most likely to get wrong by one.
    expect(focusToStage({ focus: 'answer', index: 0 }, { answerCount: 1 }))
      .toEqual({ lessonExpanded: false, spotlightIndex: 0 });
  });

  test('no answers loaded yet means nothing opens', () => {
    expect(focusToStage({ focus: 'answer', index: 0 }, { answerCount: 0 }))
      .toEqual({ lessonExpanded: false, spotlightIndex: null });
  });
});

describe('building the request', () => {
  test('a round-bearing state produces a body with a numeric round', () => {
    expect(focusRequest({ focus: 'answer', index: 2, state: 'RESULTS#004' }))
      .toEqual({ focus: 'answer', index: 2, questionNumber: 4 });
  });

  test('a roundless state produces nothing to send', () => {
    // rejects: posting `questionNumber: 0` from the lobby, which the handler
    // pads to '000' and writes as a round row nothing will ever read again.
    expect(focusRequest({ focus: 'question', state: 'LOBBY' })).toBeNull();
    expect(focusRequest({ focus: 'question', state: 'ENDED' })).toBeNull();
  });

  test('a question or a close carries index null, never a leftover number', () => {
    // rejects: passing the caller's stale index through. A stored number beside
    // a non-answer focus is a trap for the next reader.
    expect(focusRequest({ focus: 'question', index: 7, state: 'ASK#002' }))
      .toEqual({ focus: 'question', index: null, questionNumber: 2 });
    expect(focusRequest({ focus: 'none', index: 7, state: 'ASK#002' }))
      .toEqual({ focus: 'none', index: null, questionNumber: 2 });
  });

  test('an answer focus with a bad index degrades to a close, not to index 0', () => {
    // rejects: defaulting. Defaulting would put a specific person's response on
    // a wall because a caller forgot a field.
    expect(focusRequest({ focus: 'answer', index: undefined, state: 'ASK#002' }))
      .toEqual({ focus: 'none', index: null, questionNumber: 2 });
  });
});

describe('the double-tap', () => {
  test('the same focus twice is recognised as the same', () => {
    // rejects: object identity. The host is in front of a room and will tap
    // twice; a press that changes nothing should cost no request.
    expect(sameFocus({ focus: 'answer', index: 2 }, { focus: 'answer', index: 2 })).toBe(true);
    expect(sameFocus(NO_FOCUS, { focus: 'nonsense' })).toBe(true);
  });

  test('a different response is a different focus', () => {
    expect(sameFocus({ focus: 'answer', index: 2 }, { focus: 'answer', index: 3 })).toBe(false);
    expect(sameFocus({ focus: 'answer', index: 0 }, { focus: 'question' })).toBe(false);
  });
});
