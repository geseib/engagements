/**
 * AN EVENT ITEM → THE SESSION ROADMAP M3 WILL MAKE FROM IT — the contract the
 * plan's mapping table states (docs/superpowers/plans/
 * 2026-09-26-events-m1b-richer-agenda.md), pinned. agenda-rules.sessionFormOf
 * turns an item into the create dialog's own payload; createGameBody — the
 * function the create dialog itself uses — turns that into the POST /games
 * body. So an item and a session made by hand with the same choices are the
 * same session.
 *
 * rejects: an item option that reaches the body under another name, or not at
 * all; the item's description, leader or length leaking into the session; an
 * untouched item that differs from an untouched create dialog.
 */
import { createGameBody } from '../config/createGame';
import rules from '../../../lambda-functions/websocket/events/agenda-rules';

const BRIEF = { text: 'Open issues are up 15%.', source: null, namesRemoved: 0, draftedAt: null, editedAt: null };
const item = (over = {}) => ({
  itemId: 'it_00000004', type: 'call-and-answer', title: 'What’s slowing us down?', description: 'Write it, then vote.',
  ledBy: 'Priya Raman', minutes: 20, state: 'planned',
  setRef: { scope: 'org', orgId: 'org_nw', setId: 'friction', version: 5 },
  ...over,
});

test('every option of a Call & Answer item reaches the body under create\'s own name', () => {
  const it = item({
    settings: {
      anonymousResponses: false, randomizeQuestions: false, categoryIds: ['Ops'], target: 4, personaId: 'coach',
      promptId: 'lp-behavioral', aiContext: 'End with one question.', eventDetails: 'Why we meet.', briefing: BRIEF,
    },
  });
  expect(createGameBody(rules.sessionFormOf(it))).toEqual({
    eventTitle: 'What’s slowing us down?',
    engagementInfo: 'Why we meet.',
    aiContext: 'End with one question.',
    gameType: 'call-and-answer',
    questionSetId: 'friction',
    questionSetScope: 'org',
    randomizeQuestions: false,
    selectedCategories: ['Ops'],
    personaId: 'coach',
    promptId: 'lp-behavioral',
    hostName: 'Host',
    anonymousUntilReveal: false,
    briefing: BRIEF,
    target: 4,
  });
});

test('the pinned version travels beside the form, for M3 to send as questionSetVersion', () => {
  expect(rules.sessionFormOf(item()).setVersion).toBe(5);
  expect('questionSetVersion' in createGameBody(rules.sessionFormOf(item()))).toBe(false);
});

test('a survey item sends its Names, and never a shuffle, a goal or a vote to hide', () => {
  const it = item({
    type: 'survey', title: 'How did today go?', setRef: { scope: 'platform', orgId: '', setId: 'kickoff', version: 1 },
    settings: { names: 'finished', personaId: '', promptId: '', aiContext: '', eventDetails: '' },
  });
  const body = createGameBody(rules.sessionFormOf(it));
  expect(body.names).toBe('finished');
  expect(body.randomizeQuestions).toBe(false);
  expect(body.anonymousUntilReveal).toBe(false);
  expect('target' in body).toBe(false);
});

// fix round 1: settingKeysFor('survey') never lists 'target', so even a
// corrupted or pre-fix row carrying one cannot smuggle a goal into a
// survey's session — settingsFor reads only the keys the format has.
test('a survey item never sends a goal, even one sitting in its own settings', () => {
  const it = item({
    type: 'survey', title: 'How did today go?', setRef: { scope: 'platform', orgId: '', setId: 'kickoff', version: 1 },
    settings: { names: 'finished', personaId: '', promptId: '', aiContext: '', eventDetails: '', target: 3 },
  });
  const body = createGameBody(rules.sessionFormOf(it));
  expect('target' in body).toBe(false);
});

test.each(['trivia', 'call-and-answer', 'poll', 'wavelength', 'survey'])(
  'an untouched %s item is an untouched create dialog',
  (type) => {
    const fromItem = createGameBody(rules.sessionFormOf({ type, title: 'T', setRef: { scope: 'platform', orgId: '', setId: 'x', version: 1 } }));
    const fromDialog = createGameBody({ title: 'T', gameType: type, setId: 'x', setScope: 'platform' });
    expect(fromItem).toEqual(fromDialog);
  },
);

test('the description, the leader and the length are the agenda\'s, never the session\'s', () => {
  const body = JSON.stringify(createGameBody(rules.sessionFormOf(item({ settings: {} }))));
  expect(body).not.toMatch(/Write it, then vote|Priya Raman/);
  expect(body).not.toMatch(/"minutes"|"ledBy"|"description"/);
});
