/**
 * The workflow strip (session flow v3 §4.6). The owner: "i as a host know where
 * i am and what is expected of me". These pin the live step per moment, the
 * ticks, Ask as optional, the sub-states, and the one rule that matters most:
 * "Your part now" always names the main button by its own label, on the
 * laptop and on the Remote alike.
 */
import { workflowStrip, stripFor, liveWhere, stepIdsFor } from '../config/workflowStrip';
import { hostControlsFor } from '../config/hostControls';
import { remoteStep, snapshotFromHostState } from '../config/hostRemote';

const snap = (over = {}) => ({
  gameType: 'call-and-answer', roundNoun: 'Round', hasQuestionSet: true, playerCount: 4,
  ...over,
});

const stateOf = (strip) => Object.fromEntries(strip.steps.map((s) => [s.id, s.state]));

describe('the steps', () => {
  test('Call and Answer has six steps; a type without a vote has five', () => {
    expect(stepIdsFor('call-and-answer')).toEqual(['setup', 'answer', 'vote', 'heard', 'ask', 'finish']);
    expect(stepIdsFor('trivia')).toEqual(['setup', 'answer', 'heard', 'ask', 'finish']);
  });

  test('the lobby: Setup is live and nothing in the loop is done', () => {
    const s = stripFor(snap({ state: 'CREATED' }));
    expect(s.live).toBe('setup');
    expect(stateOf(s)).toEqual({ setup: 'live', answer: 'todo', vote: 'todo', heard: 'todo', ask: 'todo', finish: 'todo' });
    expect(s.round).toBeNull();
  });

  test('answering: Setup ticked, Answer live, the round named with its total', () => {
    const s = stripFor(snap({ state: 'ASK#002', totalRounds: 6, progress: { received: 1, total: 4 } }));
    expect(stateOf(s)).toMatchObject({ setup: 'done', answer: 'live', vote: 'todo' });
    expect(s.round).toMatchObject({ n: 2, of: 6, label: 'Round 2 of 6' });
  });

  test('the read: Answer and Vote ticked, What we heard live with its page, Ask shows how many are ready', () => {
    const s = stripFor(snap({
      state: 'RESULTS#002', stageBeat: 'field-notes', notes: { page: 1, pages: 6, ready: true }, asksReady: 3,
    }));
    expect(stateOf(s)).toMatchObject({ answer: 'done', vote: 'done', heard: 'live', ask: 'todo', finish: 'todo' });
    expect(s.steps.find((x) => x.id === 'heard').sub).toBe('page 2 of 6');
    expect(s.steps.find((x) => x.id === 'ask')).toMatchObject({ optional: true, sub: '3 ready' });
  });

  test('a question for the room: Ask live; the set noun names the round', () => {
    const s = stripFor(snap({ state: 'RESULTS#003', stageBeat: 'ask', roomAsk: { status: 'open' }, roundNoun: 'Lesson' }));
    expect(stateOf(s)).toMatchObject({ heard: 'done', ask: 'live' });
    expect(s.steps.find((x) => x.id === 'ask').sub).toBe('');
    expect(s.round.label).toBe('Lesson 3');
  });

  test('ended: every step ticked and Finish live', () => {
    const s = stripFor(snap({ state: 'ENDED' }));
    expect(stateOf(s)).toEqual({ setup: 'done', answer: 'done', vote: 'done', heard: 'done', ask: 'done', finish: 'live' });
  });

  test('a moment with no step (a survey, an unknown state) has no strip', () => {
    expect(stripFor(snap({ state: 'SURVEY#OPEN' }))).toBeNull();
    expect(stripFor(snap({ state: '' }))).toBeNull();
  });

  test('every step explains itself', () => {
    for (const st of stripFor(snap({ state: 'ASK#001' })).steps) expect(st.explain).toMatch(/\w/);
  });
});

describe('"Your part now" names the main button', () => {
  const MOMENTS = [
    { state: 'CREATED' },
    { state: 'ASK#002', progress: { received: 2, total: 4 } },
    { state: 'VOTE#002', progress: { received: 2, total: 4 }, answerCount: 4 },
    { state: 'RESULTS#002', answerCount: 4 },
    { state: 'RESULTS#002', stageBeat: 'field-notes', notes: { page: 0, pages: 3, ready: true } },
    { state: 'RESULTS#002', stageBeat: 'field-notes', notes: { page: 2, pages: 3, ready: true } },
    { state: 'RESULTS#002', stageBeat: 'feedback' },
    { state: 'RESULTS#002', stageBeat: 'ask', roomAsk: { status: 'open', answered: 1, total: 4 } },
    { state: 'RESULTS#002', stageBeat: 'ask', roomAsk: { status: 'closed' } },
    { state: 'ENDED' },
  ];

  test.each(MOMENTS.map((m) => [m.state + (m.stageBeat ? ` ${m.stageBeat}` : ''), m]))('%s', (_, m) => {
    const s = snap(m);
    const strip = stripFor(s);
    const step = remoteStep({ ...m, stageNotes: m.notes, gameType: s.gameType }, { playerCount: 4, hasQuestionSet: true, answerCount: m.answerCount, notesReady: m.notes && m.notes.ready, roomAsk: m.roomAsk });
    expect(strip.part).not.toBeNull();
    expect(strip.part.action).toBe(step.primary.label);
    expect(`${strip.part.before}${strip.part.action}${strip.part.after}`).toMatch(/^[A-Z]/);
  });

  test('mid-read it says the page turns; on the last page it names Start round 3', () => {
    const mid = stripFor(snap({ state: 'RESULTS#002', stageBeat: 'field-notes', notes: { page: 0, pages: 3, ready: true } }));
    expect(mid.part).toEqual({ before: 'Read with the room. ', action: 'Next page', after: ' turns the page.' });
    const last = stripFor(snap({ state: 'RESULTS#002', stageBeat: 'field-notes', notes: { page: 2, pages: 3, ready: true } }));
    expect(last.part.action).toBe('Start round 3');
  });

  test('while Workie writes there is no button to name, so the line says what is happening', () => {
    const s = stripFor(snap({ state: 'RESULTS#002', stageBeat: 'field-notes', notes: { ready: false } }));
    expect(s.part).toEqual({ before: 'Workie is writing. The read appears when it is ready.', action: '', after: '' });
  });

  test('the laptop and the Remote build the same strip for the same round', () => {
    const dock = hostControlsFor({
      gameType: 'call-and-answer', phase: 'FIELD_NOTES', roundNoun: 'Round', playerCount: 4, answerCount: 4,
      notesPage: 1, notesPages: 3, notesReady: true, roundNumber: 2, totalRounds: 6, asksReady: 2,
    });
    const laptop = workflowStrip(dock.step, {
      gameType: 'call-and-answer', roundNoun: 'Round', roundNumber: 2, totalRounds: 6, notes: { page: 1, pages: 3, ready: true }, asksReady: 2,
    });
    const json = { state: 'RESULTS#002', gameType: 'call-and-answer', stageBeat: 'field-notes', stageNotes: { page: 1, pages: 3 } };
    const extras = { playerCount: 4, answerCount: 4, notesReady: true, asksReady: 2 };
    const phone = workflowStrip(remoteStep(json, extras), { ...snapshotFromHostState(json, extras), totalRounds: 6 });
    expect(phone.steps).toEqual(laptop.steps);
    expect(phone.part).toEqual(laptop.part);
    expect(phone.round.label).toBe('Round 2 of 6');
  });
});

describe('the Viewing bar names where the room is', () => {
  test('a round step: "round 2, What we heard, page 4 of 6"', () => {
    const s = stripFor(snap({ state: 'RESULTS#002', stageBeat: 'field-notes', notes: { page: 3, pages: 6, ready: true } }));
    expect(liveWhere(s)).toBe('round 2, What we heard, page 4 of 6');
  });
  test('the lobby: just "Setup"', () => {
    expect(liveWhere(stripFor(snap({ state: 'CREATED' })))).toBe('Setup');
  });
});

/* A QUESTION FOR THE ROOM'S RESULTS SAY WHAT THERE IS TO DO (review of test
   a76fda95, issue #34 P3): picking applies to Ideas only.
   rejects: "Pick the ideas to show" after a Choose or a Rate. */
describe('Your part now after a question for the room', () => {
  const after = (kind) => {
    const s = stripFor(snap({ state: 'RESULTS#002', stageBeat: 'ask', roomAsk: { status: 'closed', kind, answered: 3, total: 4 } }));
    return `${s.part.before}${s.part.action}${s.part.after}`;
  };
  test('Ideas: pick the ideas', () => {
    expect(after('ideas')).toMatch(/^Pick the ideas to show\./);
  });
  test('Choose, Rate or a kind not known yet: nothing to pick', () => {
    for (const kind of ['choose', 'rate', undefined]) {
      expect(after(kind)).not.toMatch(/Pick the ideas/);
      expect(after(kind)).toMatch(/^The room's answer is up\./);
    }
  });
});
