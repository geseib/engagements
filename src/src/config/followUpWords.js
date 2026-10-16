/**
 * ASK THE ROOM: EVERY WORD (docs/design/followup-icons, phase B1).
 *
 * One place for the follow-up asks' labels, so the laptop, the Remote, the wall
 * and the phones say the same thing. The kinds are Build Room's: Ideas, Choose,
 * Rate. Round-step labels (Show results, Cancel the question, Ask another) live
 * in config/roundWords.js with the rest of the dock.
 */
import { deviceWords } from './roundWords';

export const KIND_ORDER = Object.freeze(['ideas', 'choice', 'rate']);

export const KINDS = Object.freeze({
  ideas: { label: 'Ideas', icon: 'Lightbulb', blurb: 'The room writes a short answer.', wall: 'Ideas' },
  choice: { label: 'Choose', icon: 'ListChecks', blurb: 'Pick one of 2 to 4 options from the room’s answers.', wall: 'Choose one' },
  rate: { label: 'Rate', icon: 'Gauge', blurb: 'Rate a statement from the room, 1 to 5.', wall: 'Rate it' },
});

export const RATE_ENDS = Object.freeze({ low: '1 · Disagree', high: '5 · Agree' });

/*
  THE COMPOSER'S KINDS (session flow v3 §4.1). The three asks plus Comments,
  which opens the feedback round (it replaces "Request feedback"; owner, 15 Oct,
  Q7). KIND_ORDER above stays the three the wall, the phones and the server
  know; Comments never becomes an ask row.
*/
export const COMPOSER_KINDS = Object.freeze(['ideas', 'choice', 'rate', 'comments']);
export const COMMENTS_KIND = Object.freeze({ label: 'Comments', icon: 'ChatCircleText' });
/** One line each: what the kind is for, and who sees what. */
export const KIND_LINES = Object.freeze({
  ideas: 'Short written answers. Anonymous.',
  choice: 'Pick one of 2 to 4 options. Anonymous.',
  rate: 'Agree or disagree with a statement, 1 to 5. Anonymous.',
  comments: 'Comment on what we heard, the results or a response. Names are shown.',
});
export const PRIVACY_LINES = Object.freeze({
  ideas: 'Answers are anonymous. Only the ideas you put on the wall are shown to the room.',
  choice: 'Answers are anonymous. The wall shows the count for each option.',
  rate: 'Answers are anonymous. The wall shows how the room rated it.',
  comments: 'Comments carry the writer\'s name. You choose which ones go on the wall.',
});

const list = (nums) => {
  const n = nums.map(String);
  if (n.length <= 1) return n.join('');
  return `${n.slice(0, -1).join(', ')} and ${n[n.length - 1]}`;
};

const FW = Object.freeze({
  askTheRoom: 'Ask the room',
  questionForRoom: 'Question for the room',
  theRoomsAnswer: 'The room’s answer',
  sendToRoom: 'Send to the room',
  sending: 'Sending…',
  edit: 'Edit',
  doneEditing: 'Done',
  cancel: 'Cancel',
  close: 'Close',
  whatPhonesShow: 'What the phones will show',
  forYou: 'For you:',
  reworded: 'Reworded',
  yourWords: 'Your words',
  afterTheRead: 'After the read',
  finishFirst: 'Finish the open question first',
  fromAnswers: (nums) => (nums.length === 1 ? `From answer ${nums[0]}.` : `From answers ${list(nums)}.`),
  fromPoint: (section, point) => `from ${section}, point ${point}`,
  answeredOn: (x, n) => `${x} of ${n} answered on their ${deviceWords}`,
  answered: (n) => `${n} answered`,
  ideasCount: (n, shown) => `${n} ${n === 1 ? 'idea' : 'ideas'} · ${shown} shown`,
  stillToAnswer: (n) => `Still to answer (${n})`,
  averageOf5: 'average of 5',
  pickForWall: 'Put this on the wall',
  takeOffWall: 'Take it off the wall',
  onTheWall: 'On the wall',
  questionPlaceholder: 'The question the room sees',
  statementPlaceholder: 'A statement from the room',
  optionPlaceholder: (i) => `Option ${String.fromCharCode(65 + i)}`,
  addOption: 'Add an option',
  ideaPlaceholder: 'Your answer',
  send: 'Send',
  sent: 'Sent. You can change it until the results are shown.',
  // Session flow v3 §4.4: an answer that reached the server after the results.
  keptLate: 'The results are already up. Your answer is kept, but not in the count.',
  roomMovedOn: 'The room has moved on. Your answer is still here, and you can still send it.',
  leaveDraft: 'Leave it',
  done: 'Done',
  change: 'Change my answer',
  openIcon: (kindLabel, section, point) => `${kindLabel} ask from ${section}, point ${point}. Preview it.`,
  // The composer (session flow v3 §4.1).
  workieSuggests: 'Workie suggests',
  startFromBlank: 'Start from blank',
  kind: 'Kind',
  question: 'Question',
  statement: 'Statement',
  options: 'Options',
  edited: 'Edited',
  backToWorkie: 'Back to Workie\'s words',
  whatRoomSees: 'What the room sees',
  whyWorkie: 'Why Workie suggests this',
  sentAlready: 'Sent',
  commentsSend: 'Open comments',
  commentsBody: 'The room comments on what we heard, the results or any response, from their phone, laptop or tablet.',
  fromTheRead: 'Words from the read',
  fromTheReadHint: (choice) => (choice
    ? 'Click a line to add it as the next option.'
    : 'Click a line to use its words.'),
  takeLineLabel: (text) => `Use these words: ${text}`,
  // The report's full record of each question (session flow v3 §4.2).
  sentAsWritten: 'Sent as Workie wrote it',
  writtenByHost: 'Written by the host',
  workieSuggested: (words) => `Workie suggested: “${words}”`,
  editedBy: (parts) => (parts && parts.length ? `Edited by the host (${parts.join(', ')})` : 'Edited by the host'),
  workiesReason: (why) => `Workie’s reason: ${why}`,
  drawnFrom: (nums) => (nums.length === 1 ? `Drawn from response ${nums[0]}` : `Drawn from responses ${list(nums)}`),
  openFor: (from, to) => (to ? `Open ${from}–${to}` : `Sent ${from}`),
  answeredOfRoom: (n, of) => (Number.isInteger(of) ? `${n} of ${of} in the room answered` : `${n} answered`),
  shownToRoom: (n) => `Shown to the room (${n})`,
  notShown: (n) => `Not shown (${n})`,
  /** Under an Ideas record: late ideas the host put on the wall (walk W2, 16 Oct 2026). */
  lateShown: (n) => `${n} late ${n === 1 ? 'idea was' : 'ideas were'} shown to the room · see Arrived late`,
  sentFromRemote: 'Sent from the Remote',
});

export default FW;
