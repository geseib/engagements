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
  change: 'Change my answer',
  openIcon: (kindLabel, section, point) => `${kindLabel} ask from ${section}, point ${point}. Preview it.`,
});

export default FW;
