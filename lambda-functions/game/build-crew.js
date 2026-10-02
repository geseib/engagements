/**
 * BUILD ROOM CREW MODE — the pure half (docs/design/build-room-crew/FLOWS.md).
 *
 * Builders are players who bring a laptop with their own Claude Code. They
 * claim tasks, build on their own fork or branch, share EARLY LOOKS (work in
 * progress, before any PR: screenshots, what changed, what they are unsure
 * of), and offer the work back. The room reacts, the host's Claude reviews,
 * and only the host merges.
 *
 * Engage carries the conversation and the evidence; git carries the code.
 * Nothing here holds a GitHub token or anyone's source — only pointers (repo,
 * branch, commit), summaries, screenshots, comments, decisions, and (patch
 * mode) a patch the builder chose to send, kept in S3 beside the screenshots.
 *
 * Owner decisions (2026-10-02): fork + PR, and patches through Engage; each
 * Claude Code does its own GitHub work; the host alone merges; the room sees
 * an early look when the host puts it on the wall; a visible "Run crew code"
 * switch instead of a prompt every time; eight builders at most.
 */
const S = require('./build-store');

const MAX_BUILDERS = 8;
const MODES = Object.freeze(['fork', 'patch']);
const BUILDER_STATUSES = Object.freeze(['setting-up', 'building', 'synced', 'needs-rebase', 'needs-help', 'idle']);
const LANES = Object.freeze(['shared', 'reviewed', 'pr', 'merged', 'not-now']);
const REACTIONS = Object.freeze(['looks-right', 'question', 'concern']);
const RECOMMENDATIONS = Object.freeze(['merge', 'merge-after-changes', 'not-yet']);
const PATCH_MAX_BYTES = 300 * 1024;
const MAX_VERSIONS = 12;
const MAX_TASKS = 30;

const L = Object.freeze({
  repo: 300, branch: 120, commit: 64, title: 120, summary: 1500, unsure: 600, wanted: 300,
  task: 200, taskDetail: 1000, note: 300, comment: 500, review: 1500, suggestion: 400, help: 500,
});

const SK = Object.freeze({
  builder: (name) => `BUILD#BLD#${name}`,
  task: (id) => `BUILD#TASK#${id}`,
  share: (id) => `BUILD#SHR#${id}`,
  comment: (shareId, iso) => `BUILD#CMT#${shareId}#${String(Date.parse(iso) || Date.now()).padStart(13, '0')}#${S.newId()}`,
  review: (shareId, iso) => `BUILD#REV#${shareId}#${String(Date.parse(iso) || Date.now()).padStart(13, '0')}`,
});

/** Which tenant-crypto entity a crew row belongs to (null when it is not one). */
function entityForSk(sk) {
  if (sk.startsWith('BUILD#BLD#')) return 'buildBuilder';
  if (sk.startsWith('BUILD#TASK#')) return 'buildTask';
  if (sk.startsWith('BUILD#SHR#')) return 'buildShare';
  if (sk.startsWith('BUILD#CMT#')) return 'buildComment';
  if (sk.startsWith('BUILD#REV#')) return 'buildReview';
  return null;
}

/** Sort crew rows into the room (roomFromRows calls this for BUILD#BLD/TASK/SHR/CMT/REV). */
function addRow(room, r) {
  const sk = String(r.SK);
  if (sk.startsWith('BUILD#BLD#')) room.builders.push(r);
  else if (sk.startsWith('BUILD#TASK#')) room.tasks.push(r);
  else if (sk.startsWith('BUILD#SHR#')) room.shares.push(r);
  else if (sk.startsWith('BUILD#CMT#')) room.comments.push(r);
  else if (sk.startsWith('BUILD#REV#')) room.reviews.push(r);
  else return false;
  return true;
}

// ── Settings ─────────────────────────────────────────────────────────────────

const repoUrl = (v) => {
  const s = S.cleanText(v, L.repo);
  if (!s) return '';
  // https://, git@host:owner/repo or ssh:// — a pointer for people, never fetched by Engage.
  return /^(https?:\/\/|ssh:\/\/|git@)[^\s]+$/i.test(s) ? s : '';
};
const branchName = (v) => {
  const s = S.cleanText(v, L.branch);
  return /^[A-Za-z0-9._/-]+$/.test(s) && !s.includes('..') ? s : '';
};
const commitId = (v) => {
  const s = S.cleanText(v, L.commit).toLowerCase();
  return /^[0-9a-f]{4,64}$/.test(s) ? s : '';
};

function crewOf(stateRow) {
  const c = (stateRow && stateRow.Crew) || {};
  return {
    enabled: Boolean(c.enabled),
    repoUrl: c.repoUrl || '',
    baseBranch: c.baseBranch || '',
    baseCommit: c.baseCommit || '',
    baseNote: c.baseNote || '',
    baseMovedAt: c.baseMovedAt || null,
    modes: Array.isArray(c.modes) && c.modes.length ? c.modes.filter((m) => MODES.includes(m)) : [...MODES],
    runCrewCode: Boolean(c.runCrewCode),
  };
}

/** A settings change from the host (or the repo from the host's Claude). */
function applyCrewSettings(current, b) {
  const next = { ...current };
  if (b.enabled !== undefined) next.enabled = Boolean(b.enabled);
  if (b.runCrewCode !== undefined) next.runCrewCode = Boolean(b.runCrewCode);
  if (b.repoUrl !== undefined) {
    const u = repoUrl(b.repoUrl);
    if (b.repoUrl && !u) return { error: 'The repo must be an https://, ssh:// or git@ address' };
    next.repoUrl = u;
  }
  if (b.baseBranch !== undefined) {
    const br = branchName(b.baseBranch);
    if (b.baseBranch && !br) return { error: 'That is not a branch name' };
    next.baseBranch = br;
  }
  if (b.baseCommit !== undefined) {
    const c = commitId(b.baseCommit);
    if (b.baseCommit && !c) return { error: 'The commit must be a git hash' };
    next.baseCommit = c;
  }
  if (b.modes !== undefined) {
    const m = (Array.isArray(b.modes) ? b.modes : []).filter((x) => MODES.includes(x));
    if (!m.length) return { error: `Pick at least one of ${MODES.join(', ')}` };
    next.modes = m;
  }
  return { value: next };
}

// ── Inputs ───────────────────────────────────────────────────────────────────

function normalizeTask(b) {
  const text = S.cleanText(b && b.text, L.task);
  if (!text) return { error: 'Write the task' };
  return { value: { text, detail: S.cleanText(b.detail, L.taskDetail) } };
}

function diffstat(d) {
  const n = (v) => (Number.isInteger(Number(v)) && Number(v) >= 0 ? Math.min(Number(v), 1e7) : 0);
  const files = Array.isArray(d && d.files)
    ? d.files.map((f) => S.cleanText(f, 200)).filter(Boolean).slice(0, 50)
    : [];
  return { files, fileCount: n(d && (d.fileCount !== undefined ? d.fileCount : files.length)), added: n(d && d.added), removed: n(d && d.removed) };
}

/** One early look (or its next version) from a builder's Claude. */
function normalizeShare(b, mode) {
  const x = b || {};
  const title = S.cleanText(x.title, L.title);
  const summary = S.cleanText(x.summary, L.summary);
  if (!title) return { error: 'Give the early look a short title' };
  if (!summary) return { error: 'Say what you changed, in plain words (summary)' };
  const patch = x.patch === undefined || x.patch === null ? '' : String(x.patch);
  if (patch && Buffer.byteLength(patch, 'utf8') > PATCH_MAX_BYTES) {
    return { error: `The patch is over ${PATCH_MAX_BYTES / 1024} KB. Share a smaller step, or use a fork and send the branch instead.` };
  }
  if (patch && !/^(From [0-9a-f]{7,40} |diff --git )/m.test(patch)) {
    return { error: 'The patch must be git format-patch or git diff output' };
  }
  if (mode === 'patch' && !patch && !x.shareId) return { error: 'In patch mode, send the patch (git format-patch output)' };
  return {
    value: {
      title,
      summary,
      unsure: S.cleanText(x.unsure, L.unsure),
      feedbackWanted: S.cleanText(x.feedbackWanted, L.wanted),
      commit: commitId(x.commit),
      branch: branchName(x.branch),
      forkUrl: repoUrl(x.forkUrl),
      diffstat: diffstat(x.diffstat),
      imageIds: (Array.isArray(x.imageIds) ? x.imageIds : []).map((i) => String(i).replace(/[^0-9a-f]/g, '').slice(0, 32)).filter(Boolean).slice(0, 8),
      patch,
    },
  };
}

function normalizeReview(b) {
  const x = b || {};
  const does = S.cleanText(x.does, L.review);
  if (!does) return { error: 'Say what the change does (does)' };
  const rec = String(x.recommendation || '').toLowerCase();
  if (!RECOMMENDATIONS.includes(rec)) return { error: `recommendation must be one of ${RECOMMENDATIONS.join(', ')}` };
  const list = (v, max) => (Array.isArray(v) ? v : (v ? [v] : [])).map((t) => S.cleanText(t, max)).filter(Boolean).slice(0, 12);
  return {
    value: {
      does,
      fits: list(x.fits, L.suggestion),
      risk: S.cleanText(x.risk, L.review),
      suggestions: list(x.suggestions, L.suggestion),
      recommendation: rec,
      testsRun: Boolean(x.testsRun),
      testsSummary: S.cleanText(x.testsSummary, L.note),
    },
  };
}

// ── Views ────────────────────────────────────────────────────────────────────

const latest = (share) => {
  const v = share.Versions || [];
  return v[v.length - 1] || null;
};

function versionView(v, audience) {
  return {
    v: v.v,
    summary: v.summary || '',
    unsure: v.unsure || '',
    feedbackWanted: v.feedbackWanted || '',
    commit: v.commit || '',
    branch: v.branch || '',
    forkUrl: audience === 'public' ? '' : (v.forkUrl || ''),
    diffstat: v.diffstat || { files: [], fileCount: 0, added: 0, removed: 0 },
    imageIds: v.imageIds || [],
    hasPatch: Boolean(v.hasPatch),
    createdAt: v.createdAt || null,
  };
}

function reactionCounts(comments, shareId) {
  const latestBy = new Map();
  for (const c of comments.filter((x) => x.ShareId === shareId && REACTIONS.includes(x.Kind))) latestBy.set(c.Name, c.Kind);
  const out = { 'looks-right': 0, question: 0, concern: 0 };
  for (const k of latestBy.values()) out[k] += 1;
  return out;
}

function shareView(share, room, audience, me) {
  const named = audience !== 'public';
  const comments = room.comments.filter((c) => c.ShareId === share.ShareId).map((c) => ({
    kind: c.Kind,
    text: c.Text || '',
    by: c.By,
    // On a phone the room is anonymous; the builder, the host and Claude are not.
    name: named || c.By !== 'room' ? (c.Name || '') : (me && c.Name === me.playerName ? 'You' : ''),
    version: c.Version || null,
    createdAt: c.CreatedAt || null,
  }));
  const reviews = room.reviews.filter((r) => r.ShareId === share.ShareId).map((r) => ({
    version: r.Version,
    does: r.Does || '',
    fits: r.Fits || [],
    risk: r.Risk || '',
    suggestions: r.Suggestions || [],
    recommendation: r.Recommendation,
    testsRun: Boolean(r.TestsRun),
    testsSummary: r.TestsSummary || '',
    runCrewCode: Boolean(r.RunCrewCode),
    createdAt: r.CreatedAt || null,
  }));
  return {
    shareId: share.ShareId,
    builder: share.Builder,
    taskId: share.TaskId || null,
    title: share.Title || '',
    lane: share.Lane || 'shared',
    featured: Boolean(share.Featured),
    prUrl: audience === 'public' ? '' : (share.PrUrl || ''),
    mergedCommit: share.MergedCommit || '',
    versions: (share.Versions || []).map((v) => versionView(v, audience)),
    reactions: reactionCounts(room.comments, share.ShareId),
    comments,
    reviews,
    createdAt: share.CreatedAt || null,
    updatedAt: share.UpdatedAt || null,
  };
}

function builderView(b, room) {
  const own = room.shares.filter((s) => s.Builder === b.PlayerName);
  const lastShare = own.sort((x, y) => String(y.UpdatedAt).localeCompare(String(x.UpdatedAt)))[0];
  const lastImages = lastShare && latest(lastShare) ? latest(lastShare).imageIds || [] : [];
  return {
    name: b.PlayerName,
    mode: b.Mode || 'fork',
    forkUrl: b.ForkUrl || '',
    branch: b.Branch || '',
    commit: b.Commit || '',
    status: b.Status || 'setting-up',
    note: b.Note || '',
    taskId: b.TaskId || null,
    lastSeenAt: b.LastSeenAt || null,
    checkpointAt: b.CheckpointAt || null,
    latestImageId: lastImages[0] || null,
    shareIds: own.map((s) => s.ShareId),
  };
}

function taskView(t) {
  return {
    taskId: t.TaskId,
    text: t.Text || '',
    detail: t.Detail || '',
    source: t.Source || 'host',
    claimedBy: t.ClaimedBy || [],
    state: t.State || 'open',
    createdAt: t.CreatedAt || null,
  };
}

/** The pipeline strip: Building → Early look → Reviewed → PR open → Merged. */
function pipeline(room) {
  const lanes = { building: 0, shared: 0, reviewed: 0, pr: 0, merged: 0, 'not-now': 0 };
  for (const s of room.shares) lanes[s.Lane || 'shared'] += 1;
  const sharing = new Set(room.shares.filter((s) => !['merged', 'not-now'].includes(s.Lane)).map((s) => s.Builder));
  lanes.building = room.builders.filter((b) => !sharing.has(b.PlayerName)).length;
  return lanes;
}

/**
 * The crew, as `audience` may see it: 'host' and 'agent' (the host's Claude)
 * see everything; 'builder' sees the crew it is part of; 'public' (a phone)
 * sees the lanes, the tasks, and only the early looks the host put on the
 * wall — plus the phone's own, if it is a builder.
 */
function crewView(room, audience, me) {
  const settings = crewOf(room.state);
  if (!settings.enabled) return { enabled: false };
  const visible = audience === 'public'
    ? room.shares.filter((s) => s.Featured || (me && s.Builder === me.playerName))
    : room.shares;
  return {
    ...settings,
    // A phone needs neither the switch nor where a fork lives.
    ...(audience === 'public' ? { runCrewCode: undefined } : {}),
    builders: room.builders.map((b) => builderView(b, room)),
    tasks: room.tasks.filter((t) => t.State !== 'deleted').map(taskView),
    shares: visible.slice().sort((a, b) => String(a.CreatedAt).localeCompare(String(b.CreatedAt)))
      .map((s) => shareView(s, room, audience, me)),
    pipeline: pipeline(room),
    me: me && room.builders.some((b) => b.PlayerName === me.playerName) ? { name: me.playerName, isBuilder: true } : null,
  };
}

/** What a builder's Claude is told when the base moves. */
function baseMovedText(settings, note) {
  return `The base branch ${settings.baseBranch || ''} moved to ${settings.baseCommit || 'a new commit'}${note ? `: ${note}` : ''}. `
    + 'Pull it into your branch (fetch, then merge or rebase), run the project again, and report with crew_status '
    + '(synced, or needs-rebase with the files that clash).';
}

module.exports = {
  MAX_BUILDERS, MODES, BUILDER_STATUSES, LANES, REACTIONS, RECOMMENDATIONS, PATCH_MAX_BYTES, MAX_VERSIONS, MAX_TASKS, L, SK,
  entityForSk, addRow, crewOf, applyCrewSettings, repoUrl, branchName, commitId,
  normalizeTask, normalizeShare, normalizeReview, diffstat,
  latest, shareView, builderView, taskView, pipeline, crewView, reactionCounts, baseMovedText,
};
