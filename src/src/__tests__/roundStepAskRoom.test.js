/**
 * Where "Ask the room" sits (session flow v3 §4.3). The read ends on a real
 * stop when Workie's questions are unsent; mid-read, moving on past them takes
 * an in-place second press (owner, 15 Oct, Q8); Ask the room replaces Request
 * feedback where the composer exists (Q7); Ask another question opens it.
 * The laptop and the Remote give the same buttons (parity).
 */
import { roundStep, momentOf } from '../config/roundStep';
import { hostControlsFor } from '../config/hostControls';
import { remoteStep } from '../config/hostRemote';

const read = (over = {}) => ({
  gameType: 'call-and-answer', roundNoun: 'Round', state: 'RESULTS#002', stageBeat: 'field-notes',
  notes: { page: 2, pages: 3, ready: true }, asksEnabled: true, asksReady: 3, answerCount: 4, ...over,
});
const step = (s) => roundStep(momentOf(s), s);

describe('the last page', () => {
  test('with questions unsent: Ask the room is the main step and sends nothing; Start round 3 is one press beside it', () => {
    const st = step(read());
    expect(st.primary).toMatchObject({ id: 'ask-room', label: 'Ask the room', intent: 'ask-room' });
    expect(st.secondary).toMatchObject({ id: 'next', label: 'Start round 3' });
    expect(st.secondary.arm).toBeUndefined();
    expect(st.status.text).toBe('Last page · 3 asks ready');
  });
  test('with nothing unsent: Start round 3, and Ask the room replaces Request feedback', () => {
    const st = step(read({ asksReady: 0 }));
    expect(st.primary).toMatchObject({ id: 'next', label: 'Start round 3' });
    expect(st.secondary).toMatchObject({ id: 'ask-room', label: 'Ask the room' });
  });
  test('where the composer is not offered (the tier\'s switch off), Request feedback stays', () => {
    const st = step(read({ asksEnabled: false }));
    expect(st.primary.id).toBe('next');
    expect(st.secondary).toMatchObject({ id: 'request-feedback' });
  });
});

describe('mid-read', () => {
  test('Start round 3 needs a second press while questions are unsent, said in place', () => {
    const st = step(read({ notes: { page: 0, pages: 3, ready: true } }));
    expect(st.primary.id).toBe('notes-page');
    expect(st.secondary.arm).toEqual({
      text: '3 questions not asked yet. Press again to move on.',
      confirmLabel: 'Start round 3 anyway',
      inPlace: true,
    });
  });
  test('with nothing unsent it is one press, as before', () => {
    expect(step(read({ notes: { page: 0, pages: 3, ready: true }, asksReady: 0 })).secondary.arm).toBeUndefined();
  });
  test('one question unsent reads in the singular', () => {
    expect(step(read({ notes: { page: 0, pages: 3, ready: true }, asksReady: 1 })).secondary.arm.text)
      .toBe('1 question not asked yet. Press again to move on.');
  });
});

describe('after a question\'s results', () => {
  test('Ask another question opens the composer', () => {
    const st = step(read({ stageBeat: 'ask', roomAsk: { status: 'closed' } }));
    expect(st.secondary).toMatchObject({ label: 'Ask another question', intent: 'ask-room' });
  });
});

describe('the laptop and the Remote agree', () => {
  test.each([
    ['last page, unsent', { notesPage: 2 }, { page: 2 }],
    ['mid-read, unsent', { notesPage: 0 }, { page: 0 }],
  ])('%s', (_, dockOver, notes) => {
    const dock = hostControlsFor({
      gameType: 'call-and-answer', phase: 'FIELD_NOTES', roundNoun: 'Round', playerCount: 4, answerCount: 4,
      notesPages: 3, notesReady: true, roundNumber: 2, asksEnabled: true, asksReady: 3, ...dockOver,
    });
    const phone = remoteStep(
      { state: 'RESULTS#002', gameType: 'call-and-answer', stageBeat: 'field-notes', stageNotes: { ...notes, pages: 3 } },
      { playerCount: 4, answerCount: 4, notesReady: true, asksEnabled: true, asksReady: 3 },
    );
    expect(phone.primary).toEqual(dock.step.primary);
    expect(phone.secondary).toEqual(dock.step.secondary);
  });
});
