/**
 * THE ADVANCED SUMMARY LINE — config/setupDefaults.js.
 *
 * docs/design/session-setup-redesign (01, 02, 04 and RATIONALE §b): the create
 * dialog keeps title, format, set and categories in view and folds everything
 * with a safe default under a closed "Advanced". What makes folding safe is the
 * line on the fold itself: it names every default in force, and names any
 * CHANGED value first, so closing the section never hides a decision.
 *
 * This is the one place that decides what "default" means for each field, so
 * it is also where that meaning is held equal to what a create actually sends
 * (createGameBody) — a line that says "questions shuffled" over a payload that
 * says otherwise would be the plan sentence's old over-claim again.
 */
import { advancedSummary } from '../config/setupDefaults';
import { createGameBody } from '../config/createGame';

const PERSONAS = [{ personaId: 'advisor', name: 'The Business Advisor' }];
const PROMPTS = [{ promptId: 'lp', name: 'LP Behavioural' }];

/** The form exactly as the dialog opens it: nothing touched. */
const untouched = (gameType, extra = {}) => ({
  gameType,
  anonymousResponses: true,
  randomizeQuestions: true,
  personaId: '',
  promptId: '',
  eventDetails: '',
  aiContext: '',
  personas: PERSONAS,
  promptChoices: PROMPTS,
  setPromptWillBeUsed: false,
  ...extra,
});

const line = (s) => `${s.lead ? `${s.lead} ` : ''}${s.rest}`;

describe('every default, per format', () => {
  // The mockup's sentence, word for word (01-create.html).
  test('Call & Answer names anonymity, the shuffle, the voice and the approach', () => {
    const s = advancedSummary(untouched('call-and-answer'));
    expect(s.changed).toEqual([]);
    expect(line(s)).toBe('Using the defaults — answers anonymous until voting closes, questions shuffled; '
      + 'Workie adapts its voice and gives the standard Call & Answer summary.');
  });

  test('Poll still holds a vote, so it carries the anonymity clause too', () => {
    expect(line(advancedSummary(untouched('poll')))).toMatch(/answers anonymous until voting closes/);
  });

  test.each([['trivia', 'Trivia'], ['wavelength', 'Wavelength']])(
    '%s has no vote, so no anonymity clause', (type, label) => {
      expect(line(advancedSummary(untouched(type)))).toBe(
        `Using the defaults — questions shuffled; Workie adapts its voice and gives the standard ${label} summary.`);
    });

  test('a set whose own approach will be used is named as the default, not the format standard', () => {
    const s = advancedSummary(untouched('call-and-answer', { setPromptWillBeUsed: true }));
    expect(line(s)).toMatch(/Workie adapts its voice and follows this set’s own summary approach\.$/);
    expect(line(s)).not.toMatch(/standard/);
  });

  // A survey has no rounds to shuffle or sum up; its one setting is Names.
  test('a survey names what is recorded about people, and nothing about rounds', () => {
    const s = advancedSummary(untouched('survey', { names: 'anonymous' }));
    expect(s.changed).toEqual([]);
    expect(line(s)).toBe('Using the defaults — nobody’s name recorded.');
  });

  test('a survey set\'s own Names default is the default, and says whose it is', () => {
    const s = advancedSummary(untouched('survey', { names: 'named', namesDefault: 'named' }));
    expect(s.changed).toEqual([]);
    expect(line(s)).toMatch(/answers kept with names \(this set’s default\)/);
  });
});

describe('a changed value is named first', () => {
  // 02-create-advanced.html: the voice was switched.
  test('a changed voice leads, and the defaults still in force follow', () => {
    const s = advancedSummary(untouched('call-and-answer', { personaId: 'advisor' }));
    expect(s.lead).toBe('Changed: Workie speaks as The Business Advisor.');
    expect(s.rest).toBe('Otherwise the defaults — answers anonymous until voting closes, questions shuffled, '
      + 'the standard Call & Answer summary.');
  });

  test('anonymity turned off is a change, said as what happens', () => {
    const s = advancedSummary(untouched('call-and-answer', { anonymousResponses: false }));
    expect(s.changed).toEqual(['answers named from the start']);
    expect(s.rest).not.toMatch(/anonymous/);
  });

  test('two changes are both named, in the order the section lists them', () => {
    const s = advancedSummary(untouched('call-and-answer', { anonymousResponses: false, personaId: 'advisor' }));
    expect(s.lead).toBe('Changed: answers named from the start, Workie speaks as The Business Advisor.');
  });

  test('the shuffle turned off, a chosen approach, instructions and details are each named', () => {
    const s = advancedSummary(untouched('trivia', {
      randomizeQuestions: false, promptId: 'lp', aiContext: 'Be brief.', eventDetails: 'Quiz night.',
    }));
    expect(s.changed).toEqual([
      'questions asked in order',
      'Workie sums up with “LP Behavioural”',
      'instructions for Workie added',
      'event details added',
    ]);
    expect(s.rest).toBe('Otherwise the defaults — Workie adapts its voice.');
  });

  test('whitespace is not instructions', () => {
    expect(advancedSummary(untouched('trivia', { aiContext: '   ', eventDetails: '\n' })).changed).toEqual([]);
  });

  test('a voice or approach the lists do not carry is still named, by its id', () => {
    const s = advancedSummary(untouched('trivia', { personaId: 'gone', promptId: 'old-id' }));
    expect(s.changed).toEqual(['Workie speaks as gone', 'Workie sums up with “old-id”']);
  });

  test('a survey with a different Names choice is a change', () => {
    const s = advancedSummary(untouched('survey', { names: 'finished' }));
    expect(s.lead).toBe('Changed: who finished recorded, never their answers.');
    expect(s.rest).toBe('');
  });

  test('the anonymity flag means nothing for a format with no vote', () => {
    expect(advancedSummary(untouched('trivia', { anonymousResponses: false })).changed).toEqual([]);
  });

  test('the shuffle flag means nothing for a survey', () => {
    expect(advancedSummary(untouched('survey', { randomizeQuestions: false })).changed).toEqual([]);
  });
});

describe('the defaults are the ones a create actually sends', () => {
  // rejects: a line promising a default the payload does not carry.
  test('createGameBody with nothing chosen is shuffled, anonymous, adaptive and unapproached', () => {
    const body = createGameBody({ title: 'T', gameType: 'call-and-answer', setId: 's' });
    expect(body.randomizeQuestions).toBe(true);
    expect(body.anonymousUntilReveal).toBe(true);
    expect(body.personaId || '').toBe('');
    expect(body.promptId || '').toBe('');
    expect(body.aiContext).toBeNull();
    expect(body.engagementInfo).toBeNull();
    // …and the same untouched form is all defaults here.
    expect(advancedSummary(untouched('call-and-answer')).changed).toEqual([]);
  });
});
