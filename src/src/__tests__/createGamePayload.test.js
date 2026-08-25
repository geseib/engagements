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
  test('sends only the whitelist — nothing the backend pins', () => {
    // categoryIds joined the whitelist when the backend grew mask support; the
    // still-pinned fields (gameType, setId, randomizeQuestions) still vanish.
    expect(Object.keys(updateGameBody(form)).sort()).toEqual([
      'aiContext', 'anonymousUntilReveal', 'categoryIds', 'engagementInfo', 'eventTitle', 'personaId',
    ]);
  });

  test('categoryIds travel as given, and never travel empty or absent', () => {
    /*
      An EMPTY list is deliberately not a wire shape — the dialog refuses to
      submit one ("no reachable questions" is not a thing to save), so this
      function dropping it is belt-and-braces. An ABSENT key means "leave the
      masks alone" to the backend's `'field' in body` builder, which is what a
      caller that never rendered a category grid should say.
    */
    expect(updateGameBody(form).categoryIds).toEqual(['Leadership', 'Ops']);
    expect('categoryIds' in updateGameBody({ ...form, categoryIds: [] })).toBe(false);
    const { categoryIds, ...formWithout } = form;
    expect('categoryIds' in updateGameBody(formWithout)).toBe(false);
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

/**
 * THE SCOPE, WHICH THE BODY NEVER CARRIED.
 *
 * `tenant.js` states the rule: a setId is a slug that names a different set in
 * each of platform, org and public, so a session pins the PAIR. The backend has
 * carried it the whole time — `create-game.js` names `questionSetScope` in its
 * destructure, `schema-compliant-manager.js:72` reads it, and
 * `tests/tenant-session-scoping.js` proves "an explicit scope on the create
 * payload is the one pinned".
 *
 * No client ever sent one. The default is `platform`, so a session built from an
 * ORG's set went looking for that id in the platform library, found no metadata,
 * fell through to the legacy partition, and pinned a key holding no CATEGORY#
 * rows and no questions. Nothing failed: the set list showed the set, the
 * dialog showed its categories (GET /question-sets/{id}/categories SEARCHES the
 * readable scopes, which is why it looked right up to the moment of play), and
 * the session was created empty.
 */
describe('the question set reference is a pair', () => {
  // rejects: the exact defect — an org set's session pinned to the platform
  // library, where that id does not exist.
  test('sends the scope the host actually picked', () => {
    expect(createGameBody({ ...form, setScope: 'org' }).questionSetScope).toBe('org');
    expect(createGameBody({ ...form, setScope: 'public' }).questionSetScope).toBe('public');
  });

  /*
    Platform is what a payload that says nothing already means to the backend,
    so an unscoped form must send that rather than omitting the key — an absent
    key and `platform` agree today, and would stop agreeing the moment anyone
    changes the backend default.
  */
  // rejects: leaving it undefined, which JSON.stringify deletes outright.
  test('says platform explicitly when the form carries no scope', () => {
    const body = createGameBody(form);
    expect(body.questionSetScope).toBe('platform');
    expect(JSON.parse(JSON.stringify(body))).toHaveProperty('questionSetScope');
  });

  // rejects: the id and the scope drifting apart in the body.
  test('keeps the id beside it', () => {
    const body = createGameBody({ ...form, setId: 'teamretro', setScope: 'org' });
    expect(body.questionSetId).toBe('teamretro');
    expect(body.questionSetScope).toBe('org');
  });
});
