/**
 * THE AUDIT LOG IN PLAIN WORDS — what each recorded action is called on screen.
 *
 * Pure: an entry from GET /orgs/{orgId}/audit or GET /platform/audit in,
 * strings out. The server stores a dotted action (`org.suspend`) and the
 * people reading the log are a team's owner, or a person looking at their own
 * account — so every sentence here says what happened, to what, in the words
 * they would use. Kept apart from the component so it can be tested whole.
 *
 * The action list is the inventory in lambda-functions/admin/shared/audit-log.js
 * plus the deletions another work stream records through the same log. An
 * action this file does not know still reads as words, never as a code.
 */

const ACTIONS = {
  // Accounts (Engage staff, manage-users.js)
  'user.approve': 'Approved the account',
  'user.set-host': 'Made the account a host',
  'user.make-admin': 'Made the account an Engage admin',
  'user.remove-admin': 'Took Engage admin away from the account',
  'user.set-pending': 'Moved the account back to waiting for approval',
  'user.disable': 'Turned the account off',
  'user.enable': 'Turned the account back on',
  'user.delete': 'Deleted the account',
  // Organisations (platform-orgs.js)
  'org.approve': 'Approved the organisation',
  'org.suspend': 'Suspended the organisation',
  'org.reinstate': 'Lifted the suspension',
  'org.set-pending': 'Put the organisation back to waiting for approval',
  // Plans and billing (plan-requests.js, adjustments.js)
  'plan.approve': 'Approved a plan request',
  'plan.decline': 'Declined a plan request',
  'billing.grant': 'Added a billing adjustment',
  'billing.revoke': 'Withdrew a billing adjustment',
  'code.create': 'Created a discount code',
  'code.retire': 'Retired a discount code',
  // The public library (moderation-decide.js, public-library-item.js)
  'publish.approve': 'Approved a set for the public library',
  'publish.reject': 'Turned down a set for the public library',
  'publish.leave-serving': 'Kept a set in the public library after a re-check',
  'library.take-down': 'Took a set down from the public library',
  // Sessions and content
  'session.categories': 'Changed which categories a session asks',
  'session.delete': 'Deleted a session',
  'sessions.delete-all': 'Deleted every session',
  'event.delete': 'Deleted an event',
  'event-item.delete': 'Removed an item from an event',
  'buildroom.delete': 'Deleted a Build Room',
  'report.delete': 'Deleted a saved report',
};

const TARGET_TYPES = {
  user: 'Account',
  org: 'Organisation',
  'plan-request': 'Plan request',
  adjustment: 'Billing adjustment',
  code: 'Discount code',
  set: 'Question set',
  'public-set': 'Public library set',
  session: 'Session',
  sessions: 'Sessions',
  event: 'Event',
  'event-item': 'Event item',
  buildroom: 'Build Room',
  report: 'Saved report',
};

const ROLES = {
  'platform-admin': 'Engage staff',
  'org-owner': 'Owner',
  'org-admin': 'Admin',
  host: 'Host',
};

const STATUS_WORDS = {
  active: 'active', pending: 'waiting', suspended: 'suspended', disabled: 'turned off',
  hosts: 'host', admins: 'Engage admin', none: 'no access', delete: 'deleted',
};

/** `org.suspend` -> "Suspended the organisation"; unknown -> "Org: suspend". */
export function describeAction(action) {
  const a = String(action || '');
  if (ACTIONS[a]) return ACTIONS[a];
  const [noun, ...rest] = a.split('.');
  if (!noun) return 'Something changed';
  const words = rest.join(' ').replace(/-/g, ' ');
  return `${noun.charAt(0).toUpperCase()}${noun.slice(1).replace(/-/g, ' ')}${words ? `: ${words}` : ''}`;
}

/** The role the person acted in. */
export function roleLabel(role) {
  return ROLES[role] || '';
}

/** "Account", "Session"… for the second line under what it touched. */
export function targetTypeLabel(type) {
  return TARGET_TYPES[type] || (type ? String(type).replace(/-/g, ' ') : '');
}

/** The name of the thing touched, or its id when it has no name. */
export function targetName(entry) {
  const t = (entry && entry.target) || {};
  return t.title || t.id || '';
}

/** Who did it: their name, else their email, else that we do not know. */
export function actorName(entry) {
  const a = (entry && entry.actor) || {};
  return a.name || a.email || 'Someone';
}

/** The second line under the name: role, and the email when a name was shown. */
export function actorLine(entry) {
  const a = (entry && entry.actor) || {};
  return [roleLabel(a.role), a.name && a.email ? a.email : ''].filter(Boolean).join(' · ');
}

/** A short "from → to" when the entry records one; '' otherwise. */
export function changeLine(entry) {
  const d = (entry && entry.detail) || {};
  if (d.from && d.to) {
    return `${STATUS_WORDS[d.from] || d.from} → ${STATUS_WORDS[d.to] || d.to}`;
  }
  if (d.fromPlan && d.toPlan) return `${d.fromPlan} → ${d.toPlan}`;
  return '';
}

/** "4 Oct 2026, 14:05" in the reader's own time zone. */
export function whenLabel(iso) {
  const d = new Date(iso);
  if (!iso || Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

/** Said beside an entry whose action was refused or failed after it was written. */
export function outcomeLabel(outcome) {
  if (!outcome) return '';
  return 'Did not go through';
}

/** The one plain line about retention (owner, 2026-10-04: one year). */
export const RETENTION_LINE = 'Entries are kept for a year, then deleted.';
