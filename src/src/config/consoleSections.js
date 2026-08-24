/**
 * WHICH SECTIONS OF THE CONSOLE THIS PERSON HAS, GIVEN WHICH ORGANISATION.
 *
 * A PURE MODULE. No React, no fetch, no localStorage — props in, an array out,
 * for the same reason `config/adminSection.js` is pure: `AdminPage.jsx` cannot
 * be mounted in jsdom at all (it dies on `useAuth must be used within an
 * AuthProvider`), so anything that cannot be tested standing on its own cannot
 * be tested here at all.
 *
 * THE NAV IS COMPUTED, AND THAT IS THE WHOLE POINT
 * (docs/design/tenancy-redesign/RATIONALE.md §3, mockups 10/11/12).
 *
 * An org admin and a platform admin are not the same person and must not see
 * the same console. Before tenancy, "admin" meant one thing and it meant
 * *everything*; after it there are four different consoles:
 *
 *   PLATFORM  — somebody who works on Engage. Organisations, Moderation,
 *               Accounts, Archive, and **no content section at all**. That
 *               absence is the isolation story in one screen: there is no
 *               "view their sets" button because after the split there is
 *               nothing to link to. Reading a customer's content takes a
 *               request with a written reason that expires and lands in that
 *               customer's own log.
 *   TEAM ADMIN — a team's owner or admin. Content, plus Members, Plan & usage
 *               and Data & privacy.
 *   TEAM MEMBER — the same content, and of the Team group only Members. Billing
 *               and the export/access log are powers, not information; a member
 *               who can see the invoice but not change it is being shown a
 *               control that refuses them.
 *   PERSONAL  — the auto-provisioned home. **No Members section**, because
 *               there is nobody to manage and a section that exists only to say
 *               "just you" is a section you stop looking at. No Prompts either:
 *               mockup 12's nav is the authority and it lists three places.
 *
 * AND A FIFTH STATE THAT IS NOT AN EDGE CASE: an approved account with no
 * organisation at all gets NO sections (mockup 09). Every section is a place
 * inside an org; the first cut of that mockup drew a fully populated nav beside
 * the words "one more thing before you can build anything", which is a
 * contradiction a reader spots immediately.
 *
 * ── PLATFORM IS A MODE, NOT A GROUP OF LINKS ──────────────────────────────
 *
 * This has now been wrong in both directions, so the reasoning is worth the
 * space.
 *
 * FIRST CUT: the platform console was selected by the ABSENCE of an active
 * organisation. Correct in spirit and unreachable in practice — every approved
 * account is given a personal organisation automatically, so staff always had
 * one and Organisations/Moderation/Accounts/Archive could not be opened at all.
 *
 * SECOND CUT: bolt the platform links on ADDITIVELY, beside the org's own. That
 * made them reachable and reintroduced exactly the mixing the split exists to
 * end — an Engage admin looked at Moderation and their own question sets on one
 * screen, with nothing on the page saying which hat they had on. The owner
 * named it: "we likely need a way to distinguish when engage admins have taken
 * the role as engage admin vs org admin."
 *
 * SO: an explicit MODE, chosen in the switcher, which is the one control that
 * already means "who am I right now". `mode: PLATFORM_MODE` gives the platform
 * console and nothing else; any other value gives the active organisation's
 * console and no platform links. The two never appear together.
 *
 * The mode is a VIEW and the Cognito group is the PERMISSION. Asking for
 * platform mode without being in `admins` returns no sections, because a nav is
 * not an access-control decision — every platform route checks the group
 * server-side and would refuse regardless.
 *
 * ── SECTION IDS ARE THE CONSOLE'S EXISTING ONES WHERE ONE EXISTS ───────────
 *
 * `questionsets`, `games`, `prompts`, `archive`, `users` and `settings` are the
 * ids `AdminPage.jsx` already renders and `config/adminSection.js` already puts
 * in the URL. Reusing them means a bookmarked `?section=users` keeps working
 * and the platform console's Accounts and Archive need no new screens at all.
 * The genuinely new ids — `library`, `members`, `billing`, `privacy`, `orgs`,
 * `moderation` — have no renderer yet; a section id with nothing behind it
 * shows an empty work area, so wire them as they land rather than all at once.
 */

/** Cognito group that means "works on Engage", not "runs an organisation". */
export const PLATFORM_GROUP = 'admins';

/**
 * The switcher's value for "I am acting as Engage, not as a member of any
 * organisation". Deliberately not a possible org id — `isOrgId` requires the
 * `org_` prefix — so a stored mode and a stored org id can never be confused,
 * and a stale value from either side falls back to org mode rather than
 * silently granting the platform console.
 */
export const PLATFORM_MODE = '~platform';

/* Icons are names from components/Icon.jsx's ICONS map. An unknown name falls
   back to Circle rather than crashing, which is why designSystem.test.jsx
   asserts every entry resolves — a silent Circle is still a defect. */

const SECTION = {
  questionsets: {
    id: 'questionsets',
    label: 'Question sets',
    icon: 'Books',
    title: 'Question sets',
    subtitle: 'The thing every session is built from.',
    contentTheme: 'dark',
  },
  games: {
    id: 'games',
    label: 'Sessions',
    icon: 'GameController',
    title: 'Sessions',
    subtitle: 'What hosts have run. Data here expires: 90 days from creation.',
    contentTheme: 'dark',
  },
  library: {
    id: 'library',
    label: 'Public library',
    icon: 'Broadcast',
    title: 'Public library',
    subtitle: 'Sets other organisations have published. Copying one makes it yours.',
    contentTheme: 'dark',
  },
  prompts: {
    id: 'prompts',
    label: 'Prompts',
    icon: 'Sparkle',
    title: 'Prompts',
    subtitle: 'Generation prompts build questions; analysis prompts are what Workie says afterwards.',
    contentTheme: 'dark',
  },
  members: {
    id: 'members',
    label: 'Members',
    icon: 'UsersThree',
    title: 'Members',
    subtitle: 'Who can build and run sessions here.',
    contentTheme: 'dark',
  },
  billing: {
    id: 'billing',
    label: 'Plan & usage',
    icon: 'ChartBar',
    title: 'Plan & usage',
    subtitle: 'What this month costs, and the arithmetic behind it.',
    contentTheme: 'dark',
  },
  privacy: {
    id: 'privacy',
    label: 'Data & privacy',
    icon: 'Lock',
    title: 'Data & privacy',
    subtitle: 'Who has opened what, and how to take everything with you.',
    contentTheme: 'dark',
  },
  orgs: {
    id: 'orgs',
    label: 'Organisations',
    icon: 'Buildings',
    title: 'Organisations',
    subtitle: 'Every organisation on this tier. Their content is not reachable from here.',
    contentTheme: 'dark',
  },
  moderation: {
    id: 'moderation',
    label: 'Moderation',
    icon: 'FlagCheckered',
    title: 'Moderation',
    subtitle: 'Sets waiting on a human. The check is tuned to be cautious, so some of these are fine.',
    contentTheme: 'dark',
  },
  accounts: {
    /* The existing Users screen, relabelled for the platform console: on 10/11
       it is "Accounts" because "Users" inside a tenanted console reads as the
       members of the org you are standing in, which is a different list. */
    id: 'users',
    label: 'Accounts',
    icon: 'UserCircle',
    title: 'Accounts',
    subtitle: 'Registration lands people in pending. Somebody has to move them.',
    contentTheme: 'dark',
  },
  archive: {
    id: 'archive',
    label: 'Archive',
    icon: 'Package',
    title: 'Archive',
    subtitle: 'A shared, public service. The same store backs all three environments.',
  },
  settings: {
    id: 'settings',
    label: 'Settings',
    icon: 'Gear',
    title: 'Settings',
    subtitle: 'Three switches, stored in this browser only.',
  },
};

/**
 * The foot of the nav. Settings is not a place inside an organisation — it is
 * three browser-local switches — so it survives every state above, including
 * the account that has no organisation yet.
 */
export const FOOT_SECTIONS = [SECTION.settings];

/** Roles that may see the money and the access log. */
const ADMIN_ROLES = ['owner', 'admin'];

const group = (id, label, items) => ({ id, label, items });

/**
 * The ordered nav groups for one person in one organisation.
 *
 * @param {object}   input
 * @param {string[]} input.groups   Cognito groups, e.g. ['admins'] | ['hosts']
 * @param {string}   input.orgRole  'owner' | 'admin' | 'member' — the caller's
 *                                  role IN THE ACTIVE ORG, from GET /orgs
 * @param {string}   input.orgType  'personal' | 'team', or falsy for no org
 * @param {string}  [input.orgName] The active org's name. It is the heading of
 *                                  the first group on a team (mockup 01), and
 *                                  is ignored for personal and platform, which
 *                                  say "Your space" and "Engage".
 * @returns {Array<{id:string,label:string,items:Array<object>}>}
 */
export function sectionsFor({
  groups = [], orgRole = '', orgType = '', orgName = '', mode = '',
} = {}) {
  const memberships = Array.isArray(groups) ? groups : [];
  const isStaff = memberships.includes(PLATFORM_GROUP);
  const type = String(orgType || '');
  const role = String(orgRole || '').toLowerCase();

  /*
    PLATFORM MODE IS EXCLUSIVE AND IT IS ASKED FOR. See the header for the two
    ways this was previously wrong. `isStaff` is checked here as well as on
    every platform route because a nav that lists a place the server will refuse
    is worse than no link at all — but the server is the authority, not this.
  */
  if (mode === PLATFORM_MODE) {
    if (!isStaff) return [];
    return [group('platform', 'Engage', [
      SECTION.orgs,
      SECTION.moderation,
      SECTION.accounts,
      SECTION.archive,
    ])];
  }

  if (!type) {
    /* No active organisation and not asking for platform — an approved account
       that has not joined one yet (mockup 09). No sections; every one of them
       is a place inside an org. */
    return [];
  }

  if (type === 'personal') {
    /*
      PROMPTS IS HERE ON PURPOSE, and it was not at first. A personal space was
      given three sections on the reasoning that it has no team to manage — but
      Prompts is not a team control, it is the library that shapes what the AI
      writes, and every org reads the platform prompts. Leaving it out meant an
      Engage admin, whose home is always personal, lost the section entirely the
      moment provisioning ran. That was reported from dev as prompts
      disappearing, and it was this line.
    */
    return [
      group('space', 'Your space', [
        SECTION.questionsets,
        SECTION.games,
        SECTION.library,
        SECTION.prompts,
      ]),
      group('account', 'Account', [
        SECTION.billing,
        SECTION.privacy,
      ]),
    ];
  }

  const content = group('org', orgName || 'Your organisation', [
    SECTION.questionsets,
    SECTION.games,
    SECTION.library,
    SECTION.prompts,
  ]);

  if (!ADMIN_ROLES.includes(role)) {
    /* A member sees who else is here and nothing that would refuse them. */
    return [content, group('team', 'Team', [SECTION.members])];
  }

  return [
    content,
    group('team', 'Team', [SECTION.members, SECTION.billing, SECTION.privacy]),
  ];
}

/** Every nav item in order, groups flattened, foot items last. */
export function allSections(input) {
  return [...sectionsFor(input).flatMap((g) => g.items), ...FOOT_SECTIONS];
}

/**
 * The section ids this person may address. Hand it to
 * `sectionFromSearch(search, ids, fallback)` so a bookmark naming a section
 * this account no longer has lands on the default rather than a blank work
 * area — the console's existing rule (config/adminSection.js), applied to a
 * list that is now different per person.
 */
export function sectionIdsFor(input) {
  return allSections(input).map((s) => s.id);
}

/** The section a person lands on. First item of the first group, or Settings. */
export function defaultSectionIdFor(input) {
  const nav = sectionsFor(input);
  return nav.length && nav[0].items.length ? nav[0].items[0].id : FOOT_SECTIONS[0].id;
}

/** One section by id, or undefined. */
export function sectionById(input, id) {
  return allSections(input).find((s) => s.id === id);
}

export default sectionsFor;
