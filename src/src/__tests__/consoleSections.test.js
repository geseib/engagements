/**
 * THE COMPUTED NAV — config/consoleSections.js
 *
 * A pure module, so this is a pure test: no DOM, no mounting, no geometry.
 * What it pins is the isolation story — that four different people get four
 * different consoles, and specifically that a platform operator's console has
 * no way into a customer's content at all.
 */
import sectionsFor, {
  sectionsFor as named,
  allSections,
  sectionIdsFor,
  defaultSectionIdFor,
  sectionById,
  FOOT_SECTIONS,
  PLATFORM_GROUP,
  PLATFORM_MODE,
} from '../config/consoleSections';

const ids = (input) => sectionsFor(input).flatMap((g) => g.items.map((s) => s.id));
const labels = (input) => sectionsFor(input).map((g) => g.label);

const TEAM_ADMIN = { groups: ['hosts'], orgRole: 'admin', orgType: 'team', orgName: 'Northwind Learning' };
const TEAM_MEMBER = { ...TEAM_ADMIN, orgRole: 'member' };
const PERSONAL = { groups: ['hosts'], orgRole: 'owner', orgType: 'personal', orgName: 'Amara Reyes' };
// PLATFORM IS NOW A MODE THAT IS ASKED FOR, not the absence of an org. This
// fixture used to be "staff with no active organisation", which stopped being
// reachable the moment every account got a personal org automatically.
const PLATFORM = { groups: [PLATFORM_GROUP], mode: PLATFORM_MODE };
const NO_ORG = { groups: ['hosts'], orgRole: '', orgType: '' };

test('the default export is the same function as the named one', () => {
  expect(sectionsFor).toBe(named);
});

describe('platform staff (mockups 10 and 11)', () => {
  // rejects: leaving ANY content section in the platform nav — the whole isolation story
  test('get no content section at all', () => {
    expect(ids(PLATFORM)).toEqual(['orgs', 'moderation', 'users', 'archive']);
    expect(ids(PLATFORM)).not.toContain('questionsets');
    expect(ids(PLATFORM)).not.toContain('games');
    expect(ids(PLATFORM)).not.toContain('prompts');
    expect(ids(PLATFORM)).not.toContain('library');
  });

  /*
    THIS TEST USED TO ASSERT THE OPPOSITE, and the rule it pinned made the
    platform console unreachable.

    It read: "an Engage operator INSIDE an organisation sees that organisation,
    NOT the platform" — selecting the platform nav by the ABSENCE of an active
    org. A good instinct (staff standing in a customer's org should not be
    looking at platform tools) with a fatal consequence: every approved account
    is now given a personal organisation automatically, so an Engage admin
    ALWAYS has an active org, and Organisations / Moderation / Accounts /
    Archive became permanently unreachable the moment provisioning ran.

    The platform group is therefore ADDITIVE — staff see their own space and
    the platform tools, kept apart by the headings, which is what the headings
    are for.

    It widens no access. `tenant.readableScopes` gives a platform admin no extra
    scope and `canManageScope` refuses them another org's content; reading a
    customer's data still takes a written reason and an expiring grant. This
    decides which LINKS appear, never what may be opened — which is why the
    next test still insists the platform GROUP carries no content section.

    rejects: making the platform group exclusive again, which hides the platform
    console from every member of staff.
  */
  // rejects: THE ADDITIVE CONSOLE, which this test used to REQUIRE.
  //
  // It read "an Engage operator inside an organisation reaches BOTH" and
  // asserted that Organisations and Moderation rendered beside that operator's
  // own question sets. That was a deliberate fix for a real problem — platform
  // mode had become unreachable — and it traded one defect for a worse one:
  // there was then nothing on the screen saying which hat the operator had on.
  // The owner asked for the distinction explicitly. The switcher now carries
  // the mode, and the two consoles never appear together.
  test('an Engage operator inside an organisation sees ONLY that organisation', () => {
    const inside = { ...TEAM_ADMIN, groups: [PLATFORM_GROUP] };
    expect(ids(inside)).toContain('questionsets');
    expect(ids(inside)).not.toContain('orgs');
    expect(ids(inside)).not.toContain('moderation');
    expect(labels(inside)).not.toContain('Engage');
  });

  test('an ordinary host never reaches the platform console, even asking for it', () => {
    expect(ids(TEAM_ADMIN)).not.toContain('orgs');
    expect(ids(TEAM_ADMIN)).not.toContain('moderation');
    expect(ids(TEAM_ADMIN)).not.toContain('users');
    // Asking for the mode is not the same as being allowed it. The mode is a
    // view; `admins` is the permission, and every platform route re-checks it.
    expect(sectionsFor({ ...TEAM_ADMIN, mode: PLATFORM_MODE })).toEqual([]);
  });

  // rejects: relabelling the platform group heading back to an org name
  test('the group is headed Engage, not an organisation name', () => {
    expect(labels(PLATFORM)).toEqual(['Engage']);
  });
});

describe('an account with no organisation (mockup 09)', () => {
  // rejects: drawing a populated nav beside "one more thing before you can build anything"
  test('has no sections, because every section is a place inside an org', () => {
    expect(sectionsFor(NO_ORG)).toEqual([]);
    expect(sectionsFor()).toEqual([]);
  });

  // rejects: losing Settings, which is browser-local and not inside any org
  test('still has Settings in the foot', () => {
    expect(allSections(NO_ORG).map((s) => s.id)).toEqual(['settings']);
    expect(defaultSectionIdFor(NO_ORG)).toBe('settings');
  });
});

describe('a personal space (mockup 12)', () => {
  // rejects: a Members section in a space with nobody to manage
  test('has no Members section', () => {
    expect(ids(PERSONAL)).not.toContain('members');
  });

  // rejects: the nav drifting from the three places mockup 12 draws
  // Prompts joined this group after it was reported missing from dev: an
  // Engage admin's home is always personal, so excluding it there removed the
  // section from the person most likely to be editing prompts.
  test('is Your space then Account, exactly as drawn', () => {
    expect(labels(PERSONAL)).toEqual(['Your space', 'Account']);
    expect(ids(PERSONAL)).toEqual(['questionsets', 'games', 'library', 'prompts', 'billing', 'privacy']);
  });

  // rejects: heading the personal group with the person's own name
  test('the first group is headed Your space, not the org name', () => {
    expect(labels(PERSONAL)[0]).toBe('Your space');
  });
});

describe('a team', () => {
  // rejects: the org name vanishing from the first group heading (mockup 01)
  test('the first group is headed with the organisation name', () => {
    expect(labels(TEAM_ADMIN)).toEqual(['Northwind Learning', 'Team']);
    expect(labels({ ...TEAM_ADMIN, orgName: '' })[0]).toBe('Your organisation');
  });

  // rejects: showing a member the invoice and the export they cannot act on
  test('a member sees Members and neither Plan & usage nor Data & privacy', () => {
    expect(ids(TEAM_MEMBER)).toEqual(['questionsets', 'games', 'library', 'prompts', 'members']);
  });

  // rejects: an owner losing billing because only 'admin' was checked
  test('owner and admin both get the full Team group', () => {
    const full = ['questionsets', 'games', 'library', 'prompts', 'members', 'billing', 'privacy'];
    expect(ids(TEAM_ADMIN)).toEqual(full);
    expect(ids({ ...TEAM_ADMIN, orgRole: 'owner' })).toEqual(full);
    expect(ids({ ...TEAM_ADMIN, orgRole: 'OWNER' })).toEqual(full);
  });
});

describe('the ids the rest of the console has to agree with', () => {
  // rejects: renaming an id AdminPage already renders and adminSection already puts in a URL
  test('the sections that exist today keep the ids they have', () => {
    const all = new Set(sectionIdsFor(TEAM_ADMIN).concat(sectionIdsFor(PLATFORM)));
    for (const id of ['questionsets', 'games', 'prompts', 'users', 'archive', 'settings']) {
      expect(all.has(id)).toBe(true);
    }
  });

  // rejects: two sections claiming one id, which makes the URL ambiguous
  test('no id appears twice in one person’s console', () => {
    for (const input of [TEAM_ADMIN, TEAM_MEMBER, PERSONAL, PLATFORM, NO_ORG]) {
      const list = sectionIdsFor(input);
      expect(new Set(list).size).toBe(list.length);
    }
  });

  // rejects: a section with no title/subtitle, which AdminShell renders as a blank head
  test('every section carries what AdminShell needs to draw its head', () => {
    for (const input of [TEAM_ADMIN, TEAM_MEMBER, PERSONAL, PLATFORM]) {
      for (const section of allSections(input)) {
        expect(typeof section.id).toBe('string');
        expect(section.label).toBeTruthy();
        expect(section.title).toBeTruthy();
        expect(section.subtitle).toBeTruthy();
        expect(section.icon).toBeTruthy();
      }
    }
  });

  // rejects: a bookmark for a section this account lost rendering a blank work area
  test('sectionById answers only for sections this person actually has', () => {
    expect(sectionById(TEAM_ADMIN, 'billing').label).toBe('Plan & usage');
    expect(sectionById(TEAM_MEMBER, 'billing')).toBeUndefined();
    expect(sectionById(PERSONAL, 'members')).toBeUndefined();
    expect(sectionById(PLATFORM, 'questionsets')).toBeUndefined();
  });

  // rejects: landing a personal account on a section that is not its first place
  test('the default section is the first place in the first group', () => {
    expect(defaultSectionIdFor(TEAM_ADMIN)).toBe('questionsets');
    expect(defaultSectionIdFor(PLATFORM)).toBe('orgs');
  });

  // rejects: Settings quietly disappearing from the foot for one of the four states
  test('Settings is in the foot for every state', () => {
    expect(FOOT_SECTIONS.map((s) => s.id)).toEqual(['settings']);
    for (const input of [TEAM_ADMIN, TEAM_MEMBER, PERSONAL, PLATFORM, NO_ORG]) {
      expect(sectionIdsFor(input)).toContain('settings');
    }
  });
});

describe('it is pure', () => {
  // rejects: reaching for React, fetch or storage from a module the tests mount nothing for
  test('the module imports nothing and touches no browser global', () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(path.join(__dirname, '..', 'config', 'consoleSections.js'), 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/\bimport\s/);
    expect(code).not.toMatch(/\brequire\(/);
    expect(code).not.toMatch(/\b(window|document|localStorage|fetch)\b/);
  });

  // rejects: handing back the module's own arrays, which a caller could sort in place
  test('callers cannot mutate the next caller’s nav', () => {
    const first = sectionsFor(TEAM_ADMIN);
    first[0].items.pop();
    expect(ids(TEAM_ADMIN)).toContain('prompts');
  });
});
