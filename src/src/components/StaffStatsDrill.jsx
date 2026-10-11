import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { authFetch } from '../auth/authFetch';
import { monthLabel, dateLabel, countLabel } from '../utils/statsFormat';
import {
  MonthStepper, Tile, TypeTable, TeamStatsBody, useStats, addMonths, thisMonth,
  TYPE_LABELS, TYPE_ORDER, buildCsv, saveFile,
} from './UsageStatsPanel';
import './UsageStatsPanel.css';

/**
 * USAGE STATS FOR ENGAGE STAFF (docs/design/usage-stats, mockups B1–B4).
 *
 *   PlatformStatsBlock  on Observability: the month by type, and every team
 *   StaffStatsDrill     one team (B2), one account (B3) or one set (B4)
 *
 * Opening a team, a team's set or an account is written to the audit log by
 * GET /platform/stats BEFORE it answers (owner, SPEC §13 Q3); the blue staff
 * bar says so. A team's sets are "Team set · <ref>": their names are sealed
 * under the team's key and their ids are slugs that can echo a title, so the
 * server never sends either (Q14). Engage's and the Public library's sets are
 * named — that content is plaintext by design.
 */

const API = () => window.API_BASE || '';
const NONE = '—';
const staffUrl = (query) => `${API()}platform/stats?${query}`;
const teamSetLabel = (s) => `Team set · ${s.ref}`;
const LIBRARY_LABEL = { platform: 'Engage library', public: 'Public library', org: 'Team library' };

/** The words for an ISO instant relative to now: "2d", "today". */
function sinceLabel(iso, now = new Date()) {
  const d = new Date(iso);
  if (!iso || Number.isNaN(d.getTime())) return NONE;
  const days = Math.floor((now.getTime() - d.getTime()) / 86400000);
  if (days <= 0) return 'today';
  return `${days}d`;
}
const shortDate = (iso) => {
  const label = dateLabel(iso);
  return label ? label.split(' ').slice(0, 2).map((x, i) => (i === 1 ? x.slice(0, 3) : x)).join(' ') : NONE;
};

/* ======================================================= Observability (B1) */

/**
 * The platform's month by type and the teams beside it. `names` is the
 * console's own list of organisations (GET /platform/orgs), joined by id —
 * GET /platform/observability names nobody.
 */
export function PlatformStatsBlock({
  stats, month, onMonth, latest, names = {}, onOpen,
}) {
  const [tab, setTab] = useState('teams');
  const [find, setFind] = useState('');
  const [library, setLibrary] = useState({ scope: 'platform', sets: null, error: '' });

  useEffect(() => {
    if (tab !== 'sets') return undefined;
    let cancelled = false;
    (async () => {
      try {
        const res = await authFetch(staffUrl(`library=${library.scope}`));
        const body = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) throw new Error(body.error || `The server answered ${res.status}.`);
        setLibrary((l) => ({ ...l, sets: body.sets || [], error: '' }));
      } catch (err) {
        if (!cancelled) setLibrary((l) => ({ ...l, sets: [], error: err.message || 'Could not read the sets.' }));
      }
    })();
    return () => { cancelled = true; };
  }, [tab, library.scope]);

  if (!stats) return null;
  const m = { ...stats, byType: stats.byType || {}, totals: stats.totals || {} };
  const ev = stats.events || {};
  const q = find.trim().toLowerCase();
  const teams = (stats.teams || []).filter((t) => !q || String(names[t.orgId] || t.orgId).toLowerCase().includes(q));
  const sets = (library.sets || []).filter((s) => !q || String(s.name || s.setId).toLowerCase().includes(q));

  const download = () => {
    const rows = [['Section', 'Month', 'Name', 'Created', 'Started', 'Counted', 'Questions', 'Participants', 'Kept', 'Sets']];
    for (const t of TYPE_ORDER) {
      const c = m.byType[t];
      if (c) rows.push(['Type', month, TYPE_LABELS[t], c.created, c.started, t === 'build' ? '' : c.counted, c.questions, c.participants, m.gauge && m.gauge.existing ? m.gauge.existing[t] || 0 : '', '']);
    }
    rows.push(['All types', month, 'All types', m.totals.created, m.totals.started, m.totals.counted, m.totals.questions, m.totals.participants, m.gauge ? m.gauge.kept : '', m.gauge ? m.gauge.setsHeld : '']);
    for (const t of stats.teams || []) {
      rows.push(['Team', month, names[t.orgId] || t.orgId, t.totals.created, t.totals.started, t.totals.counted, t.totals.questions, t.totals.participants, t.kept ?? '', t.sets ?? '']);
    }
    if (stats.noTeam) rows.push(['No team', month, 'No team', stats.noTeam.created, stats.noTeam.started, stats.noTeam.counted, stats.noTeam.questions, stats.noTeam.participants, '', '']);
    const csv = `${rows.map((r) => r.map((v) => (/[",\n]/.test(String(v ?? '')) ? `"${String(v).replace(/"/g, '""')}"` : String(v ?? ''))).join(',')).join('\n')}\n`;
    saveFile(`engage-usage-${month}.csv`, csv);
  };

  return (
    <div className="ust" data-theme="dark">
      <div className="ust-bar">
        <MonthStepper period={month} onChange={onMonth} latest={latest} />
        <button type="button" className="ust-btn ust-btn--primary" onClick={download}>Download CSV</button>
      </div>
      {m.recorded ? (
        <>
          <div className="ust-tiles">
            <Tile label="Sessions counted" value={countLabel(m.totals.counted)} sub={`${countLabel(m.totals.created)} created · ${countLabel(m.totals.started)} started`} />
            <Tile label="Questions asked" value={countLabel(m.totals.questions)} sub={m.byType.build && m.byType.build.questions ? `incl. ${countLabel(m.byType.build.questions)} Build Room asks` : 'put to the room'} />
            <Tile label="Participants" value={countLabel(m.totals.participants)} sub="one per person per session" />
            <Tile label="Sessions kept" value={m.gauge ? countLabel(m.gauge.kept) : NONE} sub={m.gauge && Number.isFinite(m.gauge.teams) ? `in ${countLabel(m.gauge.teams)} teams` : 'counted daily'} />
            <Tile label="Events run" value={countLabel(ev.started)} sub={`${countLabel(ev.participants)} registered`} />
          </div>
          <TypeTable month={m} caption="Platform by type" />
        </>
      ) : <p className="ust-empty">Nothing was counted in {monthLabel(month)}.</p>}

      <section className="ust-blk" aria-label="Teams and sets">
        <div className="ust-h2row">
          <h2 className="ust-h2">{tab === 'teams' ? 'Teams this month' : 'Sets, all time'}</h2>
          <p className="ust-hint">{tab === 'teams' ? 'Most counted first. Open one to see its numbers.' : 'Engage’s and the Public library’s sets, by use.'}</p>
        </div>
        <div className="ust-search">
          <input
            className="ust-input"
            value={find}
            onChange={(e) => setFind(e.target.value)}
            placeholder={tab === 'teams' ? 'Find a team by name' : 'Find a set by name'}
            aria-label={tab === 'teams' ? 'Find a team by name' : 'Find a set by name'}
          />
          <span className="ust-seg" role="group" aria-label="Show">
            <button type="button" aria-pressed={tab === 'teams'} onClick={() => setTab('teams')}>Teams</button>
            <button type="button" aria-pressed={tab === 'sets' && library.scope === 'platform'} onClick={() => { setTab('sets'); setLibrary({ scope: 'platform', sets: null, error: '' }); }}>Engage sets</button>
            <button type="button" aria-pressed={tab === 'sets' && library.scope === 'public'} onClick={() => { setTab('sets'); setLibrary({ scope: 'public', sets: null, error: '' }); }}>Public sets</button>
          </span>
        </div>
        {tab === 'teams' ? (
          <table className="ust-tbl" aria-label="Teams this month">
            <colgroup><col className="ust-col-name" /><col /><col /><col /><col /><col /></colgroup>
            <thead>
              <tr>
                <th scope="col">Team</th>
                <th scope="col" className="ust-n">Counted</th>
                <th scope="col" className="ust-n">Questions</th>
                <th scope="col" className="ust-n">Participants</th>
                <th scope="col" className="ust-n">Kept today</th>
                <th scope="col" className="ust-n">Sets</th>
              </tr>
            </thead>
            <tbody>
              {teams.map((t) => {
                const name = names[t.orgId] || t.orgId;
                return (
                  <tr key={t.orgId}>
                    <td className="ust-first" title={name}>
                      <button type="button" className="ust-link" onClick={() => onOpen({ kind: 'org', id: t.orgId, label: name })}>{name}</button>
                    </td>
                    <td className="ust-n" data-l="Counted">{countLabel(t.totals.counted)}</td>
                    <td className="ust-n" data-l="Questions">{countLabel(t.totals.questions)}</td>
                    <td className="ust-n" data-l="Participants">{countLabel(t.totals.participants)}</td>
                    <td className="ust-n" data-l="Kept today">{Number.isFinite(t.kept) ? countLabel(t.kept) : NONE}</td>
                    <td className="ust-n" data-l="Sets">{countLabel(t.sets)}</td>
                  </tr>
                );
              })}
              {!q && stats.noTeam && (stats.noTeam.created || stats.noTeam.questions || stats.noTeam.participants) ? (
                <tr>
                  <td className="ust-first"><span className="ust-dim">No team</span></td>
                  <td className="ust-n" data-l="Counted">{countLabel(stats.noTeam.counted)}</td>
                  <td className="ust-n" data-l="Questions">{countLabel(stats.noTeam.questions)}</td>
                  <td className="ust-n" data-l="Participants">{countLabel(stats.noTeam.participants)}</td>
                  <td className="ust-n" data-l="Kept today"><span className="ust-dim">{NONE}</span></td>
                  <td className="ust-n" data-l="Sets"><span className="ust-dim">{NONE}</span></td>
                </tr>
              ) : null}
            </tbody>
          </table>
        ) : (
          <>
            {library.error && <div className="ust-alert" role="alert">{library.error}</div>}
            {library.sets === null && <p className="ust-empty">Reading the sets…</p>}
            {library.sets && !sets.length && !library.error && <p className="ust-empty">No set in this library has been used yet.</p>}
            {sets.length > 0 && (
              <table className="ust-tbl" aria-label="Sets, all time">
                <colgroup><col className="ust-col-name" /><col /><col /><col /><col /></colgroup>
                <thead>
                  <tr>
                    <th scope="col">Set</th>
                    <th scope="col" className="ust-n">Used</th>
                    <th scope="col" className="ust-n">Questions</th>
                    <th scope="col" className="ust-n">Copied</th>
                    <th scope="col" className="ust-n">Downloaded</th>
                  </tr>
                </thead>
                <tbody>
                  {sets.map((s) => (
                    <tr key={s.setId}>
                      <td className="ust-first" title={s.name || s.setId}>
                        <button type="button" className="ust-link" onClick={() => onOpen({ kind: 'set', id: `${library.scope}::${s.setId}`, label: s.name || s.setId })}>{s.name || s.setId}</button>
                      </td>
                      <td className="ust-n" data-l="Used">{countLabel(s.total.sessions)}</td>
                      <td className="ust-n" data-l="Questions">{countLabel(s.total.questions)}</td>
                      <td className="ust-n" data-l="Copied">{countLabel(s.total.copies)}</td>
                      <td className="ust-n" data-l="Downloaded">{countLabel(s.total.downloads)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
      </section>
    </div>
  );
}

/* ================================================================ one team */

function TeamDrill({ id, onOpen, latest }) {
  const [period, setPeriod] = useState(latest);
  const urlFor = useCallback((from, to) => staffUrl(`org=${encodeURIComponent(id)}&from=${from}&to=${to}`), [id]);
  const { data, error, loading } = useStats(urlFor, period);
  const org = (data && data.org) || {};
  const name = org.name || id;
  const download = () => data && saveFile(`${name.replace(/[^A-Za-z0-9-_]+/g, '-')}-activity-${period}.csv`, buildCsv(data, period, { setLabel: teamSetLabel }));
  return (
    <>
      <div className="ust-staffbar"><b>Viewing as Engage staff.</b> This visit is recorded in {data ? name : 'this team'}’s audit log. Counts only.</div>
      <div className="ust-head">
        <div className="ust-head-t">
          <h2 className="ust-title">{name}</h2>
          {data && <p className="ust-sub">{org.plan ? `${org.plan[0].toUpperCase()}${org.plan.slice(1)} plan` : 'Team'} · {countLabel((data.members || []).length)} members{org.createdAt ? ` · since ${monthLabel(String(org.createdAt).slice(0, 7))}` : ''}</p>}
        </div>
        <div className="ust-bar">
          <MonthStepper period={period} onChange={setPeriod} latest={latest} />
          <button type="button" className="ust-btn ust-btn--primary" onClick={download} disabled={!data}>Download CSV</button>
        </div>
      </div>
      {error && <div className="ust-alert" role="alert">{error}</div>}
      {loading && !data && <p className="ust-empty">Gathering the numbers…</p>}
      {data && (
        <TeamStatsBody
          data={data}
          period={period}
          latest={latest}
          staff
          setLabel={teamSetLabel}
          onOpenMember={(m) => onOpen({ kind: 'user', id: m.userId, label: m.displayName || m.email || m.userId })}
          onOpenSet={(s) => onOpen({ kind: 'set', id: `org:${id}:${s.ref}`, label: teamSetLabel(s) })}
        />
      )}
    </>
  );
}

/* ============================================================= one account */

function AccountDrill({ id, latest }) {
  const [period, setPeriod] = useState(latest);
  const urlFor = useCallback((from, to) => staffUrl(`user=${encodeURIComponent(id)}&from=${from}&to=${to}`), [id]);
  const { data, error, loading } = useStats(urlFor, period);
  const names = useMemo(() => Object.fromEntries(((data && data.teams) || []).map((t) => [t.orgId, t.orgId ? (t.name || t.orgId) : 'Personal'])), [data]);
  const month = data && (data.months || []).find((m) => m.period === period);
  const rows = [];
  const total = { created: 0, counted: 0, questions: 0, participants: 0, kept: 0 };
  for (const t of (month && month.teams) || []) {
    for (const type of TYPE_ORDER) {
      const c = t.byType && t.byType[type];
      if (!c) continue;
      const kept = t.gauge && t.gauge.existing ? t.gauge.existing[type] || 0 : null;
      rows.push({ key: `${t.orgId}:${type}`, label: `${names[t.orgId] || 'Personal'} · ${TYPE_LABELS[type]}`, type, c, kept });
      total.created += c.created; total.questions += c.questions; total.participants += c.participants;
      if (type !== 'build') total.counted += c.counted;
      total.kept += kept || 0;
    }
  }
  const account = (data && data.account) || {};
  const download = () => {
    const lines = [['Team · type', 'Created', 'Counted', 'Questions', 'Participants', 'Kept'].join(',')];
    for (const r of rows) lines.push([`"${r.label.replace(/"/g, '""')}"`, r.c.created, r.type === 'build' ? '' : r.c.counted, r.c.questions, r.c.participants, r.kept ?? ''].join(','));
    saveFile(`account-${period}.csv`, `${lines.join('\n')}\n`);
  };
  return (
    <>
      <div className="ust-staffbar"><b>Viewing as Engage staff.</b> This visit is recorded in the audit log. Counts only.</div>
      <div className="ust-head">
        <div className="ust-head-t">
          <h2 className="ust-title">{account.displayName || account.email || id}</h2>
          {account.email && <p className="ust-sub">{account.email}</p>}
        </div>
        <div className="ust-bar">
          <MonthStepper period={period} onChange={setPeriod} latest={latest} />
          <button type="button" className="ust-btn ust-btn--primary" onClick={download} disabled={!data}>Download CSV</button>
        </div>
      </div>
      {error && <div className="ust-alert" role="alert">{error}</div>}
      {loading && !data && <p className="ust-empty">Gathering the numbers…</p>}
      {data && (rows.length ? (
        <section className="ust-blk" aria-label="By team and type">
          <h2 className="ust-h2">By team and type</h2>
          <table className="ust-tbl">
            <colgroup><col className="ust-col-name" /><col /><col /><col /><col /><col /></colgroup>
            <thead>
              <tr>
                <th scope="col">Team · type</th>
                <th scope="col" className="ust-n">Created</th>
                <th scope="col" className="ust-n">Counted</th>
                <th scope="col" className="ust-n">Questions</th>
                <th scope="col" className="ust-n">Participants</th>
                <th scope="col" className="ust-n">Kept today</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key}>
                  <td className="ust-first" title={r.label}>{r.label}</td>
                  <td className="ust-n" data-l="Created">{countLabel(r.c.created)}</td>
                  <td className="ust-n" data-l="Counted">{r.type === 'build' ? <span className="ust-dim">{NONE}</span> : countLabel(r.c.counted)}</td>
                  <td className="ust-n" data-l={r.type === 'build' ? 'Asks' : 'Questions'}>{countLabel(r.c.questions)}</td>
                  <td className="ust-n" data-l="Participants">{countLabel(r.c.participants)}</td>
                  <td className="ust-n" data-l="Kept today">{Number.isFinite(r.kept) ? countLabel(r.kept) : NONE}</td>
                </tr>
              ))}
              <tr className="ust-tot">
                <td className="ust-first">All</td>
                <td className="ust-n" data-l="Created">{countLabel(total.created)}</td>
                <td className="ust-n" data-l="Counted">{countLabel(total.counted)}</td>
                <td className="ust-n" data-l="Questions">{countLabel(total.questions)}</td>
                <td className="ust-n" data-l="Participants">{countLabel(total.participants)}</td>
                <td className="ust-n" data-l="Kept today">{countLabel(total.kept)}</td>
              </tr>
            </tbody>
          </table>
        </section>
      ) : <p className="ust-empty">Nothing ran in {monthLabel(period)}.</p>)}
    </>
  );
}

/* ================================================================= one set */

function SetDrill({ id, now }) {
  const [state, setState] = useState({ data: null, error: '' });
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await authFetch(staffUrl(`set=${encodeURIComponent(id)}`));
        const body = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) throw new Error(body.error || `The server answered ${res.status}.`);
        setState({ data: body, error: '' });
      } catch (err) {
        if (!cancelled) setState({ data: null, error: err.message || 'Could not read the set.' });
      }
    })();
    return () => { cancelled = true; };
  }, [id]);
  const set = state.data && state.data.set;
  const title = set ? (set.scope === 'org' ? teamSetLabel(set) : (set.name || set.setId)) : '';
  const perSession = set && set.total.sessions ? (set.total.questions / set.total.sessions).toFixed(1) : null;
  const subParts = set ? [
    set.scope === 'org' && state.data.org ? `${state.data.org.name || 'A team'}’s library` : LIBRARY_LABEL[set.scope],
    set.engagementType ? TYPE_LABELS[set.engagementType] || set.engagementType : '',
    set.activeVersion ? `active version v${set.activeVersion}` : '',
  ].filter(Boolean) : [];
  const download = () => {
    if (!set) return;
    const lines = ['Version,Used in sessions,Questions asked,Copied,Downloaded,Last used'];
    for (const v of set.versions) lines.push([v.version || 'none', v.sessions, v.questions, v.copies, v.downloads, v.lastAt || ''].join(','));
    lines.push(['All versions', set.total.sessions, set.total.questions, set.total.copies, set.total.downloads, set.total.lastAt || ''].join(','));
    saveFile(`set-${set.scope}-${set.setId || set.ref}.csv`, `${lines.join('\n')}\n`);
  };
  return (
    <>
      {set && set.scope === 'org' && (
        <div className="ust-staffbar"><b>Viewing as Engage staff.</b> This visit is recorded in the team’s audit log. Its name is the team’s and is not shown.</div>
      )}
      <div className="ust-head">
        <div className="ust-head-t">
          <h2 className="ust-title">{title || 'Set'}</h2>
          {subParts.length > 0 && <p className="ust-sub">{subParts.join(' · ')}</p>}
        </div>
        <div className="ust-bar">
          <span />
          <button type="button" className="ust-btn ust-btn--primary" onClick={download} disabled={!set}>Download CSV</button>
        </div>
      </div>
      {state.error && <div className="ust-alert" role="alert">{state.error}</div>}
      {!set && !state.error && <p className="ust-empty">Gathering the numbers…</p>}
      {set && (
        <>
          <div className="ust-tiles">
            <Tile label="Used in sessions" value={countLabel(set.total.sessions)} sub="sessions that asked from it" />
            <Tile label="Questions asked" value={countLabel(set.total.questions)} sub={perSession ? `${perSession} a session` : 'none yet'} />
            <Tile label="Copied" value={countLabel(set.total.copies)} sub="into team libraries" />
            <Tile label="Downloaded" value={countLabel(set.total.downloads)} sub="as CSV or JSON" />
            <Tile label="Last used" value={set.total.lastAt ? sinceLabel(set.total.lastAt, now) : NONE} sub={set.total.lastAt ? dateLabel(set.total.lastAt) : 'never'} />
          </div>
          <section className="ust-blk" aria-label="By version, all time">
            <h2 className="ust-h2">By version, all time</h2>
            {set.versions.length === 0 ? <p className="ust-empty">Nothing has been counted for this set yet.</p> : (
              <table className="ust-tbl">
                <colgroup><col className="ust-col-name" /><col /><col /><col /><col /><col /></colgroup>
                <thead>
                  <tr>
                    <th scope="col">Version</th>
                    <th scope="col" className="ust-n">Used</th>
                    <th scope="col" className="ust-n">Questions</th>
                    <th scope="col" className="ust-n">Copied</th>
                    <th scope="col" className="ust-n">Downloaded</th>
                    <th scope="col" className="ust-n">Last used</th>
                  </tr>
                </thead>
                <tbody>
                  {set.versions.map((v) => (
                    <tr key={v.version}>
                      <td className="ust-first">{v.version ? `v${v.version}` : 'no versions'}{set.activeVersion === v.version && <span className="ust-dim"> (active)</span>}</td>
                      <td className="ust-n" data-l="Used">{countLabel(v.sessions)}</td>
                      <td className="ust-n" data-l="Questions">{countLabel(v.questions)}</td>
                      <td className="ust-n" data-l="Copied">{countLabel(v.copies)}</td>
                      <td className="ust-n" data-l="Downloaded">{countLabel(v.downloads)}</td>
                      <td className="ust-n" data-l="Last used">{v.lastAt ? shortDate(v.lastAt) : NONE}</td>
                    </tr>
                  ))}
                  {set.versions.length > 1 && (
                    <tr className="ust-tot">
                      <td className="ust-first">All versions</td>
                      <td className="ust-n" data-l="Used">{countLabel(set.total.sessions)}</td>
                      <td className="ust-n" data-l="Questions">{countLabel(set.total.questions)}</td>
                      <td className="ust-n" data-l="Copied">{countLabel(set.total.copies)}</td>
                      <td className="ust-n" data-l="Downloaded">{countLabel(set.total.downloads)}</td>
                      <td className="ust-n" data-l="Last used">{set.total.lastAt ? shortDate(set.total.lastAt) : NONE}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}
          </section>
        </>
      )}
    </>
  );
}

/**
 * One drill place. `trail` is the path here (Observability › team › account);
 * `onTrail(i)` goes back to step i (-1 is Observability itself); `onOpen`
 * pushes the next step.
 */
export function StaffStatsDrill({
  trail, onTrail, onOpen, now = new Date(),
}) {
  const latest = thisMonth(now);
  const here = trail[trail.length - 1];
  return (
    <div className="ust" data-theme="dark">
      <nav className="ust-crumb" aria-label="Where you are">
        <button type="button" className="ust-link" onClick={() => onTrail(-1)}>Observability</button>
        {trail.map((step, i) => (
          <span key={`${step.kind}:${step.id}`}>
            {' › '}
            {i < trail.length - 1
              ? <button type="button" className="ust-link" onClick={() => onTrail(i)}>{step.label}</button>
              : <span aria-current="page">{step.label}</span>}
          </span>
        ))}
      </nav>
      {here.kind === 'org' && <TeamDrill key={here.id} id={here.id} onOpen={onOpen} latest={latest} />}
      {here.kind === 'user' && <AccountDrill key={here.id} id={here.id} latest={latest} />}
      {here.kind === 'set' && <SetDrill key={here.id} id={here.id} now={now} />}
    </div>
  );
}

export { addMonths };
export default StaffStatsDrill;
