/**
 * WHAT AN ARCHIVE ITEM IS, READ OFF ITS TAGS — utils/archiveItems.js.
 *
 * Every tier reads every tier's backups (spec A2), so the screen has to say where each one came
 * from, keep a source's snapshots together, send export requests that name their library, and
 * report a restore in words that lead with what just went live for every organisation.
 */
import {
  TIERS, archiveTier, archiveScope, archiveSource, isSnapshot, displayTags, groupSnapshots,
  selectionKey, exportSelection, describeExport, describeRestore,
} from '../utils/archiveItems';

const snapshot = (id, tier, source, createdAt, extra = []) => ({
  ArchiveId: id, Title: source, CreatedAt: createdAt,
  Tags: [tier, 'schema:engage.set/1', `scope:${source.split('/')[0]}`, `source:${source}`, `exportedAt:${createdAt}`, ...extra],
});
const NEW_RETRO = snapshot('arc-3', 'prod', 'platform/teamretro', '2026-09-15T12:00:00.000Z', ['call-and-answer', 'questions:12']);
const OLD_RETRO = snapshot('arc-1', 'dev', 'platform/teamretro', '2026-09-01T12:00:00.000Z');
const SHARED = snapshot('arc-2', 'test', 'public/acme-quiz', '2026-09-10T12:00:00.000Z');
const LEGACY = { ArchiveId: 'arc-0', Title: 'Old Quiz (dev)', CreatedAt: '2026-08-01T00:00:00.000Z', Tags: ['dev', 'trivia', 'questions:3'] };

describe('reading an item', () => {
  test('the tier is the environment tag, for snapshots and legacy items alike', () => {
    expect(TIERS).toEqual(['dev', 'test', 'prod']);
    expect(archiveTier(NEW_RETRO)).toBe('prod');
    expect(archiveTier(LEGACY)).toBe('dev');
    expect(archiveTier({ Tags: ['business'] })).toBe('');
  });
  test('scope, source and snapshot-ness come from the structured tags', () => {
    expect(archiveScope(SHARED)).toBe('public');
    expect(archiveSource(NEW_RETRO)).toBe('platform/teamretro');
    expect(isSnapshot(NEW_RETRO)).toBe(true);
    expect(isSnapshot(LEGACY)).toBe(false);
    expect(archiveScope(LEGACY)).toBe('');
  });
  test('display tags leave out the structured tags and the tier, which have their own chips', () => {
    expect(displayTags(NEW_RETRO)).toEqual(['call-and-answer', 'questions:12']);
    expect(displayTags(LEGACY)).toEqual(['trivia', 'questions:3']);
  });
});

describe('groupSnapshots', () => {
  test("a source's snapshots sit together, newest first, and groups follow their newest snapshot", () => {
    const rows = groupSnapshots([OLD_RETRO, LEGACY, SHARED, NEW_RETRO]);
    expect(rows.map((r) => r.item.ArchiveId)).toEqual(['arc-3', 'arc-1', 'arc-2', 'arc-0']);
    expect(rows.map((r) => [r.latest, r.snapshots])).toEqual([[true, 2], [false, 2], [true, 1], [true, 1]]);
  });
  test('an empty archive groups to nothing', () => {
    expect(groupSnapshots([])).toEqual([]);
    expect(groupSnapshots(undefined)).toEqual([]);
  });
});

describe('export selection', () => {
  test('keys round-trip to {scope, id}, and an organisation set can never be sent', () => {
    const keys = new Set([selectionKey('platform', 'teamretro'), selectionKey('public', 'acme-quiz'), selectionKey('org', 'mine')]);
    expect(exportSelection(keys)).toEqual([{ scope: 'platform', id: 'teamretro' }, { scope: 'public', id: 'acme-quiz' }]);
  });
  test('a missing scope is the platform library', () => {
    expect(selectionKey(undefined, 'x')).toBe('platform:x');
  });
});

describe('describeRestore', () => {
  test('what went live comes first, then what happened to each item, then what was refused', () => {
    const lines = describeRestore({
      results: {
        successful: [
          { archiveId: 'arc-3', kind: 'set', id: 'teamretro', name: 'Team Retro', mode: 'new-version', version: 4, active: true },
          { archiveId: 'arc-2', kind: 'set', id: 'acme-quiz', name: 'Acme Quiz', mode: 'created', version: 1, active: false },
          { archiveId: 'arc-0', kind: 'set', id: 'oldquiz', name: 'Old Quiz', mode: 'created', version: null, active: false, legacy: true },
        ],
        failed: [{ archiveId: 'arc-9', refused: true, error: 'Organisation content is not archived: it is encrypted per organisation.' }],
      },
      becameActive: [{ id: 'teamretro', name: 'Team Retro' }],
      media: { copied: 2, kept: 1, missing: ['sets/acme-quiz/gone.png'] },
    });
    expect(lines).toEqual([
      'Now live for every organisation: Team Retro.',
      'Restored 3: Team Retro (new version v4); Acme Quiz (recreated); Old Quiz (imported as an inactive set).',
      '1 image could not be restored: sets/acme-quiz/gone.png.',
      'Not restored: arc-9 — Organisation content is not archived: it is encrypted per organisation.',
    ]);
  });
  test('a restore that did nothing says so rather than saying nothing', () => {
    expect(describeRestore({ results: { successful: [], failed: [] } })).toEqual(['The import reported nothing restored and no error.']);
  });
});

describe('describeExport', () => {
  test('backups, lost images and refusals, each named', () => {
    expect(describeExport({
      results: {
        successful: [{ id: 'teamretro', name: 'Team Retro', media: { copied: 1, missing: ['sets/teamretro/old.png'] } }],
        failed: [{ id: 'mine', scope: 'org', refused: true, error: 'Organisation content is not archived: it is encrypted per organisation.' }],
      },
    })).toEqual([
      'Backed up 1: Team Retro.',
      'Team Retro: 1 image was already missing and is not in the backup.',
      'Not archived: mine — Organisation content is not archived: it is encrypted per organisation.',
    ]);
  });
  test('an export that did nothing says so', () => {
    expect(describeExport({ results: {} })).toEqual(['The export reported no backup and no error.']);
  });
});
