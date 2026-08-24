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
 * ── HOW THE PLATFORM CONSOLE IS SELECTED ───────────────────────────────────
 *
 * By the ABSENCE of an active organisation, not by a group alone. `GET /orgs`
 * provisions a personal org on first call, so every ordinary signed-in person
 * has one; a platform operator asks for the platform console by leaving the
 * org switcher (the "Engage staff" chip on 10/11 is not an org and cannot be
 * switched to a section inside one). Selecting on `groups` alone would give
 * every Engage employee the platform nav *while they are standing inside a
 * customer's organisation*, which is exactly the mixing this set exists to end.
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
export function sectionsFor({ groups = [], orgRole = '', orgType = '', orgName = '' } = {}) {
  const memberships = Array.isArray(groups) ? groups : [];
  const type = String(orgType || '');
  const role = String(orgRole || '').toLowerCase();

  /*
    THE PLATFORM GROUP IS ADDITIVE, not an alternative. Read this before
    "simplifying" it.
    
    The first cut selected the platform console by the ABSENCE of an active
    organisation, on the reasoning that an Engage employee standing inside a
    customer's org should not be looking at platform tools. That is a good
    instinct and it produced a console nobody could reach: EVERY approved
    account is now given a personal organisation automatically
    (admin/orgs/shared/personal-org.js), so an Engage admin always has an
    active org, and Organisations / Moderation / Accounts / Archive became
    permanently unreachable the moment provisioning ran.
    
    So staff get their own space AND the platform group, kept apart by the
    headings — which is what the headings are for. It does NOT widen access to
    anything: `tenant.readableScopes` gives a platform admin no extra scope, and
    reading a customer's content still takes a logged, expiring grant. This
    decides which LINKS appear, never what may be opened.
  */
  const platformGroup = memberships.includes(PLATFORM_GROUP)
    ? [group('platform', 'Engage', [
      SECTION.orgs,
      SECTION.moderation,
      SECTION.accounts,
      SECTION.archive,
    ])]
    : [];

  if (!type) {
    /* No active organisation yet — either staff, or somebody who has not
       joined one, and then there are no places at all (mockup 09). */
    return platformGroup;
  }

  if (type === 'personal') {
    return [
      group('space', 'Your space', [
        SECTION.questionsets,
        SECTION.games,
        SECTION.library,
      ]),
      group('account', 'Account', [
        SECTION.billing,
        SECTION.privacy,
      ]),
      ...platformGroup,
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
    return [content, group('team', 'Team', [SECTION.members]), ...platformGroup];
  }

  return [
    content,
    group('team', 'Team', [SECTION.members, SECTION.billing, SECTION.privacy]),
    ...platformGroup,
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
