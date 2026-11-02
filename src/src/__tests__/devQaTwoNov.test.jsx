/**
 * LIVE QA ON DEV (f92287e7f) OF EXPERIENCE-PLAN PHASE 2, 2 NOV 2026.
 *
 * One file for the findings whose fix is a rule rather than a restyle; each
 * test names the finding it rejects. The Session menu's sections are pinned in
 * setupPanel.test.js and sessionSetupPanel.test.jsx, the one orange button in
 * mainButtonPalette.test.js, the quiet reads in commentsClient.test.js and
 * aiSummaryRecovery.test.js (and tests/round-comments.js,
 * tests/ai-summary-host-only-params.js, tests/end-session.js on the server).
 */
import React from 'react';
import fs from 'fs';
import path from 'path';
import { render, screen, fireEvent, within } from '@testing-library/react';

import NeedsActions from '../components/needs/NeedsActions';
import NeedsYouLine from '../components/needs/NeedsYouLine';
import HostActionBar from '../components/HostActionBar';
import SessionSetup from '../components/console/panels/SessionSetup';
import SessionSetupPanel from '../components/stage/SessionSetupPanel';
import { ACTION_WORDS, NEEDS_ACTIONS, NEEDS_LEVELS } from '../config/needsYou';
import { roundStep } from '../config/roundStep';
import { workflowStrip } from '../config/workflowStrip';
import { pulseFor, answersAreChoices } from '../config/consolePulse';
import { consolePeopleFor } from '../config/consoleRail';
import { timesUpPartFor, TIMER_WORDS } from '../config/roundTimer';
import { SETUP_TYPES, CONSOLE_TYPES, oneScreenWhy } from '../config/surfaces';
import { setupStepFor } from '../config/sessionSetup';

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');

jest.mock('qrcode.react', () => ({
  QRCodeSVG: ({ value }) => <div data-testid="qr" data-value={value} />,
}));

// ── 2. "Let them" pressed twice, said ───────────────────────────────────
describe('an armed Let them says why (finding 2)', () => {
  const sam = {
    id: 'name:Sam', kind: 'name-request', level: NEEDS_LEVELS.NOW, name: 'Sam',
    text: 'Sam wants their name on a new device', armLet: true,
    actions: [NEEDS_ACTIONS.LET, NEEDS_ACTIONS.NOT_NOW],
  };
  const NOTE = "Sam's first device is still open. Press again to move the name.";

  // rejects: dev QA 2 Nov — the first press changed only the label, and QA thought it was broken.
  test('on a row (People, the Remote): the first press arms and says why, politely; the second moves the name', () => {
    const onAct = jest.fn();
    render(<NeedsActions item={sam} onAct={onAct} />);
    const note = screen.getByTestId('needs-armed-note');
    expect(note).toHaveAttribute('aria-live', 'polite');
    expect(note).toHaveTextContent('');
    fireEvent.click(screen.getByRole('button', { name: 'Let them: Sam' }));
    expect(onAct).not.toHaveBeenCalled();
    expect(note).toHaveTextContent(NOTE);
    fireEvent.click(screen.getByRole('button', { name: 'Let them anyway: Sam' }));
    expect(onAct).toHaveBeenCalledWith(sam, NEEDS_ACTIONS.LET);
    expect(note).toHaveTextContent('');
  });

  test('no note where nothing arms (their first device is away)', () => {
    render(<NeedsActions item={{ ...sam, armLet: false }} onAct={() => {}} />);
    expect(screen.queryByTestId('needs-armed-note')).toBeNull();
  });

  // rejects: dev QA 2 Nov — the line is one fixed height, so a second line would be clipped.
  test('on the Needs-you line the note takes the item\'s words, in the line\'s live region', () => {
    const onAct = jest.fn();
    render(<NeedsYouLine needs={{ top: sam, items: [sam] }} onAct={onAct} />);
    const region = screen.getByTestId('needs-line-text');
    expect(region).toHaveAttribute('aria-live', 'polite');
    fireEvent.click(screen.getByRole('button', { name: 'Let them: Sam' }));
    expect(within(region).getByTestId('needs-armed-note')).toHaveTextContent(NOTE);
    expect(region).not.toHaveTextContent('Sam wants their name');
    fireEvent.click(screen.getByRole('button', { name: 'Let them anyway: Sam' }));
    expect(onAct).toHaveBeenCalledTimes(1);
    expect(region).toHaveTextContent('Sam wants their name');
  });

  test('the words come from the one words file, and every place draws the same buttons', () => {
    expect(ACTION_WORDS.armedNote('Sam')).toBe(NOTE);
    // The person row, People on the console, and the Remote's list all draw NeedsActions with its note.
    for (const file of [['components', 'people', 'PersonRow.jsx'], ['components', 'console', 'ConsoleRail.jsx'], ['components', 'needs', 'SessionNeedsList.jsx']]) {
      const src = read(...file);
      expect([file.join('/'), /<NeedsActions\b/.test(src)]).toEqual([file.join('/'), true]);
      expect([file.join('/'), /showNote=\{false\}/.test(src)]).toEqual([file.join('/'), false]);
    }
    expect(read('HostRemote.jsx')).toMatch(/<SessionNeedsList\b/);
  });
});

// ── 3. Trivia and Poll in their own words ─────────────────────────────
describe('after the reveal, each type speaks its own words (finding 3)', () => {
  const results = (gameType) => {
    const ctx = { gameType, state: 'RESULTS#002', roundNoun: 'Round', answerCount: 3, playerCount: 3 };
    const step = roundStep('RESULTS', ctx);
    return { step, strip: workflowStrip(step, ctx) };
  };
  const line = (part) => `${part.before}${part.action}${part.after}`;

  // rejects: dev QA 2 Nov — Trivia read "Talk them through, then What we heard" and "Show response 1 of 3".
  test('Trivia: the answer is up, then Workie\'s read; no "Show response"', () => {
    const { step, strip } = results('trivia');
    expect(step.primary.label).toBe("Workie's read");
    expect(step.secondary).toBeNull();
    expect(line(strip.part)).toBe("The answer is up. Talk it through, then Workie's read.");
    expect(step.next).toBe("Workie's read");
  });

  test('Trivia after the read points at Scores, its own optional step', () => {
    const ctx = { gameType: 'trivia', state: 'RESULTS#002', stageBeat: 'field-notes', roundNoun: 'Round', notes: { page: 0, pages: 1, ready: true } };
    const step = roundStep('READ', ctx);
    expect(line(workflowStrip(step, ctx).part)).toBe('The read is done. Show the scoreboard if you like, then Start round 3.');
  });

  test('Poll: the room\'s answer is up, then Workie\'s read', () => {
    const { step, strip } = results('poll');
    expect(step.primary.label).toBe("Workie's read");
    expect(step.secondary).toBeNull();
    expect(line(strip.part)).toBe("The room's answer is up. Talk it through, then Workie's read.");
  });

  test('Call & Answer keeps its own: What we heard, and Show response 1 of 3', () => {
    const { step, strip } = results('call-and-answer');
    expect(step.primary.label).toBe('What we heard');
    expect(step.secondary.label).toBe('Show response 1 of 3');
    expect(line(strip.part)).toBe('The results are up. Talk them through, then What we heard.');
  });

  // rejects: dev QA 2 Nov — "still writing" for a tap on an option.
  test('a choice round is "still answering" in the pulse and the person row; an open one still writes', () => {
    expect(answersAreChoices('trivia')).toBe(true);
    expect(answersAreChoices('poll', { kind: 'choice' })).toBe(true);
    expect(answersAreChoices('poll', { options: ['Mon', 'Fri'] })).toBe(true);
    expect(answersAreChoices('poll', { kind: 'text' })).toBe(false);
    expect(answersAreChoices('call-and-answer')).toBe(false);
    expect(pulseFor({ moment: 'ANSWERING', players: 3, answered: 1, choice: true }).room.sub).toBe('2 still answering');
    expect(pulseFor({ moment: 'ANSWERING', players: 3, answered: 1 }).room.sub).toBe('2 still writing');
    const rows = consolePeopleFor({
      moment: 'ANSWERING', players: [{ name: 'Ada' }, { name: 'Bo' }], answeredNames: ['Ada'], answeredCount: 1,
      gameType: 'trivia', choice: true,
    });
    expect(rows.map((r) => r.state)).toEqual(['answered', 'answering']);
    expect(read('components', 'console', 'ConsoleRail.jsx')).toMatch(/answering: CW\.stillAnswering/);
    expect(read('GameHostPage.jsx')).toMatch(/choice=\{consoleChoice\}/);
  });
});

// ── 4. +1 min beside the main button ──────────────────────────────────
describe('one screen, a timed round: +1 min beside the main button (finding 4)', () => {
  const controls = {
    primary: { id: 'reveal-from-ask', label: 'Show results', intent: 'finish', icon: 'ChartBar', disabled: false, hint: '' },
    secondary: null,
    status: { text: '', tone: '' },
  };
  // rejects: dev QA 2 Nov — during a live timed round one screen showed no way to add time.
  test('the bar draws +1 min right before the main button when asked, and it adds a minute', () => {
    const onAddTime = jest.fn();
    const { container } = render(<HostActionBar controls={controls} onAction={() => {}} onAddTime={onAddTime} showAddTime />);
    const plus = screen.getByTestId('bar-add-minute');
    expect(plus).toHaveTextContent(TIMER_WORDS.plusOne);
    expect(plus.nextElementSibling).toBe(container.querySelector('.host-action-bar__primary'));
    fireEvent.click(plus);
    expect(onAddTime).toHaveBeenCalledTimes(1);
  });
  test('not without a timer, and not where the pulse carries it (the console)', () => {
    render(<HostActionBar controls={controls} onAction={() => {}} showAddTime />);
    expect(screen.queryByTestId('bar-add-minute')).toBeNull();
    expect(read('components', 'console', 'ConsoleFooter.jsx')).not.toMatch(/showAddTime/);
  });
  test('the one-screen stage asks for it, with the timer\'s own handler', () => {
    const page = read('GameHostPage.jsx');
    expect(page).toMatch(/onAddTime=\{phaseTimer && !viewing \? addMinute : null\}\s*\/\*[\s\S]*?\*\/\s*showAddTime/);
  });
});

// ── 5. Wavelength opens Setup ─────────────────────────────────────────
describe('Wavelength opens Setup, and says why one screen (finding 5)', () => {
  // rejects: dev QA 2 Nov — Start went straight to Wavelength's lobby.
  test('Setup is for the console types and Wavelength', () => {
    expect(SETUP_TYPES).toEqual([...CONSOLE_TYPES, 'wavelength']);
    const page = read('GameHostPage.jsx');
    expect(page).toMatch(/SETUP_TYPES\.includes\(normalizeGameType\(currentGameType\)\)/);
    expect(page).toMatch(/const setupChoice = setupOneOnly \? 'classic' : roomScreenChoice;/);
  });
  test('the choice is made for it: Setup opens at the check, then the one-screen path', () => {
    expect(setupStepFor({ choice: 'classic' })).toBe('screen');
    expect(setupStepFor({ choice: 'classic', checked: true })).toBe('joins');
  });
  test('step 1 says it runs on one screen and why, with no chooser, no Change and no "Use two screens"', () => {
    const why = oneScreenWhy('wavelength');
    expect(why).toMatch(/the room's window has no Write and Reveal moments yet, so the room watches this laptop/);
    render(
      <SessionSetup
        step="screen" choice="classic" oneOnly={why}
        onChange={() => {}} onUseTwo={() => {}}
        players={[]} title="Words" code="4821" now={0}
      />,
    );
    expect(screen.getByTestId('setup-one-only')).toHaveTextContent(why);
    const first = document.querySelector('[data-step="where"]');
    expect(first).toHaveAttribute('data-state', 'done');
    expect(within(first).getByText('One screen')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Change' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Use two screens' })).toBeNull();
  });
});

// ── 7. Everyone's in beats Time's up ──────────────────────────────────
describe('Your part now at zero (finding 7)', () => {
  // rejects: dev QA 2 Nov — "Time's up" with 3 of 3 answered.
  test('everyone in takes precedence over the time message', () => {
    expect(timesUpPartFor({ timeIsUp: true, gameState: 'ASK#002', everyoneIn: true })).toEqual(TIMER_WORDS.everyoneInPart);
    expect(timesUpPartFor({ timeIsUp: true, gameState: 'ASK#002', everyoneIn: true, closesIntoVote: false }).after).toBe(' Show the results.');
    expect(timesUpPartFor({ timeIsUp: true, gameState: 'ASK#002', everyoneIn: false }).action).toBe("Time's up.");
    expect(timesUpPartFor({ timeIsUp: false, gameState: 'ASK#002', everyoneIn: true })).toBeNull();
    expect(timesUpPartFor({ timeIsUp: true, gameState: 'RESULTS#002', everyoneIn: true })).toBeNull();
    expect(read('GameHostPage.jsx')).toMatch(/timesUpPartFor\(\{ timeIsUp, gameState, closesIntoVote, everyoneIn: everybodyIn \}\)/);
  });
});

// ── 1. the Session menu: People as a view, a survey's close, End in the lobby ──
describe('the Session menu\'s people and endings (finding 1)', () => {
  const players = [{ name: 'Ada', score: 3 }, { name: 'Bo', score: 1 }];
  // rejects: dev QA 2 Nov — Players was a Session menu tab beside a People column.
  test('beside a People column the full list is a view, "All N, and who left", not a section', () => {
    render(<SessionSetupPanel players={players} peopleColumn initialTab="players" />);
    expect(screen.queryByRole('tab', { name: 'People' })).toBeNull();
    const view = screen.getByRole('region', { name: 'All 2, and who left' });
    expect(within(view).getAllByTestId('roster-name').map((n) => n.textContent)).toEqual(['Ada', 'Bo']);
    expect(read('components', 'console', 'ConsoleRail.jsx')).toMatch(/onLink=\{\(\) => onOpenSection\('players'\)\}/);
  });
  test('a survey closes from its menu with the main button\'s own control', () => {
    const onAct = jest.fn();
    const close = { id: 'close-survey', label: 'Close the survey', intent: 'close-survey' };
    const warn = { id: 'warn-survey', label: 'Two-minute warning', intent: 'warn-survey' };
    render(<SessionSetupPanel gameType="survey" gameState="SURVEY#OPEN" surveyActs={{ close, warn, end: null, closed: false, onAct }} />);
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Screens', 'Joining', 'Close survey', 'People', 'End session']);
    fireEvent.click(screen.getByRole('tab', { name: 'Close survey' }));
    fireEvent.click(screen.getByTestId('session-menu-close-survey'));
    expect(onAct).toHaveBeenCalledWith(close);
    fireEvent.click(screen.getByRole('tab', { name: 'End session' }));
    expect(screen.getByText(/Close the survey first/)).toBeInTheDocument();
  });
  test('an event opens its menu on Agenda', () => {
    render(<SessionSetupPanel event={{ onAgenda: () => {}, onBringHere: null }} />);
    expect(screen.getByRole('tab', { name: 'Agenda' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('session-menu-agenda')).toBeInTheDocument();
  });
});
