/**
 * THE ATTENTION EVENTS (docs/design/experience-plan/PLAN.md §4.1-§4.2; audit D §2a-2c).
 *
 * Every event that can need the host, as data: the one list Phase 1 builds the Needs-you
 * list, the bell, the Needs-you line, the marks and the help from. Phase 0 lands it so
 * the guard (__tests__/needsYouWiring.test.js) can hold each event to having all of:
 *
 *   id            stable key; audit D's event numbers are in `audit`
 *   level         'now' | 'soon' | 'glance' | 'account' (PLAN §4.1)
 *   needsYouLine  the words on the Needs-you line and in the bell's list. Required for
 *                 now and soon; null for glance (never the bell), for account (the bell's
 *                 lower section shows the account item's own title), and for an `inline`
 *                 now event, which is said beside the button that caused it
 *   markedOn      the person or thing the mark sits on, so "what is going on with Sam?"
 *                 is answered without opening anything
 *   helpLine      the sentence help will say about it (Phase 1a writes it into the guides;
 *                 until then the help-truth guard checks these words, not the guides)
 *   actions       the buttons, in order ([] when there is nothing to press)
 *
 * The words use PLAN §3.6's names; the banned-words guard reads this file.
 * Not here: the monitoring alarm (#23, outside the app) and the participant's own
 * failures (#24-26), which are the participant's screen, not the host's attention.
 * "Sam" is the plan's example name; Phase 1 fills in the real one.
 */

export const ATTENTION_LEVELS = Object.freeze(['now', 'soon', 'glance', 'account']);

export const ATTENTION_EVENTS = Object.freeze([
  {
    id: 'name-request',
    audit: [1, 16],
    level: 'now',
    needsYouLine: 'Sam wants their name on a new device · 0:20 ago',
    markedOn: 'Sam\'s row in People: amber dot, the words, lifted to the top',
    helpLine: 'When someone asks to move their name to a new device, the bell counts it, the Needs-you line under the main button names them with Let them and Not now, and their row in People carries the same two buttons.',
    actions: ['Let them', 'Not now', 'See in People'],
  },
  {
    id: 'name-open',
    audit: [2],
    level: 'soon',
    needsYouLine: 'Sam\'s name is open for a new device · 4:10 left',
    markedOn: 'Sam\'s row in People',
    helpLine: 'After you press Let them, the name stays open for five minutes; Lock again closes it early.',
    actions: ['Lock again'],
  },
  {
    id: 'late-items',
    audit: [3],
    level: 'soon',
    needsYouLine: '3 arrived late: 2 answers, 1 comment',
    markedOn: 'A dot on that round in the steps line and in the rounds list',
    helpLine: 'Answers, comments and asks that arrive after a round closes are kept as one item to review when there is a gap. Review opens them: show one on the room\'s screen, or mark them reviewed.',
    actions: ['Review'],
  },
  {
    id: 'read-check',
    audit: [4],
    level: 'soon',
    needsYouLine: 'Check Workie\'s read for round 3',
    markedOn: 'Under Workie\'s read, on private surfaces only',
    helpLine: 'If Workie\'s read uses words the answers do not support, you are asked to check it, with Redo and It\'s fine; it never shows on the room\'s screen.',
    actions: ['Redo', 'It\'s fine'],
  },
  {
    id: 'read-failed',
    audit: [5],
    level: 'now',
    needsYouLine: 'Workie\'s read didn\'t arrive',
    markedOn: 'The read panel becomes a failure card',
    helpLine: 'If Workie\'s read does not arrive, the read panel says so with Retry and Redo, and you can go on without it; the room sees the results.',
    actions: ['Retry', 'Redo', 'Go on without it'],
  },
  {
    id: 'read-ready',
    audit: [6],
    level: 'glance',
    needsYouLine: null,
    markedOn: 'The steps line\'s "Workie writing" clears',
    helpLine: 'When Workie\'s read is ready, the steps line stops saying Workie is writing.',
    actions: [],
  },
  {
    id: 'connection-lost',
    audit: [7],
    level: 'now',
    needsYouLine: 'Not hearing the room · Reconnecting',
    markedOn: 'The top bar\'s connection chip turns amber with Reconnect',
    helpLine: 'If your connection drops, the top bar says so with Reconnect, and the Needs-you list says it is not hearing the room.',
    actions: ['Reconnect'],
  },
  {
    id: 'room-window-closed',
    audit: [8],
    level: 'now', // glance in the lobby
    needsYouLine: 'The room\'s window is closed',
    markedOn: 'The room\'s window status in the top bar',
    helpLine: 'If the room\'s window is closed during a round, the top bar and the Needs-you line say so with Open it.',
    actions: ['Open it'],
  },
  {
    id: 'presence',
    audit: [9],
    level: 'glance',
    needsYouLine: null,
    markedOn: 'The person\'s row in People: here or away, and "joined 2 min ago" this round',
    helpLine: 'People shows who is here and who is away, and who joined during this round.',
    actions: [],
  },
  {
    id: 'removed',
    audit: [10],
    level: 'glance',
    needsYouLine: null,
    markedOn: 'The Removed group in People',
    helpLine: 'Someone you removed is listed under Removed in People, with Bring back.',
    actions: ['Bring back'],
  },
  {
    id: 'button-refused',
    audit: [11],
    level: 'now',
    inline: true, // it belongs to the button: the status line, never the bell or the list
    needsYouLine: null,
    markedOn: 'The status line under Your part now, read aloud',
    helpLine: 'If the main button cannot do what you asked, the line under it says why.',
    actions: [],
  },
  {
    id: 'survey-progress',
    audit: [12],
    level: 'glance',
    needsYouLine: null,
    markedOn: 'The room tile',
    helpLine: 'A survey\'s progress, and when it closes, are in the room tile.',
    actions: [],
  },
  {
    id: 'event-moved-on',
    audit: [13],
    level: 'now',
    needsYouLine: 'The event moved on to Item 3',
    markedOn: 'The Agenda',
    helpLine: 'If the event moves on while you are on an item, the Needs-you line says where it went, with Bring everyone here.',
    actions: ['Bring everyone here'],
  },
  {
    id: 'build-asks',
    audit: [14],
    level: 'now', // room ideas waiting are soon
    needsYouLine: 'Claude asked a new question',
    markedOn: 'The ask in the queue',
    helpLine: 'In a Build Room, Claude\'s asks and the room\'s ideas waiting for you are in the Needs-you list; Decide opens the ask.',
    actions: ['Decide'],
  },
  {
    id: 'room-milestone',
    audit: [],
    level: 'glance',
    needsYouLine: null,
    markedOn: 'The room tile',
    helpLine: 'Everyone in and time up show in the room tile, and a goal reached in Your part now, never on the bell.',
    actions: [],
  },
  {
    id: 'account',
    audit: [15, 17, 18, 19, 20, 21, 22],
    level: 'account',
    needsYouLine: null,
    markedOn: 'The console\'s nav badges, as today',
    helpLine: 'Drafts ready, reports built, invites, team requests, sets sent back and plan limits are in the bell\'s lower section, Your account, folded during a session.',
    actions: ['Open'],
  },
]);

/** The events that reach the Needs-you list (and so the bell's count or dot). */
export const NEEDS_YOU_EVENTS = ATTENTION_EVENTS.filter((e) => e.needsYouLine);
