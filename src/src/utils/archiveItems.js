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
