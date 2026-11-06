/**
 * WHAT AN ARCHIVE ITEM IS, AND WHAT A BACKUP OR RESTORE DID — for components/ArchivePanel.jsx.
 *
 * Every tier reads every tier's backups (docs/superpowers/specs/2026-09-14-archive-full-
 * fidelity-design.md, amendment A2). So "which environment is this from" is the first question
 * the screen answers, a source's snapshots are shown together, and a restore is reported
 * leading with what just went live for every organisation.
 *
 * Pure: everything here reads the tags export writes (archive-snapshot.js envelopeTags) or the
 * JSON the export and import routes return.
 */
import { archiveTags, STRUCTURED_TAG } from './archiveFiltering';

export const TIERS = ['dev', 'test', 'prod'];

const tagValue = (item, prefix) => {
  const found = archiveTags(item).find((tag) => tag.startsWith(prefix));
  return found ? found.slice(prefix.length) : '';
};

/** The environment a backup was taken on, or '' when the item never recorded one. */
export function archiveTier(item) {
  const tags = archiveTags(item).map((tag) => tag.toLowerCase());
  return TIERS.find((tier) => tags.includes(tier)) || '';
}

export const archiveScope = (item) => tagValue(item, 'scope:');
export const archiveSource = (item) => tagValue(item, 'source:');
export const isSnapshot = (item) => tagValue(item, 'schema:') !== '';

/** Tags worth showing a person: not the structured ones, not the tier (each has its own chip). */
export const displayTags = (item) => archiveTags(item)
  .filter((tag) => !STRUCTURED_TAG.test(tag) && !TIERS.includes(tag.toLowerCase()));

/**
 * Items in display order. Snapshots of the same source are adjacent, newest first, and groups
 * are ordered by their newest snapshot. An item with no source is a group of one.
 */
export function groupSnapshots(items) {
  const groups = new Map();
  for (const item of items || []) {
    const key = archiveSource(item) ? `source:${archiveSource(item)}` : `item:${item.ArchiveId}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  const time = (item) => Date.parse(item.CreatedAt) || 0;
  const ordered = [...groups.values()].map((group) => group.sort((a, b) => time(b) - time(a)));
  ordered.sort((a, b) => time(b[0]) - time(a[0]));
  return ordered.flatMap((group) => group.map((item, index) => ({ item, latest: index === 0, snapshots: group.length })));
}

/** A selection key naming the library as well as the id: `teamretro` alone is not one set. */
export const selectionKey = (scope, id) => `${scope || 'platform'}:${id}`;

/** The export request's entries. An organisation set is never archived, so it is dropped here too. */
export function exportSelection(keys) {
  return [...(keys || [])]
    .map((key) => {
      const at = key.indexOf(':');
      return { scope: key.slice(0, at), id: key.slice(at + 1) };
    })
    .filter((ref) => ref.scope === 'platform' || ref.scope === 'public');
}

const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

export function describeExport(response) {
  const results = (response && response.results) || {};
  const done = results.successful || [];
  const failed = results.failed || [];
  const lines = [];
  if (done.length) lines.push(`Backed up ${done.length}: ${done.map((d) => d.name || d.id).join(', ')}.`);
  for (const d of done) {
    const missing = (d.media && d.media.missing) || [];
    if (missing.length) {
      lines.push(`${d.name || d.id}: ${plural(missing.length, 'image')} ${missing.length === 1 ? 'was' : 'were'} already missing and ${missing.length === 1 ? 'is' : 'are'} not in the backup.`);
    }
    const skipped = (d.media && d.media.skipped) || [];
    if (skipped.length) {
      const n = skipped.length;
      lines.push(`${d.name || d.id}: ${plural(n, 'image')} ${n === 1 ? 'is' : 'are'} not stored under sets/, so ${n === 1 ? 'it is' : 'they are'} not in the backup: ${skipped.join(', ')}.`);
    }
  }
  for (const f of failed) lines.push(`${f.refused ? 'Not archived' : 'Failed'}: ${f.name || f.id} — ${f.error}`);
  if (!done.length && !failed.length) lines.push('The export reported no backup and no error.');
  return lines;
}

const restoredAs = (entry) => {
  if (entry.legacy) return entry.kind === 'prompt' ? 'imported as a draft copy' : 'imported as an inactive set';
  return entry.mode === 'new-version' ? `new version v${entry.version}` : 'recreated';
};

export function describeRestore(response) {
  const results = (response && response.results) || {};
  const restored = results.successful || [];
  const failed = results.failed || [];
  const live = (response && response.becameActive) || [];
  const missing = (response && response.media && response.media.missing) || [];
  const skipped = (response && response.media && response.media.skipped) || [];
  const lines = [];
  if (live.length) lines.push(`Now live for every organisation: ${live.map((s) => s.name || s.id).join(', ')}.`);
  if (restored.length) {
    lines.push(`Restored ${restored.length}: ${restored.map((r) => `${r.name || r.id} (${restoredAs(r)})`).join('; ')}.`);
  }
  if (missing.length) lines.push(`${plural(missing.length, 'image')} could not be restored: ${missing.join(', ')}.`);
  if (skipped.length) {
    const n = skipped.length;
    lines.push(`${plural(n, 'image')} ${n === 1 ? 'was' : 'were'} not restored because ${n === 1 ? 'it is' : 'they are'} not stored under sets/: ${skipped.join(', ')}.`);
  }
  for (const f of failed) lines.push(`${f.refused ? 'Not restored' : 'Failed'}: ${f.archiveId} — ${f.error}`);
  if (!restored.length && !failed.length) lines.push('The import reported nothing restored and no error.');
  return lines;
}

/* ── THE EXPORTED COLUMN, AND "LAST BACKED UP" ────────────────────────────────────────────
   docs/design/archive-promotion/REVIEW.md: four snapshots taken today read the same as four
   taken this morning when the column shows the day only. The time tells batches apart. */

/** "Nov 5, 2026, 14:32" — the day and the 24-hour time; an em dash when there is no date. */
export function formatExported(value) {
  if (!value) return '—';
  const when = new Date(value);
  if (Number.isNaN(when.getTime())) return '—';
  const day = when.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  const pad = (n) => String(n).padStart(2, '0');
  return `${day}, ${pad(when.getHours())}:${pad(when.getMinutes())}`;
}

/**
 * When each source on `tier` was last backed up: a Map of `<scope>/<id>` (the snapshot's
 * `source:` tag) to the newest CreatedAt. Only snapshots taken ON this tier count: dev's
 * backup of `teamretro` says nothing about when test's copy was last saved.
 */
export function lastBackups(items, tier) {
  const latest = new Map();
  for (const item of items || []) {
    const source = archiveSource(item);
    if (!source || archiveTier(item) !== tier) continue;
    const at = Date.parse(item.CreatedAt);
    if (!Number.isFinite(at)) continue;
    if (!latest.has(source) || Date.parse(latest.get(source)) < at) latest.set(source, item.CreatedAt);
  }
  return latest;
}

/** "just now", "12 min ago", "3 h ago", "4 days ago", then the date. */
export function relativeTime(value, now = Date.now()) {
  const at = Date.parse(value);
  if (!Number.isFinite(at)) return '';
  const minutes = Math.max(0, Math.round((now - at) / 60000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${plural(days, 'day')} ago`;
  return new Date(at).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

export const PICKER_SORTS = [
  { value: 'name', label: 'Name' },
  { value: 'last', label: 'Last backed up' },
  { value: 'type', label: 'Type' },
];

/**
 * The export picker's rows: searched (name or id, case-insensitive) and sorted. Each row is
 * `{key, name, id, type, last}`; `last` is an ISO time or ''. Name sorts the name as SHOWN,
 * alphabetically and ignoring case. Last backed up puts the newest first and never-backed-up
 * last. Type groups by the type label, then by name. Ties fall back to name, then id.
 */
export function pickerRows(rows, { search = '', sort = 'name' } = {}) {
  const needle = String(search || '').trim().toLowerCase();
  const shown = needle
    ? rows.filter((row) => String(row.name || '').toLowerCase().includes(needle) || String(row.id || '').toLowerCase().includes(needle))
    : [...rows];
  const byName = (a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'en', { sensitivity: 'base' })
    || String(a.id).localeCompare(String(b.id));
  const time = (row) => (row.last ? Date.parse(row.last) || 0 : 0);
  const compare = {
    name: byName,
    last: (a, b) => (time(b) - time(a)) || byName(a, b),
    type: (a, b) => String(a.type || '').localeCompare(String(b.type || ''), 'en', { sensitivity: 'base' }) || byName(a, b),
  }[sort] || byName;
  return shown.sort(compare);
}

/* ── THE PREVIEW BEFORE A RESTORE, AND THE CHECK AFTER ────────────────────────────────────
   The import route's `dryRun` plan (lambda-functions/admin/import-from-archive.js) and the
   `check` each restored set carries. */

function verdictOf(entry) {
  const isPrompt = entry.kind === 'prompt';
  if (entry.mode !== 'new-version') {
    if (isPrompt) return entry.legacy ? 'New draft prompt' : 'New prompt';
    return 'New set';
  }
  const of = entry.currentVersion ? `v${entry.currentVersion}` : 'the existing one';
  if (isPrompt) return `New version of ${of}`;
  const state = { true: 'currently live', false: 'currently inactive' }[String(entry.currentlyActive)];
  return `New version of ${of}${state ? ` (${state})` : ''}`;
}

/** One preview row: what happens to this item, how big it is, and how it arrives. */
export function describePlanEntry(entry) {
  let counts = 'Prompt';
  if (entry.kind === 'set') {
    counts = [
      entry.questionCount != null ? plural(entry.questionCount, 'question') : '',
      entry.categoryCount != null ? `${entry.categoryCount} ${entry.categoryCount === 1 ? 'category' : 'categories'}` : '',
    ].filter(Boolean).join(' · ') || '—';
  }
  let arrival;
  if (entry.kind === 'set') arrival = entry.active ? 'Active on arrival' : 'Inactive on arrival';
  else arrival = entry.status === 'active' ? 'Active on arrival' : `Arrives as ${entry.status || 'draft'}`;
  return { verdict: verdictOf(entry), counts, arrival, live: entry.kind === 'set' && entry.active === true };
}

/** The restored sets with their read-back, for the check table. */
export function restoreChecks(response) {
  const restored = (response && response.results && response.results.successful) || [];
  return restored
    .filter((entry) => entry.kind === 'set' && entry.check)
    .map((entry) => ({ archiveId: entry.archiveId, id: entry.id, name: entry.name || entry.id, check: entry.check }));
}

/** "60 of 60" against the snapshot, or the bare count when the snapshot recorded none. */
export function checkCount(pair) {
  if (!pair) return '—';
  return pair.expected == null ? String(pair.found) : `${pair.found} of ${pair.expected}`;
}
