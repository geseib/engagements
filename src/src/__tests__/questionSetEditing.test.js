import {
  EDITABLE_SET_FIELDS,
  describeSetChange,
  truncate,
  editableSnapshot,
  buildEditPayload,
  summarizeEditResult,
  parseCsv,
  summarizeCsv,
  describeReplacePlan,
  normalizeVersions,
  nextVersionNumber,
  interpretVersionDelete,
  versionDeleteTone
} from '../utils/questionSetEditing';
import { statusTone } from '../utils/statusTone';

/** A set as GET /admin/question-sets hands it over. */
const SET = {
  id: 'lessons-learned',
  name: 'Lessons Learned',
  description: 'Retro prompts',
  customInstruction: 'Answer in the STAR format.',
  aiContextInstruction: 'Healthcare engineering team',
  promptId: 'retro-v2',
  engagementType: 'callandanswer',
  roundNoun: 'Lesson',
  personaId: 'coach',
  totalQuestions: 42,
  categoryCount: 5,
  activeVersion: 3
};

describe('editableSnapshot', () => {
  it('normalises the storage spelling of the engagement type', () => {
    expect(editableSnapshot(SET).engagementType).toBe('call-and-answer');
  });

  it('turns every missing field into an empty string, never null or undefined', () => {
    const snapshot = editableSnapshot({ id: 'bare' });
    for (const field of Object.keys(EDITABLE_SET_FIELDS)) {
      expect(typeof snapshot[field]).toBe('string');
    }
    expect(snapshot.description).toBe('');
    // The one exception: the type always resolves to a real type.
    expect(snapshot.engagementType).toBe('call-and-answer');
  });

  it('trims, so reopening and saving an untouched set reports no changes', () => {
    const snapshot = editableSnapshot({ description: '  spaced  ' });
    expect(snapshot.description).toBe('spaced');
  });
});

/*
 * The regression guard on today's fix. `null` used to mean "skip" in the
 * lambda, so flattening every blank field to null made clearing any field a
 * silent no-op: the owner blanked a prompt, got "updated successfully", and the
 * prompt was still there.
 */
describe('buildEditPayload — the diff contract', () => {
  const original = editableSnapshot(SET);

  it('sends the name and nothing else when nothing changed', () => {
    expect(buildEditPayload('Lessons Learned', { ...original }, original))
      .toEqual({ name: 'Lessons Learned' });
  });

  it('OMITS an untouched field', () => {
    const payload = buildEditPayload('Lessons Learned', { ...original, roundNoun: 'Story' }, original);
    expect(payload).toEqual({ name: 'Lessons Learned', roundNoun: 'Story' });
    expect('description' in payload).toBe(false);
    expect('promptId' in payload).toBe(false);
    expect('personaId' in payload).toBe(false);
  });

  it("sends a CLEARED field as '' — not null, not undefined, not omitted", () => {
    const payload = buildEditPayload('Lessons Learned', { ...original, promptId: '' }, original);
    expect(payload.promptId).toBe('');
    expect('promptId' in payload).toBe(true);
    expect(payload.promptId).not.toBeNull();
    expect(payload.promptId).not.toBeUndefined();
  });

  it('can clear every editable field at once', () => {
    const cleared = {};
    for (const field of Object.keys(EDITABLE_SET_FIELDS)) cleared[field] = '';
    const payload = buildEditPayload('Lessons Learned', cleared, original);
    for (const field of Object.keys(EDITABLE_SET_FIELDS)) {
      expect(payload[field]).toBe('');
    }
  });

  it('treats a missing key in the snapshot as an empty original', () => {
    // A set opened before a field existed has no key for it. Typing into that
    // field must still register as a change.
    const payload = buildEditPayload('X', { ...original, roundNoun: 'Lesson' }, { ...original, roundNoun: undefined });
    expect(payload.roundNoun).toBe('Lesson');
  });

  it('never sends a field that is not in the editable whitelist', () => {
    const payload = buildEditPayload('X', { ...original, active: false, hackedField: 'nope' }, original);
    expect('active' in payload).toBe(false);
    expect('hackedField' in payload).toBe(false);
  });

  it('trims the name', () => {
    expect(buildEditPayload('  Lessons Learned  ', { ...original }, original).name)
      .toBe('Lessons Learned');
  });
});

describe('describeSetChange / summarizeEditResult', () => {
  it('names each landed change instead of a bare "updated successfully"', () => {
    expect(summarizeEditResult('Lessons Learned', { roundNoun: 'Story' }))
      .toBe('Saved "Lessons Learned" — round label set to "Story".');
  });

  it('says what a cleared field fell back to', () => {
    expect(describeSetChange('promptId', '')).toMatch(/game-type default/);
    expect(describeSetChange('personaId', '')).toMatch(/adapting to the session/);
    expect(describeSetChange('description', '')).toBe('description cleared');
  });

  it('admits when only the title moved', () => {
    expect(summarizeEditResult('Lessons Learned', {}))
      .toBe('Saved "Lessons Learned" — title only, no other fields changed.');
  });

  it('produces a message statusTone reads as success', () => {
    expect(statusTone(summarizeEditResult('Lessons Learned', { roundNoun: 'Story' }))).toBe('success');
  });
});

describe('truncate', () => {
  it('leaves a short string alone and ellipses a long one', () => {
    expect(truncate('short', 90)).toBe('short');
    expect(truncate('x'.repeat(200), 10)).toBe(`${'x'.repeat(9)}…`);
  });
});

describe('parseCsv', () => {
  it('does not split on a comma inside quotes', () => {
    const rows = parseCsv('Category,Title\n"Ops","Fix it, then ship it"');
    expect(rows[1]).toEqual(['Ops', 'Fix it, then ship it']);
  });

  it('handles escaped quotes and embedded newlines', () => {
    const rows = parseCsv('A\n"He said ""go""\nand went"');
    expect(rows[1][0]).toBe('He said "go"\nand went');
  });

  it('handles CRLF files, which is what Excel writes', () => {
    expect(parseCsv('A,B\r\n1,2\r\n')).toEqual([['A', 'B'], ['1', '2']]);
  });

  it('drops trailing blank lines rather than counting them as questions', () => {
    expect(parseCsv('A,B\n1,2\n\n\n')).toEqual([['A', 'B'], ['1', '2']]);
  });
});

describe('summarizeCsv', () => {
  const CSV = [
    'Category,Question#,Title,Detail_lesson',
    '"Ops",1,"Title one","Detail, with comma"',
    '"Ops",2,"Title two","Detail"',
    '"Delivery",1,"Title three","Detail"'
  ].join('\n');

  it('counts questions and distinct categories', () => {
    const summary = summarizeCsv(CSV);
    expect(summary.questionCount).toBe(3);
    expect(summary.categoryCount).toBe(2);
    expect(summary.categories).toEqual(['Ops', 'Delivery']);
    expect(summary.error).toBeNull();
  });

  it('refuses an empty file and a header-only file', () => {
    expect(summarizeCsv('').error).toMatch(/empty/i);
    expect(summarizeCsv('Category,Title').error).toMatch(/no questions/i);
  });

  it('warns rather than fails when there is no Category column', () => {
    const summary = summarizeCsv('Title,Detail\n"a","b"');
    expect(summary.error).toBeNull();
    expect(summary.questionCount).toBe(1);
    expect(summary.warning).toMatch(/No Category column/i);
  });
});

describe('describeReplacePlan', () => {
  const plan = describeReplacePlan(SET, { questionCount: 40, categoryCount: 6 }, 4);

  it('shows the new counts against the current ones, with the direction', () => {
    expect(plan[0]).toBe('Questions: 42 → 40 (2 fewer)');
    expect(plan[1]).toBe('Categories: 5 → 6 (1 more)');
  });

  it('says "unchanged" rather than "0 more"', () => {
    expect(describeReplacePlan(SET, { questionCount: 42, categoryCount: 5 })[0])
      .toBe('Questions: 42 → 42 (unchanged)');
  });

  // The owner's mental model is "the old questions get deleted". They are not.
  it('names the version it will write and promises the old one is kept', () => {
    expect(plan[2]).toMatch(/version 4/);
    expect(plan[2]).toMatch(/kept and can be promoted back/);
    expect(plan[2]).toMatch(/already in play stay on the version they started with/);
  });

  it('falls back to "a new version" when the version number is unknown', () => {
    expect(describeReplacePlan(SET, { questionCount: 1, categoryCount: 1 })[2])
      .toMatch(/a new version/);
  });
});

describe('normalizeVersions', () => {
  const PAYLOAD = [
    { version: 1, createdAt: '2026-01-01T00:00:00Z', questionCount: 10, categoryCount: 2, sourceFile: 'a.csv', isActive: false, pinnedByGames: [] },
    { version: 3, createdAt: '2026-03-01T00:00:00Z', questionCount: 12, categoryCount: 3, sourceFile: 'c.csv', isActive: true, pinnedByGames: ['GAME-9'] },
    { version: 2, createdAt: '2026-02-01T00:00:00Z', questionCount: 11, categoryCount: 3, sourceFile: 'b.csv', isActive: false, pinnedByGames: ['GAME-7', 'GAME-8'] }
  ];

  it('lists newest first', () => {
    expect(normalizeVersions(PAYLOAD).map((v) => v.version)).toEqual([3, 2, 1]);
  });

  it('marks exactly one row active from the payload flag', () => {
    const rows = normalizeVersions(PAYLOAD);
    expect(rows.filter((v) => v.isActive).map((v) => v.version)).toEqual([3]);
  });

  // A payload that omits isActive must still mark something active, or the
  // panel would offer "promote" on the version that is already live.
  it('falls back to the set activeVersion when no row claims to be active', () => {
    const bare = PAYLOAD.map(({ isActive, ...rest }) => rest);
    const rows = normalizeVersions(bare, 2);
    expect(rows.filter((v) => v.isActive).map((v) => v.version)).toEqual([2]);
  });

  it('accepts either a bare array or { versions: [] }', () => {
    expect(normalizeVersions({ versions: PAYLOAD }).map((v) => v.version)).toEqual([3, 2, 1]);
    expect(normalizeVersions(null)).toEqual([]);
    expect(normalizeVersions(undefined)).toEqual([]);
  });

  it('defaults the pinned list so the row never has to null-check it', () => {
    const rows = normalizeVersions([{ version: 1 }]);
    expect(rows[0].pinnedByGames).toEqual([]);
    expect(rows[0].questionCount).toBe(0);
  });

  it('drops rows with an unusable version number', () => {
    expect(normalizeVersions([{ version: 'nonsense' }, { version: 2 }]).map((v) => v.version))
      .toEqual([2]);
  });
});

describe('nextVersionNumber', () => {
  it('is one past the highest version seen', () => {
    expect(nextVersionNumber(normalizeVersions([{ version: 1 }, { version: 3 }]))).toBe(4);
  });

  it('counts the set activeVersion even when the list is empty', () => {
    expect(nextVersionNumber([], 7)).toBe(8);
  });

  it('is null when there is no version history at all', () => {
    expect(nextVersionNumber([])).toBeNull();
  });
});

describe('interpretVersionDelete', () => {
  // 409 on the active version. "Delete failed" tells the owner nothing about
  // the fix, which is to promote another version first.
  it('explains a 409 on the active version instead of failing generically', () => {
    const verdict = interpretVersionDelete(3, 409, { error: 'Cannot delete active version', activeVersion: 3 });
    expect(verdict.outcome).toBe('refused');
    expect(verdict.message).toContain('active version');
    expect(verdict.message).toContain('v3');
    expect(verdict.message).toMatch(/Promote another version first/);
    expect(versionDeleteTone(verdict.outcome)).toBe('error');
  });

  it('handles a 409 that does not name the active version', () => {
    const verdict = interpretVersionDelete(3, 409, { error: 'nope' });
    expect(verdict.outcome).toBe('refused');
    expect(verdict.message).toMatch(/Promote another version first/);
  });

  // 200 + warning + pinnedByGames means NOT deleted — it is a question.
  it('turns a pinned-game warning into a confirmation, naming the games', () => {
    const verdict = interpretVersionDelete(2, 200, {
      warning: 'Version 2 is pinned by live engagements',
      pinnedByGames: ['GAME-7', 'GAME-8']
    });
    expect(verdict.outcome).toBe('confirm');
    expect(verdict.pinnedByGames).toEqual(['GAME-7', 'GAME-8']);
    expect(verdict.message).toBe('Version 2 is pinned by live engagements');
  });

  it('writes its own warning, with the game ids, when the server sends none', () => {
    const verdict = interpretVersionDelete(2, 200, { pinnedByGames: ['GAME-7'] });
    expect(verdict.outcome).toBe('confirm');
    expect(verdict.message).toContain('GAME-7');
    expect(verdict.message).toMatch(/1 engagement is still playing version 2/);
  });

  it('never reports a pinned version as deleted', () => {
    const verdict = interpretVersionDelete(2, 200, { warning: 'in use', pinnedByGames: ['GAME-7'] });
    expect(verdict.outcome).not.toBe('deleted');
  });

  it('reports a clean delete', () => {
    const verdict = interpretVersionDelete(2, 200, { deleted: true });
    expect(verdict.outcome).toBe('deleted');
    expect(verdict.message).toBe('Version 2 deleted.');
    expect(versionDeleteTone(verdict.outcome)).toBe('success');
    expect(statusTone(verdict.message)).toBe('success');
  });

  it('treats a bare 200 with no body as a delete', () => {
    expect(interpretVersionDelete(2, 200, {}).outcome).toBe('deleted');
    expect(interpretVersionDelete(2, 204, null).outcome).toBe('deleted');
  });

  it('surfaces the server error on any other status', () => {
    expect(interpretVersionDelete(2, 500, { error: 'boom' }))
      .toMatchObject({ outcome: 'error', message: 'Delete failed: boom' });
    expect(interpretVersionDelete(2, 404, {}).message).toBe('Delete failed: HTTP 404');
  });
});

describe('versionDeleteTone', () => {
  it('keeps the banner tone explicit rather than sniffing the copy', () => {
    expect(versionDeleteTone('deleted')).toBe('success');
    expect(versionDeleteTone('confirm')).toBe('pending');
    expect(versionDeleteTone('refused')).toBe('error');
    expect(versionDeleteTone('error')).toBe('error');
  });
});
