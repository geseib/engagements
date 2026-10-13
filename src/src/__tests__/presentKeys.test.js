/**
 * KEYS ON THE PRESENTATION (owner, 2026-10-13: "if focus is on projection
 * window/tab you should be able to move forward or backwards (if in
 * responses, results, or ai advisor response, feedback, etc.)").
 *
 * Forward and Back walk what is ON THE WALL within a round — the tally, each
 * response (by part), Workie's pages, feedback — and never move the round
 * itself: no Start voting, Show results or Next round from a stray key. Those
 * stay on the host's dock and the Remote.
 */
import { presentKeyStep } from '../present/presentKeys';

const snap = (over = {}) => ({
  state: 'RESULTS#005', stageBeat: 'results',
  stageFocus: { focus: 'none', index: null, part: 0, parts: 1, phase: null },
  stageNotes: { page: 0, pages: 4 },
  ...over,
});
const answerAt = (index, phase = 'RESULTS', part = 0, parts = 1) => ({ focus: 'answer', index, part, parts, phase });

describe('results', () => {
  it('tally → response 1 → … → last → What we heard', () => {
    expect(presentKeyStep(snap(), 'forward', { total: 3 })).toEqual([{ kind: 'focus', focus: 'answer', index: 0, part: 0 }]);
    expect(presentKeyStep(snap({ stageFocus: answerAt(0) }), 'forward', { total: 3 })).toEqual([{ kind: 'focus', focus: 'answer', index: 1, part: 0 }]);
    expect(presentKeyStep(snap({ stageFocus: answerAt(2) }), 'forward', { total: 3 }))
      .toEqual([{ kind: 'focus', focus: 'none' }, { kind: 'beat', beat: 'field-notes' }]);
  });
  it('a long response steps by part, both ways', () => {
    expect(presentKeyStep(snap({ stageFocus: answerAt(1, 'RESULTS', 0, 2) }), 'forward', { total: 3 }))
      .toEqual([{ kind: 'focus', focus: 'answer', index: 1, part: 1, parts: 2 }]);
    expect(presentKeyStep(snap({ stageFocus: answerAt(1, 'RESULTS', 1, 2) }), 'back', { total: 3 }))
      .toEqual([{ kind: 'focus', focus: 'answer', index: 1, part: 0, parts: 2 }]);
  });
  it('back: response → previous → tally; the tally goes nowhere', () => {
    expect(presentKeyStep(snap({ stageFocus: answerAt(2) }), 'back', { total: 3 })).toEqual([{ kind: 'focus', focus: 'answer', index: 1, part: 0 }]);
    expect(presentKeyStep(snap({ stageFocus: answerAt(0) }), 'back', { total: 3 })).toEqual([{ kind: 'focus', focus: 'none' }]);
    expect(presentKeyStep(snap(), 'back', { total: 3 })).toEqual([]);
  });
  it('no responses: forward goes to What we heard', () => {
    expect(presentKeyStep(snap(), 'forward', { total: 0 })).toEqual([{ kind: 'beat', beat: 'field-notes' }]);
  });
});

describe("Workie's read and feedback", () => {
  const read = (page) => snap({ stageBeat: 'field-notes', stageNotes: { page, pages: 4 } });
  it('pages forward and back; the last page does not start the next round', () => {
    expect(presentKeyStep(read(0), 'forward', { total: 3 })).toEqual([{ kind: 'page', step: 'next' }]);
    expect(presentKeyStep(read(3), 'forward', { total: 3 })).toEqual([]);
    expect(presentKeyStep(read(2), 'back', { total: 3 })).toEqual([{ kind: 'page', step: 'prev' }]);
  });
  it('back from the first page returns to the last response, or the tally', () => {
    expect(presentKeyStep(read(0), 'back', { total: 3 }))
      .toEqual([{ kind: 'beat', beat: 'results' }, { kind: 'focus', focus: 'answer', index: 2, part: 0 }]);
    expect(presentKeyStep(read(0), 'back', { total: 0 })).toEqual([{ kind: 'beat', beat: 'results' }]);
  });
  it('feedback: back to the read, forward nowhere', () => {
    const fb = snap({ stageBeat: 'feedback' });
    expect(presentKeyStep(fb, 'back', { total: 3 })).toEqual([{ kind: 'beat', beat: 'field-notes' }]);
    expect(presentKeyStep(fb, 'forward', { total: 3 })).toEqual([]);
  });
});

describe('voting', () => {
  const vote = (focus) => snap({ state: 'VOTE#005', stageFocus: focus || { focus: 'none', index: null } });
  it('forward shows the responses in voting order; the last stays put (results are the host\'s act)', () => {
    expect(presentKeyStep(vote(), 'forward', { total: 4 })).toEqual([{ kind: 'focus', focus: 'answer', index: 0, part: 0 }]);
    expect(presentKeyStep(vote(answerAt(1, 'VOTE')), 'forward', { total: 4 })).toEqual([{ kind: 'focus', focus: 'answer', index: 2, part: 0 }]);
    expect(presentKeyStep(vote(answerAt(3, 'VOTE')), 'forward', { total: 4 })).toEqual([]);
  });
  it('back walks down to the count', () => {
    expect(presentKeyStep(vote(answerAt(1, 'VOTE')), 'back', { total: 4 })).toEqual([{ kind: 'focus', focus: 'answer', index: 0, part: 0 }]);
    expect(presentKeyStep(vote(answerAt(0, 'VOTE')), 'back', { total: 4 })).toEqual([{ kind: 'focus', focus: 'none' }]);
  });
  it('nothing to show, nothing to do', () => {
    expect(presentKeyStep(vote(), 'forward', { total: 0 })).toEqual([]);
  });
});

describe('everything else is still', () => {
  it.each(['CREATED', 'ASK#005', 'ENDED', 'SURVEY#OPEN'])('%s', (state) => {
    expect(presentKeyStep(snap({ state }), 'forward', { total: 3 })).toEqual([]);
    expect(presentKeyStep(snap({ state }), 'back', { total: 3 })).toEqual([]);
  });
  it('an enlarged question shrinks either way', () => {
    const q = snap({ state: 'ASK#005', stageFocus: { focus: 'question' } });
    expect(presentKeyStep(q, 'forward', { total: 3 })).toEqual([{ kind: 'focus', focus: 'none' }]);
  });
});
