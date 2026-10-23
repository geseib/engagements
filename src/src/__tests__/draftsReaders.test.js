/**
 * THE PURE READERS BEHIND THE DRAFT REVIEW AND THE BELL
 * (docs/design/ai-generation-review). No React, no fetch.
 *
 * // rejects: a review that groups questions under the wrong category, a
 * //          defect it cannot see, an estimate that invents a number, a bell
 * //          link that lands in the wrong library, and a destination that
 * //          offers Engage to somebody who is not staff.
 */
import {
  groupByCategory, itemDefect, tokenEstimate, waitingDrafts, draftsForSet, restorableDrafts, draftNoun,
} from '../utils/draftsApi';
import { destinationOf, daysLeftLabel } from '../utils/notificationsApi';
import {
  librariesFrom, libraryLabel, defaultLibraryKey, libraryKeyOf, ENGAGE_KEY,
} from '../utils/libraries';

const it_ = (seq, category, extra = {}) => ({ seq, decision: 'keep', item: { title: `Q${seq}`, category, ...extra } });

describe('grouping a draft by category', () => {
  test('first-seen order, every item once', () => {
    const groups = groupByCategory([it_(1, 'B'), it_(2, 'A'), it_(3, 'B')]);
    expect(groups.map((g) => g.category)).toEqual(['B', 'A']);
    expect(groups[0].items.map((i) => i.seq)).toEqual([1, 3]);
  });
  test('a question with no category is filed, not dropped', () => {
    expect(groupByCategory([it_(1, '')])[0].category).toBe('Uncategorised');
  });
});

describe('what is wrong with a generated question', () => {
  test('a trivia answer key that points at an empty option', () => {
    expect(itemDefect({ title: 'x', correctAnswer: 'OptionC', optionA: 'a', optionB: 'b' }, 'trivia'))
      .toMatch(/empty option/);
  });
  test('a trivia question with no answer key', () => {
    expect(itemDefect({ title: 'x', optionA: 'a' }, 'trivia')).toMatch(/cannot be scored/);
  });
  test('a scenario with no text', () => {
    expect(itemDefect({ title: 'x', detail: ' ' }, 'call-and-answer')).toMatch(/nothing for the room/);
  });
  test('a sound question has none', () => {
    expect(itemDefect({ title: 'x', correctAnswer: 'OptionA', optionA: 'a' }, 'trivia')).toBeNull();
  });
});

describe('the cost, stated before it is paid', () => {
  test('count × tokens per item, rounded', () => {
    expect(tokenEstimate(10, 700)).toBe('about 7,000 output tokens');
  });
  test('no rate known, no number invented', () => {
    expect(tokenEstimate(10, 0)).toBe('');
  });
});

describe('which drafts wait where', () => {
  const drafts = [
    { draftId: 'a', status: 'ready', mode: 'append', targetSetId: 'history', produced: 4 },
    { draftId: 'b', status: 'generating', mode: 'new' },
    { draftId: 'c', status: 'failed', mode: 'new' },
    { draftId: 'd', status: 'discarded', mode: 'new' },
    { draftId: 'e', status: 'accepted', mode: 'append', targetSetId: 'history' },
  ];
  test('waiting means ready or failed', () => {
    expect(waitingDrafts(drafts).map((d) => d.draftId)).toEqual(['a', 'c']);
  });
  test('a set shows only the draft still waiting to join it — an accepted one turns its tag off', () => {
    expect(draftsForSet(drafts, 'history').map((d) => d.draftId)).toEqual(['a']);
  });
  test('discarded drafts are offered for restore', () => {
    expect(restorableDrafts(drafts).map((d) => d.draftId)).toEqual(['d']);
  });
  test('the noun follows the kind of set', () => {
    expect(draftNoun('poll')).toBe('poll questions');
    expect(draftNoun('call-and-answer')).toBe('questions');
  });
});

describe('where a notification goes', () => {
  test('a draft opens its review, in its own library', () => {
    expect(destinationOf({ type: 'draft', draftId: 'abc123def', orgId: 'org_1' }))
      .toEqual({ libraryKey: 'org_1', url: '/admin?section=questionsets&draft=abc123def' });
  });
  test('a section of a team', () => {
    expect(destinationOf({ type: 'section', orgId: 'org_1', section: 'members' }))
      .toEqual({ libraryKey: 'org_1', url: '/admin?section=members' });
  });
  test('an invitation goes to the Overview, where invitations are answered', () => {
    expect(destinationOf({ type: 'invites' }).url).toBe('/admin?section=overview');
  });
  test('Claude\'s unsaved question set (#45) opens its Build Room, from any library', () => {
    expect(destinationOf({ type: 'build', gameId: '4821', setId: 'x', orgId: 'org_1' }))
      .toEqual({ libraryKey: '', url: '/build?gameId=4821' });
    expect(destinationOf({ type: 'build', gameId: '../admin' }).url).toBe('/admin');
  });
  test('days left, in words', () => {
    expect(daysLeftLabel(1)).toBe('1 day left');
    expect(daysLeftLabel(0)).toBe('expires today');
    expect(daysLeftLabel(null)).toBe('');
  });
});

describe('where work is saved', () => {
  const orgs = [
    { orgId: 'org_team', name: 'Northwind', type: 'team' },
    { orgId: 'org_me', name: 'Amara', type: 'personal' },
  ];
  test('Your space first, then each team; Engage only for staff', () => {
    expect(librariesFrom(orgs, false).map((l) => l.label)).toEqual(['Your space', 'Northwind']);
    expect(librariesFrom(orgs, true).map((l) => l.key)).toEqual(['org_me', 'org_team', ENGAGE_KEY]);
  });
  test('the default is the library the console stands in, else Your space', () => {
    const libs = librariesFrom(orgs, true);
    expect(defaultLibraryKey(libs, ENGAGE_KEY)).toBe(ENGAGE_KEY);
    expect(defaultLibraryKey(libs, 'org_team')).toBe('org_team');
    expect(defaultLibraryKey(libs, 'org_somebody_else')).toBe('org_me');
  });
  test('labels and keys', () => {
    const libs = librariesFrom(orgs, true);
    expect(libraryLabel('org_team', libs)).toBe('Northwind');
    expect(libraryLabel(ENGAGE_KEY, libs)).toBe('Engage');
    expect(libraryKeyOf({ scope: 'platform', orgId: '' })).toBe(ENGAGE_KEY);
    expect(libraryKeyOf({ scope: 'org', orgId: 'org_me' })).toBe('org_me');
  });
});
