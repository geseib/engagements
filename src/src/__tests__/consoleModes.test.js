/**
 * THE FOUR AUDIENCES, AND THE MODE SWITCH BETWEEN TWO OF THEM.
 *
 * Reported from dev, all four in one sitting:
 *
 *   1. "when i first went there i saw the question sets, prompts plus the org
 *      account plan etc. but when i left and came back its missing most of the
 *      menu items"
 *   2. "i do need a super admin role that sees the overall system, can approve
 *      orgs, moderate etc. i think that is missing"
 *   3. "we likely need a way to distinguish when engage admins have taken the
 *      role as engage admin vs org admin"
 *
 * (1) had two independent causes and this file pins both. The first is a plain
 * field-name mismatch — `GET /orgs` returns `yourRole` and AdminPage read
 * `role` — which silently demoted every team owner to a member, and a member's
 * nav is missing exactly "most of the menu items". The second is that an Engage
 * admin's home is a PERSONAL org, and personal deliberately had no Prompts, so
 * the section vanished for the one person most likely to need it.
 *
 * (3) is the design answer to both: platform and org are MODES, chosen
 * explicitly in the switcher, not two nav groups stacked on one screen.
 */
import {
  sectionsFor, sectionIdsFor, defaultSectionIdFor, PLATFORM_MODE,
} from '../config/consoleSections';

const ids = (nav) => nav.flatMap((g) => g.items.map((s) => s.id));

describe('an Engage admin standing in their own space', () => {
  const staffAtHome = { groups: ['admins', 'hosts'], orgRole: 'owner', orgType: 'personal' };

  // rejects: the additive platform group — Organisations/Moderation/Accounts
  // rendered BESIDE a personal space's own sections. That is the mixing the
  // owner asked to end: standing inside an organisation and holding the
  // platform tools at the same time makes it impossible to tell which hat is on.
  it('does not see platform sections while an organisation is active', () => {
    const got = ids(sectionsFor(staffAtHome));
    expect(got).not.toContain('orgs');
    expect(got).not.toContain('moderation');
  });

  // rejects: personal orgs having no Prompts. Reported directly — prompts were
  // there and then were not. Every org reads the platform prompt library, so
  // the section is meaningful in a personal space too.
  it('keeps Prompts, which a personal space used to lose', () => {
    expect(ids(sectionsFor(staffAtHome))).toContain('prompts');
  });
});

describe('the platform mode', () => {
  const staffOnPlatform = { groups: ['admins'], mode: PLATFORM_MODE };

  // rejects: platform mode being unreachable. It was selected by the ABSENCE of
  // an active org, and then every account was given a personal org
  // automatically — so the platform console could not be reached at all, which
  // is why it was bolted on additively in the first place.
  it('is reachable by an explicit choice, not by having no organisation', () => {
    expect(ids(sectionsFor(staffOnPlatform)))
      .toEqual(['orgs', 'moderation', 'users', 'archive']);
  });

  // rejects: a platform console that also lists content sections. There is no
  // "view their sets" link because after the split there is nothing to link to.
  it('carries no content section at all', () => {
    const got = ids(sectionsFor(staffOnPlatform));
    expect(got).not.toContain('questionsets');
    expect(got).not.toContain('games');
  });

  // rejects: a host talking their way into the platform console by asking for
  // the mode. The mode is a VIEW; the group is the permission.
  it('is empty for somebody who is not Engage staff', () => {
    expect(sectionsFor({ groups: ['hosts'], mode: PLATFORM_MODE })).toEqual([]);
  });

  // rejects: landing a platform operator on Settings because the default
  // section was computed from a nav this mode does not have.
  it('lands on Organisations', () => {
    expect(defaultSectionIdFor(staffOnPlatform)).toBe('orgs');
  });
});

describe('a team owner', () => {
  const owner = { groups: ['hosts'], orgRole: 'owner', orgType: 'team', orgName: 'Northwind' };
  const member = { groups: ['hosts'], orgRole: 'member', orgType: 'team', orgName: 'Northwind' };

  // rejects: THE FIELD-NAME BUG'S EFFECT. `GET /orgs` answers with `yourRole`
  // and AdminPage read `role`, so orgRole arrived undefined and every owner
  // fell through to the member branch — losing Plan & usage and Data & privacy
  // while still being the person who pays the bill.
  it('sees the money and the access log; a member does not', () => {
    expect(ids(sectionsFor(owner))).toEqual(
      expect.arrayContaining(['billing', 'privacy', 'members']),
    );
    const asMember = ids(sectionsFor(member));
    expect(asMember).toContain('members');
    expect(asMember).not.toContain('billing');
    expect(asMember).not.toContain('privacy');
  });
});

describe('sectionIdsFor', () => {
  // rejects: a deep link to a section this account cannot address resolving to
  // a blank work area instead of falling back.
  it('never offers a platform id to an org-mode caller', () => {
    const got = sectionIdsFor({ groups: ['admins'], orgRole: 'owner', orgType: 'team' });
    expect(got).not.toContain('orgs');
    expect(got).toContain('settings');
  });
});
