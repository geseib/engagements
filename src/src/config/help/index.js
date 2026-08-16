import { PLAYER_ROLE } from './player';
import { HOST_ROLE } from './host';
import { ADMIN_ROLE } from './admin';
import { BUILDER_ROLE } from './builder';
import { TECHNICAL_ROLE } from './technical';

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
 * Ordered players-first. The old home screen listed Admin, Host, Player,
 * Builder, Technical — the org chart, not the room. Most people who ever open
 * this are holding a phone and trying to answer a question.
 */
export const HELP_ROLES = [PLAYER_ROLE, HOST_ROLE, ADMIN_ROLE, BUILDER_ROLE, TECHNICAL_ROLE];

export const ROLE_BY_ID = Object.fromEntries(HELP_ROLES.map((role) => [role.id, role]));

export const GUIDE_BY_ID = Object.fromEntries(
  HELP_ROLES.flatMap((role) => role.guides.map((guide) => [guide.id, guide]))
);

/** Which role owns a guide — for the breadcrumb, and for search result labels. */
export const ROLE_ID_BY_GUIDE_ID = Object.fromEntries(
  HELP_ROLES.flatMap((role) => role.guides.map((guide) => [guide.id, role.id]))
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
 * alias resolves to something real.
 */
export const HELP_ALIASES = {
  'ai-prompts': 'admin-ai-prompts',
  'question-sets': 'admin-question-sets',
  'websocket-settings': 'admin-settings',
  'quick-start': 'host-quick-start',
  players: 'host-player-management',
  troubleshooting: 'technical-troubleshooting',
};

/**
 * Where a `section` prop should land: a guide, a role index, or home.
 *
 * Never returns null. An id nobody recognises goes home rather than to a dead
 * screen — the old default branch rendered a box apologising for content that
 * was never coming, which reads as a broken product rather than a wrong link.
 */
export function resolveHelpTarget(id) {
  if (!id) return { kind: 'home', id: 'home' };
  const key = String(id);
  if (key === 'home') return { kind: 'home', id: 'home' };
  if (ROLE_BY_ID[key]) return { kind: 'role', id: key };
  if (GUIDE_BY_ID[key]) return { kind: 'guide', id: key };
  const aliased = HELP_ALIASES[key];
  if (aliased && GUIDE_BY_ID[aliased]) return { kind: 'guide', id: aliased };
  if (aliased && ROLE_BY_ID[aliased]) return { kind: 'role', id: aliased };
  return { kind: 'home', id: 'home' };
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
 * Substring rather than fuzzy: the corpus is nineteen guides, the queries are
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
