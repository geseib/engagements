/**
 * The Build Room's four screens: the pure rules (buildroom/buildScreens.js).
 */
import {
  SCREENS, PROJECTED, isProjected, screenForKey, togglePresent, waitingCount, askPill, latestBuild,
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
