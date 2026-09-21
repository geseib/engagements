/**
 * What a builder does differently when it is ADDING to a set rather than
 * making one — components/AddQuestionsDialog.jsx is the way in. One module, so
 * the three builders cannot each grow their own reading of the two modes.
 *
 *   appendTo = { setName, mode: 'existing' | 'new', categories: string[] }
 */
export const isAppend = (appendTo) => Boolean(appendTo && appendTo.setName);
export const appendsToExisting = (appendTo) => isAppend(appendTo) && appendTo.mode === 'existing';

/** The category settings the form starts from, and in `existing` mode is held to. */
export function appendCategoryDefaults(appendTo, fallback = {}) {
  if (!appendsToExisting(appendTo)) return fallback;
  return {
    numberOfCategories: Math.max(1, appendTo.categories.length),
    mustHaveCategories: appendTo.categories.join(', '),
  };
}

/** The sentence added to the model's requirements, so the mode reaches the prompt. */
export function appendRequirement(appendTo) {
  if (!isAppend(appendTo)) return '';
  const names = (appendTo.categories || []).join(', ');
  if (appendsToExisting(appendTo)) {
    return `These questions are being ADDED to an existing set. Use ONLY these category names, spelled exactly: ${names}. Do not invent any other category. Spread the questions evenly across them.`;
  }
  return names
    ? `These questions are being ADDED to an existing set as NEW categories. These category names are already taken and must NOT be used: ${names}.`
    : '';
}

/** `customPrompt` with the requirement appended, for the job payload. */
export function withAppendRequirement(customPrompt, appendTo) {
  const extra = appendRequirement(appendTo);
  const base = String(customPrompt ?? '').trim();
  return extra ? (base ? `${base}\n\n${extra}` : extra) : base;
}

/**
 * THE BRIEF THE SET WAS MADE FROM, READ BACK OFF THE SET.
 *
 * The owner: "it should get the exact same info from before ... it should
 * prefill that as the topic. target audience should be the same as before."
 *
 * A set does not store its builder form — only what the builder composed FROM
 * it. So this reverses the builders' own templates:
 *
 *   title   `${topic} Trivia for ${audience}` / `${topic} Polls for ${audience}`
 *   context `These are ${difficulty}-level trivia questions about ${topic}.`
 *           (scenario) `… Target audience: ${audience}.`
 *
 * A set that was NOT made by a builder (a CSV, a renamed set) matches none of
 * them, and then the whole name is the topic — which is what the owner asked
 * for in as many words, and is a better start than an empty box.
 */
export function briefFromSet(set = {}) {
  const name = String(set.name ?? '').trim();
  const description = String(set.description ?? '').trim();
  const aiContext = String(set.aiContextInstruction ?? set.aiContextInstructions ?? '').trim();

  const titled = /^(.+?)\s+(?:Trivia|Polls)(?:\s+for\s+(.+))?$/i.exec(name);
  const about = /questions about (.+?)\.(?:\s|$)/i.exec(aiContext);
  const level = /These are (\w+)-level/i.exec(aiContext);
  const audienceInProse = /Target audience:\s*(.+?)\.(?:\s|$)/i.exec(`${description} ${aiContext}`);
  const trailingFor = /\s+for\s+(.+)$/i.exec(name);

  return {
    topic: (titled && titled[1]) || (about && about[1]) || name,
    audience: (titled && titled[2]) || (audienceInProse && audienceInProse[1]) || (trailingFor && trailingFor[1]) || '',
    difficulty: level ? level[1].toLowerCase() : '',
    context: description,
  };
}
