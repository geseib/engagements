// src/src/__tests__/hostConsoleShell.test.jsx
import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import HostConsole from '../components/console/HostConsole';
import { stripFor } from '../config/workflowStrip';

const strip = stripFor({ gameType: 'call-and-answer', roundNoun: 'Round', state: 'ASK#002', totalRounds: 6, progress: { received: 3, total: 4 } });
const controls = {
  primary: { id: 'open-vote', label: 'Start voting', intent: 'finish', icon: 'ListChecks' },
  secondary: { id: 'skip', label: 'Skip this round', intent: 'skip', icon: 'SkipForward' },
  status: { text: '3 of 4 answered', tone: 'pending' },
};
const props = (over = {}) => ({
  top: { title: 'Relay expansion', code: '7924', onJoin: jest.fn(), presentHref: '/present?gameId=7924', presentDetail: { open: true, fullscreen: true, visible: true, statusAt: new Date().toISOString() } },
  strip: { strip, mode: 'full', onView: jest.fn() },
  rail: {
    moment: 'ANSWERING',
    rounds: [{ n: 1, title: 'Churchill', state: 'done' }, { n: 2, title: 'Meiji', state: 'now' }],
    people: [{ name: 'Ada', state: 'answered' }, { name: 'Omar', state: 'writing' }],
    counts: { players: 4, answered: 3, voted: 0 },
    late: [], connected: true, onOpenSection: jest.fn(),
  },
  footer: { status: controls.status, part: strip.part, controls, onAction: jest.fn(), shortcutsEnabled: false },
  ...over,
});

test('top: name, join code, room\'s window and its status', () => {
  render(<HostConsole {...props()}><div>panel</div></HostConsole>);
  expect(screen.getByText('Relay expansion')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Join 7924/ })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /Room's window/ })).toHaveAttribute('href', '/present?gameId=7924');
  expect(screen.getByText("Room's window: on, full screen")).toBeInTheDocument();
});

test('the loop is there without Your part now; the footer carries it with the buttons', () => {
  const { container } = render(<HostConsole {...props()}><div>panel</div></HostConsole>);
  expect(container.querySelector('.hc-loop .wfs-part')).toBeNull();
  expect(container.querySelector('.hc-foot').textContent).toMatch(/Your part now/);
  expect(screen.getByRole('button', { name: /Start voting/ })).toBeInTheDocument();
});

test('the rail opens the moment\'s section; the host\'s choice holds until the moment changes (Review Focus 4)', () => {
  const { rerender, container } = render(<HostConsole {...props()}><div /></HostConsole>);
  const open = () => [...container.querySelectorAll('.hc-rail details')].filter((d) => d.open).map((d) => d.dataset.section);
  expect(open()).toEqual(['people']);
  fireEvent.click(container.querySelector('.hc-rail details[data-section="people"] summary'));
  expect(open()).toEqual([]);
  rerender(<HostConsole {...props()}><div /></HostConsole>);
  expect(open()).toEqual([]);
  rerender(<HostConsole {...props({ rail: { ...props().rail, moment: 'READ' } })}><div /></HostConsole>);
  expect(open()).toEqual(['late']);
});

test('People says the one count; a section\'s link opens the session menu at its tab', () => {
  const p = props();
  const { container } = render(<HostConsole {...p}><div /></HostConsole>);
  expect(container.querySelector('[data-section="people"] summary').textContent).toMatch('3 of 4 answered');
  fireEvent.click(screen.getByRole('button', { name: 'All players' }));
  expect(p.rail.onOpenSection).toHaveBeenCalledWith('players');
});

test('the panel is drawn in the main area', () => {
  render(<HostConsole {...props()}><div data-testid="panel">panel</div></HostConsole>);
  expect(screen.getByTestId('panel').closest('.hc-main')).not.toBeNull();
});

/*
  SPACE ON A CONSOLE CONTROL (review, 15 Oct). jsdom does not know
  :focus-visible, so matches() is stubbed for that selector; jsdom also does
  not turn Space into a click, so the browser's own activation is the
  fireEvent.click that follows an unprevented keydown.
*/
describe('Space on the rail and the top line', () => {
  const realMatches = Element.prototype.matches;
  afterEach(() => { Element.prototype.matches = realMatches; });
  const stubFocusVisible = (on) => {
    Element.prototype.matches = function matches(sel) {
      if (sel === ':focus-visible') return on;
      return realMatches.call(this, sel);
    };
  };

  test('a keyboard-focused summary keeps Space: the section toggles, the room does not advance', () => {
    stubFocusVisible(true);
    const p = props({ footer: { ...props().footer, shortcutsEnabled: true } });
    const { container } = render(<HostConsole {...p}><div /></HostConsole>);
    const summary = container.querySelector('.hc-rail details[data-section="queue"] summary');
    summary.focus();
    const notPrevented = fireEvent.keyDown(summary, { key: ' ' });
    expect(notPrevented).toBe(true);
    expect(p.footer.onAction).not.toHaveBeenCalled();
    fireEvent.click(summary);
    expect(container.querySelector('details[data-section="queue"]').open).toBe(true);
  });

  test('a mouse-focused summary: Space advances the room', () => {
    stubFocusVisible(false);
    const p = props({ footer: { ...props().footer, shortcutsEnabled: true } });
    const { container } = render(<HostConsole {...p}><div /></HostConsole>);
    const summary = container.querySelector('.hc-rail details[data-section="queue"] summary');
    summary.focus();
    fireEvent.keyDown(summary, { key: ' ' });
    expect(p.footer.onAction).toHaveBeenCalledWith(controls.primary);
  });

  test('a keyboard-focused top control still lets the clicker (→) advance', () => {
    stubFocusVisible(true);
    const p = props({ footer: { ...props().footer, shortcutsEnabled: true } });
    render(<HostConsole {...p}><div /></HostConsole>);
    const join = screen.getByRole('button', { name: /Join 7924/ });
    join.focus();
    fireEvent.keyDown(join, { key: 'ArrowRight' });
    expect(p.footer.onAction).toHaveBeenCalledWith(controls.primary);
  });

  /* THE MAIN COLUMN TOO (final review, 15 Oct): a response or comment button
     the host tabbed to means that button, not "advance the room". */
  const mainButton = (p) => {
    const putUp = jest.fn();
    render(<HostConsole {...p}><button type="button" data-testid="resp" onClick={putUp}>Response 1</button></HostConsole>);
    return { button: screen.getByTestId('resp'), putUp };
  };

  test('a keyboard-focused response in the main column keeps Space: it is pressed, the room does not advance', () => {
    stubFocusVisible(true);
    const p = props({ footer: { ...props().footer, shortcutsEnabled: true } });
    const { button, putUp } = mainButton(p);
    button.focus();
    const notPrevented = fireEvent.keyDown(button, { key: ' ' });
    expect(notPrevented).toBe(true);
    expect(p.footer.onAction).not.toHaveBeenCalled();
    fireEvent.click(button);
    expect(putUp).toHaveBeenCalled();
  });

  test('a keyboard-focused response in the main column: → still advances', () => {
    stubFocusVisible(true);
    const p = props({ footer: { ...props().footer, shortcutsEnabled: true } });
    const { button } = mainButton(p);
    button.focus();
    fireEvent.keyDown(button, { key: 'ArrowRight' });
    expect(p.footer.onAction).toHaveBeenCalledWith(controls.primary);
  });

  test('a mouse-focused response in the main column: Space advances the room', () => {
    stubFocusVisible(false);
    const p = props({ footer: { ...props().footer, shortcutsEnabled: true } });
    const { button } = mainButton(p);
    button.focus();
    fireEvent.keyDown(button, { key: ' ' });
    expect(p.footer.onAction).toHaveBeenCalledWith(controls.primary);
  });

  /* THE WALK (15 Oct): click a response, press →, press Space. Chrome flips
     the still-focused button to :focus-visible after the key press, so the
     button must not still hold focus: a pointer press lets go of it. */
  test('a response pressed with the mouse lets go of focus: the next Space advances the room', () => {
    stubFocusVisible(true);
    const p = props({ footer: { ...props().footer, shortcutsEnabled: true } });
    const { button, putUp } = mainButton(p);
    button.focus();
    fireEvent.click(button, { detail: 1 });
    expect(putUp).toHaveBeenCalledTimes(1);
    expect(document.activeElement).not.toBe(button);
    fireEvent.keyDown(document.activeElement, { key: ' ' });
    expect(p.footer.onAction).toHaveBeenCalledWith(controls.primary);
    expect(putUp).toHaveBeenCalledTimes(1);
  });

  test('a response pressed from the keyboard (detail 0) keeps focus', () => {
    stubFocusVisible(true);
    const p = props({ footer: { ...props().footer, shortcutsEnabled: true } });
    const { button } = mainButton(p);
    button.focus();
    fireEvent.click(button, { detail: 0 });
    expect(document.activeElement).toBe(button);
  });

  test('a text field clicked inside the console keeps focus', () => {
    const p = props();
    render(<HostConsole {...p}><textarea data-testid="ta" /></HostConsole>);
    const ta = screen.getByTestId('ta');
    ta.focus();
    fireEvent.click(ta, { detail: 1 });
    expect(document.activeElement).toBe(ta);
  });
});

test('the footer says what is next on the wall, only when given (spec §3.5)', () => {
  const { container, rerender } = render(<HostConsole {...props()}><div /></HostConsole>);
  expect(container.querySelector('.hc-next')).toBeNull();
  rerender(<HostConsole {...props({ footer: { ...props().footer, nextOnWall: 'Next on the wall: the vote' } })}><div /></HostConsole>);
  expect(container.querySelector('.hc-foot .hc-next').textContent).toBe('Next on the wall: the vote');
});

/* THE QUEUE COUNTS THE SAME ROUNDS THE STRIP DOES (walk, 15 Oct: the queue
   said "1 of 7" while the strip said "Round 1 of 80"). The page knows only a
   few rounds' titles; the header still says the session's total. */
test('the round queue header says the strip\'s total, and lists what it knows', () => {
  const p = props();
  const rail = { ...p.rail, moment: 'LOBBY', total: 80, rounds: [{ n: 1, title: 'Churchill', state: 'now' }, { n: 2, title: 'Meiji', state: 'next' }] };
  const { container } = render(<HostConsole {...p} rail={rail}><div /></HostConsole>);
  const queue = container.querySelector('[data-section="queue"]');
  expect(queue.querySelector('summary').textContent).toMatch('1 of 80');
  expect(queue.querySelectorAll('.hc-list li')).toHaveLength(2);
});

test('with no total known, the queue header says the round alone, never a count of the list', () => {
  const p = props();
  const rail = { ...p.rail, moment: 'LOBBY', rounds: [{ n: 3, title: 'Churchill', state: 'now' }, { n: 4, title: 'Meiji', state: 'next' }] };
  const { container } = render(<HostConsole {...p} rail={rail}><div /></HostConsole>);
  const summary = container.querySelector('[data-section="queue"] summary').textContent;
  expect(summary).not.toMatch(/of 2/);
  expect(summary).toMatch(/3/);
});

describe('Late & not reviewed (late items Task 4)', () => {
  const answer = { kind: 'answer', ref: 'aaaaaaaaaaaa', round: '001', text: 'A late thought', who: 'Ada', reviewed: null };
  const comment = { kind: 'comment', ref: '202610161000000-abc', round: '001', text: 'More on this', who: 'Omar', reviewed: null };
  const late = [answer, comment, { ...answer, ref: 'bbbbbbbbbbbb' }, { ...answer, ref: 'cccccccccccc' }]
    .map((item) => ({ id: `${item.kind}:${item.ref}`, label: item.text, meta: item.who, item }));

  test('the count is the whole count; the first few show with their buttons', async () => {
    const onLateShow = jest.fn();
    const onLateMark = jest.fn();
    const p = props({ rail: { ...props().rail, moment: 'READ', late, lateCount: 5, lateWall: { round: '001', beat: 'feedback' }, onLateShow, onLateMark } });
    const { container } = render(<HostConsole {...p}><div /></HostConsole>);
    const sec = container.querySelector('[data-section="late"]');
    expect(sec.querySelector('summary').textContent).toMatch('5');
    expect(sec.querySelectorAll('li')).toHaveLength(3);
    // No wall for a late round answer.
    const [first, second] = sec.querySelectorAll('li');
    expect(first.textContent).not.toMatch('Show on the wall');
    fireEvent.click([...first.querySelectorAll('button')].find((b) => b.textContent === 'Mark reviewed'));
    expect(onLateMark).toHaveBeenCalledWith(answer);
    // The buttons wait out the first call (no double send) before the next.
    await act(async () => {});
    fireEvent.click([...second.querySelectorAll('button')].find((b) => b.textContent === 'Show on the wall'));
    expect(onLateShow).toHaveBeenCalledWith(comment);
    fireEvent.click(screen.getByRole('button', { name: 'Review them' }));
    expect(p.rail.onOpenSection).toHaveBeenCalledWith('history');
  });

  test('an earlier round\'s comment: no Show, only Mark reviewed (review fix)', () => {
    const p = props({ rail: { ...props().rail, moment: 'READ', late, lateCount: 4, lateWall: { round: '002', beat: 'feedback' } } });
    const { container } = render(<HostConsole {...p}><div /></HostConsole>);
    expect(container.querySelector('[data-section="late"]').textContent).not.toMatch('Show on the wall');
  });

  test('a refusal is said in the rail', async () => {
    const onLateMark = jest.fn(() => Promise.resolve({ ok: false, error: 'That did not work.' }));
    const p = props({ rail: { ...props().rail, moment: 'READ', late, lateCount: 4, onLateMark } });
    const { container } = render(<HostConsole {...p}><div /></HostConsole>);
    const first = container.querySelector('[data-section="late"] li');
    fireEvent.click([...first.querySelectorAll('button')].find((b) => b.textContent === 'Mark reviewed'));
    expect(await screen.findByRole('alert')).toHaveTextContent('That did not work.');
  });

  test('while a call is in flight every late button waits, so a second press cannot send it twice', async () => {
    let finish;
    const onLateMark = jest.fn(() => new Promise((resolve) => { finish = resolve; }));
    const onLateShow = jest.fn(() => Promise.resolve({ ok: true }));
    const p = props({ rail: { ...props().rail, moment: 'READ', late, lateCount: 4, lateWall: { round: '001', beat: 'feedback' }, onLateMark, onLateShow } });
    const { container } = render(<HostConsole {...p}><div /></HostConsole>);
    const sec = container.querySelector('[data-section="late"]');
    const buttons = () => [...sec.querySelectorAll('li button')];
    const mark = () => buttons().find((b) => b.textContent === 'Mark reviewed');
    fireEvent.click(mark());
    expect(buttons().every((b) => b.disabled)).toBe(true);
    fireEvent.click(mark());
    fireEvent.click(buttons().find((b) => b.textContent === 'Show on the wall'));
    expect(onLateMark).toHaveBeenCalledTimes(1);
    expect(onLateShow).not.toHaveBeenCalled();
    await act(async () => { finish({ ok: true }); });
    expect(buttons().every((b) => !b.disabled)).toBe(true);
  });

  test('the footer\'s late count opens the list', () => {
    const onReviewLate = jest.fn();
    const status = { text: '3 of 4 answered · 1 late answer kept', tone: 'pending', late: { line: '1 late answer kept', link: '1 late answer kept' } };
    render(<HostConsole {...props({ footer: { ...props().footer, status, onReviewLate } })}><div /></HostConsole>);
    fireEvent.click(screen.getByRole('button', { name: '1 late answer kept' }));
    expect(onReviewLate).toHaveBeenCalled();
  });
});

/* THE SCOREBOARD FROM THE PEOPLE SECTION (owner, 16 Oct 2026): a button that
   opens or closes the scoreboard on the wall through the page's own toggle,
   labelled for what it will do, drawn only where a scoreboard is allowed.
   rejects: a dead button on a poll; a label that says the state, not the act. */
describe('People: the scoreboard button', () => {
  const withBoard = (scoreboard) => props({ rail: { ...props().rail, scoreboard } });
  test('closed: "Show scoreboard" opens it', () => {
    const onToggle = jest.fn();
    render(<HostConsole {...withBoard({ show: true, enabled: true, open: false, onToggle })}><div /></HostConsole>);
    const b = screen.getByRole('button', { name: 'Show scoreboard' });
    expect(b.closest('[data-section="people"]')).not.toBeNull();
    fireEvent.click(b);
    expect(onToggle).toHaveBeenCalledWith(true);
  });
  test('open: "Hide scoreboard" closes it', () => {
    const onToggle = jest.fn();
    render(<HostConsole {...withBoard({ show: true, enabled: true, open: true, onToggle })}><div /></HostConsole>);
    fireEvent.click(screen.getByRole('button', { name: 'Hide scoreboard' }));
    expect(onToggle).toHaveBeenCalledWith(false);
  });
  test('before a round is scored: there, disabled, with the reason', () => {
    render(<HostConsole {...withBoard({ show: true, enabled: false, open: false, reason: 'Scores appear after the first round', onToggle: jest.fn() })}><div /></HostConsole>);
    expect(screen.getByRole('button', { name: 'Show scoreboard' })).toBeDisabled();
    expect(screen.getByText('Scores appear after the first round')).toBeInTheDocument();
  });
  test('where no scoreboard is allowed, no button', () => {
    render(<HostConsole {...withBoard({ show: false, enabled: false, open: false, onToggle: jest.fn() })}><div /></HostConsole>);
    expect(screen.queryByRole('button', { name: /scoreboard/i })).toBeNull();
    render(<HostConsole {...props()}><div /></HostConsole>);
    expect(screen.queryByRole('button', { name: /scoreboard/i })).toBeNull();
  });
});

/* ONE SCOREBOARD CLOSE ON THE CONSOLE (controller ruling, 16 Oct 2026): the
   People section's button. The page no longer draws a second "Take it down"
   card in the main area. rejects: two controls for one act. */
test('the page draws no second scoreboard card on the console', () => {
  // eslint-disable-next-line global-require
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'GameHostPage.jsx'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  expect(src).not.toMatch(/consoleBoard/);
  expect(src).not.toMatch(/Take it down|takeItDown|scoreboardOnWall/);
  expect(src).toMatch(/scoreboard: \{ \.\.\.scoreboardAvail, open: scoreboard\.open, onToggle:/);
});
