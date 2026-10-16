/**
 * THE LATE LIST'S WORDS (session flow v3 §4.4; late items Task 4).
 *
 * The host's words only. Nothing here is ever shown on a phone, laptop or
 * tablet in the room, or on the wall: the review labels are the host's and
 * the report's (owner, Q14). __tests__/lateList.test.jsx holds that no room
 * file imports this one.
 *
 * The three labels are the owner's, exactly, and match the server's
 * (lambda-functions/game/late-labels.js), which sends them on every item.
 */
const plural = (n, one, many) => (n === 1 ? one : many);

const PHASES = {
  ASK: 'Answering',
  VOTE: 'Voting',
  RESULTS: 'Results',
  RESULT: 'Results',
};

const LW = Object.freeze({
  heading: 'Late & not reviewed',

  kinds: Object.freeze({
    answer: 'Late answer',
    askAnswer: 'Late answer to a question',
    comment: 'Comment added later',
  }),

  labels: Object.freeze({
    none: 'Not reviewed',
    read: 'Reviewed by the host',
    shown: 'Reviewed with the room',
  }),

  show: 'Show on the wall',
  markReviewed: 'Mark reviewed',
  empty: 'Nothing arrived late.',
  loadFailed: 'The late list could not load. It will try again.',

  closeComments: 'Close comments',
  closeExplain: 'Comments stay open until 24 hours after the end. Close them now to stop new ones.',
  commentsClosed: 'Comments are closed.',

  review: 'Review',

  /*
    THE REPORT (late items Task 5): each round's "Arrived late", and the
    setting that leaves the not-reviewed ones out. The line saying how many
    were left out comes from the server (late-labels.js leftOutLine), with the
    report it describes.
  */
  report: Object.freeze({
    heading: 'Arrived late',
    toQuestion: (q) => `To: ${q}`,
    on: (label) => `On ${label}`,
    settingHeading: 'Report',
    settingLabel: 'Include items not reviewed',
    settingNote: 'Late answers and comments added later carry a label: not reviewed, reviewed with the room, '
      + 'or reviewed by the host. Off, the report leaves out the ones not reviewed and says how many. '
      + 'It applies the next time the report is made.',
    settingFailed: 'The setting did not save. Try again.',
  }),

  /** "during Round 3 · Voting", from a state the server stamped ("VOTE#003"). */
  arrivedDuring(state, roundNoun) {
    const s = String(state || '').trim();
    if (!s) return '';
    if (s === 'ENDED') return 'after the session ended';
    const m = /^(ASK|VOTE|RESULTS?)#(\d+)$/i.exec(s);
    if (!m) return '';
    const noun = String(roundNoun || 'Round').trim() || 'Round';
    return `during ${noun} ${parseInt(m[2], 10)} · ${PHASES[m[1].toUpperCase()]}`;
  },

  /** A group's heading: "Round 3". */
  roundHeading(round, roundNoun) {
    const noun = String(roundNoun || 'Round').trim() || 'Round';
    return `${noun} ${parseInt(round, 10) || round}`;
  },

  /**
   * The status line's count while the session runs: "1 late answer kept"
   * when every waiting item is an answer, otherwise "3 late items not reviewed".
   */
  statusCount(notReviewed, answersOnly) {
    const n = Number(notReviewed) || 0;
    return answersOnly
      ? `${n} ${plural(n, 'late answer', 'late answers')} kept`
      : `${n} ${plural(n, 'late item', 'late items')} not reviewed`;
  },

  /** At the end: "2 items not reviewed". */
  endedCount(notReviewed) {
    const n = Number(notReviewed) || 0;
    return `${n} ${plural(n, 'item', 'items')} not reviewed`;
  },
});

/**
 * THE CONSOLE RAIL'S COMPACT LINE for a late item (walk W1, 16 Oct 2026),
 * LateList's own: the author, then when it arrived ("Dan · during Round 1 ·
 * Voting"). No author (a hidden round, or a late answer to a question for the
 * room): the kind stands in, once. Never the server's `who`, which falls back
 * to the kind's words and so said it twice.
 */
export function lateRailMeta(item = {}) {
  const who = item.author ? String(item.author) : (LW.kinds[item.kind] || '');
  return [who, LW.arrivedDuring(item.arrivedDuring, item.roundNoun)].filter(Boolean).join(' · ');
}

export default LW;
