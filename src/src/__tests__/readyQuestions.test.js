import { buildAskFromQuestion, askedAs, isBuildRoomSet, groupReady } from '../buildroom/readyQuestions';

const CAA = { engagementType: 'call-and-answer', tags: ['build-room'] };
const POLL = { engagementType: 'poll', tags: ['build-room'] };

describe('a question as a Build Room ask (step 7b)', () => {
  test('Call and Answer is Ideas, carrying what Claude gets and the note', () => {
    expect(buildAskFromQuestion({ title: 'Who is this for?', detail: 'One sentence.', claudeGets: 'keep', claudeNote: 'Treat it as the audience.' }, CAA))
      .toEqual({ ask: { kind: 'suggest', prompt: 'Who is this for?', detail: 'One sentence.', claudeGets: 'keep', claudeNote: 'Treat it as the audience.' } });
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

  test('yes or no, open answers and rankings cannot be asked, and say so', () => {
    expect(buildAskFromQuestion({ title: 'Ok?', kind: 'yesno' }, POLL).reason).toBe('A yes or no question cannot be asked in a Build Room.');
    expect(buildAskFromQuestion({ title: 'Why?', kind: 'text' }, POLL).reason).toBe('An open answer cannot be asked in a Build Room.');
    expect(buildAskFromQuestion({ title: 'Order?', kind: 'rank' }, POLL).reason).toBe('A ranking cannot be asked in a Build Room.');
  });

  test('only Call and Answer and Poll sets', () => {
    expect(buildAskFromQuestion({ title: 'Q' }, { engagementType: 'trivia' }).reason).toMatch('Only Call and Answer and Poll');
    expect(buildAskFromQuestion({ title: '' }, CAA).reason).toMatch('no question text');
  });

  test('askedAs names the kind, or null', () => {
    expect(askedAs({ title: 'Q' }, CAA)).toBe('Ideas');
    expect(askedAs({ title: 'Q', kind: 'rating', scale: '1-5' }, POLL)).toBe('Rate');
    expect(askedAs({ title: 'Q', kind: 'text' }, POLL)).toBeNull();
  });

  test('a set is ready by its build-room tag', () => {
    expect(isBuildRoomSet(CAA)).toBe(true);
    expect(isBuildRoomSet({ tags: ['Build-Room'] })).toBe(true);
    expect(isBuildRoomSet({ tags: ['retro'] })).toBe(false);
    expect(isBuildRoomSet(null)).toBe(false);
  });

  test('groups in session order, then any other category', () => {
    const g = groupReady([{ category: 'While building' }, { category: 'Extra' }, { category: 'Who it is for' }, { category: 'Start' }]);
    expect(g.map((x) => x.category)).toEqual(['Who it is for', 'Start', 'While building', 'Extra']);
  });
});
