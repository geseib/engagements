/**
 * EARLIER ROUNDS, AS A PARTICIPANT GOES BACK TO THEM (issue #47).
 *
 * The end screen's "Something to add?" listed rounds as "Lesson 1", "Lesson 2"
 * — nothing a person could recognise a round by — and an opened round showed
 * its title and responses but not the lesson the room had answered. These are
 * the pure halves of the fix, kept out of PlayerPage so they are tested
 * directly:
 *
 *   pastRoundLabel     the list's line for one round: its number and its
 *                      title, "Lesson 2 · Form Follows Function", shortened
 *                      for the button with the full text kept for `title=`;
 *                      "Lesson 3" alone when the title is unknown.
 *   pastRoundQuestion  the question part of the opened round, from the public
 *                      fields get-results returns for a round read back
 *                      (`question`): title, lesson and "Your turn", built by
 *                      questionRoomData so it reads as the room screen read.
 *
 * NEVER BACKGROUND. questionRoomData whitelists its fields; the server's
 * read-back does too (get-results.js roundQuestionPublic). A Background handed
 * in here by mistake still goes nowhere.
 */
import { questionRoomData, roomTitle } from './roomContent';

/** Longest title shown on a round's button before it is shortened. */
export const PAST_TITLE_MAX = 60;

const str = (v) => (typeof v === 'string' ? v.trim() : '');

/** `text` cut to `max` characters at a word where one is near, with an ellipsis. */
export function shortenTitle(text, max = PAST_TITLE_MAX) {
  const t = str(text);
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:.·-]+$/, '')}…`;
}

/**
 * One round's line on the end screen.
 * @returns {{ number: string, title: string, short: string, full: string }}
 *   `number` "Lesson 2"; `title` the title as shown (title-cased when it was
 *   all capitals) or ''; `short` the title shortened for the button; `full`
 *   the whole line, for `title=` and the accessible name.
 */
export function pastRoundLabel(noun, n, title) {
  const number = `${str(noun) || 'Round'} ${n}`;
  const shown = roomTitle(str(title));
  return {
    number,
    title: shown,
    short: shown ? shortenTitle(shown) : '',
    full: shown ? `${number} · ${shown}` : number,
  };
}

/**
 * The question part of an opened earlier round, in the snapshot shape
 * PlayerPage hands RoundReport (title, detail, task, image, school).
 * `question` is get-results' `question` ({title, detail, category,
 * customInstructions, image, school}); `fallbackTitle` is what to call the
 * round when it has no title ("Lesson 3").
 */
export function pastRoundQuestion(question, fallbackTitle = '') {
  const q = question && typeof question === 'object' ? question : {};
  const room = questionRoomData({
    title: str(q.title),
    detail: str(q.detail),
    category: str(q.category),
    customInstructions: str(q.customInstructions),
  }, { task: str(q.customInstructions) });
  return {
    title: room.title || str(fallbackTitle),
    detail: room.story,
    task: room.taskOwn ? room.task : '',
    category: room.category,
    image: str(q.image) || null,
    school: str(q.school) || null,
  };
}
