/**
 * THE PRIVATE PARTS (docs/design/experience-plan/PLAN.md principle 3 and §5.3 "One-screen
 * privacy"; the list starts as audit B §2.3's eight hazards and grows as parts move).
 *
 * Where the laptop is the room's screen (one screen), every piece of host UI is one of:
 *   public       draws as it is
 *   count-only   draws as a number, with no names or text
 *   private      draws only on the host's phone, or on the laptop after a deliberate
 *                "Show on this screen: the room will see it" for that one item
 * This file lists the parts that are NOT plain public, as data, so the guard
 * (__tests__/oneScreenPrivacy.test.js) can render each with "the room sees this laptop"
 * on and fail if one appears unrevealed. Phase 1e builds that render check; Phase 0
 * holds the list itself to having every field.
 *
 *   id        stable key
 *   hazard    audit B §2.3's rank (null for a part added later)
 *   what      what could escape, in plain words
 *   where     the component(s) that draw it today
 *   tag       'private' | 'count-only'
 *   step      the plan step that fixes it
 *   note      why it is tagged as it is, where that needs saying
 */

export const PRIVACY_TAGS = Object.freeze(['private', 'count-only']);

export const PRIVATE_PARTS = Object.freeze([
  {
    id: 'read-check-warning',
    hazard: 1,
    what: 'Workie\'s read-check warning ("Workie used words the room\'s answers don\'t support…")',
    where: ['components/stage/WorkieSettings.jsx', 'components/ReadCheckNote.jsx'],
    tag: 'private',
    step: '1e',
    note: 'Reproduced on test in GitHub #48.',
  },
  {
    id: 'late-list',
    hazard: 2,
    what: 'The late list: each late answer\'s full text, with its author when the round named authors',
    where: ['components/LateList.jsx', 'components/stage/SessionSetupPanel.jsx'],
    tag: 'private',
    step: '1e',
  },
  {
    id: 'name-request',
    hazard: 3,
    what: 'A name request: the person\'s name flagged in front of the room, and the host\'s decision made in public',
    where: ['components/stage/PlayersList.jsx'],
    tag: 'count-only',
    step: '1b',
    note: 'The bell shows the count; the name only on the phone or after Show on this screen (PLAN §7 decision 4).',
  },
  {
    id: 'workie-settings',
    hazard: 4,
    what: 'Workie\'s settings: the voice and approach pickers, and "Briefing on: Workie has your briefing"',
    where: ['components/stage/WorkieSettings.jsx'],
    tag: 'private',
    step: '1e',
  },
  {
    id: 'remote-qr',
    hazard: 5,
    what: 'The phone remote\'s QR and address',
    where: ['components/stage/SessionSetupPanel.jsx'],
    tag: 'private',
    step: '1e',
    note: 'Low risk (the route needs the host\'s sign-in), but the room has no use for it.',
  },
  {
    id: 'scores-roster',
    hazard: 6,
    what: 'Scores and the full roster in the People list, open whenever the host opens the Session menu for something else',
    where: ['components/stage/PlayersList.jsx', 'components/stage/SessionSetupPanel.jsx'],
    tag: 'count-only',
    step: '1e',
    note: 'The owner\'s 25 Sep ruling allows the scoreboard on the room\'s screen when the host shows it; the list itself is the phone\'s (PLAN §3.3).',
  },
  {
    id: 'upcoming-titles',
    hazard: 7,
    what: 'The question browser\'s upcoming titles (answers and options are already withheld)',
    where: ['components/stage/SessionSetupPanel.jsx'],
    tag: 'private',
    step: '1e',
  },
  {
    id: 'sign-out-confirm',
    hazard: 8,
    what: 'A browser confirm dialog for Sign out, drawn over the room\'s screen',
    where: ['GameHostPage.jsx'],
    tag: 'private',
    step: '5b',
    note: 'The browser-dialogs ratchet already counts it; 5b turns it into the small confirm dialog.',
  },
]);
