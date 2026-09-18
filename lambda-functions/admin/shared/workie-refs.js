/**
 * WHAT A SET POINTS WORKIE AT — one resolver, used by every writer.
 *
 * A question set's metadata row carries two ids and neither is encrypted:
 *
 *   promptId    how each round is summed up
 *   personaId   the voice it is summed up in
 *
 * Both RESOLVE correctly at run time, and both DEGRADE QUIETLY when they
 * resolve to nothing: `get-ai-summary.js` falls back to the game-type default
 * and records a reason, and `personas.js` falls through to the next rung. That
 * is the right run-time behaviour — a session must not die because a prompt was
 * deleted last week — but it meant nothing ever told the person who CHOSE the
 * value that it would not be used. `edit-question-set.js`'s OPTIONAL_FIELDS and
 * `upload-questions.js`'s metadata write both accepted any string at all.
 *
 * So the check belongs at the WRITE, which is the one moment there is a person
 * to tell. This module is that check, in one place, because two writers with
 * two notions of "does this exist" is how one of them ends up wrong.
 *
 * ── THE PROMPT LIBRARIES, AND WHY THE ORDER IS COPIED AND NOT IMPORTED ──────
 *
 * `get-ai-summary.js`'s `promptLibrariesFor(orgId)` is the run-time authority:
 * the org's own library first, then the platform library, and a session with no
 * organisation reads the platform library ONLY — falling back the other way
 * would be a cross-tenant read. That ordering is reproduced here and the KEYS
 * are built by the same function it builds them with, `tenant.promptsMetadataPk`
 * (through `prompt-access.js`'s `promptKey`), so there is no second spelling of
 * a partition anywhere.
 *
 * The module itself cannot be shared. `get-ai-summary.js` lives in the GAME
 * bundle and says so in its own comment: it cannot import `prompt-access.js`
 * either, "being a different CodeUri bundle" — which is why `tenant.js`,
 * `tenant-crypto.js` and `set-version.js` are triplicated with drift guards.
 * Lifting `promptLibrariesFor` into this file and requiring it from there would
 * not survive packaging; exporting it from there and requiring it from here
 * would not either. The ORDER is reproduced; the module is not.
 *
 * ── AND WHY ANOTHER ORG'S PROMPT IS 'missing', NOT 'unreadable' ─────────────
 *
 * `prompt-access.js` settled this for the read path and it settles it here:
 * "a scope this caller cannot read is never probed, so another organisation's
 * Workie is not 'forbidden' here, it is ABSENT". Answering `unreadable` would
 * mean establishing that org B has a Workie called `retro` and then telling org
 * A so. `unreadable` is kept for the case that genuinely is one — a row in OUR
 * library sealed to somebody else's key, which is what a careless cross-org
 * copy leaves behind. We found it, and we still cannot read a word of it.
 *
 * Personas take no org at all: `tenant.personasPk()` ignores scope on purpose
 * (see its comment), so there is one cast of voices and the same id means the
 * same voice everywhere.
 */
const { GetCommand } = require('@aws-sdk/lib-dynamodb');
const tenant = require('./tenant');
const { promptKey } = require('./prompt-access');
const { decryptItem } = require('./tenant-crypto');

const clean = (v) => (typeof v === 'string' ? v.trim() : '');

/**
 * WHAT A BUILDER IS TOLD. Plain language, and every one of them ends with the
 * way out, because a refusal that only says no is a dead end on a screen where
 * the person cannot see what the valid values are.
 */
const PROMPT_REFUSALS = Object.freeze({
  missing: 'That summary prompt no longer exists. Choose another, or clear it to use the default for this game type.',
  unreadable: 'That summary prompt belongs to another organisation, so this set cannot use it. Choose another, or clear it to use the default for this game type.',
});
const PERSONA_REFUSALS = Object.freeze({
  missing: 'That voice no longer exists. Choose another, or clear it to use the standard voice.',
  inactive: 'That voice has been turned off. Choose another, or clear it to use the standard voice.',
});

/** Every prompt library a set in this org may read, most specific first. */
const promptRefsFor = (orgId) => (
  orgId
    ? [{ scope: tenant.ORG, orgId }, { scope: tenant.PLATFORM, orgId: '' }]
    : [{ scope: tenant.PLATFORM, orgId: '' }]
);

/**
 * Does this set's summary prompt exist, in a library this set can read?
 *
 * @param {object} db          a DynamoDBDocumentClient
 * @param {string} tableName
 * @param {string} promptId    the id as the caller sent it; '' means none
 * @param {{orgId?: string}} opts  the org of the SET, not of the caller — a
 *   platform set must not be allowed to point into an org library, and the
 *   caller's active org is not the set's org on every path.
 * @returns {Promise<{ok: true, prompt: object|null}|{ok: false, reason: 'missing'|'unreadable'}>}
 */
async function resolvePromptRef(db, tableName, promptId, { orgId = '' } = {}) {
  const id = clean(promptId);
  // NO ID IS NOT A BROKEN ID. Clearing a value is always allowed, and it has to
  // be: detaching a prompt is the only cure for one that has been deleted, and
  // a validator that refused '' would make the defect permanent.
  if (!id) return { ok: true, prompt: null };

  for (const ref of promptRefsFor(clean(orgId))) {
    // eslint-disable-next-line no-await-in-loop
    const res = await db.send(new GetCommand({
      TableName: tableName,
      Key: promptKey({ ...ref, promptId: id }),
    }));
    const item = res && res.Item;
    if (!item) continue;
    // The platform library is shared by every organisation and is never sealed.
    if (ref.scope !== tenant.ORG) return { ok: true, prompt: item };
    try {
      // eslint-disable-next-line no-await-in-loop
      return { ok: true, prompt: await decryptItem(ref.orgId, 'prompt', item) };
    } catch (error) {
      console.warn(`⚠️ WORKIE: prompt ${id} is in ${ref.orgId}'s library but sealed to another key: ${error.message}`);
      return { ok: false, reason: 'unreadable' };
    }
  }
  return { ok: false, reason: 'missing' };
}

/**
 * Does this voice exist and can it still speak?
 *
 * "Usable" is `personas.js`'s notion and not a new one: it falls through on a
 * row that is absent, on `status === 'inactive'`, and on an empty `voice` —
 * that last one alike, because a persona with nothing to say changes no words.
 * All three are refused here so that a set cannot be saved pointing at one.
 *
 * @returns {Promise<{ok: true, persona: object|null}|{ok: false, reason: 'missing'|'inactive'}>}
 */
async function resolvePersonaRef(db, tableName, personaId) {
  const id = clean(personaId);
  if (!id) return { ok: true, persona: null };

  const res = await db.send(new GetCommand({
    TableName: tableName,
    Key: { PK: tenant.personasPk(), SK: `PERSONA#${id}` },
  }));
  const item = res && res.Item;
  if (!item) return { ok: false, reason: 'missing' };
  if (item.status === 'inactive' || !clean(item.voice)) return { ok: false, reason: 'inactive' };
  return { ok: true, persona: item };
}

/**
 * The 400 a writer returns for a refused id.
 *
 * `field` rides ALONGSIDE the sentence rather than inside it: the UI needs to
 * know which of the two controls to point at, and the person reading the
 * sentence does not need to know it is called `promptId`.
 */
const refusal = (field, reason) => {
  const table = field === 'personaId' ? PERSONA_REFUSALS : PROMPT_REFUSALS;
  return {
    statusCode: 400,
    body: JSON.stringify({ error: table[reason] || table.missing, field }),
    headers: { 'Access-Control-Allow-Origin': '*' },
  };
};

module.exports = {
  resolvePromptRef,
  resolvePersonaRef,
  refusal,
  PROMPT_REFUSALS,
  PERSONA_REFUSALS,
};
