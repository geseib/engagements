/**
 * WHAT THE CREATE DIALOG'S "ADVANCED" LINE SAYS — every default in force, and
 * every changed value named first.
 *
 * docs/design/session-setup-redesign (01, 02, 04; RATIONALE §b). The dialog
 * keeps title, format, set and categories in view and folds everything with a
 * safe default under a closed <details>. The fold is only safe because of the
 * line on it: closed, it still states the whole plan, so closing the section
 * never hides a decision. It replaces the old green plan sentence — one
 * statement of the plan, not two.
 *
 * THE ONE PLACE THAT DECIDES WHAT "DEFAULT" MEANS for each field, held equal to
 * what createGameBody sends for an untouched form (setupDefaults.test.js):
 *   anonymous responses   on          (only where the format holds a vote)
 *   shuffle               on          (never for a survey)
 *   Names                 the set's own default, else Anonymous (survey only)
 *   voice                 ''  = Workie adapts its voice
 *   summary approach      ''  = the set's own when it will be used, else the
 *                                format's standard (get-ai-summary.js
 *                                sessionPromptId)
 *   instructions/details  empty
 *
 * Pure: the dialog hands in its form state and the two lists it already holds.
 */
import { anonymityApplies } from './anonymity';
import { gameTypeMeta, normalizeGameType } from './gameTypes';
import { NAMES_DEFAULT, namesMode } from './surveyNames';

// What each Names value means for what the host gets, in the line's voice.
const NAMES_PHRASE = {
  anonymous: 'nobody’s name recorded',
  finished: 'who finished recorded, never their answers',
  named: 'answers kept with names',
};

/**
 * @returns {{ changed: string[], defaults: string[], lead: string, rest: string }}
 *   `changed` and `defaults` are the fragments; `lead` ("Changed: …." or '')
 *   is drawn in amber, `rest` follows it in muted.
 */
export function advancedSummary({
  gameType,
  anonymousResponses = true,
  randomizeQuestions = true,
  names,
  namesDefault,
  personaId = '',
  promptId = '',
  eventDetails = '',
  aiContext = '',
  personas = [],
  promptChoices = [],
  setPromptWillBeUsed = false,
} = {}) {
  const type = normalizeGameType(gameType);
  const isSurvey = type === 'survey';
  const changed = [];
  const room = [];     // the defaults about the room: responses and questions

  // ── Responses
  if (isSurvey) {
    const setDefault = namesDefault ? namesMode(namesDefault).id : NAMES_DEFAULT;
    const chosen = namesMode(names || setDefault).id;
    if (chosen !== setDefault) changed.push(NAMES_PHRASE[chosen]);
    else room.push(namesDefault && setDefault !== NAMES_DEFAULT
      ? `${NAMES_PHRASE[chosen]} (this set’s default)`
      : NAMES_PHRASE[chosen]);
  } else if (anonymityApplies(type)) {
    if (anonymousResponses === false) changed.push('answers named from the start');
    else room.push('answers anonymous until voting closes');
  }

  // ── Questions
  if (!isSurvey) {
    if (randomizeQuestions === false) changed.push('questions asked in order');
    else room.push('questions shuffled');
  }

  // ── Workie. A survey has no rounds to sum up, so its defaults say nothing
  // about Workie — but a value the host did set is still named.
  const workieDefaults = [];
  if (personaId) {
    const persona = personas.find((p) => p.personaId === personaId);
    changed.push(`Workie speaks as ${(persona && persona.name) || personaId}`);
  } else if (!isSurvey) {
    workieDefaults.push({ phrase: 'Workie adapts its voice' });
  }
  if (promptId) {
    const prompt = promptChoices.find((p) => p.promptId === promptId);
    changed.push(`Workie sums up with “${(prompt && prompt.name) || promptId}”`);
  } else if (!isSurvey) {
    workieDefaults.push(setPromptWillBeUsed
      ? { verb: 'follows', phrase: 'this set’s own summary approach' }
      : { verb: 'gives', phrase: `the standard ${gameTypeMeta(type).label} summary` });
  }
  if (String(aiContext || '').trim()) changed.push('instructions for Workie added');
  if (String(eventDetails || '').trim()) changed.push('event details added');

  const defaults = [...room, ...workieDefaults.map((d) => d.phrase)];

  if (changed.length === 0) {
    // Nothing touched: the full sentence, Workie's two defaults read as one
    // clause ("Workie adapts its voice and gives the standard … summary").
    const [voice, approach] = workieDefaults;
    const workie = voice && approach ? `; ${voice.phrase} and ${approach.verb} ${approach.phrase}` : '';
    return { changed, defaults, lead: '', rest: `Using the defaults — ${room.join(', ')}${workie}.` };
  }

  return {
    changed,
    defaults,
    lead: `Changed: ${changed.join(', ')}.`,
    rest: defaults.length ? `Otherwise the defaults — ${defaults.join(', ')}.` : '',
  };
}
