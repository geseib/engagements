import React, { useCallback, useEffect, useState } from 'react';
import { authFetch } from '../auth/authFetch';
import Icon from './Icon';
import './ObservabilityPanel.css';

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

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

const NONE = '—';

/** `2026-09` -> `September 2026`. Parsed, never handed to Date: no zone can move it. */
export function monthLabel(period) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(period || ''));
  if (!m) return String(period || '');
  return `${MONTHS[Number(m[2]) - 1] || m[2]} ${m[1]}`;
}

/** An ISO instant -> `23 September 2026`, in UTC, for the reason sinceLabel gives. */
export function dateLabel(iso) {
  const d = new Date(iso);
  if (!iso || Number.isNaN(d.getTime())) return '';
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** An ISO instant -> `14 Nov 2026, 10:42 UTC`. */
function asOfLabel(iso) {
  const d = new Date(iso);
  if (!iso || Number.isNaN(d.getTime())) return '';
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()].slice(0, 3)} ${d.getUTCFullYear()}, ${hh}:${mm} UTC`;
}

/** 4076 -> `4,076`; anything that is not a number is a dash, never a 0. */
export function countLabel(n) {
  return Number.isFinite(n) ? n.toLocaleString('en-GB') : NONE;
}

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
            “Toward plans” is each team’s plan meter, summed across organisations.
          </p>
          <div className="pobs-tablewrap">
            <table className="pobs-tbl" aria-labelledby="pobs-months">
              <thead>
                <tr>
                  <th scope="col">Month</th>
                  <th scope="col" className="pobs-col-num pobs-num">Created</th>
                  <th scope="col" className="pobs-col-num pobs-num">Started</th>
                  <th scope="col" className="pobs-col-num pobs-num" title="Counted toward plans">Toward plans</th>
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
  ['Toward plans', 'What each team’s Plan & usage counted that month, summed across every organisation.'],
  ['Questions', 'A question counts when it is put on screen, once per session. Questions a set holds but nobody reached are not counted.'],
  ['Per session', 'Questions ÷ sessions that put at least one question on screen, that month.'],
  ['Answers', 'One per person per question. Changing an answer does not count again.'],
];

export default function ObservabilityPanel() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await authFetch(`${API()}platform/observability`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `The server answered ${res.status}.`);
      setData(body);
    } catch (err) {
      setData(null);
      setError(err.message || 'Could not load the numbers.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

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
