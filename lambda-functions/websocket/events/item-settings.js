/**
 * AN ENGAGEMENT ITEM'S SESSION OPTIONS, CHECKED — the server's half of the
 * item dialog's options (src/src/components/SessionOptions.jsx), for POST and
 * PUT /events/{code}/items (items.js). Events M1b.
 *
 * The rules are create's own. The keys are the create dialog's payload keys
 * (agenda-rules.settingKeysFor decides which a format has); an option a format
 * does not have is refused in the sentence create-game.js or update-game.js
 * would use, never dropped; Names is one of survey-names.js's three; a goal is
 * session-goal.js's, bounded by the set's size at the item's pinned version;
 * the briefing is briefing.js's (1,500 characters); and the two text caps are
 * the create dialog's own maxLengths — 500 for Workie's instructions, 300 for
 * the event details — which create-game.js has never checked itself.
 * tests/event-item-settings.js §5 holds these numbers equal to the dialog's.
 *
 * The map this returns is complete for the format (every key that applies,
 * defaults filled), and items.js seals it whole as `Settings`.
 *
 * NULL MEANS BLANK/DEFAULT (fix round 1 RULING), the same convention
 * create-game.js's own body uses for a cleared field. A `null` for a key this
 * format does not have is skipped, exactly as if it had never been sent —
 * never refused. A `null` for a key this format DOES have reads as that key's
 * own default (agenda-rules.settingsFor does the substitution): '' for a
 * string, the boolean default for a switch, `[]` for categories, `anonymous`
 * for Names. An UNKNOWN key is refused whether or not its value is null — the
 * null convention only ever excuses a key that exists but does not apply.
 */
const rules = require('./agenda-rules');
const { normalizeBriefing } = require('../briefing');
const { NAMES } = require('../survey-names');
const { checkTarget } = require('../session-goal');

const AI_CONTEXT_MAX = 500;
const EVENT_DETAILS_MAX = 300;
const ID_MAX = 128;
const CATEGORY_MAX = 24;
const CATEGORY_NAME_MAX = 120;
/** How much of an unrecognised key's own name the 400 sentence echoes back
 *  (fix round 1 nit): a key is caller-supplied text, not a bounded token, and
 *  echoing it whole would let an arbitrarily long string ride into a log or a
 *  toast under the guise of an error message. */
const KEY_ECHO_MAX = 40;

/** What each option says when the format does not have it. */
const NOT_THIS_FORMAT = Object.freeze({
  anonymousResponses: 'Anonymous responses apply to Call & Answer only.',
  randomizeQuestions: 'A survey is read in the order it was written, so it has no shuffle.',
  categoryIds: 'A survey has no categories.',
  target: 'A survey is answered at each person’s own pace, so it has no goal.',
  names: 'Names applies to a survey only.',
  briefing: 'A briefing applies to Call & Answer sessions only',
});

/**
 * @param {string} type           the item's kind
 * @param {object} input          the `settings` the request sent (or undefined)
 * @param {{questionCount?: number}} opts  the pinned version's size
 * @returns {{value: object|null}|{error: string}}
 */
function checkItemSettings(type, input, { questionCount = 0 } = {}) {
  const sent = input !== undefined && input !== null;
  if (!rules.isEngagement(type)) {
    return sent ? { error: 'Only an engagement has session options.' } : { value: null };
  }
  if (sent && (typeof input !== 'object' || Array.isArray(input))) {
    return { error: 'Session options are a set of named choices.' };
  }
  const given = sent ? input : {};
  const applies = rules.settingKeysFor(type);
  for (const key of Object.keys(given)) {
    if (!rules.SETTING_KEYS.includes(key)) {
      const shown = key.length > KEY_ECHO_MAX ? `${key.slice(0, KEY_ECHO_MAX)}…` : key;
      return { error: `“${shown}” is not a session option.` };
    }
    // null on a key this format does not have is skipped, not refused — see
    // the file header. A real value for the wrong format is still refused.
    if (!applies.includes(key) && given[key] !== null) return { error: NOT_THIS_FORMAT[key] };
  }

  const s = rules.settingsFor(type, given);
  const out = {};
  for (const key of applies) {
    const v = s[key];
    if (key === 'anonymousResponses' || key === 'randomizeQuestions') {
      if (typeof v !== 'boolean') {
        return { error: key === 'anonymousResponses' ? 'Anonymous responses is on or off.' : 'Shuffle is on or off.' };
      }
      out[key] = v;
    } else if (key === 'names') {
      const mode = String(v == null ? '' : v).trim().toLowerCase();
      if (!NAMES.includes(mode)) return { error: `Names is one of: ${NAMES.join(', ')}.` };
      out[key] = mode;
    } else if (key === 'target') {
      const checked = checkTarget(v, questionCount);
      if (checked.error) return { error: checked.error };
      out[key] = checked.value;
    } else if (key === 'categoryIds') {
      if (!Array.isArray(v)) return { error: 'Choose categories from the set.' };
      const chosen = [...new Set(v.map((c) => (typeof c === 'string' ? c.trim() : '')))];
      if (chosen.length > CATEGORY_MAX || chosen.some((c) => !c || c.length > CATEGORY_NAME_MAX)) {
        return { error: 'Choose categories from the set.' };
      }
      out[key] = chosen;
    } else if (key === 'personaId' || key === 'promptId') {
      if (typeof v !== 'string' || v.trim().length > ID_MAX) {
        return { error: key === 'personaId' ? 'That is not one of Workie’s voices.' : 'That is not a summary approach.' };
      }
      out[key] = v.trim();
    } else if (key === 'aiContext') {
      if (typeof v !== 'string') return { error: 'Instructions for Workie are text.' };
      if (v.length > AI_CONTEXT_MAX) return { error: `Instructions for Workie can be ${AI_CONTEXT_MAX} characters at most.` };
      out[key] = v;
    } else if (key === 'eventDetails') {
      if (typeof v !== 'string') return { error: 'Event details are text.' };
      if (v.length > EVENT_DETAILS_MAX) return { error: `Event details can be ${EVENT_DETAILS_MAX} characters at most.` };
      out[key] = v;
    } else if (key === 'briefing') {
      const checked = normalizeBriefing(v);
      if (checked.error) return { error: checked.error };
      out[key] = checked.value;
    }
  }
  return { value: out };
}

module.exports = {
  AI_CONTEXT_MAX, EVENT_DETAILS_MAX, ID_MAX, CATEGORY_MAX, CATEGORY_NAME_MAX, KEY_ECHO_MAX,
  checkItemSettings,
};
