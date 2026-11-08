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
  formatExported, lastBackups, relativeTime, pickerRows, describePlanEntry, restoreChecks, checkCount,
  promptChecks, batchNoun, promptsFirst, mergeExports,
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
  test('images not stored under sets/ are named as not restored, after the ones that could not be', () => {
    const quiz = { archiveId: 'arc-1', kind: 'set', id: 'quiz', name: 'Quiz', mode: 'created', version: 1, active: false };
    expect(describeRestore({
      results: { successful: [quiz], failed: [] },
      becameActive: [],
      media: { copied: 1, kept: 0, missing: ['sets/quiz/gone.png'], skipped: ['images/legacy.png'] },
    })).toEqual([
      'Restored 1: Quiz (recreated).',
      '1 image could not be restored: sets/quiz/gone.png.',
      '1 image was not restored because it is not stored under sets/: images/legacy.png.',
    ]);
    expect(describeRestore({
      results: { successful: [quiz], failed: [] },
      becameActive: [],
      media: { copied: 0, kept: 0, missing: [], skipped: ['images/a.png', 'images/b.png'] },
    })).toEqual([
      'Restored 1: Quiz (recreated).',
      '2 images were not restored because they are not stored under sets/: images/a.png, images/b.png.',
    ]);
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
  test('images stored outside sets/ are named as not in the backup, after the missing ones', () => {
    expect(describeExport({
      results: {
        successful: [
          { id: 'teamretro', name: 'Team Retro', media: { copied: 1, missing: ['sets/teamretro/old.png'], skipped: ['images/legacy.png'] } },
          { id: 'quiz', name: 'Quiz', media: { copied: 0, missing: [], skipped: ['images/a.png', 'images/b.png'] } },
        ],
        failed: [],
      },
    })).toEqual([
      'Backed up 2: Team Retro, Quiz.',
      'Team Retro: 1 image was already missing and is not in the backup.',
      'Team Retro: 1 image is not stored under sets/, so it is not in the backup: images/legacy.png.',
      'Quiz: 2 images are not stored under sets/, so they are not in the backup: images/a.png, images/b.png.',
    ]);
  });
});

describe('telling batches apart, and when a source was last backed up', () => {
  test('the Exported value carries the 24-hour time as well as the day', () => {
    const at = new Date(2026, 10, 5, 9, 7).toISOString();
    expect(formatExported(at)).toBe('Nov 5, 2026, 09:07');
    expect(formatExported('')).toBe('—');
    expect(formatExported('not a date')).toBe('—');
  });
  test('last backed up is per source and per tier: the newest snapshot taken ON this tier', () => {
    const newer = snapshot('arc-9', 'dev', 'platform/teamretro', '2026-09-20T12:00:00.000Z');
    const last = lastBackups([NEW_RETRO, OLD_RETRO, newer, SHARED, LEGACY], 'dev');
    expect([...last.entries()]).toEqual([['platform/teamretro', '2026-09-20T12:00:00.000Z']]);
    expect(lastBackups([NEW_RETRO], 'prod').get('platform/teamretro')).toBe('2026-09-15T12:00:00.000Z');
  });
  test('relative time reads in plain words, and falls back to the date after a month', () => {
    const now = Date.parse('2026-11-05T12:00:00.000Z');
    expect(relativeTime('2026-11-05T11:59:40.000Z', now)).toBe('just now');
    expect(relativeTime('2026-11-05T11:48:00.000Z', now)).toBe('12 min ago');
    expect(relativeTime('2026-11-05T09:00:00.000Z', now)).toBe('3 h ago');
    expect(relativeTime('2026-11-04T12:00:00.000Z', now)).toBe('1 day ago');
    expect(relativeTime('2026-11-01T12:00:00.000Z', now)).toBe('4 days ago');
    expect(relativeTime('2026-08-01T12:00:00.000Z', now)).toBe('Aug 1, 2026');
    expect(relativeTime('', now)).toBe('');
  });
});

describe('the export picker', () => {
  const ROWS = [
    { key: 'platform:music', id: 'musicpopcultureencore', name: 'Music & Pop Culture: Encore!', type: 'Trivia', last: '2026-11-05T10:00:00.000Z' },
    { key: 'platform:tech', id: 'techworld', name: 'lessons from the Tech World', type: 'Call & Answer', last: '' },
    { key: 'platform:hist', id: 'historicleaders', name: 'Historic World Leaders', type: 'Trivia', last: '2026-11-05T11:00:00.000Z' },
  ];
  const ids = (rows) => rows.map((r) => r.id);
  test('name sorts the name as shown, alphabetically, ignoring case', () => {
    expect(ids(pickerRows(ROWS))).toEqual(['historicleaders', 'techworld', 'musicpopcultureencore']);
  });
  test('last backed up puts the newest first and the never-backed-up last', () => {
    expect(ids(pickerRows(ROWS, { sort: 'last' }))).toEqual(['historicleaders', 'musicpopcultureencore', 'techworld']);
  });
  test('type groups by type, then by name', () => {
    expect(ids(pickerRows(ROWS, { sort: 'type' }))).toEqual(['techworld', 'historicleaders', 'musicpopcultureencore']);
  });
  test('search matches the name or the id, ignoring case, and does not reorder the input', () => {
    expect(ids(pickerRows(ROWS, { search: 'WORLD' }))).toEqual(['historicleaders', 'techworld']);
    expect(ids(pickerRows(ROWS, { search: 'popcultureenc' }))).toEqual(['musicpopcultureencore']);
    expect(ROWS[0].id).toBe('musicpopcultureencore');
  });
});

describe('the restore preview and the check after it', () => {
  test('a new version names the live version and whether it is live now', () => {
    expect(describePlanEntry({ kind: 'set', mode: 'new-version', currentVersion: 3, currentlyActive: true, active: true, questionCount: 60, categoryCount: 6 }))
      .toEqual({ verdict: 'New version of v3 (currently live)', counts: '60 questions · 6 categories', arrival: 'Active on arrival', live: true, external: '' });
    expect(describePlanEntry({ kind: 'set', mode: 'new-version', currentVersion: 1, currentlyActive: false, active: false, questionCount: 1, categoryCount: 1 }))
      .toEqual({ verdict: 'New version of v1 (currently inactive)', counts: '1 question · 1 category', arrival: 'Inactive on arrival', live: false, external: '' });
  });
  test('a new set, a legacy CSV with no category count, and a prompt', () => {
    expect(describePlanEntry({ kind: 'set', mode: 'created', active: false, questionCount: 7, categoryCount: null, legacy: true }).verdict).toBe('New set');
    expect(describePlanEntry({ kind: 'set', mode: 'created', active: false, questionCount: 7, categoryCount: null }).counts).toBe('7 questions');
    expect(describePlanEntry({ kind: 'prompt', mode: 'new-version', currentVersion: 4, status: 'active' }))
      .toEqual({ verdict: 'New version of v4', counts: 'Prompt', arrival: 'Active on arrival', live: false, external: '' });
    expect(describePlanEntry({ kind: 'prompt', mode: 'created', status: 'draft', legacy: true }).verdict).toBe('New draft prompt');
  });
  test('the check lists only sets that carry one, and counts read "found of expected"', () => {
    const checks = restoreChecks({ results: { successful: [
      { archiveId: 'a', kind: 'set', id: 's1', name: 'One', check: { questions: { expected: 60, found: 58 }, matches: false } },
      { archiveId: 'b', kind: 'prompt', id: 'p1' },
    ] } });
    expect(checks).toEqual([{ archiveId: 'a', id: 's1', name: 'One', check: { questions: { expected: 60, found: 58 }, matches: false } }]);
    expect(checkCount({ expected: 60, found: 58 })).toBe('58 of 60');
    expect(checkCount({ expected: null, found: 6 })).toBe('6');
    expect(checkCount(undefined)).toBe('—');
  });
  test('a set whose images stay on another site says how many', () => {
    expect(describePlanEntry({ kind: 'set', mode: 'created', active: true, questionCount: 2, categoryCount: 1, externalImages: ['https://x/a.jpg'] }).external)
      .toBe('1 image stays on another site');
    expect(describePlanEntry({ kind: 'set', mode: 'created', active: true, questionCount: 2, categoryCount: 1, externalImages: ['a', 'b'] }).external)
      .toBe('2 images stay on another site');
  });
  test('prompts carry their read-back too, in their own list', () => {
    const response = { results: { successful: [
      { archiveId: 'a', kind: 'set', id: 's1', check: { matches: true } },
      { archiveId: 'b', kind: 'prompt', id: 'p1', name: 'P', check: { version: 2, status: 'active', active: true, name: 'P', matches: true } },
      { archiveId: 'c', kind: 'prompt', id: 'p2' },
    ] } };
    expect(promptChecks(response)).toEqual([{ archiveId: 'b', id: 'p1', name: 'P', check: { version: 2, status: 'active', active: true, name: 'P', matches: true } }]);
  });
});

describe('one batch, prompts first', () => {
  test('batchNoun names what the batch holds', () => {
    expect(batchNoun(2, 0)).toBe('2 sets');
    expect(batchNoun(0, 1)).toBe('1 prompt');
    expect(batchNoun(1, 2)).toBe('1 set and 2 prompts');
    expect(batchNoun(0, 0)).toBe('');
  });
  test('promptsFirst moves prompts ahead of sets and keeps the order within each', () => {
    const items = [
      { ArchiveId: 's1', ContentType: 'questionset' }, { ArchiveId: 'p1', ContentType: 'prompt' },
      { ArchiveId: 's2', ContentType: 'questionset' }, { ArchiveId: 'p2', ContentType: 'prompt' },
    ];
    expect(promptsFirst(['s1', 'p1', 's2', 'unknown', 'p2'], items)).toEqual(['p1', 'p2', 's1', 's2', 'unknown']);
    expect(promptsFirst(new Set(['s2', 'p2']), items)).toEqual(['p2', 's2']);
  });
  test('mergeExports joins the prompt and set responses in that order; a missing one is skipped', () => {
    const merged = mergeExports(
      { results: { successful: [{ archiveId: 'p' }], failed: [], totalRequested: 1 } },
      null,
      { results: { successful: [{ archiveId: 's' }], failed: [{ id: 'x' }], totalRequested: 2 } },
    );
    expect(merged).toEqual({ results: { successful: [{ archiveId: 'p' }, { archiveId: 's' }], failed: [{ id: 'x' }], totalRequested: 3 } });
  });
  test('the export and restore reports list images that stay on another site', () => {
    expect(describeExport({ results: { successful: [{ name: 'W', media: { missing: [], skipped: [], external: ['https://w/a.jpg'] } }], failed: [] } }))
      .toContain('W: 1 image stays on another site, not copied: https://w/a.jpg.');
    expect(describeRestore({ results: { successful: [{ id: 'w', kind: 'set', mode: 'created' }], failed: [] }, media: { missing: [], skipped: [], external: ['u1', 'u2', 'u1'] } }))
      .toContain('2 images stay on another site, not copied: u1, u2.');
  });
});
