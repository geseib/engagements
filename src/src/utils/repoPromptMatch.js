/**
 * WHICH REPO FILE IS THIS PROMPT, AND DOES THE LIVE TEXT MATCH IT?
 *
 * docs/design/prompt-versions/ frame 1. The repo's prompt files —
 * demo-sets/*.prompt.json and lambda-functions/admin/default-ai-prompts.json —
 * travel with every deploy as src/src/config/repoPrompts.json
 * (scripts/build-repo-prompts.js). The library compares each live prompt with
 * its file and marks the row:
 *
 *   newer    "Repo has a newer version"   the live text differs from the file
 *   matches  "Matches the repo"           every field the file carries is equal
 *   none     "Not in the repo"            no file is this prompt
 *
 * It never changes anything by itself; the Review screen does, and only on Save.
 *
 * HOW A PROMPT IS MATCHED TO ITS FILE, strongest first:
 *   1. the `repoSource.key` stored on the row once it was taken from the repo
 *      (the Review save, or a seed by populate-defaults);
 *   2. a `promptId` the file itself names (the quiz Workies carry one);
 *   3. the seeded identity of a built-in default — populate-defaults matches a
 *      default by its exact `name` (its header: "name IS THE IDENTITY OF A
 *      DEFAULT PROMPT"), on a row it wrote (`createdBy: 'system'`);
 *   4. the name, ignoring case and an "(Imported YYYY-MM-DD)" suffix — the
 *      archive importer's mark — preferring the same engagement type.
 *
 * EQUAL MEANS THE LAMBDA'S HASHES ARE EQUAL. The live row carries
 * `fieldHashes` (get-ai-prompts.js, includeContent) and every repo entry
 * carries its own, both from lambda-functions/admin/shared/prompt-versions.js.
 * Comparing per field over the fields the FILE carries is what lets a quiz
 * file with no output sections match a prompt that has the default ones.
 */

export const REPO_STATE = { NEWER: 'newer', MATCHES: 'matches', NONE: 'none' };

export const REPO_STATE_LABEL = {
  newer: 'Repo has a newer version',
  matches: 'Matches the repo',
  none: 'Not in the repo',
};

/** The parts of a prompt, in the order the Review screen reads them. */
export const REPO_FIELD_ORDER = ['instructions', 'outputFormat', 'outputSections', 'template', 'description', 'angleWeights'];

export const REPO_FIELD_LABEL = {
  instructions: 'Instructions',
  outputFormat: 'Output format',
  outputSections: 'Sections',
  template: 'Template',
  description: 'Description',
  angleWeights: 'Round angles',
};

const IMPORTED_SUFFIX = /\s*\(imported \d{4}-\d{2}-\d{2}\)\s*$/i;

/** A name as matching reads it: no import suffix, no case, single spaces. */
export function normalizePromptName(name) {
  return String(name || '').replace(IMPORTED_SUFFIX, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

const sameType = (a, b) => String(a || '') === String(b || '');

/** The repo entry for this prompt, or null. `entries` is repoPrompts.json's `prompts`. */
export function matchRepoEntry(prompt, entries) {
  if (!prompt || !Array.isArray(entries) || entries.length === 0) return null;
  const stored = prompt.repoSource && prompt.repoSource.key;
  if (stored) {
    const hit = entries.find((e) => e.key === stored);
    if (hit) return hit;
  }
  if (prompt.promptId) {
    const hit = entries.find((e) => e.promptId && e.promptId === prompt.promptId);
    if (hit) return hit;
  }
  if (prompt.createdBy === 'system') {
    const hit = entries.find((e) => e.source === 'defaults' && e.name === prompt.name
      && sameType(e.gameType, prompt.gameType));
    if (hit) return hit;
  }
  const wanted = normalizePromptName(prompt.name);
  if (!wanted) return null;
  const named = entries.filter((e) => normalizePromptName(e.name) === wanted);
  return named.find((e) => sameType(e.gameType, prompt.gameType)) || named[0] || null;
}

/**
 * The row's mark. `{ state, entry, changed, editedHere }`, or null when the
 * live text was not loaded (no `fieldHashes`) and nothing honest can be said.
 *
 * `editedHere` — the live prompt was taken from the repo and then changed in
 * this environment, so the repo's version would replace an edit made here.
 * Known only for a row that recorded what it took (`repoSource.fieldHashes`).
 */
export function repoStatusOf(prompt, entries) {
  const entry = matchRepoEntry(prompt, entries);
  if (!entry) return { state: REPO_STATE.NONE, entry: null, changed: [], editedHere: false };
  const live = prompt && prompt.fieldHashes;
  if (!live) return null;
  const changed = entry.fields.filter((f) => live[f] !== entry.fieldHashes[f]);
  if (changed.length === 0) return { state: REPO_STATE.MATCHES, entry, changed, editedHere: false };
  const taken = prompt.repoSource && prompt.repoSource.key === entry.key && prompt.repoSource.fieldHashes;
  const editedHere = Boolean(taken)
    && entry.fields.some((f) => taken[f] !== undefined && live[f] !== taken[f]);
  return { state: REPO_STATE.NEWER, entry, changed, editedHere };
}

/** "21 Oct" — the date the library's notice names. */
export function shortDate(iso) {
  const t = Date.parse(iso || '');
  if (Number.isNaN(t)) return '';
  return new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

/** "21 Oct, 14:02" — when a version was saved. */
export function shortDateTime(iso) {
  const t = Date.parse(iso || '');
  if (Number.isNaN(t)) return '—';
  const d = new Date(t);
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC' });
  return `${shortDate(iso)}, ${time}`;
}

/** The newest repo date among these entries, for "from the deploy of …". */
export function newestRepoDate(entries) {
  const dates = (entries || []).map((e) => e && e.commitDate).filter((d) => !Number.isNaN(Date.parse(d || '')));
  if (!dates.length) return '';
  return dates.reduce((a, b) => (Date.parse(a) >= Date.parse(b) ? a : b));
}

/* ------------------------------------------------------------- the diff -- */

/** One part of a prompt as readable text — sections and angles included. */
export function fieldText(field, value) {
  if (field === 'outputSections') {
    if (!Array.isArray(value) || value.length === 0) return '';
    return value.map((s) => `${(s && s.heading) || ''}: ${(s && s.guidance) || ''}`.trim()).join('\n');
  }
  if (field === 'angleWeights') {
    if (!value || typeof value !== 'object' || Object.keys(value).length === 0) return '';
    return Object.keys(value).sort().map((k) => `${k} ${value[k]}`).join(', ');
  }
  if (value === undefined || value === null) return '';
  return String(value).replace(/\r\n?/g, '\n');
}

export function countWords(text) {
  const t = String(text || '').trim();
  return t ? t.split(/\s+/).length : 0;
}

/** How many sections differ, by position — "2 of 4 changed". */
export function sectionsChanged(before, after) {
  const a = Array.isArray(before) ? before : [];
  const b = Array.isArray(after) ? after : [];
  const n = Math.max(a.length, b.length);
  let changed = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i] || {}; const y = b[i] || {};
    if (String(x.heading || '').trim() !== String(y.heading || '').trim()
      || String(x.guidance || '').trim() !== String(y.guidance || '').trim()) changed++;
  }
  return { changed, total: b.length || a.length };
}

const tokenize = (text) => String(text || '').match(/\s+|[^\s]+/g) || [];

/**
 * A word-level diff: `[{ type: 'same'|'add'|'del', text }]`, runs merged.
 * The common head and tail are peeled first, so the longest-common-subsequence
 * table only spans the part that actually changed — a one-sentence edit in a
 * 1,300-word prompt is a few hundred cells, not two million.
 */
export function wordDiff(before, after) {
  const a = tokenize(before);
  const b = tokenize(after);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length; let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB--; }

  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);
  const out = [];
  const push = (type, text) => {
    if (!text) return;
    const last = out[out.length - 1];
    if (last && last.type === type) last.text += text; else out.push({ type, text });
  };
  push('same', a.slice(0, start).join(''));

  const n = midA.length; const m = midB.length;
  if (n * m > 4000000) {
    // Too large to align word by word: say it as a replacement.
    push('del', midA.join('')); push('add', midB.join(''));
  } else {
    const table = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        table[i][j] = midA[i] === midB[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
      }
    }
    let i = 0; let j = 0;
    while (i < n && j < m) {
      if (midA[i] === midB[j]) { push('same', midA[i]); i++; j++; } else if (table[i + 1][j] >= table[i][j + 1]) { push('del', midA[i]); i++; } else { push('add', midB[j]); j++; }
    }
    while (i < n) push('del', midA[i++]);
    while (j < m) push('add', midB[j++]);
  }

  push('same', a.slice(endA).join(''));
  return out;
}

/**
 * The diff with long unchanged stretches folded to "…", keeping `context`
 * words either side of every change, so a reviewer reads the changes and not
 * the whole prompt again.
 */
export function foldDiff(parts, context = 12) {
  const words = (text) => text.match(/\s+|[^\s]+/g) || [];
  return parts.map((p, idx) => {
    if (p.type !== 'same') return p;
    const w = words(p.text);
    const keep = context * 2; // a word plus its following space
    if (w.length <= keep * 2 + 2) return p;
    const head = idx === 0 ? [] : w.slice(0, keep);
    const tail = idx === parts.length - 1 ? [] : w.slice(w.length - keep);
    return { type: 'same', text: `${head.join('')}${head.length ? ' … ' : '… '}${tail.join('')}`, folded: true };
  });
}
