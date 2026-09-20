/**
 * THE SHELF AND THE SET'S OWN TAGS, AS THE EDITOR'S SAVE SEES THEM.
 *
 * Everything here is the pure half of the control in `SetTopicField.jsx`: what
 * the snapshot holds, what the diffed PUT body carries, what the save
 * confirmation says it wrote, and which proposal the editor should be offering.
 *
 * ── WHY NEITHER FIELD IS IN `EDITABLE_SET_FIELDS` ──────────────────────────
 *
 * That map is the "an empty string clears it" family, and it is asserted as
 * such in questionSetEditing.test.js ("can clear every editable field at
 * once"). The shelf is the one field that CANNOT be cleared —
 * `edit-question-set.js` answers 400 for a blank one, on purpose, because a
 * filed set silently becoming unfiled again is the single way the requirement
 * could be undone. And `tags` is a LIST, which no `!==` diff can compare.
 * Folding either into that map would make its stated contract false.
 */
import {
  editableSnapshot,
  buildEditPayload,
  describeSetChange,
  summarizeEditResult,
  normalizeVersions,
  latestTopicSuggestion,
} from '../utils/questionSetEditing';

/** A set as GET /admin/question-sets hands it over, filed and tagged. */
const FILED = {
  id: 'eighties-trivia',
  name: '80s Trivia',
  engagementType: 'trivia',
  topic: 'music',
  tags: ['1980s', 'pop'],
};

describe('editableSnapshot — the shelf', () => {
  it('keeps a stored shelf as the id the picker selects', () => {
    expect(editableSnapshot(FILED).topic).toBe('music');
  });

  it('leaves a set that predates the field UNFILED rather than filing it', () => {
    // rejects: resolving an absent topic to 'general-knowledge' here. The save
    // payload is a diff against this snapshot, so a resolved default would file
    // all forty legacy sets on the catch-all shelf, one accidental save at a
    // time — a migration nobody asked for, performed by the Save button.
    expect(editableSnapshot({ id: 'old-set' }).topic).toBe('');
  });

  it('drops a stored shelf that is not one of the fifteen', () => {
    // A reader resolves junk to Unfiled; the FORM must not offer to re-save it,
    // because `edit-question-set.js` would 400 and name a value nobody typed.
    expect(editableSnapshot({ topic: 'chemistry' }).topic).toBe('');
  });

  it('folds a label, so a set filed as "Science & Technology" reads as its id', () => {
    expect(editableSnapshot({ topic: 'Science & Technology' }).topic).toBe('science-technology');
  });
});

describe('editableSnapshot — the set’s own tags', () => {
  it('canonicalises what is stored, so an untouched set reports no changes', () => {
    expect(editableSnapshot({ tags: ['  Pop  ', 'NEW WAVE'] }).tags).toEqual(['pop', 'new-wave']);
  });

  it('is an empty ARRAY for a set with none — never a string, never undefined', () => {
    expect(editableSnapshot({ id: 'bare' }).tags).toEqual([]);
  });
});

describe('buildEditPayload — the shelf', () => {
  const original = editableSnapshot(FILED);

  it('omits the shelf when it was not changed', () => {
    const payload = buildEditPayload('80s Trivia', { ...original }, original);
    expect('topic' in payload).toBe(false);
  });

  it('sends the new shelf when it changed', () => {
    const payload = buildEditPayload('80s Trivia', { ...original, topic: 'history' }, original);
    expect(payload.topic).toBe('history');
  });

  it('files an unfiled set the moment one is chosen', () => {
    const unfiled = editableSnapshot({ id: 'old-set' });
    const payload = buildEditPayload('Old Set', { ...unfiled, topic: 'history' }, unfiled);
    expect(payload.topic).toBe('history');
  });

  it('NEVER sends a blank shelf, even when the form hands it one', () => {
    // rejects: the plain `!==` diff every other field uses. Sending '' is a
    // guaranteed 400 ("Give this set a topic…") over a save the person made
    // about something else entirely — a rename refused with a message about a
    // field they never touched. Omitting it leaves the row exactly as it was.
    const payload = buildEditPayload('80s Trivia', { ...original, topic: '' }, original);
    expect('topic' in payload).toBe(false);
  });

  it('leaves an unfiled set unfiled when nothing chose a shelf', () => {
    const unfiled = editableSnapshot({ id: 'old-set' });
    const payload = buildEditPayload('Old Set', { ...unfiled }, unfiled);
    expect('topic' in payload).toBe(false);
  });
});

describe('buildEditPayload — the set’s own tags', () => {
  const original = editableSnapshot(FILED);

  it('omits the list when it is the same list', () => {
    // rejects: comparing arrays with `!==`. Two equal arrays are never the same
    // object, so every open-and-save would re-send the tags and report a change
    // the person did not make.
    const payload = buildEditPayload('80s Trivia', { ...original, tags: ['1980s', 'pop'] }, original);
    expect('tags' in payload).toBe(false);
  });

  it('sends the list when a tag was added', () => {
    const payload = buildEditPayload('80s Trivia', { ...original, tags: ['1980s', 'pop', 'synth'] }, original);
    expect(payload.tags).toEqual(['1980s', 'pop', 'synth']);
  });

  it('sends the list when the ORDER changed, because the order is stored', () => {
    const payload = buildEditPayload('80s Trivia', { ...original, tags: ['pop', '1980s'] }, original);
    expect(payload.tags).toEqual(['pop', '1980s']);
  });

  it('sends an empty list to clear them — a tag is the author’s own word', () => {
    const payload = buildEditPayload('80s Trivia', { ...original, tags: [] }, original);
    expect(payload.tags).toEqual([]);
    expect('tags' in payload).toBe(true);
  });
});

describe('describeSetChange / summarizeEditResult — what landed', () => {
  it('names the shelf the way the picker named it, not the stored id', () => {
    // rejects: 'topic set to "science-technology"' — a value nobody saw on
    // screen, for the same reason roundKind echoes its label.
    expect(describeSetChange('topic', 'science-technology')).toBe('topic set to Science & Technology');
  });

  it('reads back through the whole save confirmation', () => {
    expect(summarizeEditResult('80s Trivia', { topic: 'music' }))
      .toBe('Saved "80s Trivia" — topic set to Music.');
  });

  it('lists the tags in the words the author typed them in', () => {
    expect(describeSetChange('tags', ['1980s', 'pop'])).toBe('tags set to 1980s, pop');
  });

  it('says tags were cleared rather than "set to nothing"', () => {
    // rejects: falling through to the generic `!value` branch. `[]` is TRUTHY
    // in JavaScript, so without its own branch an emptied list reports
    // 'tags set to ""' — which reads as a tag whose name is the empty string.
    expect(describeSetChange('tags', [])).toBe('tags cleared');
  });
});

describe('normalizeVersions — the proposal reaches the author', () => {
  const SUGGESTION = {
    topic: 'science-technology', tags: ['chemistry'], filedAs: 'music', mismatch: true,
  };

  it('carries the check’s proposal through the whitelist', () => {
    // `normalizeVersions` is the sole consumer of GET …/versions, so a field it
    // does not name does not exist as far as this editor is concerned.
    const [v] = normalizeVersions([{ version: 3, reviewTopicSuggestion: SUGGESTION }]);
    expect(v.reviewTopicSuggestion).toEqual(SUGGESTION);
  });

  it('a version nothing proposed for, and a reader who may not see one, both read as null', () => {
    expect(normalizeVersions([{ version: 1 }])[0].reviewTopicSuggestion).toBeNull();
    expect(normalizeVersions([{ version: 1, reviewTopicSuggestion: null }])[0].reviewTopicSuggestion)
      .toBeNull();
  });
});

describe('latestTopicSuggestion', () => {
  const proposal = (version, topic) => ({
    version, reviewTopicSuggestion: { topic, tags: [], filedAs: '', mismatch: false },
  });

  it('takes the newest proposal, because a later check read later questions', () => {
    const versions = normalizeVersions([proposal(1, 'history'), proposal(3, 'music')]);
    expect(latestTopicSuggestion(versions).topic).toBe('music');
  });

  it('skips versions nothing proposed for rather than stopping at them', () => {
    // A check can skip the proposal entirely — no budget, or the model would
    // not answer — while still writing its review. The version above it having
    // no proposal must not hide the one below it.
    const versions = normalizeVersions([{ version: 4 }, proposal(2, 'history')]);
    expect(latestTopicSuggestion(versions).topic).toBe('history');
  });

  it('is null when no version carries one', () => {
    expect(latestTopicSuggestion(normalizeVersions([{ version: 1 }]))).toBeNull();
    expect(latestTopicSuggestion([])).toBeNull();
  });
});
