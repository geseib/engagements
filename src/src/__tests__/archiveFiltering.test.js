import {
  archiveTags,
  archiveGameType,
  collectArchiveTags,
  tagFilterOptions,
  hasArchiveTag,
  filterArchiveItems,
} from '../utils/archiveFiltering';
import { GAME_TYPE_LIST } from '../config/gameTypes';

/**
 * Records shaped the way export-to-archive.js actually writes them.
 * See lambda-functions/admin/export-to-archive.js — Category is the engagement
 * type (or the prompt's gameType), and Tags repeats it next to the environment,
 * a questions:<n> count and any flags.
 */
const triviaSet = {
  ArchiveId: 'a1',
  Title: 'Tech Trivia (dev)',
  ContentType: 'questionset',
  Category: 'trivia',
  Tags: ['dev', 'trivia', 'questions:24'],
};

const callAndAnswerSet = {
  ArchiveId: 'a2',
  Title: 'Team Warmups (dev)',
  ContentType: 'questionset',
  Category: 'call-and-answer',
  Tags: ['dev', 'call-and-answer', 'questions:12', 'ai-generated'],
};

// An AI prompt is stored under the prompt-storage spelling, not the dashed id.
const callAndAnswerPrompt = {
  ArchiveId: 'a3',
  Title: 'Summary prompt (prod)',
  ContentType: 'prompt',
  Category: 'callandanswer',
  Tags: ['prod', 'callandanswer', 'summary', 'active'],
};

// Uploaded by hand through the panel's modal: Category is a topic, not a type.
const handUpload = {
  ArchiveId: 'a4',
  Title: 'Q3 offsite notes',
  ContentType: 'document',
  Category: 'business',
  Tags: [],
};

const ALL = [triviaSet, callAndAnswerSet, callAndAnswerPrompt, handUpload];

describe('archiveGameType', () => {
  it('reads the type out of Category', () => {
    expect(archiveGameType(triviaSet)).toBe('trivia');
    expect(archiveGameType(callAndAnswerSet)).toBe('call-and-answer');
  });

  it('accepts the legacy prompt spelling', () => {
    // `callandanswer` and `call-and-answer` are the same type; a filter that
    // treated them as different would hide every archived prompt.
    expect(archiveGameType(callAndAnswerPrompt)).toBe('call-and-answer');
    expect(archiveGameType({ Category: 'polls' })).toBe('poll');
    expect(archiveGameType({ Category: 'quiz' })).toBe('trivia');
  });

  it('falls back to Tags when Category is a topic', () => {
    const item = { Category: 'general', Tags: ['test', 'wavelength'] };
    expect(archiveGameType(item)).toBe('wavelength');
  });

  it('returns null rather than guessing a type', () => {
    // The registry's normalizeGameType() defaults unknown values to
    // call-and-answer. If that leaked in here, every hand-uploaded document
    // would show up under the Call & Answer filter.
    expect(archiveGameType(handUpload)).toBeNull();
    expect(archiveGameType({ Category: 'general', Tags: ['dev'] })).toBeNull();
    expect(archiveGameType({})).toBeNull();
    expect(archiveGameType(null)).toBeNull();
  });

  it('ignores case and stray whitespace', () => {
    expect(archiveGameType({ Category: ' Trivia ' })).toBe('trivia');
  });

  it('covers every type in the registry', () => {
    for (const type of GAME_TYPE_LIST) {
      expect(archiveGameType({ Category: type.id })).toBe(type.id);
    }
  });
});

describe('archiveTags', () => {
  it('normalises to trimmed non-empty strings', () => {
    expect(archiveTags({ Tags: [' dev ', '', null, 'ai-generated'] }))
      .toEqual(['dev', 'ai-generated']);
  });

  it('survives a missing or non-array Tags field', () => {
    expect(archiveTags({})).toEqual([]);
    expect(archiveTags(null)).toEqual([]);
    expect(archiveTags({ Tags: new Set(['dev']) })).toEqual(['dev']);
  });
});

describe('collectArchiveTags', () => {
  it('lists distinct tags alphabetically', () => {
    expect(collectArchiveTags(ALL)).toEqual([
      'ai-generated', 'active', 'dev', 'prod', 'questions:12', 'questions:24', 'summary',
    ].sort((a, b) => a.localeCompare(b)));
  });

  it('leaves game-type spellings out — they have their own dropdown', () => {
    const tags = collectArchiveTags(ALL);
    expect(tags).not.toContain('trivia');
    expect(tags).not.toContain('call-and-answer');
    expect(tags).not.toContain('callandanswer');
  });

  it('de-duplicates case-insensitively', () => {
    const tags = collectArchiveTags([{ Tags: ['Dev'] }, { Tags: ['dev'] }]);
    expect(tags).toEqual(['Dev']);
  });

  it('handles an empty archive', () => {
    expect(collectArchiveTags([])).toEqual([]);
    expect(collectArchiveTags(undefined)).toEqual([]);
  });
});

describe('tagFilterOptions', () => {
  it('keeps the current selection listed even when nothing carries it', () => {
    // Otherwise switching the game-type filter blanks the tag control while it
    // is still filtering, and the empty grid has no visible explanation.
    expect(tagFilterOptions([triviaSet], 'prod')).toEqual(['prod', 'dev', 'questions:24']);
  });

  it('does not duplicate a selection that is present', () => {
    expect(tagFilterOptions([triviaSet], 'dev')).toEqual(['dev', 'questions:24']);
  });
});

describe('hasArchiveTag', () => {
  it('matches case-insensitively', () => {
    expect(hasArchiveTag(triviaSet, 'DEV')).toBe(true);
    expect(hasArchiveTag(triviaSet, 'prod')).toBe(false);
  });

  it('treats an empty tag as no filter', () => {
    expect(hasArchiveTag(handUpload, '')).toBe(true);
  });
});

describe('filterArchiveItems', () => {
  it('returns everything when no filter is set', () => {
    expect(filterArchiveItems(ALL, {})).toEqual(ALL);
    expect(filterArchiveItems(ALL)).toEqual(ALL);
  });

  it('narrows by game type', () => {
    expect(filterArchiveItems(ALL, { gameType: 'trivia' })).toEqual([triviaSet]);
  });

  it('groups both spellings of a type under one selection', () => {
    expect(filterArchiveItems(ALL, { gameType: 'call-and-answer' }))
      .toEqual([callAndAnswerSet, callAndAnswerPrompt]);
  });

  it('accepts a legacy spelling as the selected value', () => {
    expect(filterArchiveItems(ALL, { gameType: 'callandanswer' }))
      .toEqual([callAndAnswerSet, callAndAnswerPrompt]);
  });

  it('excludes untyped records from every type filter', () => {
    for (const type of GAME_TYPE_LIST) {
      expect(filterArchiveItems(ALL, { gameType: type.id })).not.toContain(handUpload);
    }
  });

  it('narrows by tag', () => {
    expect(filterArchiveItems(ALL, { tag: 'ai-generated' })).toEqual([callAndAnswerSet]);
  });

  it('combines both axes', () => {
    expect(filterArchiveItems(ALL, { gameType: 'call-and-answer', tag: 'prod' }))
      .toEqual([callAndAnswerPrompt]);
    expect(filterArchiveItems(ALL, { gameType: 'trivia', tag: 'prod' })).toEqual([]);
  });

  it('matches nothing for an unrecognised game type', () => {
    // Not "everything", and not "the untyped ones" — a stale selection must not
    // silently widen the result set.
    expect(filterArchiveItems(ALL, { gameType: 'bingo' })).toEqual([]);
  });

  it('survives an empty archive', () => {
    expect(filterArchiveItems([], { gameType: 'trivia' })).toEqual([]);
    expect(filterArchiveItems(undefined, {})).toEqual([]);
  });
});
