/**
 * BUILD ROOM — the "Talking points and research" section of the session report
 * (docs/superpowers/specs/2026-10-09-build-room-talking-points-design.md §6,
 * mockup docs/design/build-room-talking-points T10).
 *
 * A pure function of the room's rows (already decrypted, as roomFromRows
 * returns them). It names builders on their own points ("Priya's Claude") and
 * never a participant: votes are counts, ideas are counts, nothing carries a
 * phone's name. Points that were never shown, voted on, sent or run are left
 * out, except research findings, which are the section's reason for being.
 */
const S = require('./build-store');

const KIND_ORDER = { research: 0, ideas: 1 };

const byLabel = (p) => (p.ByRole === 'builder' ? `${p.By}'s Claude` : 'Claude');

function findingView(p, room) {
  return {
    id: S.pointIdOf(p.SK),
    kind: p.Kind,
    text: p.Text || '',
    detail: p.Detail || '',
    sources: (p.Sources || []).map((s) => ({ title: s.title, url: s.url, site: S.siteOf(s.url) })),
    about: p.About || '',
    by: byLabel(p),
    fromBuilder: p.ByRole === 'builder',
    shownAt: p.ShownAt || null,
    ideasSent: ideasAbout(room, S.pointIdOf(p.SK)),
    outcome: plainOutcome(p),
    createdAt: p.CreatedAt || null,
  };
}

/** Ideas the room sent while the point was up, counted as the other room views count them: not dismissed or removed. */
const IDEA_GONE = ['dismissed', 'removed', 'hidden'];
function ideasAbout(room, pointId) {
  return (room.ideas || []).filter((i) => i.AboutPoint === pointId && !IDEA_GONE.includes(i.Status || 'new')).length;
}

/** "voted 9, run item 1" -> "run item 1": the vote has its own column. */
function plainOutcome(p) {
  const raw = p.Outcome || S.POINT_OUTCOMES[p.Status || 'new'] || '';
  return raw.replace(/^voted \d+,\s*/, '');
}

const wasShown = (p) => Boolean(p.ShownAt) || p.Status === 'shown';

function talkingPointsReport(room) {
  const r = room || {};
  const points = (r.points || []).filter((p) => p.Status !== 'removed');
  const byId = new Map(points.map((p) => [S.pointIdOf(p.SK), p]));
  const asks = (r.asks || []).filter((a) => Array.isArray(a.FromPoints) && a.FromPoints.length && a.Status !== 'discarded');

  // Everything a point did beyond being posted.
  const involved = new Set();
  for (const a of asks) for (const o of a.Options || []) if (o.pointId) involved.add(o.pointId);
  const run = r.run || null;
  if (run) for (const it of run.Items || []) if (it.pointId) involved.add(it.pointId);
  // Points whose run item is sent or done moved forward even if the row says only 'voting'.
  const inRun = new Map();
  if (run) (run.Items || []).forEach((it, i) => { if (it.pointId) inRun.set(it.pointId, (run.Marks || [])[i] || 'pending'); });
  for (const p of points) {
    const id = S.pointIdOf(p.SK);
    if (wasShown(p) || ['sent', 'later', 'queued', 'voting'].includes(p.Status)) involved.add(id);
  }

  const requestRows = (r.preqs || []).slice().sort((a, b) => String(a.CreatedAt || '').localeCompare(String(b.CreatedAt || '')));
  const requests = requestRows.map((q) => ({
    id: S.requestIdOf(q.SK),
    kind: q.Kind,
    subject: q.Subject || '',
    for: q.ForBuilder ? `${q.ForBuilder}'s Claude` : 'Claude',
    status: q.Status || 'waiting',
    askedAt: q.CreatedAt || null,
    findings: [],
    ideas: [],
  }));
  const reqById = new Map(requests.map((q) => [q.id, q]));
  const loose = { id: '', kind: 'research', subject: '', for: 'Claude', status: 'done', askedAt: null, findings: [], ideas: [] };

  for (const p of points) {
    const id = S.pointIdOf(p.SK);
    const isFinding = p.Kind === 'finding';
    if (!isFinding && !involved.has(id)) continue;
    const view = findingView(p, r);
    const q = p.RequestId ? reqById.get(p.RequestId) : null;
    const home = q || loose;
    if (isFinding) home.findings.push(view); else if (p.Kind === 'idea' && q) q.ideas.push(view);
  }
  const groups = requests.filter((q) => q.findings.length || q.ideas.length || q.status !== 'failed');
  if (loose.findings.length) groups.push(loose);
  groups.sort((a, b) => (KIND_ORDER[a.kind] ?? 9) - (KIND_ORDER[b.kind] ?? 9) || String(a.askedAt || '').localeCompare(String(b.askedAt || '')));

  const votes = asks.map((a) => {
    const t = S.tally(a, r);
    const counts = new Map((t.options || []).map((o) => [o.label, o.count]));
    const options = (a.Options || []).map((o) => {
      const p = o.pointId ? byId.get(o.pointId) : null;
      return {
        label: o.label,
        text: o.title || '',
        votes: counts.get(o.label) || 0,
        by: p ? byLabel(p) : 'Claude',
        fromBuilder: Boolean(p && p.ByRole === 'builder'),
        isFinding: Boolean(p && p.Kind === 'finding'),
        outcome: p ? plainOutcome(p) : '',
        movedForward: Boolean(p && (['sent', 'queued'].includes(p.Status) || p.PromotedTo || p.RunItem
          || ['doing', 'done', 'pending'].includes(inRun.get(o.pointId)))),
      };
    }).sort((x, y) => y.votes - x.votes);
    return {
      id: a.AskId,
      prompt: a.Prompt || '',
      maxPicks: Number(a.MaxPicks) || 1,
      voted: t.total || 0,
      picks: options.reduce((n, o) => n + o.votes, 0),
      options,
    };
  });

  const runOut = run && (run.Items || []).length ? {
    status: run.Status || 'running',
    startedAt: run.StartedAt || null,
    finishedAt: run.FinishedAt || null,
    items: run.Items.map((it, i) => {
      const mark = (run.Marks || [])[i] || 'pending';
      return {
        k: i + 1,
        text: it.text || '',
        by: it.byBuilder ? `${it.byBuilder}'s Claude` : 'Claude',
        fromBuilder: Boolean(it.byBuilder),
        state: mark,
        doneAt: (run.DoneAt || [])[i] || null,
        note: it.note || '',
      };
    }),
  } : null;

  const shown = points
    .filter(wasShown)
    .sort((a, b) => String(a.ShownAt || a.UpdatedAt || '').localeCompare(String(b.ShownAt || b.UpdatedAt || '')))
    .map((p) => ({
      id: S.pointIdOf(p.SK),
      text: p.Text || '',
      kind: p.Kind,
      by: byLabel(p),
      fromBuilder: p.ByRole === 'builder',
      shownAt: p.ShownAt || p.UpdatedAt || null,
      ideasSent: ideasAbout(r, S.pointIdOf(p.SK)),
    }));

  const findingsTotal = groups.reduce((n, g) => n + g.findings.length, 0);
  if (!findingsTotal && !votes.length && !runOut && !shown.length && !groups.some((g) => g.subject)) return null;

  const mine = points.filter((p) => p.ByRole !== 'builder').length;
  const builders = new Map();
  for (const p of points) if (p.ByRole === 'builder') builders.set(p.By, (builders.get(p.By) || 0) + 1);
  const rq = requests.filter((q) => q.status !== 'failed');
  return {
    counts: {
      fromClaude: mine,
      fromBuilders: [...builders.entries()].map(([name, n]) => ({ name: `${name}'s Claude`, n })),
      researchRequests: rq.filter((q) => q.kind === 'research').length,
      ideaRequests: rq.filter((q) => q.kind === 'ideas').length,
      votes: votes.length,
      runs: runOut ? 1 : 0,
    },
    requests: groups,
    votes,
    run: runOut,
    shown,
  };
}

module.exports = { talkingPointsReport };
