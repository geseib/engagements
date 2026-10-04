/**
 * BUILD ROOM — the report (PLAN §8, storyboard frame 7).
 *
 * Paper, like components/GameReport.jsx: `data-theme="light"` on its own root,
 * because a report is read and printed, not projected. Its own scope, `.brr`,
 * in BuildReport.css.
 *
 * The order is the order a reader needs: what we wanted, what we got, how we
 * decided, then the full record. Each decision shows the room's numbers AND
 * the host's direction, because the two often differ and the difference is the
 * useful part.
 *
 * CREW MODE adds "Who built what" (docs/design/build-room-crew/FLOWS.md F10,
 * storyboard frame 10): builders are named, because their work is theirs; the
 * room stays a count. It reads `state.crew`, which GET build/state carries as
 * `crewView(room, 'host')` (lambda-functions/game/build-crew.js).
 *
 * SAVED LIKE ANY SESSION'S REPORT (2026-10-04). It used to be print-only, so
 * it lasted exactly as long as the room's rows (7 days from start) and never
 * reached Reports. Save report keeps it as a PDF for 90 days or a year through
 * the same save-report route and helper the session report uses
 * (utils/saveReport.js): one report per room, a link and a passkey
 * (ReportSavedDialog), listed in Reports as a Build Room. The keep choice is
 * inline in the bar, not a dialog over the report it is about.
 *
 * Otherwise a pure function of HostState (build-store.js `hostView`). Host notes are
 * left out: a `note` is never shown to the room, and a report gets handed
 * round. Everything Claude or a phone wrote renders as text; links only when
 * http(s).
 */
import React, { useState } from 'react';
import BuildImage from './BuildImage';
import Icon from '../components/Icon';
import ReportSavedDialog from '../components/ReportSavedDialog';
import { saveReportPdf } from '../utils/saveReport';
import { unexpectedSaveMessage } from '../config/reportPdf';
import { safeHref, apiBase } from './buildHostApi';
import './BuildReport.css';

const KIND_LABEL = { suggest: 'Ideas', choice: 'Choose', rating: 'Rate 1–5' };
const IDEA_STATUS = { new: 'New', promoted: 'Used', dismissed: 'Dismissed' };

function when(iso, opts) {
  const t = Date.parse(iso || '');
  if (!Number.isFinite(t)) return '';
  return new Date(t).toLocaleString([], opts);
}
const hhmm = (iso) => when(iso, { hour: '2-digit', minute: '2-digit' });

function whoLabel(entry) {
  if (entry.by === 'agent') return 'Claude';
  if (entry.by === 'system') return 'System';
  if (entry.by === 'room') return 'Room';
  if (entry.by === 'builder') return entry.name || 'Builder';
  return 'Host';
}

function Link({ href, children }) {
  const url = safeHref(href);
  if (!url) return children || null;
  return <a href={url} target="_blank" rel="noopener noreferrer">{children || url}</a>;
}

function Results({ ask }) {
  const r = ask.results || {};
  if (ask.kind === 'choice') {
    const opts = [...(r.options || [])].sort((a, b) => b.count - a.count);
    return opts.map((o) => (
      <div className="brr-pres" key={o.label}>
        <span className="brr-pl">{o.label}</span>
        <span>{o.title}<span className="brr-pb" aria-hidden="true"><i style={{ width: `${o.pct}%` }} /></span></span>
        <span className="brr-pn">{o.count} · {o.pct}%</span>
      </div>
    ));
  }
  if (ask.kind === 'rating') {
    const rating = r.rating || { avg: null, count: 0, dist: [] };
    return (
      <div className="brr-pres">
        <span className="brr-pl">{rating.avg === null || rating.avg === undefined ? '–' : rating.avg}</span>
        <span>
          average · {(rating.dist || []).map((n, i) => `${i + 1}: ${n}`).join(' · ')}
          <span className="brr-pb" aria-hidden="true"><i style={{ width: `${((rating.avg || 0) / 5) * 100}%` }} /></span>
        </span>
        <span className="brr-pn">{rating.count || 0} rated</span>
      </div>
    );
  }
  const ranked = r.ranked || [];
  const max = Math.max(1, ...ranked.map((x) => x.votes || 0));
  return ranked.slice(0, 8).map((x, i) => (
    <div className="brr-pres" key={x.respId}>
      <span className="brr-pl">{i + 1}</span>
      <span>{x.text}<span className="brr-pb" aria-hidden="true"><i style={{ width: `${((x.votes || 0) / max) * 100}%` }} /></span></span>
      <span className="brr-pn">{x.votes || 0} votes</span>
    </div>
  ));
}

const LANE_WORD = { shared: 'Early look', reviewed: 'Reviewed', pr: 'Pull request open', merged: 'Merged', 'not-now': 'Not now' };
const RECOMMENDATION_WORD = { merge: 'ready to merge', 'merge-after-changes': 'merge after changes', 'not-yet': 'not yet' };
const short = (c) => String(c || '').slice(0, 7);
const n = (count, one, many) => `${count} ${count === 1 ? one : many}`;

/** A repo as people say it: github.com/george/foodbank. */
const repoLabel = (url) => String(url || '').replace(/^https?:\/\//, '').replace(/\.git$/, '');

function EarlyLookRow({ share, builderBranch }) {
  const versions = share.versions || [];
  const last = versions[versions.length - 1] || { imageIds: [] };
  const branch = last.branch && last.branch !== builderBranch ? last.branch : '';
  const review = (share.reviews || []).length ? share.reviews[share.reviews.length - 1] : null;
  const rx = share.reactions || {};
  return (
    <li className="brr-look">
      <div className="brr-look-h">
        <b>{share.title}</b>
        <span className="brr-dim">
          {' · '}{n(versions.length, 'version', 'versions')}
          {' · '}{LANE_WORD[share.lane] || share.lane}
          {share.lane === 'merged' && share.mergedCommit ? <> at <span className="brr-mono">{short(share.mergedCommit)}</span></> : null}
        </span>
        {branch ? <span className="brr-dim"> · branch <span className="brr-mono">{branch}</span></span> : null}
        {share.prUrl ? <span className="brr-block brr-small"><Link href={share.prUrl}>Pull request</Link></span> : null}
      </div>
      {(last.imageIds || []).length > 0 && (
        <div className="brr-shots">
          {last.imageIds.map((id) => <BuildImage key={id} imageId={id} caption={`${share.title}, v${last.v}`} className="brr-shot" linked={false} />)}
        </div>
      )}
      <p className="brr-small brr-rx">
        Room: Looks right {rx['looks-right'] || 0} · Question {rx.question || 0} · Concern {rx.concern || 0}
        {review ? <> · Claude&apos;s review: <b>{RECOMMENDATION_WORD[review.recommendation] || review.recommendation}</b></> : null}
      </p>
    </li>
  );
}

function WhoBuiltWhat({ crew }) {
  const builders = crew.builders || [];
  const tasks = crew.tasks || [];
  const shares = crew.shares || [];
  return (
    <section aria-labelledby="brr-crew">
      <h2 id="brr-crew">Who built what</h2>
      <p className="brr-small">
        <b>The base branch:</b> {crew.baseBranch || 'not named'}
        {crew.repoUrl ? <> on <Link href={crew.repoUrl}>{repoLabel(crew.repoUrl)}</Link></> : null}
        {crew.baseCommit ? <> · final commit <span className="brr-mono">{short(crew.baseCommit)}</span></> : null}
      </p>
      {builders.map((b) => {
        const theirs = shares.filter((s) => s.builder === b.name);
        const took = tasks.filter((t) => (t.claimedBy || []).includes(b.name));
        const merged = theirs.filter((s) => s.lane === 'merged').length;
        return (
          <div className="brr-builder" key={b.name}>
            <div className="brr-dh">
              <b>{b.name}</b>
              <span>
                {b.branch ? <>branch <span className="brr-mono">{b.branch}</span></> : 'no branch reported'}
              </span>
            </div>
            <p className="brr-small brr-dim">
              {n(theirs.length, 'early look', 'early looks')} · {merged} merged
            </p>
            <p className="brr-small">
              <b>Tasks:</b> {took.length ? took.map((t) => t.text).join(', ') : 'none taken'}
            </p>
            {theirs.length ? (
              <ul className="brr-looks">{theirs.map((s) => <EarlyLookRow key={s.shareId} share={s} builderBranch={b.branch} />)}</ul>
            ) : <p className="brr-dim brr-small">Shared nothing yet.</p>}
          </div>
        );
      })}
      <p className="brr-dim brr-small">Commits are pointers. Engage holds no source code; the code lives in git.</p>
    </section>
  );
}

function Decision({ ask }) {
  const r = ask.results || {};
  // Answered FOR the room (people talked instead of tapping): say so, rather
  // than "0 answered", which reads as a room with no view.
  const spokenOnly = Boolean(ask.decision && ask.decision.spoken) && !(r.total || (ask.responses || []).length);
  const counted = spokenOnly ? 'answered out loud' : ask.kind === 'suggest'
    ? `${(ask.responses || []).length} suggestions · ${r.total || 0} voted`
    : `${r.total || 0} answered`;
  const whys = r.whys || [];
  return (
    <div className="brr-dec">
      <div className="brr-dh">
        <b>Ask {Number(ask.askId) || ask.askId} · {ask.prompt}</b>
        <span>
          {KIND_LABEL[ask.kind]} · {ask.source === 'agent' ? 'Claude asked' : 'host asked'} · {counted}
          {ask.decidedAt ? ` · decided ${hhmm(ask.decidedAt)}` : ` · ${ask.status === 'results' ? 'closed, not decided' : ask.status}`}
        </span>
      </div>
      {ask.detail && <p className="brr-detail">{ask.detail}</p>}
      {ask.kind === 'choice' && (ask.options || []).some((o) => o.imageId) && (
        <div className="brr-shots">
          {ask.options.filter((o) => o.imageId).map((o) => (
            <BuildImage key={o.label} imageId={o.imageId} caption={`Choice ${o.label}: ${o.title}`} className="brr-shot" linked={false} />
          ))}
        </div>
      )}
      <Results ask={ask} />
      {whys.length > 0 && (
        <ul className="brr-whys">
          {whys.map((w, i) => (
            <li key={i}><b>{w.label}</b> {w.text}{w.playerName ? <span className="brr-dim"> · {w.playerName}</span> : null}</li>
          ))}
        </ul>
      )}
      {ask.decision && (
        <div className="brr-direction">
          <b>Direction:</b> {ask.decision.direction}
          {ask.decision.chosen && ask.decision.chosen.length > 0 && ask.kind === 'choice' && (
            <span className="brr-dim"> · chosen {ask.decision.chosen.join(', ')}</span>
          )}
          {ask.decision.note && <div className="brr-note"><b>The room also said:</b> {ask.decision.note}</div>}
        </div>
      )}
    </div>
  );
}

export default function BuildReport({ state, onBack }) {
  const s = state || {};
  const [choosing, setChoosing] = useState(false);
  const [keepYear, setKeepYear] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(null);
  const [saveError, setSaveError] = useState('');

  const save = async () => {
    if (saving || !s.gameId) return;
    setSaving(true);
    setSaveError('');
    try {
      const result = await saveReportPdf({
        element: document.querySelector('.brr-sheet'),
        gameId: s.gameId,
        title: s.title || 'Build Room',
        permanent: keepYear,
        apiBase: apiBase(),
      });
      setChoosing(false);
      setSaved(result);
    } catch (err) {
      setSaveError((err && err.hostMessage) || unexpectedSaveMessage(err));
    } finally {
      setSaving(false);
    }
  };
  const log = (s.log || []).filter((l) => l.kind !== 'note');
  const asks = (s.asks || []).filter((a) => !['proposed', 'discarded'].includes(a.status));
  const ideas = s.ideas || [];
  const players = s.players || [];
  const outcome = s.outcome;
  const checkpoints = log.filter((l) => l.kind === 'checkpoint');
  const images = s.images || [];
  const finals = images.filter((i) => i.kind === 'final');
  // Mockups already show on their decision; everything else is the journey.
  const others = images.filter((i) => i.kind !== 'final' && !(i.askId && i.label));
  const times = (s.log || []).map((l) => Date.parse(l.createdAt || '')).filter(Number.isFinite).sort((a, b) => a - b);
  const first = times.length ? new Date(times[0]).toISOString() : null;
  const last = times.length ? new Date(times[times.length - 1]).toISOString() : null;
  const date = first ? when(first, { day: 'numeric', month: 'long', year: 'numeric' }) : '';

  return (
    <div className="brr" data-theme="light">
      <div className="brr-printbar">
        {onBack && (
          <button type="button" className="brr-btn brr-btn--ghost" onClick={onBack}>
            <Icon name="ArrowLeft" size={14} /> Back to room
          </button>
        )}
        <button type="button" className="brr-btn brr-btn--ghost" onClick={() => window.print()}>
          <Icon name="Printer" size={14} /> Print
        </button>
        {s.gameId && (
          <button
            type="button"
            className="brr-btn"
            onClick={() => { setSaveError(''); setChoosing(true); }}
            disabled={saving || choosing}
            aria-expanded={choosing}
            aria-controls="brr-keep"
          >
            <Icon name="FloppyDisk" size={14} /> {saving ? 'Saving…' : 'Save report'}
          </button>
        )}
      </div>
      {choosing && (
        <div className="brr-keep" id="brr-keep" role="group" aria-labelledby="brr-keep-q">
          <p className="brr-keep-q" id="brr-keep-q">How long should it be kept? It is listed in Reports either way.</p>
          <label className="brr-keep-opt">
            <input type="radio" name="brr-keep" checked={!keepYear} onChange={() => setKeepYear(false)} />
            <span><b>Keep for 90 days</b> Deleted automatically 90 days after you save it.</span>
          </label>
          <label className="brr-keep-opt">
            <input type="radio" name="brr-keep" checked={keepYear} onChange={() => setKeepYear(true)} />
            <span><b>Keep for 1 year</b> Deleted automatically a year after you save it.</span>
          </label>
          <div className="brr-keep-acts">
            <button type="button" className="brr-btn brr-btn--ghost" onClick={() => setChoosing(false)} disabled={saving}>Cancel</button>
            <button type="button" className="brr-btn" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
          </div>
          {saveError && <p className="brr-keep-err" role="alert">{saveError}</p>}
        </div>
      )}
      {saved && (
        <ReportSavedDialog saved={saved} gameId={s.gameId} onClose={() => setSaved(null)} />
      )}
      <article className="brr-sheet">
        <div className="brr-kick">Build Room report{date ? ` · ${date}` : ''}{first ? ` · ${hhmm(first)}–${hhmm(last)}` : ''}</div>
        <h1>{s.title || 'Build Room'}</h1>
        <div className="brr-meta">
          {s.playerCount || players.length} people · {s.agent?.name || 'Claude Code'} · {asks.length} asks · {log.length} timeline entries · code {s.gameId}
        </div>
        {s.goal && <div className="brr-goal"><span className="brr-lbl">Goal</span>{s.goal}</div>}

        <section aria-labelledby="brr-built">
          <h2 id="brr-built">What we built</h2>
          {outcome ? (
            <>
              <p className="brr-summary">{outcome.summary}</p>
              {finals.length > 0 && (
                <div className="brr-shots brr-shots--final">
                  {finals.map((im) => <BuildImage key={im.imageId} imageId={im.imageId} caption={im.caption} className="brr-shot" linked={false} />)}
                </div>
              )}
              <p className="brr-dim brr-small">{outcome.by === 'agent' ? 'Written by Claude at wrap-up' : 'Written by the host'}{outcome.updatedAt ? ` · ${hhmm(outcome.updatedAt)}` : ''}</p>
              <div className="brr-twocol">
                {outcome.built.length > 0 && (
                  <div><b className="brr-small">Built</b><ul>{outcome.built.map((b) => <li key={b}>{b}</li>)}</ul></div>
                )}
                <div>
                  {outcome.nextSteps.length > 0 && (
                    <><b className="brr-small">Next steps</b><ul>{outcome.nextSteps.map((b) => <li key={b}>{b}</li>)}</ul></>
                  )}
                  {outcome.links.length > 0 && (
                    <><b className="brr-small brr-block">Links</b><ul>{outcome.links.map((l) => (
                      <li key={l.url}><Link href={l.url}>{l.label || l.url}</Link></li>
                    ))}</ul></>
                  )}
                </div>
              </div>
            </>
          ) : (
            <p className="brr-dim">No wrap-up yet. Ask Claude to wrap up, or write one from the room.</p>
          )}
        </section>

        {s.crew && s.crew.enabled && (s.crew.builders || []).length > 0 && <WhoBuiltWhat crew={s.crew} />}

        <section aria-labelledby="brr-decisions">
          <h2 id="brr-decisions">Decisions</h2>
          {asks.length ? asks.map((a) => <Decision key={a.askId} ask={a} />) : <p className="brr-dim">The room was not asked anything.</p>}
        </section>

        {others.length > 0 && (
          <section aria-labelledby="brr-shots">
            <h2 id="brr-shots">Screenshots along the way</h2>
            <div className="brr-shots">
              {others.map((im) => <BuildImage key={im.imageId} imageId={im.imageId} caption={`${hhmm(im.createdAt)} · ${im.caption || 'Screenshot'}`} className="brr-shot" linked={false} />)}
            </div>
          </section>
        )}

        {checkpoints.length > 0 && (
          <section aria-labelledby="brr-versions">
            <h2 id="brr-versions">Version history</h2>
            <p className="brr-dim brr-small">Each step was saved in git on the host&apos;s laptop. To go back to one, check out its commit.</p>
            <table className="brr-tbl">
              <thead><tr><th className="brr-col-t">Time</th><th className="brr-col-kind">Commit</th><th>What changed</th></tr></thead>
              <tbody>
                {checkpoints.map((c) => (
                  <tr key={c.logId}>
                    <td>{hhmm(c.createdAt)}</td>
                    <td className="brr-mono">{(/commit ([0-9a-f]+)/.exec(c.detail || '') || [])[1] || ''}</td>
                    <td>{c.text}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        <section aria-labelledby="brr-timeline">
          <h2 id="brr-timeline">Timeline</h2>
          {log.length ? (
            <table className="brr-tbl">
              <thead><tr><th className="brr-col-t">Time</th><th className="brr-col-who">Who</th><th className="brr-col-kind">Kind</th><th>What happened</th></tr></thead>
              <tbody>
                {log.map((l) => (
                  <tr key={l.logId}>
                    <td>{hhmm(l.createdAt)}</td>
                    <td>{whoLabel(l)}</td>
                    <td>{l.kind}</td>
                    <td>
                      {l.text}
                      {l.detail && l.kind !== 'image' && <span className="brr-block brr-dim">{l.detail}</span>}
                      {safeHref(l.link) && <span className="brr-block"><Link href={l.link} /></span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p className="brr-dim">Nothing on the timeline yet.</p>}
          <p className="brr-dim brr-small">Host notes are left out of the report.</p>
        </section>

        <section aria-labelledby="brr-ideas">
          <h2 id="brr-ideas">Ideas from the room</h2>
          {ideas.length ? (
            <table className="brr-tbl">
              <thead><tr><th className="brr-col-t">Time</th><th className="brr-col-who">Status</th><th>Idea</th></tr></thead>
              <tbody>
                {ideas.map((i) => (
                  <tr key={i.ideaId}>
                    <td>{hhmm(i.createdAt)}</td>
                    <td>{IDEA_STATUS[i.status] || i.status}</td>
                    <td>{i.text}<span className="brr-dim"> · {i.playerName}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p className="brr-dim">No ideas were sent.</p>}
        </section>

        <section aria-labelledby="brr-people">
          <h2 id="brr-people">Who took part</h2>
          {players.length ? (
            <ul className="brr-ppl">{players.map((p) => <li key={p}>{p}</li>)}</ul>
          ) : <p className="brr-dim">Nobody joined from a phone.</p>}
        </section>
      </article>
    </div>
  );
}
