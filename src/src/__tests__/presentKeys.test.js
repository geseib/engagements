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

describe('voting, when every answer fits the overview (owner, 18 Oct 2026, room-content-v2 frame 4)', () => {
  const vote = (stageFocus = { focus: 'none', index: null }) => snap({ state: 'VOTE#005', stageFocus });
  const O = { total: 3, overview: true };
  it('forward from the overview puts answer 1 up; back from the overview does nothing', () => {
    expect(presentKeyStep(vote(), 'forward', O)).toEqual([{ kind: 'focus', focus: 'answer', index: 0, part: 0 }]);
    expect(presentKeyStep(vote(), 'back', O)).toEqual([]);
  });
  it('back from answer 1 returns to the overview', () => {
    expect(presentKeyStep(vote(answerAt(0, 'VOTE')), 'back', O)).toEqual([{ kind: 'focus', focus: 'none' }]);
  });
  it('the answers step both ways, by part; forward past the last asks for the next step', () => {
    expect(presentKeyStep(vote(answerAt(1, 'VOTE')), 'forward', O)).toEqual([{ kind: 'focus', focus: 'answer', index: 2, part: 0 }]);
    expect(presentKeyStep(vote(answerAt(1, 'VOTE', 1, 2)), 'back', O)).toEqual([{ kind: 'focus', focus: 'answer', index: 1, part: 0, parts: 2 }]);
    expect(presentKeyStep(vote(answerAt(2, 'VOTE')), 'forward', O)).toEqual([]);
  });
  // ONE RULE FOR ↑ ↓ ON BOTH SCREENS (19 Oct 2026): on one screen ↑ ↓ page
  // the list and → ← step; on the room's window ↓ stepped to the next answer.
  // Now ↑ ↓ (vertical) page what is up, or do nothing; → ← step the answers.
  it('↑ ↓ with the overview up do nothing (it is one page); → ← still step', () => {
    const V = { ...O, vertical: true };
    expect(presentKeyStep(vote(), 'forward', V)).toEqual([]);
    expect(presentKeyStep(vote(), 'back', V)).toEqual([]);
    expect(presentKeyStep(vote(answerAt(1, 'VOTE')), 'forward', V)).toEqual([]);
    expect(presentKeyStep(vote(), 'forward', O)).toEqual([{ kind: 'focus', focus: 'answer', index: 0, part: 0 }]);
  });
  it('↑ ↓ page a long answer by its parts, never across to the next answer', () => {
    const V = { ...O, vertical: true };
    expect(presentKeyStep(vote(answerAt(1, 'VOTE', 0, 2)), 'forward', V)).toEqual([{ kind: 'focus', focus: 'answer', index: 1, part: 1, parts: 2 }]);
    expect(presentKeyStep(vote(answerAt(1, 'VOTE', 1, 2)), 'forward', V)).toEqual([]);
    expect(presentKeyStep(vote(answerAt(1, 'VOTE', 1, 2)), 'back', V)).toEqual([{ kind: 'focus', focus: 'answer', index: 1, part: 0, parts: 2 }]);
    const NV = { total: 3, overview: false, vertical: true };
    expect(presentKeyStep(vote(), 'forward', NV)).toEqual([]);
    expect(presentKeyStep(vote(), 'back', NV)).toEqual([]);
  });
  it('when they do not fit, today\'s stepping holds: answer 1 is up, back from it wraps', () => {
    const N = { total: 3, overview: false };
    expect(presentKeyStep(vote(), 'forward', N)).toEqual([{ kind: 'focus', focus: 'answer', index: 1, part: 0 }]);
    expect(presentKeyStep(vote(), 'back', N)).toEqual([{ kind: 'focus', focus: 'answer', index: 2, part: 0 }]);
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
  it('Response 1 is already up: forward steps to 2; past the last asks for results', () => {
    expect(presentKeyStep(vote(), 'forward', { total: 4 })).toEqual([{ kind: 'focus', focus: 'answer', index: 1, part: 0 }]);
    expect(presentKeyStep(vote(answerAt(1, 'VOTE')), 'forward', { total: 4 })).toEqual([{ kind: 'focus', focus: 'answer', index: 2, part: 0 }]);
    expect(presentKeyStep(vote(answerAt(3, 'VOTE')), 'forward', { total: 4 })).toEqual([]);
  });
  it('back steps down and wraps from the first to the last', () => {
    expect(presentKeyStep(vote(answerAt(1, 'VOTE')), 'back', { total: 4 })).toEqual([{ kind: 'focus', focus: 'answer', index: 0, part: 0 }]);
    expect(presentKeyStep(vote(answerAt(0, 'VOTE')), 'back', { total: 4 })).toEqual([{ kind: 'focus', focus: 'answer', index: 3, part: 0 }]);
    expect(presentKeyStep(vote(), 'back', { total: 4 })).toEqual([{ kind: 'focus', focus: 'answer', index: 3, part: 0 }]);
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

test('the join code comes down with either key', () => {
  const j = { state: 'RESULTS#005', stageBeat: 'results', stageFocus: { focus: 'join' } };
  expect(presentKeyStep(j, 'forward', { total: 3 })).toEqual([{ kind: 'focus', focus: 'none' }]);
  expect(presentKeyStep(j, 'back', { total: 3 })).toEqual([{ kind: 'focus', focus: 'none' }]);
});
