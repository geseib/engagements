/**
 * THE DOCK THAT HOLDS STILL (docs/design/parity/PLAN.md §2a; owner, 17 Oct
 * 2026: "right now the bottom row buttons jump all over the place as you move
 * the cursor or things adjust"). Fixed in the shared Dock and HostActionBar,
 * so every type that uses them holds still too:
 *
 * - the SPACE cap keeps its slot when Space does nothing (it used to vanish
 *   and pull the main button right, then push it back);
 * - the dock's hint sits before the buttons, so its words never push them;
 * - a type's way home (Build Room's HOST) is a fixed item just before
 *   SESSION, and the two are always last;
 * - nothing in the dock is added on hover.
 *
 * DOM order and attributes only: jsdom has no layout engine, so the pixel
 * measurement is D3's, in Chromium.
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import Dock from '../components/stage/Dock';
import HostActionBar from '../components/HostActionBar';

const controls = (over = {}) => ({
  primary: { id: 'go', label: 'Show results', icon: 'ChartBar' },
  secondary: { id: 'spin', label: 'Spin the wheel', icon: 'ArrowsClockwise' },
  tertiary: null,
  status: { text: '' },
  ...over,
});

function dockWith(props = {}, bar = {}) {
  return (
    <Dock status="3 of 4 answered" kbd="SPACE" onSetup={() => {}} {...props}>
      <HostActionBar controls={controls(bar)} onAction={() => {}} bigScreen />
    </Dock>
  );
}

describe('the SPACE cap keeps its place', () => {
  test('with Space off ("" passed) the cap is still there, hidden, so the main button does not move', () => {
    const { container, rerender } = render(dockWith({ kbd: 'SPACE' }));
    const on = container.querySelector('.dock .kbd');
    expect(on.textContent).toBe('SPACE');
    expect(on).not.toHaveAttribute('data-off');
    rerender(dockWith({ kbd: '' }));
    const off = container.querySelector('.dock .kbd');
    expect(off).toBe(on);
    expect(off).toHaveAttribute('data-off');
    expect(off.textContent).toBe('SPACE');
    expect(off.getAttribute('aria-hidden')).toBe('true');
  });

  test('a caller that never passes kbd still gets none', () => {
    const { container } = render(<Dock onSetup={() => {}}><button type="button">Go</button></Dock>);
    expect(container.querySelector('.kbd')).toBeNull();
  });

  test('the stylesheet hides an off cap without taking its width away', () => {
    const css = require('fs').readFileSync(require('path').join(__dirname, '../styles/stage.css'), 'utf8');
    expect(css).toMatch(/\.dock \.kbd\[data-off\]\{visibility:hidden\}/);
  });
});

describe('the hint never pushes the buttons', () => {
  test('it comes before the action bar, after the spacer', () => {
    const { container } = render(dockWith({ hint: 'That did not work.' }));
    const kids = Array.from(container.querySelector('.dock').children);
    const at = (sel) => kids.findIndex((k) => k.matches(sel));
    expect(at('.spacer')).toBeLessThan(at('.hint'));
    expect(at('.hint')).toBeLessThan(at('.host-action-bar'));
  });
});

describe('the fixed right-hand items', () => {
  test('a type\'s way home sits just before SESSION, and the two are last', () => {
    const { container } = render(dockWith({ home: <button type="button" className="dock-more" data-home="">HOST</button> }));
    const kids = Array.from(container.querySelector('.dock').children);
    expect(kids[kids.length - 2]).toHaveAttribute('data-home');
    expect(kids[kids.length - 1]).toHaveTextContent('SESSION');
  });

  test('SESSION can carry a count and say whether its panel is open', () => {
    render(dockWith({ setupCount: 2, setupCountLabel: ' asking to take a name', setupOpen: true }));
    const s = screen.getByRole('button', { name: /Session panel/ });
    expect(s).toHaveAttribute('aria-expanded', 'true');
    expect(s).toHaveAttribute('aria-haspopup', 'dialog');
    expect(s).toHaveTextContent('SESSION2 asking to take a name');
  });

  test('with no count and no open state SESSION is as it was', () => {
    render(dockWith());
    const s = screen.getByRole('button', { name: 'Session panel' });
    expect(s).not.toHaveAttribute('aria-expanded');
    expect(s.querySelector('.dock-more-n')).toBeNull();
  });
});

describe('nothing appears on hover', () => {
  test('the pointer on and off the dock changes no element in it', () => {
    const { container } = render(dockWith());
    const dock = container.querySelector('.dock');
    const before = dock.innerHTML;
    fireEvent.mouseEnter(dock);
    fireEvent.mouseOver(dock.querySelector('button'));
    fireEvent.focus(dock.querySelector('button'));
    expect(dock.innerHTML).toBe(before);
    fireEvent.mouseLeave(dock);
    expect(dock.innerHTML).toBe(before);
  });
});

describe('HostActionBar honours what a caller asks of its other buttons', () => {
  test('a disabled secondary and tertiary are disabled', () => {
    render(<HostActionBar controls={controls({ secondary: { id: 's', label: 'Spin again', icon: 'X', disabled: true }, tertiary: { id: 't', label: 'Stop', icon: 'Pause', disabled: true } })} onAction={() => {}} bigScreen />);
    expect(screen.getByRole('button', { name: 'Spin again' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Stop' })).toBeDisabled();
  });

  test('the third button arms in place like the other two', () => {
    const onAction = jest.fn();
    render(<HostActionBar controls={controls({ tertiary: { id: 't', label: 'Stop', icon: 'Pause', arm: { text: 'Press again to stop.', confirmLabel: 'Stop anyway', inPlace: true } } })} onAction={onAction} bigScreen />);
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    expect(onAction).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Stop anyway' })).toHaveClass('is-armed');
  });

  test('the main button names its keys', () => {
    render(<HostActionBar controls={controls()} onAction={() => {}} bigScreen />);
    expect(screen.getByRole('button', { name: 'Show results' })).toHaveAttribute('aria-keyshortcuts', 'Space ArrowRight');
  });

  test('ignoreKey leaves a key to the page before the bar takes it (a dialog, a focused control)', () => {
    const onAction = jest.fn();
    const ignoreKey = jest.fn(() => true);
    render(<HostActionBar controls={controls()} onAction={onAction} bigScreen ignoreKey={ignoreKey} />);
    const ev = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
    window.dispatchEvent(ev);
    expect(ignoreKey).toHaveBeenCalled();
    expect(ev.defaultPrevented).toBe(false);
    expect(onAction).not.toHaveBeenCalled();
    ignoreKey.mockImplementation(() => false);
    fireEvent.keyDown(window, { key: ' ' });
    expect(onAction).toHaveBeenCalledTimes(1);
  });
});
