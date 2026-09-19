import { browserRow } from './setupPanel';

/**
 * THE SET EDITOR'S PREVIEW, AS DATA — how an editor row becomes what the card
 * is given. The card is components/QuestionCard.jsx (the stage renders it
 * too); the surface is components/QuestionPreview.jsx.
 *
 * Pure, so every rule here is reachable from a test without mounting anything.
 * Spec: docs/superpowers/specs/2026-09-19-question-preview-design.md.
 */

/**
 * The importer's `toMediaKey` (lambda-functions/admin/upload-questions.js:81-92),
 * mirrored: what an image value will be once the set is saved. With no set id
 * there is nothing to key to, and the value is left as typed rather than
 * turned into a `sets//file` path no Save ever writes.
 */
function storedImage(rawImage, setId) {
  const image = String(rawImage ?? '').trim();
  if (!image || !setId) return image;
  if (/^https?:\/\//i.test(image)) return image;
  if (image.startsWith('/')) return image;
  const prefix = `sets/${setId}/`;
  if (image.startsWith(prefix)) return image;
  return `${prefix}${image.split('/').pop()}`;
}

/**
 * game/get-question.js:249-255's RESULTS rewrite of a stored answer, mirrored:
 * "OptionC" becomes optionC's own text. Only the single-string form is
 * mirrored, because it is the only form an editor row can hold — toRow reads
 * the answer through `text()` (utils/questionRows.js:121), so even a stored
 * array arrives here as one string.
 */
function revealedAnswer(answer, row) {
  if (typeof answer !== 'string' || !answer.startsWith('Option')) return answer;
  const optionLetter = answer.replace('Option', '').toLowerCase();
  return row[`option${optionLetter.toUpperCase()}`] || answer;
}

/**
 * AN EDITOR ROW, SPELLED THE WAY THE STAGE RECEIVES A QUESTION.
 *
 * The card reads the wire's field names (game/get-question.js:221-268). The
 * editor holds utils/questionRows.js:toRow rows, and three of the fields the
 * card depends on are spelled or shaped differently there:
 *
 *   customInstructions  toRow keeps the per-question instruction as the
 *                       SINGULAR `customInstruction` (questionRows.js:107), and
 *                       resolveInstruction reads only the plural
 *                       (config/instructions.js:44) — so unmapped, a
 *                       question's own instruction silently loses to the set's.
 *   image               an upload not yet saved is a bare file name
 *                       (QuestionImageField.jsx:14-24); the importer keys it to
 *                       sets/<setId>/<file> on Save. Keyed here, so the preview
 *                       shows the file the room will get — and shows nothing
 *                       for a key copied from another set, as the room will.
 *   correctAnswer       the editor keeps "OptionC" (QuestionsPanel.jsx:1464);
 *                       at RESULTS the wire carries optionC's own TEXT.
 *                       isCorrectTriviaOption compares slot ids against the
 *                       POSITIONAL letter, so on a question whose filled slots
 *                       are not contiguous (A, C, D) "OptionC" also matches the
 *                       option lettered C on screen. The text never can.
 *
 * Everything else the card reads — title, detail, the six options — lines up
 * already (spec §3.4) and passes through untouched. No row stages as `null`,
 * so nothing selected hands the card nothing to draw.
 */
export function stagedQuestion(row, { setId = '' } = {}) {
  if (!row) return null;
  return {
    ...row,
    customInstructions: row.customInstruction || '',
    image: storedImage(row.image, setId),
    correctAnswer: revealedAnswer(row.correctAnswer || '', row),
  };
}

/**
 * The list's rows: the in-session browser's own projection (config/setupPanel.js
 * `browserRow`, an allow-list that carries no option and no answer), keyed by
 * the editor row's `uid`.
 *
 * browserRow reads identity from `id` / `Id` / `questionId`, and a toRow row has
 * none of them — only `uid`, and a stored `sk` that is empty for every question
 * added or copied in this session (questionRows.js:151, 175). Handed in raw,
 * every row comes back `id: undefined`. The uid is the key that survives an
 * edit: startEdit clones the row and commitEdit writes it back under the same
 * uid (QuestionsPanel.jsx:361, 387-392).
 *
 * Tombstones are dropped: a removed row will not exist once the set is saved.
 */
export function previewRows(rows = []) {
  return rows
    .filter((row) => row && !row.removed)
    .map((row) => browserRow({ ...row, id: row.uid }));
}

/**
 * WHY THERE IS NOTHING TO PREVIEW, or '' when there is something.
 *
 * Two situations, two lines — an empty state that lies sends people the wrong
 * way. A set with no rows has nothing yet, and the way on is adding one. A set
 * whose every row is a tombstone HAS questions, each marked for removal and
 * struck through in the Table with its Restore beside it, and Discard in the
 * bar above undoes them all; adding one is not the way back.
 *
 * One source for both places that say it: the preview's own empty state, and
 * the title on the Questions tab's disabled [Preview] (QuestionsPanel.jsx).
 */
export function nothingToPreview(rows = []) {
  if (rows.some((row) => row && !row.removed)) return '';
  if (!rows.some(Boolean)) return 'This set has no questions yet, so there is nothing to preview.';
  return 'Every question is marked for removal, so there is nothing to preview. '
    + 'Restore one in the Table, or discard your changes.';
}

/** The categories the rows actually use, in the order they first appear. */
export function previewCategories(listRows = []) {
  const seen = [];
  for (const row of listRows) {
    if (row.category && !seen.includes(row.category)) seen.push(row.category);
  }
  return seen;
}

/**
 * THE SELECTED QUESTION, FOUND AGAIN after the rows it was chosen from are gone.
 *
 * `place` is where the selection was, as of the last render that showed it:
 * the key the question is stored under once saved (utils/questionRows.js
 * `savedKeys`), its title, and its position in the visible list. A Save reads
 * the set back and every row arrives with a new uid, so the selection's uid
 * matches nothing; the stored key is what says which read-back row is the same
 * question. Its title must match too — a key names a place in the set, and if
 * the server numbered differently the place holds another question.
 *
 * Returns a VISIBLE row, or null:
 *   found, and visible          that row.
 *   found, but filtered out     null — the caller's rule for a selection the
 *                               filter hides (the first visible row) applies.
 *   not found                   the row at the same position, the last at most:
 *                               a set replaced from a CSV, say, where nothing
 *                               of the old working copy is left to find.
 */
export function refindPlace(place, rows = [], visible = []) {
  if (!place || !visible.length) return null;
  const bare = (key) => String(key || '').replace('QUESTION#', '');
  if (place.key) {
    const same = rows.find((row) => row && !row.removed
      && bare(row.sk) === place.key
      && String(row.title || '').trim() === place.title);
    if (same) return visible.find((r) => r.id === same.uid) || null;
  }
  return visible[Math.min(Math.max(place.index, 0), visible.length - 1)];
}

/**
 * The id `delta` steps from `currentId` through `ids`, wrapping at both ends.
 * An id that is not in the list steps from the top. `null` when there is
 * nothing to step through.
 */
export function stepSelection(ids = [], currentId = null, delta = 1) {
  if (!ids.length) return null;
  const at = ids.indexOf(currentId);
  if (at < 0) return ids[0];
  return ids[(at + delta + ids.length) % ids.length];
}
