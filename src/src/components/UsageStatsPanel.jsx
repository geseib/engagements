import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { authFetch } from '../auth/authFetch';
import { adminApiUrl } from '../utils/adminApi';
import { monthLabel, dateLabel, countLabel } from '../utils/statsFormat';
import './UsageStatsPanel.css';

/**
 * ACTIVITY — what a team ran, month by month (docs/design/usage-stats,
 * mockups A1/A2; SPEC approved 2026-10-11).
 *
 * A team's owners and admins see it in the console's Team group; GET
 * /orgs/{orgId}/stats checks the role on the server against the MEMBER row,
 * which is the permission (this nav entry is only a view). The same parts
 * render a team for Engage staff (StaffStatsDrill.jsx), fed from
 * GET /platform/stats, where a team set shows as "Team set · <ref>".
 *
 * COUNTS ONLY. The route returns ids and numbers. A set's NAME is joined here
 * by id from the set list the console already holds (`sets`), decrypted for
 * this member; staff get no names for a team's sets at all.
 *
 * THE LEAD NUMBER IS "COUNTED" (owner, SPEC §13 Q1): two questions answered,
 * the billing rule. Created and started sit beside it so a rehearsal is
 * visible without inflating it. A Build Room's "questions" are asks put to
 * the room, and its counted cell is a dash until there is a rule (Q2, Q11).
 *
 * A MONTH BEFORE COUNTING BEGAN shows the plan's counted sessions, labelled
 * "from your plan", and dashes for everything the plan never counted (Q13).
 * A month in which nothing ran says so in words, never as a row of zeros.
 *
 * ONE ORANGE: Download CSV, built in the browser from the same response (Q12).
 */

const NONE = '—';

/** The order and the words every stats screen uses for a session type. */
export const TYPE_ORDER = ['call-and-answer', 'trivia', 'poll', 'wavelength', 'survey', 'build', 'other'];
export const TYPE_LABELS = {
  'call-and-answer': 'Call & Answer',
  trivia: 'Trivia',
  poll: 'Poll',
  wavelength: 'Wavelength',
  survey: 'Survey',
  build: 'Build Room',
  other: 'Other',
};

/** `yyyy-mm` plus `n` months, in UTC, never through a local Date. */
export function addMonths(period, n) {
  const [y, m] = String(period).split('-').map(Number);
  const total = y * 12 + (m - 1) + n;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`;
}

export const thisMonth = (now = new Date()) => `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;

const shortMonth = (period) => {
  const label = monthLabel(period);
  const [name, year] = label.split(' ');
  return name && year ? `${name.slice(0, 3)} ${year}` : label;
};

/** The month's type rows, in the screens' order, only the types that ran. */
export function typeRows(month) {
  const byType = (month && month.byType) || {};
  return TYPE_ORDER.filter((t) => byType[t]).map((t) => ({ type: t, label: TYPE_LABELS[t], ...byType[t] }));
}

const isBlank = (c) => !c || ['created', 'started', 'counted', 'questions', 'participants'].every((k) => !c[k]);

/** "Counted" for a type: a Build Room has no rule yet, so a dash. */
const countedOf = (row) => (row.type === 'build' ? NONE : countLabel(row.counted));

/** Quote one CSV cell. */
const csvCell = (v) => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/**
 * The whole response as one CSV: every column, one section after another.
 * `setLabel(set)` names a set the way the screen does.
 */
export function buildCsv(data, period, { setLabel = (s) => s.setId || s.ref, memberLabel = (m) => m.displayName || m.email || m.userId } = {}) {
  const lines = [];
  const row = (...cells) => lines.push(cells.map(csvCell).join(','));
  const month = (data.months || []).find((m) => m.period === period) || {};
  row('Section', 'Month', 'Name', 'Created', 'Started', 'Counted', 'Questions', 'Participants', 'Decisions', 'Crew tasks', 'Kept', 'Sets');
  for (const t of typeRows(month)) {
    const kept = month.gauge && month.gauge.existing ? month.gauge.existing[t.type] || 0 : '';
    row('Type', period, t.label, t.created, t.started, t.type === 'build' ? '' : t.counted, t.questions, t.participants, t.decisions || '', t.tasks || '', kept, '');
  }
  if (month.totals) {
    row('All types', period, 'All types', month.totals.created, month.totals.started, month.totals.counted, month.totals.questions, month.totals.participants, '', '', month.gauge ? month.gauge.kept : '', month.gauge ? month.gauge.setsHeld : '');
  }
  if (month.events && !isBlank(month.events)) row('Events', period, 'Events', month.events.created, month.events.started, '', '', month.events.participants, '', '', '', '');
  for (const m of data.members || []) {
    const mine = (m.months && m.months[period]) || {};
    const t = mine.totals || {};
    row('Member', period, memberLabel(m), t.created, t.started, t.counted, t.questions, t.participants, '', '', mine.kept ?? '', mine.setsHeld ?? '');
  }
  for (const m of data.months || []) {
    if (!m.recorded && !m.plan) continue;
    row('Month', m.period, m.recorded ? 'Counted' : 'From the plan', m.recorded ? m.totals.created : '', m.recorded ? m.totals.started : '', m.recorded ? m.totals.counted : (m.plan ? m.plan.sessionsRun : ''), m.recorded ? m.totals.questions : '', m.recorded ? m.totals.participants : '', '', '', '', '');
  }
  if ((data.sets || []).length) {
    // The sets are all time and have their own columns: a second table.
    lines.push('');
    row('Set', 'Version', 'Used in sessions', 'Questions asked', 'Copied', 'Downloaded');
    for (const s of data.sets) {
      for (const v of s.versions) row(setLabel(s), v.version || 'none', v.sessions, v.questions, v.copies, v.downloads);
    }
  }
  return `${lines.join('\n')}\n`;
}

/** Hand the browser a file. Quietly nothing where there is no URL API (tests). */
function saveFile(name, text) {
  if (typeof window === 'undefined' || !window.URL || typeof window.URL.createObjectURL !== 'function') return false;
  const url = window.URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.URL.revokeObjectURL(url);
  return true;
}

export function Tile({ label, value, sub }) {
  return (
    <div className="ust-tile">
      <span className="ust-tile-l">{label}</span>
      <span className="ust-tile-v">{value}</span>
      <span className="ust-tile-s" title={sub}>{sub}</span>
    </div>
  );
}

export function MonthStepper({ period, onChange, latest }) {
  return (
    <span className="ust-month">
      <button type="button" className="ust-month-step" aria-label="Previous month" onClick={() => onChange(addMonths(period, -1))}>‹</button>
      <b aria-live="polite"><span className="ust-wide">{monthLabel(period)}</span><span className="ust-narrow">{shortMonth(period)}</span></b>
      <button type="button" className="ust-month-step" aria-label="Next month" disabled={period >= latest} onClick={() => onChange(addMonths(period, 1))}>›</button>
    </span>
  );
}

export function Tiles({ month, isCurrent, setsSub }) {
  const t = month.totals;
  const build = month.byType && month.byType.build;
  const g = month.gauge;
  return (
    <div className="ust-tiles">
      <Tile label="Sessions counted" value={countLabel(t.counted)} sub={`${countLabel(t.created)} created · ${countLabel(t.started)} started`} />
      <Tile label="Questions asked" value={countLabel(t.questions)} sub={build && build.questions ? `incl. ${countLabel(build.questions)} Build Room asks` : 'put to the room'} />
      <Tile label="Participants" value={countLabel(t.participants)} sub="one per person per session" />
      <Tile label="Sessions still kept" value={g ? countLabel(g.kept) : NONE} sub={g ? (isCurrent ? 'today' : 'at month end') : 'counted daily'} />
      <Tile label="Question sets" value={g ? countLabel(g.setsHeld) : NONE} sub={setsSub} />
    </div>
  );
}

export function TypeTable({ month, caption = 'By type', hint }) {
  const rows = typeRows(month);
  const build = rows.find((r) => r.type === 'build');
  const g = month.gauge;
  const kept = (type) => (g ? countLabel((g.existing && g.existing[type]) || 0) : NONE);
  const ev = month.events;
  return (
    <section className="ust-blk" aria-label={caption}>
      <div className="ust-h2row"><h2 className="ust-h2">{caption}</h2>{hint && <p className="ust-hint">{hint}</p>}</div>
      <table className="ust-tbl">
        <colgroup><col className="ust-col-name" /><col /><col /><col /><col /><col /><col /></colgroup>
        <thead>
          <tr>
            <th scope="col">Type</th>
            <th scope="col" className="ust-n">Created</th>
            <th scope="col" className="ust-n">Started</th>
            <th scope="col" className="ust-n">Counted</th>
            <th scope="col" className="ust-n">Questions</th>
            <th scope="col" className="ust-n">Participants</th>
            <th scope="col" className="ust-n">Kept today</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.type}>
              <td className="ust-first"><span className={`ust-kind${r.type === 'build' ? ' ust-kind--build' : ''}`}>{r.label}</span></td>
              <td className="ust-n ust-wide-cell" data-l="Created">{countLabel(r.created)}</td>
              <td className="ust-n ust-wide-cell" data-l="Started">{countLabel(r.started)}</td>
              <td className="ust-n" data-l="Counted">
                <span className="ust-wide">{countedOf(r)}</span>
                <span className="ust-narrow">{r.type === 'build' ? NONE : `${countLabel(r.counted)} of ${countLabel(r.created)}`}</span>
              </td>
              <td className="ust-n" data-l={r.type === 'build' ? 'Asks' : 'Questions'}>{countLabel(r.questions)}</td>
              <td className="ust-n" data-l="Participants">{countLabel(r.participants)}</td>
              <td className="ust-n ust-wide-cell" data-l="Kept today">{kept(r.type)}</td>
            </tr>
          ))}
          {build && (build.decisions || build.tasks) ? (
            <tr className="ust-subrow"><td colSpan={7}>Build Room also: {countLabel(build.decisions)} decisions, {countLabel(build.tasks)} crew tasks.</td></tr>
          ) : null}
          <tr className="ust-tot">
            <td className="ust-first">All types</td>
            <td className="ust-n ust-wide-cell" data-l="Created">{countLabel(month.totals.created)}</td>
            <td className="ust-n ust-wide-cell" data-l="Started">{countLabel(month.totals.started)}</td>
            <td className="ust-n" data-l="Counted">
              <span className="ust-wide">{countLabel(month.totals.counted)}</span>
              <span className="ust-narrow">{`${countLabel(month.totals.counted)} of ${countLabel(month.totals.created)}`}</span>
            </td>
            <td className="ust-n" data-l="Questions">{countLabel(month.totals.questions)}</td>
            <td className="ust-n" data-l="Participants">{countLabel(month.totals.participants)}</td>
            <td className="ust-n ust-wide-cell" data-l="Kept today">{g ? countLabel(g.kept) : NONE}</td>
          </tr>
        </tbody>
      </table>
      {ev && !isBlank(ev) && (
        <p className="ust-foot"><b>Events:</b> {countLabel(ev.created)} created, {countLabel(ev.started)} run, {countLabel(ev.participants)} people registered.</p>
      )}
    </section>
  );
}

export function MembersTable({ members, period, onOpen, label = 'Member' }) {
  if (!members || !members.length) return null;
  return (
    <section className="ust-blk" aria-label="Members">
      <h2 className="ust-h2">Members</h2>
      <table className="ust-tbl">
        <colgroup><col className="ust-col-name" /><col /><col /><col /><col /><col /></colgroup>
        <thead>
          <tr>
            <th scope="col">{label}</th>
            <th scope="col" className="ust-n">Created</th>
            <th scope="col" className="ust-n">Counted</th>
            <th scope="col" className="ust-n">Questions</th>
            <th scope="col" className="ust-n">Participants</th>
            <th scope="col" className="ust-n">Sets</th>
          </tr>
        </thead>
        <tbody>
          {members.map((m) => {
            const mine = (m.months && m.months[period]) || {};
            const t = mine.totals || {};
            const name = m.displayName || m.email || m.userId;
            const role = m.role && m.role !== 'member' ? ` · ${m.role}` : '';
            return (
              <tr key={m.userId}>
                <td className="ust-first" title={`${name}${role}`}>
                  {onOpen ? <button type="button" className="ust-link" onClick={() => onOpen(m)}>{name}</button> : name}
                  {role && <span className="ust-dim">{role}</span>}
                </td>
                <td className="ust-n" data-l="Created">{countLabel(t.created || 0)}</td>
                <td className="ust-n" data-l="Counted">{countLabel(t.counted || 0)}</td>
                <td className="ust-n" data-l="Questions">{countLabel(t.questions || 0)}</td>
                <td className="ust-n" data-l="Participants">{countLabel(t.participants || 0)}</td>
                <td className="ust-n" data-l="Sets">{Number.isFinite(mine.setsHeld) ? countLabel(mine.setsHeld) : NONE}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

const versionsNote = (s) => {
  if (s.versions.length === 1 && s.versions[0].version === 0) return 'no versions';
  return s.versions.length === 1 ? '1 version' : `${s.versions.length} versions`;
};

export function SetsTable({ sets, setLabel, onOpen, title = 'Your question sets, all time', hint, activeVersionOf = () => null }) {
  if (!sets || !sets.length) return null;
  return (
    <section className="ust-blk" aria-label={title}>
      <div className="ust-h2row"><h2 className="ust-h2">{title}</h2>{hint && <p className="ust-hint">{hint}</p>}</div>
      <table className="ust-tbl">
        <colgroup><col className="ust-col-name" /><col /><col /><col /><col /></colgroup>
        <thead>
          <tr>
            <th scope="col">Set</th>
            <th scope="col" className="ust-n">Used in sessions</th>
            <th scope="col" className="ust-n">Questions asked</th>
            <th scope="col" className="ust-n">Copied</th>
            <th scope="col" className="ust-n">Downloaded</th>
          </tr>
        </thead>
        <tbody>
          {sets.map((s) => {
            const name = setLabel(s);
            const many = s.versions.length > 1;
            const active = activeVersionOf(s);
            return (
              <React.Fragment key={s.setId || s.ref}>
                <tr>
                  <td className="ust-first" title={name}>
                    {onOpen ? <button type="button" className="ust-link" onClick={() => onOpen(s)}>{name}</button> : name}
                    <span className="ust-dim"> · {versionsNote(s)}</span>
                  </td>
                  <td className="ust-n" data-l="Used in sessions">{countLabel(s.total.sessions)}</td>
                  <td className="ust-n" data-l="Questions asked">{countLabel(s.total.questions)}</td>
                  <td className="ust-n" data-l="Copied">{countLabel(s.total.copies)}</td>
                  <td className="ust-n" data-l="Downloaded">{countLabel(s.total.downloads)}</td>
                </tr>
                {many && s.versions.map((v) => (
                  <tr key={v.version} className="ust-ver">
                    <td className="ust-first">v{v.version}{active === v.version && <span className="ust-dim"> (active)</span>}</td>
                    <td className="ust-n" data-l="Used in sessions">{countLabel(v.sessions)}</td>
                    <td className="ust-n" data-l="Questions asked">{countLabel(v.questions)}</td>
                    <td className="ust-n" data-l="Copied">{countLabel(v.copies)}</td>
                    <td className="ust-n" data-l="Downloaded">{countLabel(v.downloads)}</td>
                  </tr>
                ))}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

export function MonthsTable({ months, planWord = 'from your plan' }) {
  const shown = (months || []).filter((m) => m.recorded || (m.plan && m.plan.sessionsRun));
  if (!shown.length) return null;
  return (
    <section className="ust-blk" aria-label="Recent months">
      <h2 className="ust-h2">Last six months</h2>
      <table className="ust-tbl">
        <colgroup><col className="ust-col-name" /><col /><col /><col /></colgroup>
        <thead>
          <tr>
            <th scope="col">Month</th>
            <th scope="col" className="ust-n">Counted</th>
            <th scope="col" className="ust-n">Questions</th>
            <th scope="col" className="ust-n">Participants</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((m) => (
            <tr key={m.period}>
              <td className="ust-first">{monthLabel(m.period)}{!m.recorded && <span className="ust-dim"> · {planWord}</span>}</td>
              <td className="ust-n" data-l="Counted">{m.recorded ? countLabel(m.totals.counted) : countLabel(m.plan.sessionsRun)}</td>
              <td className="ust-n" data-l="Questions">{m.recorded ? countLabel(m.totals.questions) : <span className="ust-dim">{NONE}</span>}</td>
              <td className="ust-n" data-l="Participants">{m.recorded ? countLabel(m.totals.participants) : <span className="ust-dim">{NONE}</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/** What a month says when nothing was recorded in it. */
export function EmptyMonth({ month, planWord = 'your plan' }) {
  const plan = month.plan && month.plan.sessionsRun;
  return (
    <p className="ust-empty">
      {plan
        ? `${monthLabel(month.period)}: ${countLabel(plan)} ${plan === 1 ? 'session' : 'sessions'} counted by ${planWord}. Nothing else was counted then.`
        : `Nothing ran in ${monthLabel(month.period)}.`}
    </p>
  );
}

/**
 * Fetch a team's (or, for staff, one team's) stats for six months ending at
 * `period`, refetched when the month moves.
 */
export function useStats(urlFor, period) {
  const [state, setState] = useState({ data: null, error: '', loading: true });
  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: '' }));
    try {
      const res = await authFetch(urlFor(addMonths(period, -5), period));
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `The server answered ${res.status}.`);
      setState({ data: body, error: '', loading: false });
    } catch (err) {
      setState({ data: null, error: err.message || 'Could not load the numbers.', loading: false });
    }
  }, [urlFor, period]);
  useEffect(() => { load(); }, [load]);
  return state;
}

/**
 * The body every team view shares: note, tiles, by type, members, sets,
 * months. `staff` changes the words where they name the reader.
 */
export function TeamStatsBody({
  data, period, latest, setLabel, onOpenMember, onOpenSet, staff = false, activeVersionOf,
}) {
  const month = (data.months || []).find((m) => m.period === period)
    || { period, recorded: false, byType: {}, totals: {}, events: null, gauge: null, plan: null };
  const isCurrent = period === latest;
  return (
    <>
      <div className="ust-since">
        {data.countingSince
          ? <span>Counting since <b>{dateLabel(data.countingSince)}</b>. Earlier months show only the sessions {staff ? 'the plan' : 'your plan'} counted.</span>
          : <span>Counting starts with the next session. Earlier months show only the sessions {staff ? 'the plan' : 'your plan'} counted.</span>}
      </div>
      {month.recorded ? (
        <>
          <Tiles month={month} isCurrent={isCurrent} setsSub={staff ? 'in the team’s library' : 'in your library'} />
          <TypeTable month={month} hint="Events are listed below; their sessions are counted here." />
        </>
      ) : <EmptyMonth month={month} planWord={staff ? 'the plan' : 'your plan'} />}
      <MembersTable members={data.members} period={period} onOpen={onOpenMember} label={staff ? 'Account' : 'Member'} />
      <SetsTable
        sets={data.sets}
        setLabel={setLabel}
        onOpen={onOpenSet}
        title={staff ? 'Team’s sets, all time' : 'Your question sets, all time'}
        hint={staff ? undefined : 'Engage’s and the Public library’s sets are not listed here.'}
        activeVersionOf={activeVersionOf}
      />
      <MonthsTable months={data.months} planWord={staff ? 'from the plan' : 'from your plan'} />
    </>
  );
}

/**
 * The team's own Activity page.
 *
 * @param {string}   orgId     the active organisation
 * @param {string}   orgName   for the file name of the CSV
 * @param {object[]} sets      the console's set list ({id, scope, name, activeVersion})
 */
export default function UsageStatsPanel({ orgId, orgName = '', sets = [], now = new Date() }) {
  const latest = thisMonth(now);
  const [period, setPeriod] = useState(latest);
  const urlFor = useCallback(
    (from, to) => adminApiUrl(`orgs/${encodeURIComponent(orgId)}/stats?from=${from}&to=${to}`),
    [orgId],
  );
  const { data, error, loading } = useStats(urlFor, period);

  const byId = useMemo(() => {
    const map = new Map();
    for (const s of sets || []) if ((s.scope || 'platform') === 'org') map.set(s.id, s);
    return map;
  }, [sets]);
  const setLabel = useCallback((s) => (byId.get(s.setId) && byId.get(s.setId).name) || 'A set no longer in your library', [byId]);
  const activeVersionOf = useCallback((s) => {
    const found = byId.get(s.setId);
    return found && Number.isFinite(Number(found.activeVersion)) ? Number(found.activeVersion) : null;
  }, [byId]);

  const download = () => {
    if (!data) return;
    const safe = String(orgName || 'team').replace(/[^A-Za-z0-9-_]+/g, '-');
    saveFile(`${safe}-activity-${period}.csv`, buildCsv(data, period, { setLabel }));
  };

  return (
    <div className="ust" data-theme="dark">
      <div className="ust-bar">
        <MonthStepper period={period} onChange={setPeriod} latest={latest} />
        <button type="button" className="ust-btn ust-btn--primary" onClick={download} disabled={!data}>Download CSV</button>
      </div>
      {error && <div className="ust-alert" role="alert">{error}</div>}
      {loading && !data && <p className="ust-empty">Gathering the numbers…</p>}
      {data && (
        <TeamStatsBody
          data={data}
          period={period}
          latest={latest}
          setLabel={setLabel}
          activeVersionOf={activeVersionOf}
        />
      )}
    </div>
  );
}

export { saveFile };
