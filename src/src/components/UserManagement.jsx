import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '../auth/AuthContext';
import { authFetch } from '../auth/authFetch';
import { adminApiUrl } from '../utils/adminApi';
import Icon from './Icon';
import './UserManagement.css';

/**
 * THE USERS SCREEN.
 *
 * Grounded in docs/design/admin-redesign/16-users.html and 17-users-clear.html
 * (RATIONALE.md §7). Wave D of docs/superpowers/plans/2026-08-10-admin-console.md.
 *
 * WHAT THE BACKEND ACTUALLY OFFERS, because every decision here follows from it.
 * template-clean.yaml declares exactly two user routes:
 *
 *   POST /admin/users/list                → manage-users.js listUsers
 *   PUT  /admin/users/{username}/state    → manage-users.js changeUserState
 *
 * and manage-users.js:209 answers 404 for everything else. The shipped screen
 * carried three more functions — `updateUserStatus` (PUT .../status),
 * `approveUser` (POST .../approve) and `deleteUser` (DELETE .../{id}) — calling
 * routes that do not exist. None of the three was wired to a control, so they
 * were never observed failing. They are deleted rather than backed by new
 * endpoints: `changeUserState` already does all three jobs, and new endpoints
 * are backend scope this wave excludes.
 *
 * THE DEFECT THIS SCREEN EXISTED WITH. The Enabled tab always rendered empty
 * under a non-zero badge. The badge counted `u.enabled && u.status !== 'pending'`
 * while the filter tested `user.status === 'enabled'` — and `status` is a
 * Cognito GROUP NAME (manage-users.js:47,60-61), one of
 * pending|hosts|admins|disabled, so 'enabled' could never match anything.
 * Disabled had the same shape. Both the counts and the filter now come from one
 * function, `roleOf`, which is the only thing on this screen that decides what
 * a person is.
 *
 * SEARCH IS LOCAL, AND SAYS SO. `listUsers` reads no request body at all —
 * limit, nextToken, search and status are discarded — hardcodes Cognito's
 * `Limit: 60` and returns no `nextToken`. So "Load More Users" could never
 * render, and the search form's round trip re-requested the identical page and
 * then filtered it client-side anyway. The round trip is gone, the button is
 * gone, and the 60-account cap is stated under the table instead of hidden
 * behind a control that cannot fire. OPEN-QUESTIONS #10 asks when 60 becomes
 * real; until that is answered, the limit belongs on screen.
 *
 * NOT FIXED HERE, AND IT IS NOT SMALL: manage-users.js:13 reads
 * `// Skip authorization for now`. There is no in-lambda admin check. The only
 * gates are the route's Cognito authorizer — which any signed-in user passes —
 * and the `isAdmin()` below, which is client-side and therefore not a gate at
 * all. That is backend scope; it is reported, not patched.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The role a person is in. ONE predicate, used by the counts, the filter, the
 * chip and the queue alike — see the header note on why that matters.
 *
 * `enabled` is Cognito's account flag; `disabled` is a group this product moves
 * people into. Either one means somebody has already decided about this person,
 * which is why disabled outranks pending: an account that has been switched off
 * is not waiting for a decision.
 */
export function roleOf(user) {
  const groups = Array.isArray(user.groups) ? user.groups : [];
  if (user.enabled === false || groups.includes('disabled')) return 'disabled';
  if (groups.includes('admins')) return 'admins';
  if (groups.includes('hosts')) return 'hosts';
  return 'pending';
}

const ROLE_META = {
  admins: { label: 'Admin', chip: 'warn' },
  hosts: { label: 'Host', chip: 'on' },
  disabled: { label: 'Disabled', chip: 'off' },
  pending: { label: 'Pending', chip: 'warn' },
};

/** The three roles a member row can be moved between, in the order they rank. */
const MEMBER_ROLES = ['admins', 'hosts', 'disabled'];

/** "Make admin" / "Make host" / "Disable" — the verb, named. */
const MOVE_VERB = { admins: 'Make admin', hosts: 'Make host', disabled: 'Disable' };

/**
 * How this person signed in.
 *
 * The shipped column read `user.provider || 'cognito'` against a payload that
 * has never carried `provider`, so it printed the same word on every row. The
 * list endpoint returns no identity data either — but Cognito names a federated
 * account `<ProviderName>_<sub>`, and that prefix is a real signal rather than a
 * guess. Anything without a recognised prefix is a native pool account, which
 * is what "Cognito" means here.
 *
 * The honest alternative is a backend change: pass Cognito's `identities`
 * attribute through `listUsers`. That is one line in a lambda this wave does not
 * own, and it is noted in the report rather than taken.
 */
const IDP_PREFIX = {
  google: 'Google',
  facebook: 'Facebook',
  loginwithamazon: 'Amazon',
  amazon: 'Amazon',
  signinwithapple: 'Apple',
  apple: 'Apple',
};

export function providerOf(user) {
  const username = String(user?.username || '');
  const cut = username.indexOf('_');
  if (cut > 0 && cut < username.length - 1) {
    const named = IDP_PREFIX[username.slice(0, cut).toLowerCase()];
    if (named) return named;
  }
  return 'Cognito';
}

/**
 * The account's creation date.
 *
 * The lambda returns it as `created` (manage-users.js:64); the shipped table
 * read `createdAt`, so the Joined column was `N/A` for every account and the
 * wait age below was underivable. One word.
 */
export function formatJoined(user) {
  const value = user?.created;
  if (!value) return '—';
  const when = new Date(value);
  if (Number.isNaN(when.getTime())) return '—';
  return when.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

/** Whole days since the account was created, or null when there is no date. */
export function daysSince(value, now = Date.now()) {
  if (!value) return null;
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return null;
  return Math.max(0, Math.floor((now - then) / DAY_MS));
}

/** "today" / "1 day ago" / "6 days ago" — the number that makes someone act. */
function ageWords(days) {
  if (days == null) return 'at an unknown date';
  if (days === 0) return 'today';
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

/** Initials for the avatar; an account with no name gets an em dash, not "UN". */
function initialsOf(user) {
  const source = user.name || user.email || '';
  const parts = String(source).split(/[\s@.]+/).filter(Boolean).slice(0, 2);
  if (!parts.length) return '—';
  return parts.map((part) => part[0]).join('').toUpperCase();
}

/** The label a person is findable by. Never an empty cell. */
function displayName(user) {
  if (user.name) return user.name;
  if (user.email) return user.email;
  return null; // caller renders "No name provided" + the username beneath
}

const UserManagement = () => {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [actionInProgress, setActionInProgress] = useState(new Set());

  const { isAdmin } = useAuth();
  const canAdminister = isAdmin();

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      // No request body is sent because the lambda reads none. Sending
      // {limit, search, status} that are silently discarded is how the screen
      // came to have a search form that looked like it worked.
      const response = await authFetch(adminApiUrl('admin/users/list'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || `Could not load users (HTTP ${response.status})`);
      }
      setUsers(Array.isArray(data.users) ? data.users : []);
      setError(null);
    } catch (err) {
      console.error('Error fetching users:', err);
      setError(err.message || 'Failed to fetch users');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!canAdminister) {
      setLoading(false);
      return;
    }
    fetchUsers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * The one write this screen has. `newState` is a Cognito group name, or
   * 'delete' — manage-users.js:105 validates exactly that set.
   *
   * Local state is updated AFTER the response, never before: an optimistic
   * rewrite makes a 500 look identical to a success until the next reload,
   * which is the failure the old `updateUserStatus` shipped with.
   */
  const changeUserState = async (username, newState) => {
    setActionInProgress((prev) => new Set([...prev, username]));
    try {
      const response = await authFetch(adminApiUrl(`admin/users/${encodeURIComponent(username)}/state`), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newState }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(result.error || `Could not change this account (HTTP ${response.status})`);
      }

      setUsers((prev) =>
        newState === 'delete'
          ? prev.filter((user) => user.username !== username)
          : prev.map((user) =>
              user.username === username
                ? { ...user, groups: [newState], state: newState, status: newState, enabled: true }
                : user
            )
      );
      setError(null);
    } catch (err) {
      console.error('Error changing user state:', err);
      setError(err.message || 'Failed to change user state');
    } finally {
      setActionInProgress((prev) => {
        const next = new Set(prev);
        next.delete(username);
        return next;
      });
    }
  };

  /* ------------------------------------------------------------- selection */

  const matchesSearch = useCallback(
    (user) => {
      const needle = searchTerm.trim().toLowerCase();
      if (!needle) return true;
      return [user.email, user.name, user.username]
        .filter(Boolean)
        .some((field) => String(field).toLowerCase().includes(needle));
    },
    [searchTerm]
  );

  const found = useMemo(() => users.filter(matchesSearch), [users, matchesSearch]);
  const waiting = useMemo(
    () =>
      found
        .filter((user) => roleOf(user) === 'pending')
        .sort((a, b) => new Date(a.created || 0) - new Date(b.created || 0)),
    [found]
  );
  const members = useMemo(() => found.filter((user) => roleOf(user) !== 'pending'), [found]);

  /** Counts and filter share `roleOf`. That is the whole fix for the badge. */
  const memberCounts = useMemo(() => {
    const counts = { all: members.length, admins: 0, hosts: 0, disabled: 0 };
    for (const user of members) counts[roleOf(user)] += 1;
    return counts;
  }, [members]);

  const shownMembers = useMemo(
    () => (roleFilter === 'all' ? members : members.filter((user) => roleOf(user) === roleFilter)),
    [members, roleFilter]
  );

  const oldestWait = waiting.length ? daysSince(waiting[0].created) : null;
  const anyPending = users.some((user) => roleOf(user) === 'pending');

  if (!canAdminister) {
    return (
      <div className="um">
        <div className="um-denied">
          <h2>Access denied</h2>
          <p>You do not have permission to access user management.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="um">
      {error && (
        <div className="um-alert" role="alert">
          <Icon name="Warning" weight="fill" size={16} color="var(--danger-text)" />
          <span className="um-alert-text">{error}</span>
          <button type="button" className="um-alert-close" onClick={() => setError(null)}>
            Dismiss
          </button>
        </div>
      )}

      {/*
        THE QUEUE, and it keeps its frame when it is empty (17-users-clear.html).
        A section that disappears when it has nothing in it is a section you stop
        looking for, which is the one property an approval queue must not have.
        Today this is the second of four filter tabs, labelled "Pending (3)".
      */}
      <section className={`um-queue${waiting.length ? '' : ' um-queue--clear'}`} aria-label="Waiting for approval">
        <header className="um-queue-head">
          <h2>Waiting for approval</h2>
          <p className="um-note">Registration puts people here. Nothing else does.</p>
          <span className="um-grow" />
          {oldestWait != null && (
            <span className="um-wait" data-testid="um-oldest-wait">
              Oldest has waited <b>{oldestWait} day{oldestWait === 1 ? '' : 's'}</b>
            </span>
          )}
        </header>

        {waiting.length === 0 ? (
          <div className="um-queue-body">
            <p className="um-clearline">
              <Icon name="CheckCircle" weight="bold" size={16} color="var(--um-success-text)" />
              <span>
                {anyPending ? (
                  <>
                    <b>No one waiting matches this search.</b> Clear the search box to see the
                    whole queue.
                  </>
                ) : (
                  <>
                    <b>Nobody is waiting.</b> New registrations land here.
                  </>
                )}
              </span>
            </p>
          </div>
        ) : (
          <ul className="um-pendlist">
            {waiting.map((user) => {
              const busy = actionInProgress.has(user.username);
              const name = displayName(user);
              const confirmed = String(user.userStatus || '').toUpperCase() === 'CONFIRMED';
              return (
                <li className="um-pend" key={user.username}>
                  <span className="um-avatar" aria-hidden="true">{initialsOf(user)}</span>
                  <span className="um-pinfo">
                    <span className="um-pname">
                      {name || <span className="um-noname">No name provided</span>}
                    </span>
                    <span className="um-pmail">{user.email || user.username}</span>
                  </span>
                  <span className="um-pmeta">
                    Signed up {ageWords(daysSince(user.created))} &middot; {providerOf(user)}{' '}
                    &middot;{' '}
                    {confirmed ? (
                      'email confirmed'
                    ) : (
                      <span className="um-unconfirmed">email not confirmed</span>
                    )}
                  </span>
                  <span className="um-pacts">
                    {/*
                      ONE VERB, NAMED. Today a pending person shows the same four
                      group buttons as everyone else with the one they are in
                      disabled, and nothing says which is the approval.
                    */}
                    <button
                      type="button"
                      className="um-btn um-btn--primary"
                      disabled={busy}
                      onClick={() => changeUserState(user.username, 'hosts')}
                    >
                      <Icon name="Check" weight="bold" size={14} color="currentColor" />
                      Approve as host
                    </button>
                    <button
                      type="button"
                      className="um-btn"
                      disabled={busy}
                      onClick={() => changeUserState(user.username, 'admins')}
                    >
                      Admin
                    </button>
                    {/*
                      REJECT IS THE REVERSIBLE NEIGHBOUR (RATIONALE §8). It moves
                      the account to `disabled` rather than deleting it, and the
                      confirmation says which — a rejection that silently
                      destroys a Cognito account is a different action wearing
                      this one's label. Permanent removal lives on member rows.
                    */}
                    <button
                      type="button"
                      className="um-btn um-btn--danger"
                      disabled={busy}
                      onClick={() => {
                        const who = name || user.username;
                        if (
                          window.confirm(
                            `Reject ${who}?\n\nThey move to Disabled and cannot sign in. The account is kept, so this can be undone from the members list. Nothing is deleted.`
                          )
                        ) {
                          changeUserState(user.username, 'disabled');
                        }
                      }}
                    >
                      Reject
                    </button>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <h3 className="um-secttl">Members &middot; {members.length}</h3>

      <div className="um-filters">
        <div className="um-search">
          <Icon name="MagnifyingGlass" weight="bold" size={14} color="var(--muted)" />
          <input
            type="search"
            className="um-input"
            aria-label="Search name, email, username"
            placeholder="Search name, email, username"
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
          />
        </div>

        <div className="um-seg" role="group" aria-label="Filter members by role">
          {[
            ['all', 'All'],
            ['admins', 'Admins'],
            ['hosts', 'Hosts'],
            ['disabled', 'Disabled'],
          ].map(([id, label]) => (
            <button
              key={id}
              type="button"
              aria-pressed={roleFilter === id}
              onClick={() => setRoleFilter(id)}
            >
              {label} {memberCounts[id]}
            </button>
          ))}
        </div>
      </div>

      <table className="um-tbl">
        <thead>
          <tr>
            <th className="um-col-person">Person</th>
            <th className="um-col-role">Role</th>
            <th className="um-col-idp">Signed in with</th>
            <th className="um-col-when">Joined</th>
            <th className="um-col-acts" />
          </tr>
        </thead>
        <tbody>
          {loading && users.length === 0 && (
            <tr className="um-dimrow">
              <td colSpan={5}>Loading accounts…</td>
            </tr>
          )}
          {!loading && shownMembers.length === 0 && (
            <tr className="um-dimrow">
              <td colSpan={5}>
                {searchTerm.trim() || roleFilter !== 'all'
                  ? 'No member matches this search and filter.'
                  : 'No accounts have been approved yet.'}
              </td>
            </tr>
          )}
          {shownMembers.map((user) => {
            const role = roleOf(user);
            const meta = ROLE_META[role];
            const busy = actionInProgress.has(user.username);
            const name = displayName(user);
            const who = name || user.username;
            return (
              <tr key={user.username} className={busy ? 'um-busy' : undefined}>
                <td>
                  <span className="um-nm">
                    {name || <span className="um-noname">No name provided</span>}
                  </span>
                  <span className="um-sub">{user.email || user.username}</span>
                </td>
                <td>
                  <span className={`um-chip um-chip--${meta.chip}`}>{meta.label}</span>
                </td>
                <td>{providerOf(user)}</td>
                <td className="um-when">{formatJoined(user)}</td>
                <td>
                  <div className="um-rowact">
                    {/*
                      Only the roles this person is NOT in. The shipped screen
                      rendered all four with the current one disabled — four
                      controls to express three choices, none of them a verb.
                    */}
                    {MEMBER_ROLES.filter((target) => target !== role).map((target) => (
                      <button
                        key={target}
                        type="button"
                        className="um-btn um-btn--sm"
                        disabled={busy}
                        onClick={() => changeUserState(user.username, target)}
                      >
                        {MOVE_VERB[target]}
                      </button>
                    ))}
                    <button
                      type="button"
                      className="um-btn um-btn--sm um-btn--ghostdanger"
                      aria-label={`Remove ${who}`}
                      title={`Remove ${who}`}
                      disabled={busy}
                      onClick={() => {
                        if (
                          window.confirm(
                            `Delete ${who}'s account?\n\nThey lose access immediately and would have to register again from scratch. Sessions they hosted and any question sets they uploaded are not affected.`
                          )
                        ) {
                          changeUserState(user.username, 'delete');
                        }
                      }}
                    >
                      <Icon name="Trash" weight="bold" size={14} color="currentColor" />
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {/*
        THE CAP, STATED. `listUsers` hardcodes Cognito's Limit: 60 and returns no
        nextToken, so there is no second page to fetch and never was a button
        that could fetch it. OPEN-QUESTIONS #10.
      */}
      <p className="um-cap">
        Cognito returns at most 60 accounts in one page and there is no second page.
        Search and role filters apply to what is loaded.
      </p>
    </div>
  );
};

export default UserManagement;
