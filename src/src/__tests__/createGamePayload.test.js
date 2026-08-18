/**
 * What the create call actually sends.
 *
 * Extracted from GameHostPage because that file cannot be rendered in jsdom
 * (it dies on the auth provider), and because the failure mode this guards is
 * invisible from inside the component: a field can be in the form, in the
 * state, on the screen — and simply not be in the body. `triviaTimer` was
 * exactly that for months, which is what create-game.js:5 records.
 */
import { createGameBody, updateGameBody } from '../config/createGame';

const form = {
  title: 'Q3 Leadership Offsite',
  gameType: 'call-and-answer',
  setId: 'strategic-pricing',
  categoryIds: ['Leadership', 'Ops'],
  eventDetails: 'Half a day on pricing.',
  aiContext: 'Pricing team, mid-market SaaS.',
  personaId: 'coach',
  randomizeQuestions: true,
  anonymousResponses: true,
};

describe('createGameBody', () => {
  // rejects: restoring the trivia timer. create-game.js:9's destructure is a
  // whitelist that never named it, so every value the host typed was dropped on
  // the floor while the dialog promised players 30 seconds.
  test('sends no triviaTimer, for any type', () => {
    for (const gameType of ['trivia', 'call-and-answer', 'poll', 'wavelength']) {
      const body = createGameBody({ ...form, gameType });
      expect('triviaTimer' in body).toBe(false);
    }
  });

  // rejects: dropping the ids from the payload and reading them back out of
  // GameHostPage's `activeCategoryIds` — which `leaveCurrentGame()` has already
  // cleared by the time the create call runs. That works today only because of
  // a pre-reset closure, which is invisible at the call site.
  test('takes the selected categories from the payload it was handed', () => {
    expect(createGameBody(form).selectedCategories).toEqual(['Leadership', 'Ops']);
  });

  test('accepts a Set as readily as an array', () => {
    const body = createGameBody({ ...form, categoryIds: new Set(['Ops']) });
    expect(body.selectedCategories).toEqual(['Ops']);
  });

  // rejects: leaving the key undefined, which JSON.stringify deletes outright —
  // so the backend would see "no categories key" rather than "all categories".
  test('sends an empty array, never undefined, when no category is picked', () => {
    const body = createGameBody({ ...form, categoryIds: undefined });
    expect(body.selectedCategories).toEqual([]);
    expect(JSON.parse(JSON.stringify(body))).toHaveProperty('selectedCategories');
  });

  // rejects: dropping the createPayloadFor spread, which is the only thing that
  // marks the game anonymous.
  test('carries the anonymity flag the type and the toggle agree on', () => {
    expect(createGameBody(form).anonymousUntilReveal).toBe(true);
    expect(createGameBody({ ...form, anonymousResponses: false }).anonymousUntilReveal).toBe(false);
    // A non-voting type sends false explicitly rather than omitting the key.
    expect(createGameBody({ ...form, gameType: 'trivia' }).anonymousUntilReveal).toBe(false);
  });

  // rejects: the mockup's silent deletion of the three fields that are live —
  // Details reaches participants, AIContext reaches the Bedrock prompt, and
  // PersonaId picks Workie's voice.
  test('carries event details, AI context and the chosen persona', () => {
    const body = createGameBody(form);
    expect(body.engagementInfo).toBe('Half a day on pricing.');
    expect(body.aiContext).toBe('Pricing team, mid-market SaaS.');
    expect(body.personaId).toBe('coach');
  });

  // '' means "adapt to the session" — create-game.js only stores PersonaId when
  // it is non-empty, so the empty string must survive as an empty string.
  test('an unset persona is the empty string, not undefined', () => {
    expect(createGameBody({ ...form, personaId: '' }).personaId).toBe('');
  });

  test('keeps the title, type, set and shuffle flag the host chose', () => {
    const body = createGameBody({ ...form, randomizeQuestions: false });
    expect(body.eventTitle).toBe('Q3 Leadership Offsite');
    expect(body.gameType).toBe('call-and-answer');
    expect(body.questionSetId).toBe('strategic-pricing');
    expect(body.randomizeQuestions).toBe(false);
  });
});

describe('updateGameBody', () => {
  // rejects: sending the CREATE shape at the edit route. update-game.js is a
  // whitelist, so gameType/questionSetId/randomizeQuestions/selectedCategories
  // would be silently ignored — the dialog shows those controls disabled, and
  // a body that carried them anyway would make this function lie about what an
  // edit can do (the same shape as the triviaTimer defect, in reverse).
  test('sends only the phase-1 whitelist — nothing the backend pins', () => {
    expect(Object.keys(updateGameBody(form)).sort()).toEqual([
      'aiContext', 'anonymousUntilReveal', 'engagementInfo', 'eventTitle', 'personaId',
    ]);
  });

  // rejects: any edited field silently failing to reach the PUT body.
  test('carries the title, details, context and persona the host edited', () => {
    const body = updateGameBody(form);
    expect(body.eventTitle).toBe('Q3 Leadership Offsite');
    expect(body.engagementInfo).toBe('Half a day on pricing.');
    expect(body.aiContext).toBe('Pricing team, mid-market SaaS.');
    expect(body.personaId).toBe('coach');
  });

  // rejects: deleting the key for a blanked field. The backend's `'field' in
  // body` builder leaves an ABSENT key untouched — so a host who cleared the
  // details would see the old text reappear on refresh. null survives
  // JSON.stringify; undefined does not.
  test('a cleared field is an explicit null, never a missing key', () => {
    const body = updateGameBody({ ...form, eventDetails: '', aiContext: '' });
    const wire = JSON.parse(JSON.stringify(body));
    expect(wire.engagementInfo).toBeNull();
    expect(wire.aiContext).toBeNull();
    expect('engagementInfo' in wire).toBe(true);
    expect('aiContext' in wire).toBe(true);
  });

  // '' means "adapt to the session" — the backend REMOVEs the attribute — so
  // the empty string has to survive as one, exactly as on create.
  test('an unset persona is the empty string, not undefined', () => {
    expect(updateGameBody({ ...form, personaId: '' }).personaId).toBe('');
  });

  // rejects: dropping the createPayloadFor spread. The anonymity flag is
  // whitelisted on PUT, and it must obey the same type rule as create — a
  // trivia session sends false explicitly, whatever the toggle said.
  test('carries the anonymity flag the type and the toggle agree on', () => {
    expect(updateGameBody(form).anonymousUntilReveal).toBe(true);
    expect(updateGameBody({ ...form, anonymousResponses: false }).anonymousUntilReveal).toBe(false);
    expect(updateGameBody({ ...form, gameType: 'trivia' }).anonymousUntilReveal).toBe(false);
  });

  // rejects: always sending visibility. The dialog has no visibility control,
  // and an absent key is the backend's "leave it alone" — inventing a value
  // here would silently re-publish every private session on each save.
  test('visibility rides along only when the form actually carries it', () => {
    expect('visibility' in updateGameBody(form)).toBe(false);
    expect(updateGameBody({ ...form, visibility: 'private' }).visibility).toBe('private');
  });
});
