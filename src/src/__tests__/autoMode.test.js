/**
 * AUTO-MODE — config/autoMode.js's decisions, and the wiring that acts on them.
 *
 * The owner: *"Could we have a setting that is auto-mode which advances things
 * forward when everyone was answered. obviously we need to pause on the
 * responses to give adequate time to read everything through each page of the
 * responses."*
 *
 * The decisions are pure arithmetic and are tested as such. The WIRING cannot
 * be mounted (GameHostPage is one of the files jsdom has never rendered — see
 * hookDepOrder.test.js for what that blind spot has already cost), so it is
 * pinned as source contracts: the effect exists above the early returns, the
 * ref carries the dock's own primary, and the panel renders the switch.
 */
const fs = require('fs');
const path = require('path');

const {
  AUTO_GRACE_MS,
  RESULTS_PAGE_MS,
  NOTES_MIN_MS,
  NOTES_MAX_MS,
  NOTES_MS_PER_WORD,
  notesDwellMs,
  autoDecision,
} = require('../config/autoMode');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

describe('notesDwellMs — a page of prose earns its reading time', () => {
  // rejects: a two-line page flashing past before anyone has read it.
  test('a short page gets the floor, not a flash', () => {
    expect(notesDwellMs('three little words')).toBe(NOTES_MIN_MS);
    expect(notesDwellMs('')).toBe(NOTES_MIN_MS);
    expect(notesDwellMs(null)).toBe(NOTES_MIN_MS);
  });

  // rejects: a dense page parking the room for a minute.
  test('a dense page is capped at the ceiling', () => {
    expect(notesDwellMs('word '.repeat(500))).toBe(NOTES_MAX_MS);
  });

  // rejects: the dwell not actually scaling with what is on the page.
  test('between the clamps, the dwell is words times the rate', () => {
    const words = 50; // 50 * 300 = 15000, inside [9000, 26000]
    expect(notesDwellMs('w '.repeat(words).trim())).toBe(words * NOTES_MS_PER_WORD);
  });
});

describe('autoDecision — when a patient host would move, and when they would sit still', () => {
  const base = { enabled: true, playerCount: 3 };

  // rejects: the switch not actually being a switch.
  test('disabled means null in every phase', () => {
    for (const phase of ['ASK', 'VOTE', 'RESULTS', 'FIELD_NOTES']) {
      expect(autoDecision({ ...base, enabled: false, phase, answeredCount: 3, votedCount: 3, notesReady: true })).toBeNull();
    }
  });

  // rejects: "everyone has answered" being vacuously true of an empty room,
  //          which would sprint a session nobody is playing.
  test('an empty room disables every rule', () => {
    expect(autoDecision({ ...base, playerCount: 0, phase: 'ASK', answeredCount: 0 })).toBeNull();
  });

  // rejects: advancing while someone is still typing.
  test('ASK waits until every player has answered, then takes one beat', () => {
    expect(autoDecision({ ...base, phase: 'ASK', answeredCount: 2 })).toBeNull();
    const go = autoDecision({ ...base, phase: 'ASK', answeredCount: 3 });
    expect(go).toEqual({ kind: 'primary', delayMs: AUTO_GRACE_MS, why: expect.any(String) });
  });

  test('VOTE waits until every player has voted', () => {
    expect(autoDecision({ ...base, phase: 'VOTE', votedCount: 2 })).toBeNull();
    expect(autoDecision({ ...base, phase: 'VOTE', votedCount: 3 })).toMatchObject({ kind: 'primary' });
  });

  // rejects: skipping to Workie with page 2 of the responses unshown — the
  //          specific "adequate time to read everything" the owner asked for.
  test('RESULTS pages through every page before pressing the primary', () => {
    expect(autoDecision({ ...base, phase: 'RESULTS', page: 0, pages: 3 }))
      .toMatchObject({ kind: 'page', delayMs: RESULTS_PAGE_MS });
    expect(autoDecision({ ...base, phase: 'RESULTS', page: 1, pages: 3 }))
      .toMatchObject({ kind: 'page' });
    expect(autoDecision({ ...base, phase: 'RESULTS', page: 2, pages: 3 }))
      .toMatchObject({ kind: 'primary', delayMs: RESULTS_PAGE_MS });
  });

  // rejects: a countdown over a spinner advancing past a summary nobody saw.
  test('FIELD_NOTES sits still until Workie has actually written', () => {
    expect(autoDecision({ ...base, phase: 'FIELD_NOTES', notesReady: false, pages: 3 })).toBeNull();
  });

  // rejects: prose pages all getting one flat dwell regardless of density.
  test('FIELD_NOTES dwells by what is on the page, then moves to the next round', () => {
    const text = 'w '.repeat(50).trim();
    expect(autoDecision({ ...base, phase: 'FIELD_NOTES', notesReady: true, page: 0, pages: 2, pageText: text }))
      .toMatchObject({ kind: 'page', delayMs: notesDwellMs(text) });
    expect(autoDecision({ ...base, phase: 'FIELD_NOTES', notesReady: true, page: 1, pages: 2, pageText: text }))
      .toMatchObject({ kind: 'primary', delayMs: notesDwellMs(text) + AUTO_GRACE_MS });
  });

  // rejects: auto-mode starting sessions, ending screens moving themselves, or
  //          a phase this file has never heard of getting a guess.
  test('LOBBY, ENDED and unknown phases get stillness', () => {
    for (const phase of ['LOBBY', 'ENDED', 'SOMETHING_NEW', '']) {
      expect(autoDecision({ ...base, phase, answeredCount: 3, votedCount: 3, notesReady: true })).toBeNull();
    }
  });
});

describe('the wiring — source contracts on what jsdom cannot mount', () => {
  const host = strip(read('GameHostPage.jsx'));
  const panel = strip(read('components/stage/SessionSetupPanel.jsx'));
  const session = read('config/gameSession.js');

  // rejects: the setting existing with no state, or state with no reset — a
  //          session that starts advancing itself because the LAST room did.
  test('autoMode is per-game state with a setter in the reset map', () => {
    expect(session).toMatch(/autoMode: false/);
    expect(host).toMatch(/const \[autoMode, setAutoMode\] = useState\(false\)/);
    expect(host).toMatch(/autoMode: setAutoMode/);
  });

  // rejects: the timer acting through some fifth path instead of the dock's
  //          own primary and the stage's own pager.
  test('the timer presses the dock primary through runHostAction and turns the shared page', () => {
    expect(host).toMatch(/autoActRef\.current = \{\s*primary: hostControls\.primary,\s*run: runHostAction,\s*turnTo: setStagePageIndex,\s*\}/);
    expect(host).toMatch(/autoDecision\(\{/);
    expect(host).toMatch(/hands\.primary\.disabled\) return/);
  });

  // rejects: auto-mode firing under a pinned QR or an open spotlight — it must
  //          obey the same suppressor the SPACE key does.
  test('the effect gates on shortcutsSuppressed and the full-screen surfaces', () => {
    const effect = host.slice(host.indexOf('if (!autoMode) return undefined'));
    expect(effect).toMatch(/shortcutsSuppressed\(\{/);
    expect(effect.indexOf('shortcutsSuppressed')).toBeLessThan(effect.indexOf('autoDecision('));
    expect(effect).toMatch(/showQuickstartMenu \|\| showWelcomeScreen \|\| showNewGameDialog/);
  });

  // rejects: state with no switch — a feature only reachable from devtools.
  test('the settings tab renders the switch and hands the change up', () => {
    expect(panel).toMatch(/data-testid="auto-mode"/);
    expect(panel).toMatch(/onAutoModeChange\(e\.target\.checked\)/);
    expect(host).toMatch(/autoMode=\{autoMode\}/);
    expect(host).toMatch(/onAutoModeChange=\{setAutoMode\}/);
  });
});
