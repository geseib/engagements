/**
 * THE CORPUS, AS DATA — no rendering, because none is needed.
 *
 * The bug this file exists to make impossible: `HelpSystem.jsx` used to carry a
 * hand-written table of contents naming 18 guides, and a `switch` under it that
 * could render 2. Sixteen tiles led to "This documentation section is currently
 * under development." Nothing could catch that, because the contents and the
 * content were two unrelated literals and neither was reachable from a test
 * without mounting the modal and clicking every tile.
 *
 * Now that the guides are data, the invariants are assertable directly, and the
 * structural ones below (§1) are the ones that would have failed on the old
 * code the day it shipped.
 */
const {
  HELP_ROLES, ROLE_BY_ID, GUIDE_BY_ID, ROLE_ID_BY_GUIDE_ID,
  HELP_ALIASES, ISSUES_URL, resolveHelpTarget, searchHelp, guideText,
} = require('../config/help');
const { BLOCK_TYPES } = require('../components/documentation/DocRenderer');
const { TEMPLATE_VARIABLES } = require('../config/templateVariables');
const { GAME_TYPES, normalizeGameType } = require('../config/gameTypes');

const allGuides = () => HELP_ROLES.flatMap((role) => role.guides);
const allBlocks = () => allGuides().flatMap((g) => g.sections.flatMap((s) => s.blocks));

describe('§1 every advertised guide exists and has content', () => {
  test('there are five roles and each one has at least two guides', () => {
    expect(HELP_ROLES).toHaveLength(5);
    HELP_ROLES.forEach((role) => {
      expect(role.guides.length).toBeGreaterThanOrEqual(2);
    });
  });

  /*
    THE REGRESSION, STATED DIRECTLY. On the old code this number was 2 out of
    18 — and there was no way to ask the question, which is the actual defect.
  */
  test('every guide has a title, a summary and at least one section of blocks', () => {
    const empty = allGuides().filter(
      (g) => !g.id || !g.title || !g.summary || !g.sections?.length
        || g.sections.some((s) => !s.blocks?.length)
    );
    expect(empty.map((g) => g.id)).toEqual([]);
  });

  test('no guide is a stub — each carries real prose', () => {
    allGuides().forEach((guide) => {
      // Long enough that a placeholder ("content coming soon") cannot pass.
      expect(guideText(guide).length).toBeGreaterThan(600);
    });
  });

  test('guide ids are unique across roles', () => {
    const ids = allGuides().map((g) => g.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('every guide is reachable by id and knows its role', () => {
    allGuides().forEach((guide) => {
      expect(GUIDE_BY_ID[guide.id]).toBe(guide);
      expect(ROLE_BY_ID[ROLE_ID_BY_GUIDE_ID[guide.id]].guides).toContain(guide);
    });
  });

  test('no guide promises that documentation is coming later', () => {
    allGuides().forEach((guide) => {
      expect(guideText(guide)).not.toMatch(/under development|coming soon|being loaded/);
    });
  });
});

describe('§2 every block is one the renderer handles', () => {
  test('no block uses a type DocRenderer does not implement', () => {
    const used = new Set(allBlocks().map((b) => b.t));
    expect([...used].filter((t) => !BLOCK_TYPES.includes(t))).toEqual([]);
  });

  test('every block type the corpus uses is actually exercised somewhere', () => {
    // The other direction: a type in BLOCK_TYPES that nothing uses is dead
    // rendering code, and this is the assertion that finds it.
    const used = new Set(allBlocks().map((b) => b.t));
    expect(BLOCK_TYPES.filter((t) => !used.has(t))).toEqual([]);
  });
});

describe('§3 derived blocks track their source of truth', () => {
  /*
    THE DRIFT THAT ALREADY HAPPENED. The shipped host guide hand-wrote the
    phase flow and told hosts trivia runs a VOTE phase that is "automatic — no
    voting needed". `GAME_TYPES.trivia.phases` is ['ASK','RESULTS'] and always
    was, so there is no vote phase to automate. These two tests are why the
    guides cannot restate that again.
  */
  test('every phases block names a real game type', () => {
    allBlocks()
      .filter((b) => b.t === 'phases')
      .forEach((b) => {
        expect(GAME_TYPES[normalizeGameType(b.gameType)]).toBeDefined();
      });
  });

  test('every documented placeholder exists in the template catalogue', () => {
    const known = new Set(TEMPLATE_VARIABLES.map((v) => v.name));
    const documented = allBlocks()
      .filter((b) => b.t === 'variables')
      .flatMap((b) => b.names);
    expect(documented.length).toBeGreaterThan(0);
    expect(documented.filter((n) => !known.has(n))).toEqual([]);
  });

  /*
    The three names the OLD guide taught that do not exist. Its worked example
    used all three, so anyone who copied it wrote a prompt that substitutes to
    literal braces in front of a room. Named here so they cannot come back.
  */
  test.each(['totalScores', 'totalPlayers', 'gameContext'])(
    'the corpus does not teach the non-existent placeholder {%s}',
    (name) => {
      const known = new Set(TEMPLATE_VARIABLES.map((v) => v.name));
      expect(known.has(name)).toBe(false);
      allGuides().forEach((guide) => {
        expect(guideText(guide)).not.toContain(`{${name}}`);
      });
    }
  );
});

describe('§4 routing', () => {
  test('every alias resolves to something real', () => {
    Object.entries(HELP_ALIASES).forEach(([, target]) => {
      expect(GUIDE_BY_ID[target] || ROLE_BY_ID[target]).toBeDefined();
    });
  });

  /*
    THE TWO IDS ADMINPAGE ACTUALLY PASSES. Both were broken from the day they
    were added: neither matched a role key nor a switch case, so the help button
    beside the prompt library opened the "under development" box while the
    AI-prompts guide sat written and shipped two files away.
  */
  test('section="ai-prompts" reaches the prompts guide', () => {
    expect(resolveHelpTarget('ai-prompts')).toEqual({ kind: 'guide', id: 'admin-ai-prompts' });
  });

  test('section="websocket-settings" reaches the settings guide', () => {
    expect(resolveHelpTarget('websocket-settings')).toEqual({ kind: 'guide', id: 'admin-settings' });
  });

  test('a role id resolves to that role', () => {
    expect(resolveHelpTarget('player')).toEqual({ kind: 'role', id: 'player' });
    expect(resolveHelpTarget('host')).toEqual({ kind: 'role', id: 'host' });
  });

  test('an unknown id goes home rather than to an apology', () => {
    expect(resolveHelpTarget('nonsense')).toEqual({ kind: 'home', id: 'home' });
    expect(resolveHelpTarget(undefined)).toEqual({ kind: 'home', id: 'home' });
    expect(resolveHelpTarget('')).toEqual({ kind: 'home', id: 'home' });
  });

  test('the Report Issue link is not the shipped placeholder', () => {
    expect(ISSUES_URL).not.toContain('your-repo');
    expect(ISSUES_URL).toBe('https://github.com/geseib/engagements/issues');
  });
});

describe('§5 search, which used to discard every query', () => {
  test('an empty query returns nothing rather than everything', () => {
    expect(searchHelp('')).toEqual([]);
    expect(searchHelp('   ')).toEqual([]);
  });

  test('a word only in the body of one guide still finds it', () => {
    const hits = searchHelp('handover').map((h) => h.guide.id);
    expect(hits).toContain('host-player-management');
    expect(hits).toContain('player-joining');
  });

  /*
    "players" is in exactly one guide TITLE ("Managing players") and in the body
    of most of the others, which is the shape this ordering rule exists for: the
    person typing it wants the guide about players, not the eight guides that
    mention them in passing.
  */
  test('a title match sorts above a body-only match', () => {
    const hits = searchHelp('players');
    expect(hits.length).toBeGreaterThan(1);
    expect(hits[0].guide.id).toBe('host-player-management');
  });

  test('a query nothing matches returns an empty list, not a throw', () => {
    expect(searchHelp('zzzzzznothing')).toEqual([]);
  });

  test('search is case-insensitive', () => {
    expect(searchHelp('QR').length).toBeGreaterThan(0);
    expect(searchHelp('qr').length).toEqual(searchHelp('QR').length);
  });
});

describe('§6 the features that shipped today are documented', () => {
  const corpus = () => allGuides().map((g) => guideText(g)).join(' ');

  test.each([
    ['the one-shot name handover', /ask the host to hand it over/],
    ['the host side of the handover', /let them take it/],
    ['unlocking a name unprompted', /unlock name/],
    ['that the unlock is spent once', /one handover/],
    ['removing a player who left', /remove/],
    ['that removal keeps their contribution', /answers stay|stays in the report|every point they scored/],
    ['quickstart on the set list', /quickstart/],
    ['copy to archive', /copy to archive/],
    ['retire as a separate action', /retire/],
    ['the phone remote', /controls on your phone/],
    ['the withheld reveal', /reveal/],
    ['digit shortcuts in the round review', /1 – 9|press the number/],
    ['the arrows for the tenth response onward', /there is no 10 key/],
    ['the session report on the Rounds tab', /session report/],
    ['pictures on a question', /picture/],
  ])('%s', (_label, pattern) => {
    expect(corpus()).toMatch(pattern);
  });
});
