import React, { useCallback, useEffect, useState } from 'react';
import { authFetch } from '../auth/authFetch';
import Icon from './Icon';
import './ObservabilityPanel.css';
import {
  monthLabel, dateLabel, asOfLabel, countLabel,
} from '../utils/statsFormat';
import { PlatformStatsBlock, StaffStatsDrill } from './StaffStatsDrill';

export { monthLabel, dateLabel, countLabel };

/**
 * HOW ENGAGE IS USED, IN NUMBERS — the platform console's Observability page.
 *
 * Built from docs/design/observability/index.html. Engage staff only: the nav
 * lists it in platform mode, and GET /platform/observability re-checks the
 * `admins` group on the server, which is the permission.
 *
 * ── TOTALS, AND NOTHING A TEAM WROTE ───────────────────────────────────────
 *
 * The route returns aggregates only (lambda-functions/admin/orgs/
 * platform-observability.js), and this screen has nowhere to put anything
 * else: no organisation is named, and a team's own categories are one row
 * with one fixed label. That label is printed from `libraryLabel`, not from
 * the row — a server that ever sent a name for that library would still not
 * get it onto this screen.
 *
 * ── TWO KINDS OF NUMBER, AND THE PAGE SAYS WHICH ───────────────────────────
 *
 * The tiles are true right now, read on every load. The month and category
 * tables are COUNTED as things happen, from the day the counters were
 * deployed, so they carry "Counted since …". A month from before that shows
 * dashes, never zeros: "0 sessions in August" is a claim the counters cannot
 * make. A number the server could not read is also a dash, with the reason in
 * the status line above — never a 0.
 *
 * ── WHY TABLES, NOT A CHART, YET ───────────────────────────────────────────
 *
 * On the day this ships the recorded history is one month, and a one-bar
 * chart is a stat tile in costume. The month table is the form until there
 * are months enough for a trend; a chart can sit above it then, and this
 * table stays as its table view.
 */
const API = () => window.API_BASE || '';

const NONE = '—';

/** 6 -> `6.0`. null (no session served anything) -> a dash. */
export function averageLabel(n) {
  return Number.isFinite(n) ? n.toFixed(1) : NONE;
}

/** Which library a category came from. Anything unrecognised is a team's. */
export function libraryLabel(library) {
  if (library === 'platform') return 'Engage';
  if (library === 'public') return 'Public';
  return 'Teams';
}

/** The one label a team's own categories are ever shown under. */
const TEAMS_LABEL = 'Teams’ own sets';

/** What `unavailable[].part` means, for the status line. */
const PART_LABEL = {
  accounts: 'Accounts could not be counted',
  organisations: 'The organisation index could not be read, so organisations, question sets, stored reports and the plan meter are missing',
  recorded: 'The recorded counters could not be read',
  stats: 'The usage stats by type could not be read',
};

const plural = (n, one, many) => `${countLabel(n)} ${n === 1 ? one : many}`;

function Tile({ label, value, sub }) {
  return (
    <div className="pobs-tile">
      <span className="pobs-tile-label">{label}</span>
      <span className="pobs-tile-value">{value}</span>
      <span className="pobs-tile-sub" title={sub}>{sub}</span>
    </div>
  );
}

function Tiles({ now }) {
  const { accounts, organisations: orgs, questionSets: sets, storedReports } = now || {};
  const missing = 'Could not be read';
  return (
    <section className="pobs-tiles" aria-label="Right now">
      <Tile
        label="Accounts"
        value={accounts ? `${countLabel(accounts.count)}${accounts.capped ? '+' : ''}` : NONE}
        sub={accounts ? 'Every sign-in account, any status' : missing}
      />
      <Tile
        label="Organisations"
        value={orgs ? countLabel(orgs.teams + orgs.personal) : NONE}
        sub={orgs ? `${plural(orgs.teams, 'team', 'teams')} · ${plural(orgs.personal, 'personal space', 'personal spaces')}` : missing}
      />
      <Tile
        label="Question sets"
        value={sets ? countLabel(sets.total) : NONE}
        sub={sets ? `${countLabel(sets.platform)} Engage · ${countLabel(sets.public)} public · ${countLabel(sets.org)} teams’ own` : missing}
      />
      <Tile
        label="Stored reports"
        value={Number.isFinite(storedReports) ? countLabel(storedReports) : NONE}
        sub={Number.isFinite(storedReports) ? 'Saved PDFs still kept' : missing}
      />
    </section>
  );
}

function MonthTable({ months, countingSince }) {
  const before = countingSince ? `Not counted — counting began ${dateLabel(countingSince)}` : 'Not counted';
  return (
    <section className="pobs-section" aria-labelledby="pobs-months">
      <h2 className="pobs-h2" id="pobs-months">By month</h2>
      {months.length === 0 ? (
        <p className="pobs-empty">
          Nothing has been counted yet. The first session created on this tier will appear here.
        </p>
      ) : (
        <>
          <p className="pobs-cap">
            {countingSince ? <>Counted since <strong>{dateLabel(countingSince)}</strong>. </> : null}
            “Counted” is sessions that counted toward a team’s plan, summed across organisations.
          </p>
          <div className="pobs-tablewrap">
            <table className="pobs-tbl" aria-labelledby="pobs-months">
              <thead>
                <tr>
                  <th scope="col">Month</th>
                  <th scope="col" className="pobs-col-num pobs-num">Created</th>
                  <th scope="col" className="pobs-col-num pobs-num">Started</th>
                  <th scope="col" className="pobs-col-num pobs-num" title="Counted toward a plan: two questions answered">Counted</th>
                  <th scope="col" className="pobs-col-num pobs-num">Questions</th>
                  <th scope="col" className="pobs-col-num pobs-num">Per session</th>
                  <th scope="col" className="pobs-col-num pobs-num">Answers</th>
                </tr>
              </thead>
              <tbody>
                {months.map((m) => {
                  const r = m.recorded;
                  const cell = (text, title) => (
                    <td className={`pobs-num${text === NONE ? ' pobs-none' : ''}`} title={text === NONE ? title : undefined}>{text}</td>
                  );
                  return (
                    <tr key={m.period}>
                      <td className="pobs-name">{monthLabel(m.period)}</td>
                      {cell(r ? countLabel(r.sessionsCreated) : NONE, before)}
                      {cell(r ? countLabel(r.sessionsStarted) : NONE, before)}
                      {cell(countLabel(m.counted), 'The plan meter could not be read')}
                      {cell(r ? countLabel(r.roundsServed) : NONE, before)}
                      {cell(r ? averageLabel(r.averageRounds) : NONE, r ? 'No session put a question on screen' : before)}
                      {cell(r ? countLabel(r.answersStored) : NONE, before)}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

function CategoryTable({ categories, countingSince }) {
  return (
    <section className="pobs-section" aria-labelledby="pobs-cats">
      <h2 className="pobs-h2" id="pobs-cats">By category</h2>
      {categories.length === 0 ? (
        <p className="pobs-empty">No questions have been asked yet.</p>
      ) : (
        <>
          <p className="pobs-cap">
            {countingSince ? <>Counted since <strong>{dateLabel(countingSince)}</strong>. </> : null}
            Engage’s and the public library’s categories are named. A team’s own categories are theirs, so they are counted together and never named.
          </p>
          <div className="pobs-tablewrap">
            <table className="pobs-tbl" aria-labelledby="pobs-cats">
              <thead>
                <tr>
                  <th scope="col">Category</th>
                  <th scope="col" className="pobs-col-lib">Library</th>
                  <th scope="col" className="pobs-col-num pobs-num">Questions</th>
                  <th scope="col" className="pobs-col-num pobs-num">Answers</th>
                </tr>
              </thead>
              <tbody>
                {categories.map((c) => {
                  const teams = libraryLabel(c.library) === 'Teams';
                  const label = teams ? TEAMS_LABEL : c.label;
                  return (
                    <tr key={`${c.library}:${label}`} className={teams ? 'pobs-row--teams' : undefined}>
                      <td className="pobs-name" title={label}>{label}</td>
                      <td>{libraryLabel(c.library)}</td>
                      <td className="pobs-num">{countLabel(c.rounds)}</td>
                      <td className="pobs-num">{countLabel(c.answers)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

/* The definitions, once, where the numbers are. Every column head above is
   one of these terms. */
const DEFINITIONS = [
  ['Created', 'A host made a session, whether or not it was ever played.'],
  ['Started', 'A session left the lobby — Start, or its first question from the remote. Once per session.'],
  ['Counted', 'Sessions that counted toward a team’s plan that month: two of their questions were answered. Rehearsals and false starts are not here. Summed across every organisation.'],
  ['Questions', 'A question counts when it is put on screen, once per session. Questions a set holds but nobody reached are not counted.'],
  ['Per session', 'Questions ÷ sessions that put at least one question on screen, that month.'],
  ['Answers', 'One per person per question, counted when the host moves on from it. Changing an answer does not count again.'],
];

const thisMonth = () => new Date().toISOString().slice(0, 7);

export default function ObservabilityPanel() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  /* THE USAGE STATS (docs/design/usage-stats, B1–B4): the month the by-type
     block shows, the drill trail (a team, an account, a set — each a place
     of its own), and the teams' names from GET /platform/orgs, joined by id
     because GET /platform/observability names nobody. */
  const [month, setMonth] = useState(thisMonth);
  const [trail, setTrail] = useState([]);
  const [orgNames, setOrgNames] = useState({});

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const current = month === thisMonth();
      const res = await authFetch(`${API()}platform/observability${current ? '' : `?month=${month}`}`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `The server answered ${res.status}.`);
      setData(body);
    } catch (err) {
      setData(null);
      setError(err.message || 'Could not load the numbers.');
    } finally {
      setLoading(false);
    }
  }, [month]);

  useEffect(() => { load(); }, [load]);

  const teamCount = data && data.stats && Array.isArray(data.stats.teams) ? data.stats.teams.length : 0;
  useEffect(() => {
    if (!teamCount || Object.keys(orgNames).length) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const res = await authFetch(`${API()}platform/orgs`);
        const body = await res.json().catch(() => ({}));
        if (cancelled || !res.ok) return;
        setOrgNames(Object.fromEntries((body.orgs || []).map((o) => [o.orgId, o.name || o.orgId])));
      } catch (err) {
        /* Names are a courtesy: the teams still list, by id. */
      }
    })();
    return () => { cancelled = true; };
  }, [teamCount, orgNames]);

  if (trail.length) {
    return (
      <StaffStatsDrill
        trail={trail}
        onTrail={(i) => setTrail((t) => (i < 0 ? [] : t.slice(0, i + 1)))}
        onOpen={(step) => setTrail((t) => [...t, step])}
      />
    );
  }

  const unavailable = (data && Array.isArray(data.unavailable)) ? data.unavailable : [];
  const months = (data && Array.isArray(data.months)) ? data.months : [];
  const categories = (data && Array.isArray(data.categories)) ? data.categories : [];

  return (
    <div className="pobs" data-theme="dark">
      {error && (
        <div className="pobs-alert" role="alert">
          <span className="pobs-alert-text">{error}</span>
        </div>
      )}
      {unavailable.length > 0 && (
        <div className="pobs-alert pobs-alert--partial" role="status">
          <span className="pobs-alert-text">
            {unavailable.map((u) => (
              <span key={u.part} className="pobs-alert-line">
                {PART_LABEL[u.part] || `${u.part} could not be read`}
                {u.reason ? ` (${u.reason})` : ''}.
              </span>
            ))}
          </span>
        </div>
      )}

      <div className="pobs-bar">
        {data && data.generatedAt && <span className="pobs-asof">As of {asOfLabel(data.generatedAt)}</span>}
        <button type="button" className="pobs-btn" onClick={load} disabled={loading}>
          <Icon name="ArrowsClockwise" size={14} />
          Refresh
        </button>
      </div>

      {loading && !data && <p className="pobs-loading">Gathering the numbers…</p>}

      {data && (
        <>
          <Tiles now={data.now} />
          {data.stats && (
            <section className="pobs-section" aria-label="Usage by type">
              <PlatformStatsBlock
                stats={data.stats}
                month={month}
                onMonth={setMonth}
                latest={thisMonth()}
                names={orgNames}
                onOpen={(step) => setTrail([step])}
              />
            </section>
          )}
          <MonthTable months={months} countingSince={data.countingSince} />
          <CategoryTable categories={categories} countingSince={data.countingSince} />
          <section className="pobs-note" aria-labelledby="pobs-defs">
            <h2 className="pobs-h3" id="pobs-defs">What each number means</h2>
            <dl className="pobs-defs">
              {DEFINITIONS.map(([term, meaning]) => (
                <div key={term}>
                  <dt>{term}</dt>
                  <dd>{meaning}</dd>
                </div>
              ))}
            </dl>
          </section>
        </>
      )}
    </div>
  );
}
