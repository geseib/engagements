import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Icon from './Icon';
import { authFetch } from '../auth/authFetch';
import { adminApiUrl } from '../utils/adminApi';
import { inviteUrl } from './TeamPanel';
import { DecideRequestDialog } from './PlanRequestsPanel';
import {
  orderBoxes, orangeTarget, scopeTotal, SHOW_ROWS, auditSeenKey, shortDate,
  invitationBox, sentBackBox, usageBox, planRequestBox, reportsBox, approvalsBox,
  invitesRunningOutBox, staffOpenedBox, accountsBox, planQueueBox, moderationBox, claudeBox,
} from '../config/overviewAlerts';
import './OverviewPanel.css';

/**
 * OVERVIEW — the first section and landing page of every scope.
 *
 * Built from docs/design/admin-landing/index.html (F1 to F6, the 660 and 375
 * frames) and SPEC.md §3, §5, §6, as ruled by the owner on 2026-10-11:
 *
 *   - "Needs you" first (ruling 4): one box per kind of thing waiting, in
 *     urgency order (people, stuck, info; oldest first), each opening IN PLACE
 *     with the actions that already exist beside each row (ruling 8: Approve,
 *     Accept, Copy link, Revoke, Withdraw, Download) and a link to the section
 *     where the full action lives. No dismiss (ruling 5).
 *   - Then this month in numbers: four tiles, drawn as the Observability tiles.
 *   - ONE orange per screen: collapsed, the top box's main action; with a box
 *     open, that box's oldest row's main action (config/overviewAlerts.js
 *     `orangeTarget`). Nothing waiting: no orange at all.
 *
 * Each box is fed by one read, so a failed read hides one box and says so in a
 * line; it never blanks the page (the Observability partial-alert pattern).
 *
 * Pure props and callbacks, so it mounts in jsdom on its own: AdminPage
 * cannot be mounted there at all.
 *
 * @param {'personal'|'team'|'platform'} scope
 * @param {object}  org          the active org (null in platform mode)
 * @param {string}  role         the caller's role in it: owner | admin | member
 * @param {object[]} sets        the console's set list (sent-back boxes, counts)
 * @param {boolean} showInvites  this scope shows the person's team invitations
 *                               (Personal, or every team when there is no Personal)
 * @param {function} onNavigate  (sectionId) => void
 * @param {function} onOpenSet   (set) => void
 * @param {function} onRequestPlan  opens the plan request dialog, when the
 *                               caller may ask (owner, or a personal space)
 * @param {function} onTotalChange  (n) => void: what the open tab's number says
 */

const LABEL = {
  invites: 'your invitations',
  members: 'the members',
  usage: 'this month’s usage',
  planrequest: 'your plan request',
  reports: 'the saved reports',
  audit: 'the log',
  stats: 'the numbers',
  users: 'the accounts',
  planqueue: 'the plan requests',
  moderation: 'Moderation',
  claude: 'Engage settings',
  observability: 'the numbers',
};

async function readJson(path, init) {
  const res = await authFetch(adminApiUrl(path), init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `The server answered ${res.status}.`);
  return body;
}

/** One read: { state: 'off'|'loading'|'ready'|'error', data, error, reload }. */
function useRead(enabled, path, init) {
  const [state, setState] = useState({ state: enabled ? 'loading' : 'off', data: null, error: '' });
  const [nonce, setNonce] = useState(0);
  const initKey = init ? JSON.stringify(init) : '';
  useEffect(() => {
    if (!enabled || !path) { setState({ state: 'off', data: null, error: '' }); return undefined; }
    let cancelled = false;
    setState((s) => ({ ...s, state: s.data ? 'ready' : 'loading' }));
    readJson(path, init).then(
      (data) => { if (!cancelled) setState({ state: 'ready', data, error: '' }); },
      (err) => { if (!cancelled) setState({ state: 'error', data: null, error: err.message || 'Could not read it.' }); },
    );
    return () => { cancelled = true; };
  }, [enabled, path, initKey, nonce]); // eslint-disable-line react-hooks/exhaustive-deps
  return { ...state, reload: () => setNonce((n) => n + 1) };
}

const thisPeriod = (now) => {
  const d = new Date(now);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};
const monthName = (now) => new Date(now).toLocaleDateString('en-GB', { month: 'long', timeZone: 'UTC' });
const asOf = (now) => {
  const d = new Date(now);
  return `${shortDate(d.toISOString())}, ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
};
const NONE = '—';
const n = (v) => (Number.isFinite(Number(v)) ? Number(v).toLocaleString('en-GB') : NONE);

function readSeen(orgId) {
  try { return (orgId && window.localStorage.getItem(auditSeenKey(orgId))) || ''; } catch { return ''; }
}

/** Hand the browser a report: the route is authorised, so a bare link would 401. */
async function downloadReport(report) {
  const res = await authFetch(adminApiUrl(report.downloadUrl));
  if (!res.ok) throw new Error(`The server answered ${res.status}.`);
  const blob = await res.blob();
  if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = String(report.s3Key || 'report.pdf').replace(/^permanent\//, '').replace(/\.enc$/, '');
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function Tile({ label, value, small, sub, meter }) {
  return (
    <div className="ovw-tile">
      <span className="ovw-tile-l">{label}</span>
      <span className="ovw-tile-v">{value}{small ? <small> {small}</small> : null}</span>
      {meter != null && (
        <span className="ovw-meter" aria-hidden="true"><i style={{ width: `${Math.max(0, Math.min(100, meter))}%` }} /></span>
      )}
      <span className="ovw-tile-s" title={sub}>{sub}</span>
    </div>
  );
}

function AlertBox({
  box, open, onToggle, orange, onAction, onNavigate, busy, notes,
}) {
  const bodyId = `ovw-body-${box.id}`;
  const rows = box.rows || [];
  const shown = rows.slice(0, SHOW_ROWS);
  const headOrange = orange && orange.boxId === box.id && orange.row === -1;
  const btnClass = (action, isOrange) => [
    'ovw-btn',
    isOrange ? 'ovw-btn--primary' : '',
    action.danger ? 'ovw-btn--danger' : '',
    !isOrange && !action.danger && !action.primary ? 'ovw-btn--ghost' : '',
  ].filter(Boolean).join(' ');

  const main = box.main;
  const showMain = main && !open;
  return (
    <section className={`ovw-al ovw-al--${box.cls}${open ? ' is-open' : ''}`} data-testid={`ovw-box-${box.id}`} data-class={box.cls}>
      <div className="ovw-al-head">
        <button
          type="button"
          className="ovw-al-toggle"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={onToggle}
        >
          <span className="ovw-al-n">{box.count}</span>
          <span className="ovw-al-t">
            <b>{box.title}</b>
            <span title={box.summary}>{box.summary}</span>
          </span>
        </button>
        {showMain && (
          <span className="ovw-al-act">
            <button
              type="button"
              className={btnClass({ primary: true }, headOrange)}
              disabled={busy === `${box.id}:head`}
              onClick={() => onAction(box, main, main.row != null ? rows[main.row] : null, true)}
            >
              {main.label}
            </button>
          </span>
        )}
        <button
          type="button"
          className="ovw-al-car"
          aria-expanded={open}
          aria-controls={bodyId}
          aria-label={open ? `Close ${box.title}` : `Open ${box.title}`}
          onClick={onToggle}
        >
          <Icon name="CaretDown" size={13} weight="bold" />
        </button>
      </div>
      {open && (
        <div className="ovw-al-body" id={bodyId}>
          {box.why && <p className="ovw-al-why">{box.why}</p>}
          {!rows.length && <p className="ovw-al-why">{box.summary}</p>}
          {shown.map((row, i) => {
            const note = notes[`${box.id}:${row.id}`];
            return (
              <div className="ovw-al-row" key={row.id} data-testid="ovw-row">
                <span className="ovw-who">
                  <b title={row.name}>{row.name}</b>
                  <span title={row.detail}>{row.detail}</span>
                </span>
                <span className="ovw-acts">
                  {(row.actions || []).map((action) => {
                    const isOrange = Boolean(orange && orange.boxId === box.id && orange.row === i && action.primary);
                    return (
                      <button
                        key={action.id}
                        type="button"
                        className={btnClass(action, isOrange)}
                        disabled={busy === `${box.id}:${row.id}`}
                        onClick={() => onAction(box, action, row)}
                      >
                        {action.label}
                      </button>
                    );
                  })}
                </span>
                {note && <p className={`ovw-note${note.bad ? ' ovw-note--bad' : ''}`} role={note.bad ? 'alert' : 'status'}>{note.text}</p>}
              </div>
            );
          })}
          <div className="ovw-al-foot">
            <span>
              {box.foot && <>{box.foot} </>}
              {rows.length > 0 && (rows.length > SHOW_ROWS || !box.foot) && (
                rows.length > SHOW_ROWS ? `Showing ${SHOW_ROWS} of ${rows.length}` : `Showing all ${rows.length}`
              )}
            </span>
            {box.link && (
              <button type="button" className="ovw-link" onClick={() => onNavigate && onNavigate(box.link.section)}>
                {box.link.label} ›
              </button>
            )}
            {box.hostLink && (
              <a className="ovw-link" href={box.hostLink.href} target="_blank" rel="noopener noreferrer">{box.hostLink.label} ↗</a>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

export default function OverviewPanel({
  scope = 'personal', org = null, role = '', sets = [], showInvites = false,
  onNavigate, onOpenSet, onRequestPlan, onTotalChange, now = null,
}) {
  const nowMs = useMemo(() => (now ? new Date(now).getTime() : Date.now()), [now]);
  const orgId = (org && org.orgId) || '';
  const platform = scope === 'platform';
  const team = scope === 'team';
  const isAdmin = scope === 'personal' || role === 'owner' || role === 'admin';
  const period = thisPeriod(nowMs);
  const capped = org && !['team', 'standard'].includes(String(org.plan || 'free'));

  const reads = {
    invites: useRead(!platform && showInvites, 'invites'),
    members: useRead(team && Boolean(orgId), orgId ? `orgs/${orgId}/members` : ''),
    usage: useRead(!platform && isAdmin && Boolean(orgId), orgId ? `orgs/${orgId}/usage` : ''),
    planrequest: useRead(!platform && isAdmin && Boolean(orgId), orgId ? `orgs/${orgId}/plan-requests` : ''),
    reports: useRead(!platform && Boolean(orgId), 'reports'),
    audit: useRead(team && isAdmin && Boolean(orgId), orgId ? `orgs/${orgId}/audit?limit=25` : ''),
    stats: useRead(!platform && isAdmin && Boolean(orgId), orgId ? `orgs/${orgId}/stats?from=${period}&to=${period}` : ''),
    users: useRead(platform, 'admin/users/list', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }),
    planqueue: useRead(platform, 'platform/plan-requests?status=requested'),
    moderation: useRead(platform, 'admin/moderation'),
    claude: useRead(platform, 'platform/settings/claude-models'),
    observability: useRead(platform, 'platform/observability'),
  };

  const [seenAt] = useState(() => readSeen(orgId));
  const [openId, setOpenId] = useState('');
  const [busy, setBusy] = useState('');
  const [notes, setNotes] = useState({});
  const [deciding, setDeciding] = useState(null);

  const d = (k) => reads[k].data;
  const boxes = useMemo(() => {
    const list = [];
    if (platform) {
      if (d('users')) list.push(accountsBox(d('users').users, nowMs));
      if (d('planqueue')) list.push(planQueueBox(d('planqueue').requests, nowMs));
      if (d('moderation')) list.push(moderationBox(d('moderation'), nowMs));
      if (d('claude')) list.push(claudeBox(d('claude')));
    } else {
      if (d('invites')) list.push(invitationBox(d('invites').invites, nowMs));
      list.push(sentBackBox(sets));
      if (d('members') && isAdmin) {
        list.push(approvalsBox(d('members').members, nowMs, { canApprove: d('members').canApproveHosting !== false }));
        list.push(invitesRunningOutBox(d('members').invites, nowMs));
      }
      if (d('usage') && capped) list.push(usageBox(d('usage')));
      if (d('planrequest')) list.push(planRequestBox((d('planrequest').requests || [])[0], nowMs));
      if (d('audit')) list.push(staffOpenedBox(d('audit').entries, seenAt));
      if (d('reports')) list.push(reportsBox(d('reports').reports, nowMs));
    }
    return orderBoxes(list.filter(Boolean));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [platform, isAdmin, capped, sets, seenAt, nowMs, ...Object.values(reads).map((r) => r.data)]);

  const total = scopeTotal(boxes);
  const things = boxes.reduce((sum, b) => sum + (b.countIsSize ? 1 : (Number(b.count) || 0)), 0);
  const boxReads = platform ? ['users', 'planqueue', 'moderation', 'claude']
    : ['invites', 'members', 'usage', 'planrequest', 'audit', 'reports'];
  const loading = boxReads.some((k) => reads[k].state === 'loading');
  const failed = boxReads.filter((k) => reads[k].state === 'error');

  useEffect(() => {
    if (!loading && onTotalChange) onTotalChange(total);
  }, [loading, total, onTotalChange]);

  const orange = orangeTarget(boxes, openId);

  const note = (box, row, text, bad = false) => setNotes((all) => ({ ...all, [`${box.id}:${row ? row.id : 'head'}`]: { text, bad } }));

  const run = async (box, row, fn) => {
    const key = `${box.id}:${row ? row.id : 'head'}`;
    setBusy(key);
    try {
      await fn();
    } catch (err) {
      if (row) note(box, row, err.message || 'That did not work. Try again.', true);
      else setOpenId(box.id);
    } finally {
      setBusy('');
    }
  };

  const onAction = (box, action, row) => {
    switch (action.id) {
      case 'open':
        setOpenId(box.id);
        return undefined;
      case 'accept':
        return run(box, row, async () => {
          await readJson(`invites/${encodeURIComponent(row.data.token)}/accept`, { method: 'POST' });
          // The new team's tab has to appear, and a tab is a page load away.
          window.location.reload();
        });
      case 'open-set':
        if (onOpenSet) onOpenSet(row.data);
        return undefined;
      case 'see-plans':
        if (onRequestPlan) onRequestPlan(); else if (onNavigate) onNavigate('billing');
        return undefined;
      case 'withdraw':
        return run(box, row, async () => {
          await readJson(`orgs/${orgId}/plan-requests/${encodeURIComponent(row.data.reqId)}`, { method: 'DELETE' });
          reads.planrequest.reload();
        });
      case 'download':
        return run(box, row, async () => {
          await downloadReport(row.data);
          note(box, row, 'Downloaded.');
        });
      case 'approve':
        return run(box, row, async () => {
          await readJson(`orgs/${orgId}/members/${encodeURIComponent(row.data.userId)}/approve`, { method: 'POST' });
          note(box, row, `${row.name} can host now.`);
          reads.members.reload();
        });
      case 'copy-link': {
        const link = inviteUrl(row.data.token);
        const copy = navigator.clipboard && navigator.clipboard.writeText
          ? navigator.clipboard.writeText(link) : Promise.reject(new Error('This browser cannot copy.'));
        return copy.then(
          () => note(box, row, `Copied. Send it to ${row.data.email}.`),
          () => note(box, row, `Copy this link: ${link}`),
        );
      }
      case 'revoke':
        if (!window.confirm(`Revoke the invitation to ${row.data.email}?\n\nThe link stops working. Nobody is removed and nothing is lost; you can invite this address again.`)) return undefined;
        return run(box, row, async () => {
          await readJson(`orgs/${orgId}/invites/${encodeURIComponent(row.data.token)}`, { method: 'DELETE' });
          reads.members.reload();
        });
      case 'read-log':
        if (onNavigate) onNavigate('privacy');
        return undefined;
      case 'approve-account':
        return run(box, row, async () => {
          await readJson(`admin/users/${encodeURIComponent(row.data.username)}/state`, {
            method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ newState: 'hosts' }),
          });
          reads.users.reload();
        });
      case 'reject-account': {
        const who = row.name;
        if (!window.confirm(`Reject ${who}?\n\nThey move to Disabled and cannot sign in. The account is kept, so this can be undone from the members list. Nothing is deleted.`)) return undefined;
        return run(box, row, async () => {
          await readJson(`admin/users/${encodeURIComponent(row.data.username)}/state`, {
            method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ newState: 'disabled' }),
          });
          reads.users.reload();
        });
      }
      case 'decide':
        setDeciding(row.data);
        return undefined;
      case 'review-moderation':
        if (onNavigate) onNavigate('moderation');
        return undefined;
      case 'engage-settings':
        if (onNavigate) onNavigate('engagesettings');
        return undefined;
      default:
        return undefined;
    }
  };

  const toggle = (box) => setOpenId((was) => (was === box.id ? '' : box.id));

  /* ── the numbers ──────────────────────────────────────────────────────── */
  const month = (() => {
    const s = d('stats');
    return s && Array.isArray(s.months) ? (s.months.find((m) => m.period === period) || null) : null;
  })();
  const totals = (month && month.totals) || {};
  const usage = d('usage');
  const memberRead = d('members');

  let tiles = null;
  if (platform) {
    const obs = d('observability');
    const nowCounts = (obs && obs.now) || {};
    const monthRow = obs && Array.isArray(obs.months) ? obs.months.find((m) => m.period === period) : null;
    const pending = d('users') ? (accountsBox(d('users').users, nowMs) || { count: 0 }).count : null;
    tiles = (
      <>
        <h2 className="ovw-h2">Right now <small>as of {asOf(nowMs)}</small>
          <button type="button" className="ovw-link ovw-h2-link" onClick={() => onNavigate && onNavigate('observability')}>Observability ›</button>
        </h2>
        <div className="ovw-tiles">
          <Tile label="Accounts" value={nowCounts.accounts ? n(nowCounts.accounts.count) : NONE} sub={pending === null ? 'any status' : `any status · ${pending} pending`} />
          <Tile label="Organisations" value={nowCounts.organisations ? n(nowCounts.organisations.teams + nowCounts.organisations.personal) : NONE} sub={nowCounts.organisations ? `${n(nowCounts.organisations.teams)} teams · ${n(nowCounts.organisations.personal)} personal` : 'Could not be read'} />
          <Tile label="Sessions counted" value={monthRow ? n(monthRow.counted) : NONE} sub="this month, all teams" />
          <Tile label="Question sets" value={nowCounts.questionSets ? n(nowCounts.questionSets.total) : NONE} sub={nowCounts.questionSets ? `${n(nowCounts.questionSets.platform)} Engage · ${n(nowCounts.questionSets.public)} public` : 'Could not be read'} />
        </div>
      </>
    );
  } else if (!isAdmin) {
    const teamSets = (sets || []).filter((s) => (s.scope || 'platform') === 'org').length;
    tiles = (
      <>
        <h2 className="ovw-h2">{org ? org.name : 'This team'}</h2>
        <div className="ovw-tiles ovw-tiles--two">
          <Tile label="Question sets" value={n(teamSets)} sub="in the team library" />
          <Tile label="Members" value={memberRead ? n((memberRead.members || []).length) : NONE} sub="people in this team" />
        </div>
        <p className="ovw-note-line">Monthly numbers are shown to the team’s owners and admins.</p>
      </>
    );
  } else {
    const cap = usage && usage.plan && usage.plan.metersOverage !== true ? usage.allowances : null;
    const used = usage && usage.usage ? usage.usage : null;
    const personal = scope === 'personal';
    tiles = (
      <>
        <h2 className="ovw-h2">{monthName(nowMs)} so far <small>as of {asOf(nowMs)}</small>
          <button type="button" className="ovw-link ovw-h2-link" onClick={() => onNavigate && onNavigate(personal ? 'billing' : 'activity')}>
            {personal ? 'Plan & usage' : 'Activity'} ›
          </button>
        </h2>
        <div className="ovw-tiles">
          {cap && used ? (
            <Tile
              label="Sessions counted"
              value={n(used.sessionsRun)}
              small={`of ${n(cap.sessions)}`}
              meter={cap.sessions ? (used.sessionsRun / cap.sessions) * 100 : null}
              sub={`${usage.plan.name || 'Free'} plan${usage.period && usage.period.resetsOn ? ` · resets ${shortDate(usage.period.resetsOn)}` : ''}`}
            />
          ) : (
            <Tile label="Sessions counted" value={month ? n(totals.counted) : NONE} sub={month ? `${n(totals.created)} created · ${n(totals.started)} started` : 'none counted yet'} />
          )}
          <Tile label="Participants" value={month ? n(totals.participants) : (reads.stats.state === 'ready' ? '0' : NONE)} sub="one per person per session" />
          <Tile label="Questions asked" value={month ? n(totals.questions) : (reads.stats.state === 'ready' ? '0' : NONE)} sub="put to the room" />
          {cap && used ? (
            <Tile label="Question sets" value={n(used.setsCurrent)} small={`of ${n(cap.sets)}`} sub="in your library" />
          ) : (
            <Tile label="This month so far" value={usage ? (usage.totalIfPeriodEndedTodayDisplay || NONE) : NONE} sub={usage && usage.plan ? `${usage.plan.name} plan` : 'Plan & usage'} />
          )}
        </div>
      </>
    );
  }

  const failedLine = failed.length > 0 && (
    <p className="ovw-partial" role="status">
      Could not read {failed.map((k) => LABEL[k] || k).join(', ')}. Everything else here is current; reload to try again.
    </p>
  );

  return (
    <div className="ovw" data-theme="dark">
      {boxes.length > 0 ? (
        <>
          <h2 className="ovw-h2">{platform ? 'Needs Engage' : 'Needs you'} <small>{things === 1 ? '1 thing' : `${things} things`}</small></h2>
          {failedLine}
          <div className="ovw-alerts">
            {boxes.map((box) => (
              <AlertBox
                key={box.id}
                box={box}
                open={openId === box.id}
                onToggle={() => toggle(box)}
                orange={orange}
                onAction={onAction}
                onNavigate={onNavigate}
                busy={busy}
                notes={notes}
              />
            ))}
          </div>
        </>
      ) : loading ? (
        <p className="ovw-loading" role="status">Gathering what is waiting…</p>
      ) : (
        <>
          {failedLine}
          <div className="ovw-alerts">
            <div className="ovw-none" data-testid="ovw-none">
              <span className="ovw-none-ck" aria-hidden="true"><Icon name="Check" size={17} weight="bold" /></span>
              <div>
                <b>{platform ? 'Nothing needs Engage.' : 'Nothing needs you.'}</b>
                <span>
                  {platform
                    ? 'Accounts, plan requests and sets held for a person will show here when they arrive.'
                    : 'Approvals, invitations and sets sent back will show here when they arrive.'}
                </span>
              </div>
            </div>
          </div>
        </>
      )}

      {tiles}

      {deciding && (
        <DecideRequestDialog
          request={deciding}
          onCancel={() => setDeciding(null)}
          onDecided={() => { setDeciding(null); reads.planqueue.reload(); }}
        />
      )}
    </div>
  );
}
