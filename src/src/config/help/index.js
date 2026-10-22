import { AREA as player } from './player';
import { AREA as playerSurveys } from './player-surveys';
import { AREA as playerEvents } from './player-events';
import { AREA as buildRoomParticipant } from './build-room-participant';
import { AREA as hostSetup } from './host-setup';
import { AREA as hostRunning } from './host-running';
import { AREA as hostTwoScreens } from './host-two-screens';
import { AREA as hostSurveys } from './host-surveys';
import { AREA as hostEvents } from './host-events';
import { AREA as hostReports } from './host-reports';
import { AREA as buildRoom } from './build-room';
import { AREA as buildRoomClaude } from './build-room-claude';
import { AREA as hostPlan } from './host-plan';
import { AREA as adminConsole } from './admin-console';
import { AREA as adminTeam } from './admin-team';
import { AREA as adminStaff } from './admin-staff';
import { AREA as ai } from './ai';
import { AREA as builder } from './builder';
import { AREA as technical } from './technical';
import { AREA as glossary } from './glossary';

/**
 * THE WHOLE HELP CORPUS, AND THE ONLY LIST OF IT.
 *
 * What this replaces: `HelpSystem.jsx` carried a hand-written table of contents
 * naming 18 guides across 5 roles, and a `switch` below it that could render
 * two of them. Nothing tied the two together, so the contents advertised
 * sixteen guides that opened onto "Content for X is being loaded… This
 * documentation section is currently under development."
 *
 * The contents are now DERIVED from this file. A role's card counts
 * `role.guides.length`; a guide tile links to `guide.id`; the renderer looks up
 * the same id. There is no second list to fall out of step with the first, so
 * the failure that produced sixteen apologetic placeholders cannot recur: a
 * guide is advertised because it is here, and it is renderable because it is
 * here.
 *
 * ONE FILE PER AREA (help refresh Phase 0, 22 Oct 2026). The guides live in
 * area files (`./host-setup.js`, `./ai.js`, …) so the writers of different
 * areas never edit the same file. Each area exports `AREA = { id, guides }`,
 * where `guides` is keyed by ROLE: an area can feed more than one role (`ai`
 * feeds admin and builder). The roles below say which areas they read, in
 * order, and a role's guides are those areas' guides for it, concatenated.
 * The full map is docs/help-refresh/STRUCTURE.md.
 *
 * Ordered players-first. The old home screen listed Admin, Host, Player,
 * Builder, Technical — the org chart, not the room. Most people who ever open
 * this are holding a phone and trying to answer a question.
 */
const ROLE_DEFS = [
  {
    id: 'player',
    title: 'For players',
    icon: 'UsersThree',
    blurb: 'You scanned a code and you are in the room. Start here.',
    areas: [player, playerSurveys, playerEvents, buildRoomParticipant],
  },
  {
    id: 'host',
    title: 'For hosts',
    icon: 'GameController',
    blurb: 'Running a session in front of a room.',
    areas: [
      hostSetup, hostRunning, hostTwoScreens, hostSurveys, hostEvents,
      hostReports, buildRoom, buildRoomClaude, hostPlan,
    ],
  },
  {
    id: 'admin',
    title: 'For admins',
    icon: 'Gear',
    blurb: 'The console: question sets, members, plans, prompts and the shared archive.',
    areas: [adminConsole, ai, adminTeam, adminStaff],
  },
  {
    id: 'builder',
    title: 'For builders',
    icon: 'Buildings',
    blurb: 'Writing the questions, by hand or with the AI.',
    areas: [builder, ai],
  },
  {
    /* The glossary ("Words we use") is one guide, here, last. A guide may
       belong to one role only (guide ids are unique across roles), so instead
       of a copy under every role the home screen and the modal footer link to
       it directly. */
    id: 'technical',
    title: 'Technical',
    icon: 'Wrench',
    blurb: 'When something is not working.',
    areas: [technical, glossary],
  },
];

/** Every area, in the order the roles read them (each once). */
export const HELP_AREAS = [...new Set(ROLE_DEFS.flatMap((role) => role.areas))];

export const HELP_ROLES = ROLE_DEFS.map(({ areas, ...role }) => ({
  ...role,
  guides: areas.flatMap((area) => (area.guides && area.guides[role.id]) || []),
}));

export const ROLE_BY_ID = Object.fromEntries(HELP_ROLES.map((role) => [role.id, role]));

export const GUIDE_BY_ID = Object.fromEntries(
  HELP_ROLES.flatMap((role) => role.guides.map((guide) => [guide.id, guide]))
);

/** Which role owns a guide — for the breadcrumb, and for search result labels. */
export const ROLE_ID_BY_GUIDE_ID = Object.fromEntries(
  HELP_ROLES.flatMap((role) => role.guides.map((guide) => [guide.id, role.id]))
);

/** Which area file a guide lives in — for the drift report and STRUCTURE.md. */
export const AREA_ID_BY_GUIDE_ID = Object.fromEntries(
  HELP_AREAS.flatMap((area) => Object.values(area.guides || {}).flat().map((g) => [g.id, area.id]))
);

/**
 * WHAT CALL SITES ACTUALLY PASS, mapped to what exists.
 *
 * `AdminPage` mounts three help buttons and two of them were broken from the
 * day they were added: `section="ai-prompts"` and `section="websocket-settings"`
 * matched no role key and no `switch` case, so the button beside the prompt
 * library — the one place a reader is most obviously asking a specific question
 * — opened the "under development" placeholder even though the AI-prompts guide
 * had been written and shipped.
 *
 * Aliases rather than renaming the call sites, because these ids are also in
 * URLs and in muscle memory. The rule the test enforces is only that every
 * alias resolves to something real. When a guide is split or renamed, its old
 * id goes here so no link breaks.
 */
export const HELP_ALIASES = {
  'ai-prompts': 'admin-ai-prompts',
  'question-sets': 'admin-question-sets',
  'websocket-settings': 'admin-settings',
  'quick-start': 'host-quick-start',
  billing: 'host-plan',
  players: 'host-player-management',
  troubleshooting: 'technical-troubleshooting',
  // Phase 0: the two-screen and phone-remote sections left host-running-engagements.
  'two-screens': 'host-two-screens',
  'phone-remote': 'host-two-screens',
  words: 'glossary',
};

/**
 * SECTIONS THAT MOVED BETWEEN GUIDES, old `guide#section` → new. A section
 * keeps its id when it moves; the guide part is what changes, and an address
 * written against the old guide still lands on the words.
 */
export const HELP_SECTION_MOVES = {
  'host-running-engagements#laptop-console': 'host-two-screens#laptop-console',
  'host-running-engagements#phone-remote': 'host-two-screens#phone-remote',
  // Phase 2 (W7): the one Build Room guide became six. host-build-room keeps
  // its id (the setup guide); its connecting and during-and-after sections left.
  'host-build-room#connecting-claude': 'build-room-claude#connecting-claude',
  'host-build-room#during-after': 'build-room-running#the-host-screen',
};

/** The section of a guide with that id, or null. */
export function findSection(guideId, sectionId) {
  const guide = GUIDE_BY_ID[guideId];
  if (!guide || !sectionId) return null;
  return guide.sections.find((s) => s.id === sectionId) || null;
}

/**
 * Where a `section` prop should land: a guide, a role index, or home — and,
 * for a guide, optionally one of its sections.
 *
 * Takes `id` as a role id, a guide id, an alias, or `guide#section`; a second
 * argument is a section id within the guide. The result carries `section` only
 * when that section really exists, so a stale section id lands at the top of
 * the right guide rather than nowhere.
 *
 * Never returns null. An id nobody recognises goes home rather than to a dead
 * screen — the old default branch rendered a box apologising for content that
 * was never coming, which reads as a broken product rather than a wrong link.
 */
export function resolveHelpTarget(id, sectionId) {
  if (!id) return { kind: 'home', id: 'home' };
  let key = String(id);
  let section = sectionId ? String(sectionId) : '';
  const hash = key.indexOf('#');
  if (hash >= 0) {
    if (!section) section = key.slice(hash + 1);
    key = key.slice(0, hash);
  }
  if (key === 'home' || !key) return { kind: 'home', id: 'home' };
  if (ROLE_BY_ID[key]) return { kind: 'role', id: key };

  let guideId = null;
  if (GUIDE_BY_ID[key]) guideId = key;
  else if (HELP_ALIASES[key] && GUIDE_BY_ID[HELP_ALIASES[key]]) guideId = HELP_ALIASES[key];
  else if (HELP_ALIASES[key] && ROLE_BY_ID[HELP_ALIASES[key]]) return { kind: 'role', id: HELP_ALIASES[key] };

  if (section) {
    const moved = HELP_SECTION_MOVES[`${guideId || key}#${section}`];
    if (moved) {
      const [g, s] = moved.split('#');
      if (findSection(g, s)) return { kind: 'guide', id: g, section: s };
    }
  }
  if (!guideId) return { kind: 'home', id: 'home' };
  if (section && findSection(guideId, section)) return { kind: 'guide', id: guideId, section };
  return { kind: 'guide', id: guideId };
}

/** The DOM id a rendered section carries. Prefixed: section ids are short words. */
export function sectionDomId(guideId, sectionId) {
  return `help-${guideId}--${sectionId}`;
}

/**
 * Every word in a guide, flattened once, for search.
 *
 * The block shapes are heterogeneous by design (a step can be a string or a
 * `{title, text}` pair), so this walks values rather than assuming a shape:
 * anything string-valued in the tree is text somebody could search for. Missing
 * a field here costs a search hit, not a crash, and adding a block type does
 * not require remembering to update this.
 */
export function guideText(guide) {
  const out = [];
  const walk = (value) => {
    if (typeof value === 'string') { out.push(value); return; }
    if (Array.isArray(value)) { value.forEach(walk); return; }
    if (value && typeof value === 'object') { Object.values(value).forEach(walk); }
  };
  walk(guide);
  return out.join(' ').toLowerCase();
}

/**
 * SEARCH, which used to be a text input wired to nothing.
 *
 * `HelpSystem` rendered the field, stored what you typed in `searchTerm`, and
 * never read the variable again — so the box silently discarded every query.
 * Searching prose locked inside JSX would have meant walking a React tree;
 * searching a corpus is a filter, which is the second reason the guides are
 * data.
 *
 * Substring rather than fuzzy: the corpus is twenty guides, the queries are
 * words like "qr", "handover", "reveal", and a fuzzy matcher on a set this
 * small returns everything. Title matches sort first because someone typing
 * "scoring" wants the scoring guide, not the eight guides that mention points.
 */
export function searchHelp(term) {
  const q = String(term || '').trim().toLowerCase();
  if (!q) return [];
  return HELP_ROLES
    .flatMap((role) => role.guides.map((guide) => ({ role, guide })))
    .map(({ role, guide }) => {
      const inTitle = guide.title.toLowerCase().includes(q)
        || guide.summary.toLowerCase().includes(q);
      const inBody = guideText(guide).includes(q);
      return { role, guide, inTitle, matched: inTitle || inBody };
    })
    .filter((hit) => hit.matched)
    .sort((a, b) => (b.inTitle ? 1 : 0) - (a.inTitle ? 1 : 0));
}

/** Where "Report Issue" goes. The shipped link was `your-repo/engage2`. */
export const ISSUES_URL = 'https://github.com/geseib/engagements/issues';
