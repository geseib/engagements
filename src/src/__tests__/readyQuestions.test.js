import {
  buildAskFromQuestion, askedAs, isBuildRoomSet, groupReady, typeCounts, claudeSetItems, draftsFromClaudeSet, ASKED_AS,
} from '../buildroom/readyQuestions';
import { offeredForSessions } from '../config/setFinder';

const CAA = { engagementType: 'call-and-answer', tags: ['build-room'] };
const POLL = { engagementType: 'poll', tags: ['build-room'] };

describe('a question as a Build Room ask (step 7b)', () => {
  test('Call and Answer is Ideas, carrying what Claude gets and the note', () => {
    expect(buildAskFromQuestion({ title: 'Who is this for?', detail: 'One sentence.', claudeGets: 'keep', claudeNote: 'Treat it as the audience.' }, CAA))
      .toEqual({ ask: { kind: 'suggest', prompt: 'Who is this for?', detail: 'One sentence.', claudeGets: 'keep', claudeNote: 'Treat it as the audience.' }, type: 'suggest' });
  });

  test('no ClaudeGets reads as Do now', () => {
    expect(buildAskFromQuestion({ title: 'What should we cut?' }, CAA).ask.claudeGets).toBe('do-now');
  });

  test('poll rating 1 to 5 is Rate; any other scale says why', () => {
    expect(buildAskFromQuestion({ title: 'How clear?', kind: 'rating', scale: '1-5' }, POLL).ask.kind).toBe('rating');
    expect(buildAskFromQuestion({ title: 'How clear?', kind: 'rating', scale: '1-10' }, POLL).reason).toBe('A Build Room rates on 1 to 5; this question uses 1 to 10.');
    expect(buildAskFromQuestion({ title: 'How clear?', kind: 'rating', scale: 'stars' }, POLL).reason).toMatch('uses stars');
  });

  test('poll choice of 2 to 6 is Choose; one pick unless the question allows more', () => {
    const one = buildAskFromQuestion({ title: 'Which day?', kind: 'choice', options: ['Mon', 'Fri', ''] }, POLL).ask;
    expect(one).toMatchObject({ kind: 'choice', options: [{ title: 'Mon' }, { title: 'Fri' }], maxPicks: 1 });
    const many = buildAskFromQuestion({ title: 'Which days?', kind: 'choice', options: ['Mon', 'Tue', 'Fri'], allowMultiple: true, maxPicks: 2 }, POLL).ask;
    expect(many.maxPicks).toBe(2);
    expect(buildAskFromQuestion({ title: 'Which?', kind: 'choice', options: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] }, POLL).reason).toBe('A Build Room choice takes at most 6 options; this one has 7.');
    expect(buildAskFromQuestion({ title: 'Which?', kind: 'choice', options: ['a'] }, POLL).reason).toMatch('at least 2');
  });

  // Owner, 24 Oct: "some questions are ideas (free form responses), some are multiple choice
  // (with the choices), some are yes no." One Poll set holds all four.
  test('poll open answer is Ideas', () => {
    expect(buildAskFromQuestion({ title: 'What next?', kind: 'text', claudeGets: 'later' }, POLL))
      .toEqual({ ask: { kind: 'suggest', prompt: 'What next?', detail: '', claudeGets: 'later', claudeNote: '' }, type: 'suggest' });
  });

  test('poll yes or no is Yes/No: the room\'s choice of its two answers, renamed when the set renames them', () => {
    const plain = buildAskFromQuestion({ title: 'Ship it?', kind: 'yesno', unsure: true }, POLL);
    expect(plain).toEqual({ ask: { kind: 'choice', prompt: 'Ship it?', detail: '', claudeGets: 'do-now', claudeNote: '', options: [{ title: 'Yes' }, { title: 'No' }], maxPicks: 1 }, type: 'yesno' });
    expect(buildAskFromQuestion({ title: 'Ship it?', kind: 'yesno', yesLabel: 'Approve', noLabel: ' ' }, POLL).ask.options).toEqual([{ title: 'Approve' }, { title: 'No' }]);
  });

  test('rankings and other kinds cannot be asked, and say so', () => {
    expect(buildAskFromQuestion({ title: 'Order?', kind: 'rank' }, POLL).reason).toBe('A ranking cannot be asked in a Build Room.');
    expect(buildAskFromQuestion({ title: 'Hmm?', kind: 'nps' }, POLL).reason).toBe('This kind of question cannot be asked in a Build Room.');
  });

  test('only Call and Answer and Poll sets', () => {
    expect(buildAskFromQuestion({ title: 'Q' }, { engagementType: 'trivia' }).reason).toMatch('Only Call and Answer and Poll');
    expect(buildAskFromQuestion({ title: '' }, CAA).reason).toMatch('no question text');
  });

  test('askedAs names the type, or null', () => {
    expect(askedAs({ title: 'Q' }, CAA)).toBe('Ideas');
    expect(askedAs({ title: 'Q', kind: 'text' }, POLL)).toBe('Ideas');
    expect(askedAs({ title: 'Q', kind: 'choice', options: ['a', 'b'] }, POLL)).toBe('Choose');
    expect(askedAs({ title: 'Q', kind: 'yesno' }, POLL)).toBe('Yes/No');
    expect(askedAs({ title: 'Q', kind: 'rating', scale: '1-5' }, POLL)).toBe('Rate');
    expect(askedAs({ title: 'Q', kind: 'rank' }, POLL)).toBeNull();
    expect(Object.values(ASKED_AS)).toEqual(['Ideas', 'Choose', 'Yes/No', 'Rate']);
  });

  test('the type chips: All, then each type in order with its count, a type with none at 0', () => {
    const items = [{ type: 'suggest', ask: {} }, { type: 'yesno', ask: { kind: 'choice' } }, { ask: { kind: 'choice' } }, { ask: { kind: 'suggest' } }];
    expect(typeCounts(items).map((t) => [t.label, t.count])).toEqual([['All', 4], ['Ideas', 2], ['Choose', 1], ['Yes/No', 1], ['Rate', 0]]);
  });

  test('a Claude set\'s Yes/No is asked as a choice of Yes and No; one draft holds all four as a Poll', () => {
    const cs = { setId: 's1', name: 'Game questions', kind: 'game', questions: [
      { kind: 'suggest', prompt: 'What first?', category: 'Start' },
      { kind: 'yesno', prompt: 'Timer?' },
      { kind: 'rating', prompt: 'Fun?' },
    ] };
    const items = claudeSetItems(cs);
    expect(items.map((it) => [it.type, it.ask.kind])).toEqual([['suggest', 'suggest'], ['yesno', 'choice'], ['rating', 'rating']]);
    expect(items[1].ask.options).toEqual([{ title: 'Yes' }, { title: 'No' }]);
    const drafts = draftsFromClaudeSet(cs, '4821');
    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({ title: 'Game questions', engagementType: 'poll', tags: ['build-room', 'for-game'], gameId: '4821' });
    expect(drafts[0].items.map((i) => i.kind)).toEqual(['text', 'yesno', 'rating']);
    expect(draftsFromClaudeSet({ name: 'Only ideas', questions: [{ kind: 'suggest', prompt: 'Why?' }] })[0].engagementType).toBe('call-and-answer');
  });

  test('a set is ready by its build-room tag', () => {
    expect(isBuildRoomSet(CAA)).toBe(true);
    expect(isBuildRoomSet({ tags: ['Build-Room'] })).toBe(true);
    expect(isBuildRoomSet({ tags: ['retro'] })).toBe(false);
    expect(isBuildRoomSet(null)).toBe(false);
  });

  test('a Build Room set never starts a classic session (owner, 24 Oct); any other set may', () => {
    expect(offeredForSessions(CAA)).toBe(false);
    expect(offeredForSessions({ engagementType: 'poll', tags: ['Build-Room', 'for-game'] })).toBe(false);
    expect(offeredForSessions({ engagementType: 'call-and-answer', tags: ['retro'] })).toBe(true);
    expect(offeredForSessions({ engagementType: 'trivia' })).toBe(true);
  });

  test('groups in session order, then any other category', () => {
    const g = groupReady([{ category: 'While building' }, { category: 'Extra' }, { category: 'Who it is for' }, { category: 'Start' }]);
    expect(g.map((x) => x.category)).toEqual(['Who it is for', 'Start', 'While building', 'Extra']);
  });
});
