// src/src/__tests__/hostConsoleShell.test.jsx
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
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
