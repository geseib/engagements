/**
 * THE DOCK ON ONE LINE, WITH A WAY BACK (owner, dev, 2 Nov 2026, verbatim:
 * "when i move around from the session menu and presenting the bottom bar
 * became 2 lines. and im not real sure how to get back to the main menu
 * here").
 *
 * - Main menu is the dock's first item, before the status, and runs the
 *   console's own leave (GameHostPage's requestLeave, which asks first when
 *   people are in the room).
 * - A crowded dock never wraps above 900px: the quiet items with a glyph drop
 *   their word instead (stage.css, `.dock[data-crowded]`).
 *
 * DOM order and stylesheet text only: jsdom has no layout engine, so the
 * pixel check (one row in every state, 1280x720 and 1440x900, four
 * profiles) was done in Chromium.
 *
 * // rejects: `.dock[data-crowded]{flex-wrap:wrap}` — the second line the
 * //          owner reported.
 * // rejects: a stage page with no visible way back to the start screen.
 */
import React from 'react';
import fs from 'fs';
import path from 'path';
import { render, screen, fireEvent } from '@testing-library/react';
import Dock from '../components/stage/Dock';
import HW from '../config/hostWords';

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

describe('Main menu in the dock', () => {
  test('one Main menu item, first, before the status, that calls the leave handler', () => {
    const onMainMenu = jest.fn();
    const { container } = render(
      <Dock status="7 of 12 answered" onSetup={() => {}} onAgenda={() => {}} onMainMenu={onMainMenu}>
        <button type="button">Show Results</button>
      </Dock>
    );
    const items = screen.getAllByRole('button', { name: HW.mainMenu });
    expect(items).toHaveLength(1);
    const dock = container.querySelector('.dock');
    expect(dock.firstElementChild).toBe(items[0]);
    expect(dock.children[1]).toHaveClass('status');
    // Shaped like the dock's other text items, with the hostWords label.
    expect(items[0]).toHaveClass('dock-more');
    expect(items[0].querySelector('.dock-more-lbl').textContent).toBe(HW.mainMenu);
    expect(items[0]).toHaveAttribute('title', HW.mainMenuHint);
    fireEvent.click(items[0]);
    expect(onMainMenu).toHaveBeenCalledTimes(1);
  });

  test('no handler, no item (never a dead control)', () => {
    render(<Dock onSetup={() => {}}><button type="button">Go</button></Dock>);
    expect(screen.queryByRole('button', { name: HW.mainMenu })).toBeNull();
  });

  test('the host stage\'s Main menu is the top bar\'s now, with the console\'s own leave, which asks first', () => {
    // Experience plan 2h: the stage's frame is on top. Main menu left the
    // dock for the top bar (ConsoleTop), as on the console; Your part now (the
    // <Dock> the stage still draws) carries no Main menu of its own.
    const page = read('GameHostPage.jsx');
    const dock = page.slice(page.indexOf('<Dock\n'), page.indexOf('</Dock>'));
    expect(dock).not.toMatch(/onMainMenu=/);
    const top = page.slice(page.indexOf('<ConsoleTop\n'), page.indexOf('/>', page.indexOf('bellSession={twoSurfaces')));
    expect(top).toMatch(/onLeave=\{requestLeave\}/);
    const leave = page.slice(page.indexOf('const requestLeave = () => {'), page.indexOf('const handleSwitchGame'));
    expect(leave).toMatch(/players\.length > 0/);
    expect(leave).toMatch(/setConfirmLeave\(true\)/);
  });

  test('the Session menu on this page says Main menu too', () => {
    const panel = read('components', 'stage', 'SessionSetupPanel.jsx');
    expect(panel).toMatch(/onClick=\{onSwitchGame\} title=\{HW\.mainMenuHint\}[^>]*>[\s\S]{0,200}?HW\.mainMenu\b/);
    expect(HW.mainMenu).toBe('Main menu');
  });
});

describe('the dock never takes a second line above 900px', () => {
  const css = stripComments(read('styles', 'stage.css'));

  test('the dock is a single nowrap row', () => {
    const base = css.match(/(^|\n)\.dock\{grid-area:dock;[^}]*\}/);
    expect(base).not.toBeNull();
    expect(base[0]).toMatch(/display:flex/);
    expect(base[0]).toMatch(/flex-wrap:nowrap/);
  });

  test('no crowded rule wraps it; the only wrap is the portrait tablet\'s', () => {
    expect(css).not.toMatch(/\.dock\[data-crowded\]\{[^}]*flex-wrap:wrap/);
    expect(css).not.toMatch(/\.dock\[data-crowded\] \.status\{[^}]*100%/);
    // Every `.dock{...flex-wrap:wrap...}` sits inside @media (max-width:900px).
    const wraps = [...css.matchAll(/\.dock\{[^}]*flex-wrap:wrap/g)];
    wraps.forEach((m) => {
      const before = css.slice(0, m.index);
      const media = before.lastIndexOf('@media');
      expect(before.slice(media)).toMatch(/^@media \(max-width:900px\)\{\s*$/);
    });
  });

  test('crowded: the words of the glyphed quiet items collapse, the key hints go', () => {
    // Main menu is the exception: it keeps its word until the last step.
    expect(css).toMatch(/\.dock\[data-crowded\] \.dock-more:not\(\.dock-main\) > svg \+ \.dock-more-lbl\{display:none\}/);
    expect(css).toMatch(/\.dock\[data-crowded="3"\] \.dock-main > svg \+ \.dock-more-lbl,\s*\.dock\[data-crowded="4"\] \.dock-main > svg \+ \.dock-more-lbl\{display:none\}/);
    // The last step narrows the status; it never drops it.
    expect(css).toMatch(/\.dock\[data-crowded="4"\] \.status\{min-width:min\(5em, 12vw\)\}/);
    expect(css).toMatch(/\.dock\[data-crowded\] \.keycap\{display:none\}/);
    expect(css).toMatch(/\.dock\[data-crowded\] \.host-action-bar__keyhint\{display:none\}/);
  });

  test('Main menu, AGENDA and PRESENT carry a glyph before the word, so they can collapse to it; SESSION keeps its word', () => {
    const { container } = render(
      <Dock
        onSetup={() => {}}
        onAgenda={() => {}}
        onMainMenu={() => {}}
        present={{ href: '/present/1234', presenting: 1 }}
      >
        <button type="button">Go</button>
      </Dock>
    );
    const collapsible = [...container.querySelectorAll('.dock-more')]
      .filter((el) => el.querySelector(':scope > svg + .dock-more-lbl'));
    expect(collapsible.map((el) => el.querySelector('.dock-more-lbl').textContent))
      .toEqual([HW.mainMenu, 'AGENDA', 'PRESENTING']);
    // A collapsed item keeps its name for assistive tech and on hover.
    collapsible.forEach((el) => {
      expect(el.getAttribute('aria-label')).toBeTruthy();
      expect(el.getAttribute('title')).toBeTruthy();
    });
    const session = screen.getByRole('button', { name: 'Session panel' });
    expect(session.querySelector('svg')).toBeNull();
  });

  test('still too wide: the second and third round buttons keep their glyph, the word stays their name', () => {
    // At "2", and still at "3" and "4": each step keeps what the one before it gave up.
    const rule = css.match(/\.dock\[data-crowded="2"\] \.host-action-bar__secondary > span,\s*\.dock\[data-crowded="2"\] \.host-action-bar__tertiary > span,\s*\.dock\[data-crowded="3"\] \.host-action-bar__secondary > span,\s*\.dock\[data-crowded="3"\] \.host-action-bar__tertiary > span\{([^}]*)\}/);
    expect(rule).not.toBeNull();
    expect(css).toMatch(/\.dock\[data-crowded="4"\] \.host-action-bar__secondary > span,\s*\.dock\[data-crowded="4"\] \.host-action-bar__tertiary > span\{[^}]*clip:rect\(0 0 0 0\)/);
    // Visually hidden, not display:none, so it is still the accessible name.
    expect(rule[1]).toMatch(/clip:rect\(0 0 0 0\)/);
    expect(rule[1]).not.toMatch(/display:none/);
    // The main button never loses its words.
    expect(css).not.toMatch(/\.dock\[data-crowded[^\]]*\] \.host-action-bar__primary > span/);
  });

  test('the fitter measures with the words first, then steps down one level at a time', () => {
    const src = read('components', 'stage', 'Dock.jsx');
    const fit = src.slice(src.indexOf('const fit = () => {'), src.indexOf("window.addEventListener('resize', fit)"));
    const order = ["el.removeAttribute('data-crowded')", 'if (!over()) return;', "const steps = ['', '2', '3', '4'];", "el.setAttribute('data-crowded', steps[i]);", 'if (!over()) break;']
      .map((t) => fit.indexOf(t));
    order.forEach((i) => expect(i).toBeGreaterThan(-1));
    expect([...order].sort((x, y) => x - y)).toEqual(order);
    // And again when the ladder or the font changes under it, with no resize.
    expect(src).toMatch(/new ResizeObserver\(\(\) => fit\(\)\)/);
    expect(src).toMatch(/addEventListener\('loadingdone', fit\)/);
  });
});
