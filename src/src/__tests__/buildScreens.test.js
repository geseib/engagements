/**
 * The Build Room's four screens: the pure rules (buildroom/buildScreens.js).
 */
import {
  SCREENS, PROJECTED, isProjected, screenForKey, togglePresent, waitingCount, askPill, latestBuild, stageModel,
} from '../buildroom/buildScreens';

describe('the screens', () => {
  test('Host, Stage, Build and History, on keys 1 to 4', () => {
    expect(SCREENS.map((s) => [s.key, s.label, s.shortcut])).toEqual([
      ['host', 'Host', '1'], ['stage', 'Stage', '2'], ['build', 'Build', '3'], ['history', 'History', '4'],
    ]);
    expect(['1', '2', '3', '4', '5', 'p'].map(screenForKey)).toEqual(['host', 'stage', 'build', 'history', null, null]);
  });

  test('every screen but Host is made for the room', () => {
    expect(PROJECTED).toEqual(['stage', 'build', 'history']);
    expect(isProjected('host')).toBe(false);
    expect(isProjected('build')).toBe(true);
  });

  test('P goes from Host to the last screen the room saw, Stage the first time, and back', () => {
    expect(togglePresent('host', null)).toBe('stage');
    expect(togglePresent('host', 'build')).toBe('build');
    expect(togglePresent('history', 'history')).toBe('host');
    expect(togglePresent('stage', 'stage')).toBe('host');
  });
});

describe('what the header counts', () => {
  test('waiting: Claude\'s proposed asks plus the room\'s new ideas', () => {
    expect(waitingCount(null)).toBe(0);
    expect(waitingCount({
      asks: [{ status: 'proposed' }, { status: 'live' }, { status: 'proposed' }],
      ideas: [{ status: 'new' }, { status: 'dismissed' }, { status: 'promoted' }],
    })).toBe(3);
  });

  test('the ask pill: answered of here, votes while voting, results when closed', () => {
    const room = (ask) => ({ currentAskId: '003', playerCount: 18, asks: [{ askId: '003', ...ask }] });
    expect(askPill(room({ status: 'live', kind: 'choice', answerCount: 5 }))).toEqual({ text: 'Ask 3 · 5 of 18', results: false });
    expect(askPill(room({ status: 'voting', kind: 'suggest', answerCount: 9, voteCount: 4 }))).toEqual({ text: 'Ask 3 · 4 of 18', results: false });
    expect(askPill(room({ status: 'results', kind: 'rating' }))).toEqual({ text: 'Ask 3 · results', results: true });
    expect(askPill(room({ status: 'decided', kind: 'rating' }))).toBeNull();
    expect(askPill({ currentAskId: null, asks: [] })).toBeNull();
  });
});

describe('what the Build screen shows', () => {
  test('the newest link Claude posted, and the newest screenshot that is not a mockup', () => {
    const room = {
      log: [
        { by: 'agent', kind: 'showing', link: 'http://localhost:5173/a' },
        { by: 'host', kind: 'verbal', link: 'http://example.com/no' },
        { by: 'agent', kind: 'progress', link: 'http://localhost:5173/' },
        { by: 'agent', kind: 'progress', link: 'javascript:alert(1)' },
      ],
      images: [{ imageId: 'p1', kind: 'progress' }, { imageId: 'm1', kind: 'mockup' }],
    };
    expect(latestBuild(room)).toEqual({ link: 'http://localhost:5173/', shot: { imageId: 'p1', kind: 'progress' } });
  });

  test('falls back to the wrap-up demo, and to nothing', () => {
    expect(latestBuild({ log: [], images: [], outcome: { links: [{ url: 'http://localhost:3000/' }] } }).link).toBe('http://localhost:3000/');
    expect(latestBuild({})).toEqual({ link: '', shot: null });
  });
});

describe('the Stage screen, as the regular stage draws it', () => {
  const room = (extra = {}) => ({ playerCount: 18, agent: { connected: true }, ...extra });

  test('a live Choose: answering, the count of here, Close on Space', () => {
    expect(stageModel(room(), { askId: '003', kind: 'choice', status: 'live', answerCount: 5 })).toEqual({
      phase: 'ASK',
      context: { category: 'Choose', round: 3, noun: 'Ask' },
      meter: { heading: 'Answered', count: 5, of: 18 },
      status: '5 of 18 have answered',
      primary: { action: 'close', label: 'Close and show results' },
    });
  });

  test('Ideas collecting opens voting; voting closes; results go back to the Host to decide', () => {
    expect(stageModel(room(), { askId: '004', kind: 'suggest', status: 'live', answerCount: 1 }))
      .toMatchObject({ phase: 'ASK', status: '1 idea so far', primary: { action: 'vote' } });
    expect(stageModel(room(), { askId: '004', kind: 'suggest', status: 'voting', voteCount: 7 }))
      .toMatchObject({ phase: 'VOTE', meter: { heading: 'Voted', count: 7, of: 18 }, primary: { action: 'close' } });
    expect(stageModel(room(), { askId: '004', kind: 'rating', status: 'results', results: { total: 15 } }))
      .toMatchObject({ phase: 'RESULTS', meter: { count: 15, of: 18 }, primary: { action: 'decide', label: 'Decide on Host' } });
  });

  test('between asks: no chip, who is here, and what Claude is doing, in room-safe words', () => {
    expect(stageModel(room(), null)).toMatchObject({ phase: null, meter: { heading: 'In the room', count: 18 }, status: 'Claude is building. Send an idea from your phone any time.', primary: null });
    expect(stageModel(room({ agent: {} }), null).status).toBe('Waiting for Claude Code.');
    expect(stageModel(room({ outcome: { summary: 'A sign-up page.' } }), null).status).toBe('Here is what we built.');
  });

  test('ended: complete, no move', () => {
    expect(stageModel(room({ state: 'ENDED' }), { askId: '003', kind: 'choice', status: 'live' })).toMatchObject({ phase: 'ENDED', primary: null });
  });
});

describe('the Stage with the wheel up', () => {
  const room = { playerCount: 18, agent: { connected: true } };
  const results = (wheel) => ({ askId: '003', kind: 'choice', status: 'results', results: { total: 4 }, wheel });
  test('someone has the turn; the host can always spin; deciding stays on the Host', () => {
    expect(stageModel(room, results({ spinner: 'Dee', armed: true, landed: null, spins: [] }))).toMatchObject({
      status: 'Dee spins the wheel', wheel: true,
      primary: { action: 'spin', label: 'Spin' }, secondary: { action: 'decide', label: 'Decide on Host' },
    });
  });
  test('landed: Spin again', () => {
    expect(stageModel(room, results({ spinner: 'Dee', armed: false, landed: 'B', spins: [{}] }))).toMatchObject({
      status: 'The wheel has picked', primary: { label: 'Spin again' },
    });
  });
  test('after a revote, the old ask is plain results', () => {
    expect(stageModel(room, { ...results({ spinner: null, armed: false, landed: null, spins: [] }), revotedAs: '004' })).toMatchObject({
      status: 'Results', primary: { action: 'decide' },
    });
  });
});
