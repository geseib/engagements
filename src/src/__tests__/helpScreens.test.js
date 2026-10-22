/**
 * HELP OPENS WHERE YOU ARE — the map and the addresses it relies on.
 *
 * Help refresh Phase 0. `config/help/screens.js` is the one list of which
 * screen opens which guide section. These tests make a wrong entry a red
 * build rather than a help button that opens the top of the wrong guide:
 *   - every HELP_FOR_SCREEN entry names a real guide and a real section;
 *   - every section of every guide has an id, kebab-case, unique in its guide;
 *   - guide#section addresses, aliases and moved sections resolve.
 */
const {
  HELP_ROLES, GUIDE_BY_ID, HELP_ALIASES, HELP_SECTION_MOVES, HELP_AREAS,
  AREA_ID_BY_GUIDE_ID, resolveHelpTarget, findSection,
} = require('../config/help');
const { HELP_FOR_SCREEN, PROVISIONAL_SCREENS, helpFor } = require('../config/help/screens');

const allGuides = () => HELP_ROLES.flatMap((role) => role.guides);
const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;

describe('every section is addressable', () => {
  test('every section has a kebab-case id', () => {
    const missing = [];
    allGuides().forEach((g) => g.sections.forEach((s, i) => {
      if (!s.id || !KEBAB.test(s.id)) missing.push(`${g.id} section ${i} (${s.title}): ${s.id}`);
    }));
    expect(missing).toEqual([]);
  });

  test('section ids are unique within each guide', () => {
    const dupes = [];
    allGuides().forEach((g) => {
      const ids = g.sections.map((s) => s.id);
      ids.filter((id, i) => ids.indexOf(id) !== i).forEach((id) => dupes.push(`${g.id}#${id}`));
    });
    expect(dupes).toEqual([]);
  });

  test('guide#section resolves to that section, and a stale section to the guide top', () => {
    expect(resolveHelpTarget('player-joining#name-taken'))
      .toEqual({ kind: 'guide', id: 'player-joining', section: 'name-taken' });
    expect(resolveHelpTarget('player-joining', 'name-taken'))
      .toEqual({ kind: 'guide', id: 'player-joining', section: 'name-taken' });
    expect(resolveHelpTarget('player-joining#not-a-section'))
      .toEqual({ kind: 'guide', id: 'player-joining' });
    // An alias with a section: the alias resolves, then the section within it.
    expect(resolveHelpTarget('websocket-settings', 'real-time-communication'))
      .toEqual({ kind: 'guide', id: 'admin-settings', section: 'real-time-communication' });
  });

  test('a section that moved guides is still reached by its old address', () => {
    Object.entries(HELP_SECTION_MOVES).forEach(([from, to]) => {
      const [g, s] = to.split('#');
      expect(findSection(g, s)).toBeTruthy();
      expect(resolveHelpTarget(from)).toEqual({ kind: 'guide', id: g, section: s });
    });
  });
});

describe('the split kept every address', () => {
  /* The guide ids that existed before the Phase 0 split. Each must still
     resolve to a guide — directly, or through an alias. */
  const BEFORE_SPLIT = [
    'player-getting-started', 'player-joining', 'player-playing', 'player-scoring',
    'host-quick-start', 'host-game-setup', 'host-running-engagements', 'host-late-items',
    'host-player-management', 'host-reporting', 'host-build-room', 'host-plan',
    'admin-getting-started', 'admin-question-sets', 'admin-ai-prompts', 'admin-ai-builders',
    'admin-game-management', 'admin-settings', 'builder-manual', 'builder-ai',
    'technical-troubleshooting', 'technical-requirements',
  ];

  test.each(BEFORE_SPLIT)('%s still opens a guide', (id) => {
    expect(resolveHelpTarget(id).kind).toBe('guide');
  });

  test('every alias resolves to a guide', () => {
    Object.keys(HELP_ALIASES).forEach((alias) => {
      expect(resolveHelpTarget(alias).kind).toBe('guide');
    });
  });

  test('every guide in an area file reaches a role, and every guide knows its area', () => {
    const inAreas = HELP_AREAS.flatMap((a) => Object.values(a.guides).flat().map((g) => g.id));
    expect(inAreas.filter((id) => !GUIDE_BY_ID[id])).toEqual([]);
    expect(Object.keys(GUIDE_BY_ID).filter((id) => !AREA_ID_BY_GUIDE_ID[id])).toEqual([]);
  });

  test('area ids are unique', () => {
    const ids = HELP_AREAS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('HELP_FOR_SCREEN', () => {
  test.each(Object.entries(HELP_FOR_SCREEN))('%s opens a real guide section', (screen, entry) => {
    expect(KEBAB.test(screen)).toBe(true);
    const target = resolveHelpTarget(entry.guide, entry.section);
    // rejects: an entry naming a guide or section that no longer exists,
    // which would silently open help's home or the top of a guide.
    expect(target).toEqual({ kind: 'guide', id: entry.guide, section: entry.section });
  });

  test('helpFor returns the HelpButton props, and {} for an unknown screen', () => {
    expect(helpFor('admin-prompts')).toEqual(HELP_FOR_SCREEN['admin-prompts']);
    expect(helpFor('no-such-screen')).toEqual({});
  });

  test('every provisional screen is in the map', () => {
    expect(PROVISIONAL_SCREENS.filter((s) => !HELP_FOR_SCREEN[s])).toEqual([]);
  });

  test('the screens the inventories list as lacking help all have an entry', () => {
    [
      'host-start', 'host-create', 'host-quick-start', 'host-stage', 'host-dock',
      'host-session-players', 'host-session-questions', 'host-session-rounds', 'host-session-settings',
      'host-console', 'host-remote', 'event-builder', 'event-agenda', 'event-stage',
      'ai-builders', 'ai-draft-review',
      'build-host', 'build-stage', 'build-build', 'build-history', 'build-session-panel',
      'build-console', 'build-connect',
      'player-join', 'player-answering', 'player-voting', 'player-results', 'player-end',
      'player-survey', 'player-event',
    ].forEach((screen) => expect(HELP_FOR_SCREEN[screen]).toBeDefined());
  });
});
