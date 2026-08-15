/**
 * CARRYING A QUESTION SET'S PROMPT ACROSS ENVIRONMENTS.
 *
 * A set row has `promptId`, naming the AI prompt that reads its rounds back to
 * the room. Prompt ids are MINTED PER TIER (`create-ai-prompt.js` generates one
 * from the clock), so dev's `msue0tacv9vj6fsv6rh` names nothing in prod.
 *
 * The archive never carried the link at all: `exportQuestionSets` put the CSV,
 * the name, the type and a question count in the archive item and nothing about
 * the prompt, and `importQuestionSets` passed a hardcoded `promptId: ''`. So
 * every set imported into another tier arrived unlinked and silently fell back
 * to the game-type default — thirteen sets in prod on 2026-08-15, all eight
 * demo sets among them, each of which had a Workie written specifically for it.
 *
 * ── WHY THE NAME, AND NOT THE ID ───────────────────────────────────────────
 *
 * The id cannot travel; it means nothing on the far side. The NAME is the only
 * thing the same prompt has in common across two tiers, because that is what
 * the prompt export/import round trip preserves. So the link is carried as a
 * name and re-resolved to whatever local id that name has.
 *
 * This is a weaker key than an id and it is worth being honest about the two
 * ways it degrades, both of which fail SAFE:
 *
 *   no match    the set imports unlinked, exactly as it did before this
 *               existed, and falls back to the game-type default.
 *   two matches the first is taken, and the ambiguity is reported. Two prompts
 *               of the same name in one tier is already a problem the library
 *               shows; it does not become this module's job to resolve.
 *
 * Neither writes a WRONG link, which is the outcome that would matter — a set
 * pointed at somebody else's prompt says the wrong things to a real room.
 *
 * ── WHERE IT RIDES ─────────────────────────────────────────────────────────
 *
 * In `tags`, which the archive item already carries as a string array using a
 * `key:value` idiom (`questions:12`). No new field on the archive service, and
 * no change to the shared stack, which is deployed by hand and by a different
 * script.
 *
 * Split on the FIRST colon only. Prompt names contain colons — "Workie -
 * Knowledge Organization: Make the Distinction Land" is four of the eight demo
 * prompts — and a `split(':')[1]` here would truncate every one of them.
 */

/** The tag prefix. One spelling, so the writer and the reader cannot drift. */
const PROMPT_TAG_PREFIX = 'prompt:';

/**
 * The ` (Imported 2026-08-15)` suffix `importPrompts` appends when the caller
 * asks for rename-on-conflict.
 *
 * Stripped before matching, or the link breaks on precisely the run that needs
 * it most: import the prompts (they get the suffix), then import the sets (they
 * look for the unsuffixed name), and nothing matches. The suffix is generated
 * by this codebase, so the pattern is exact rather than a guess.
 */
const IMPORTED_SUFFIX = /\s*\(Imported \d{4}-\d{2}-\d{2}\)\s*$/;

/**
 * The form two tiers can compare. Case- and space-folded, because a name is
 * typed by a human and re-typed by nobody: the link should not turn on a
 * double space or a capital letter.
 */
function promptMatchKey(name) {
  return String(name ?? '')
    .replace(IMPORTED_SUFFIX, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

/** The tag to attach to an exported question set, or null when it has no prompt. */
function promptLinkTag(promptName) {
  const name = String(promptName ?? '').trim();
  return name ? `${PROMPT_TAG_PREFIX}${name}` : null;
}

/**
 * The prompt name carried by an archive item's tags, or ''.
 *
 * Tolerates the tag arriving as a non-array, which is what a hand-made or
 * older archive item looks like.
 */
function promptNameFromTags(tags) {
  if (!Array.isArray(tags)) return '';
  const hit = tags.find((t) => typeof t === 'string' && t.startsWith(PROMPT_TAG_PREFIX));
  // slice, NOT split(':')[1] — see the header. Four of the eight demo prompt
  // names contain a colon of their own.
  return hit ? hit.slice(PROMPT_TAG_PREFIX.length).trim() : '';
}

/**
 * Resolve a carried prompt name against this environment's prompts.
 *
 * @param {string} promptName  what the archive item said
 * @param {Array}  localPrompts rows from `PK='AIPROMPTS'`
 * @returns {{promptId: string, matched: number}} '' when nothing matched.
 */
function resolveLocalPromptId(promptName, localPrompts) {
  const want = promptMatchKey(promptName);
  if (!want) return { promptId: '', matched: 0 };
  const hits = (localPrompts || []).filter((p) => promptMatchKey(p && p.name) === want);
  return { promptId: hits.length ? String(hits[0].promptId || '') : '', matched: hits.length };
}

module.exports = {
  PROMPT_TAG_PREFIX,
  promptMatchKey,
  promptLinkTag,
  promptNameFromTags,
  resolveLocalPromptId,
};
