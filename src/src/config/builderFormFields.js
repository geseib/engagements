/**
 * WHICH FIELDS THE AI HELPER MAY PROPOSE, as the console knows them.
 *
 * MIRRORS `lambda-functions/admin/shared/builder-form-fields.js`. Duplicated
 * rather than imported because the lambda bundle is CommonJS and unreachable
 * from this ESM build — the same deliberate duplication `QuestionSetEditor.jsx`
 * makes for the drafter's caps and `edit-question-set.js` makes for
 * GAME_TYPE_IDS.
 *
 * DRIFT IS THE RISK AND IT IS TESTED, not hoped for.
 * `src/src/__tests__/fieldDrafting.test.js` requires BOTH files — jest runs in
 * node, so it can load the CommonJS one — and asserts the key lists and the seed
 * field match, form by form. Adding a field on one side and not the other turns
 * that suite red.
 *
 * WHAT LIVES HERE AND NOT THERE: the label the operator sees, which is the
 * label already printed above the input in the builder, so the panel and the
 * form cannot disagree about what a field is called.
 *
 * WHAT LIVES THERE AND NOT HERE: the character ceilings and the guidance prose.
 * Those are prompt material. The browser has no use for them and copying them
 * would be a second thing to keep in step for no gain.
 */

export const BUILDER_FORM_FIELDS = {
  scenario: {
    formId: 'scenario',
    // The box the owner meant by "the description box": the one an operator
    // realistically fills in on its own. Named so the panel can point at it.
    seed: 'context',
    fields: [
      { key: 'customTitle', label: 'Question Set Title' },
      { key: 'context', label: 'Context/Background' },
      { key: 'audience', label: 'Target Audience' },
      { key: 'mustHaveCategories', label: 'Must Have Categories' },
      { key: 'customPrompt', label: 'Base Prompt & Additional Requirements' },
    ],
  },
  trivia: {
    formId: 'trivia',
    seed: 'topic',
    fields: [
      { key: 'topic', label: 'Topic/Subject' },
      { key: 'audience', label: 'Target Audience' },
      { key: 'mustHaveCategories', label: 'Must Have Categories' },
      { key: 'customPrompt', label: 'Additional Requirements' },
    ],
  },
  poll: {
    formId: 'poll',
    seed: 'topic',
    fields: [
      { key: 'topic', label: 'Topic/Subject' },
      { key: 'category', label: 'Category' },
      { key: 'audience', label: 'Target Audience' },
      { key: 'customPrompt', label: 'Additional Requirements' },
    ],
  },
};

/** The label for one key, for status lines. Falls back to the key itself. */
export function fieldLabel(formId, key) {
  const form = BUILDER_FORM_FIELDS[formId];
  const match = form && form.fields.find((f) => f.key === key);
  return match ? match.label : key;
}
