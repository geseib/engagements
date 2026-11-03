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
      { key: 'customTitle', label: 'Set title' },
      { key: 'context', label: 'Context or background' },
      { key: 'audience', label: 'Audience' },
      { key: 'mustHaveCategories', label: 'Categories it must include' },
      { key: 'customPrompt', label: 'Your additions' },
    ],
  },
  trivia: {
    formId: 'trivia',
    seed: 'topic',
    fields: [
      { key: 'topic', label: 'Topic or subject' },
      { key: 'audience', label: 'Audience' },
      { key: 'mustHaveCategories', label: 'Categories it must include' },
      { key: 'customPrompt', label: 'Anything else it should know' },
    ],
  },
  poll: {
    formId: 'poll',
    seed: 'topic',
    fields: [
      { key: 'topic', label: 'Topic or subject' },
      { key: 'category', label: 'Category' },
      { key: 'audience', label: 'Audience' },
      { key: 'customPrompt', label: 'Anything else it should know' },
    ],
  },
};

/** The label for one key, for status lines. Falls back to the key itself. */
export function fieldLabel(formId, key) {
  const form = BUILDER_FORM_FIELDS[formId];
  const match = form && form.fields.find((f) => f.key === key);
  return match ? match.label : key;
}
