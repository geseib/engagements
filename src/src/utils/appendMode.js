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
