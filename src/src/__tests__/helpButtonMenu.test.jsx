import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';

/**
 * ONE `?` — THE GUIDES AND THE THREE WAYS TO TELL US SOMETHING.
 *
 * Reporting a bug has had three homes. A 56px circle fixed bottom-right above
 * every dialog ("floating in the way"). Then an inline icon beside Help, which
 * only two screens had a place for, so "it is not showing up in most screens".
 * Then, for a day, a quiet tab in the bottom-left corner of everything. The
 * owner, 2026-09-21: it belongs on the menu bar — and should it not just be the
 * help button? "Use the ? button to bring up these three options plus a choice
 * to read help."
 *
 * So there is no second control. The `?` a bar already carries opens a menu of
 * four: read the guides, report a bug, request a feature, ask for help. The
 * small contextual `?` buttons inside the admin sections pass no `reports` and
 * still open their own guide directly — they answer "what is this field", not
 * "something is wrong".
 */

jest.mock('../components/HelpSystem', () => (props) => (
  <div data-testid="help-system" data-section={props.section}>
    <button type="button" onClick={props.onClose}>close help</button>
  </div>
));
jest.mock('../components/IssueReportForm', () => (props) => (
  <div data-testid="issue-form" data-type={props.initialType} data-context={props.initialContext} data-game={props.gameId || ''}>
    <button type="button" onClick={props.onClose}>close form</button>
  </div>
));

import HelpButton from '../components/HelpButton';

const trigger = () => document.querySelector('button.help-button');
const item = (name) => screen.getByRole('menuitem', { name });
const goTo = (p) => window.history.pushState({}, '', p);
afterEach(() => goTo('/'));

describe('without `reports` it is what it always was', () => {
  test('one press opens the guide it was pointed at, and there is no menu', () => {
    // rejects: giving every contextual "what is this" button a bug menu
    render(<HelpButton section="ai-prompts" variant="inline" size="small" tooltip="Help: AI Prompts Management" />);
    fireEvent.click(trigger());
    expect(screen.getByTestId('help-system')).toHaveAttribute('data-section', 'ai-prompts');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(trigger()).not.toHaveAttribute('aria-haspopup');
  });
});

describe('with `reports` the same button is a menu of four', () => {
  const mount = (reports = { context: 'host', gameId: '7310' }) =>
    render(<HelpButton section="host" variant="inline" size="small" tooltip="Help" reports={reports} />);

  test('it says it is a menu, and says whether it is open', () => {
    mount();
    expect(trigger()).toHaveAttribute('aria-haspopup', 'menu');
    expect(trigger()).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('menu')).toBeNull();
    fireEvent.click(trigger());
    expect(trigger()).toHaveAttribute('aria-expanded', 'true');
    expect(trigger().getAttribute('aria-controls')).toBe(screen.getByRole('menu').id);
  });

  test('the four choices, guides first', () => {
    mount();
    fireEvent.click(trigger());
    expect(screen.getAllByRole('menuitem').map((el) => el.textContent.trim())).toEqual([
      'Read the guides', 'Report a bug', 'Request a feature', 'Ask for help',
    ]);
  });

  test('reading the guides opens the guides this button was pointed at', () => {
    mount();
    fireEvent.click(trigger());
    fireEvent.click(item('Read the guides'));
    expect(screen.getByTestId('help-system')).toHaveAttribute('data-section', 'host');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(screen.queryByTestId('issue-form')).toBeNull();
  });

  test.each([
    ['Report a bug', 'bug'],
    ['Request a feature', 'feature'],
    ['Ask for help', 'help'],
  ])('%s opens the report form as a %s, from this screen, about this session', (label, type) => {
    mount();
    fireEvent.click(trigger());
    fireEvent.click(item(label));
    const form = screen.getByTestId('issue-form');
    expect(form).toHaveAttribute('data-type', type);
    expect(form).toHaveAttribute('data-context', 'host');
    expect(form).toHaveAttribute('data-game', '7310');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(screen.queryByTestId('help-system')).toBeNull();
  });

  test('a player report takes the session code from the address', () => {
    goTo('/play?gameId=4821');
    mount({ context: 'player' });
    fireEvent.click(trigger());
    fireEvent.click(item('Report a bug'));
    expect(screen.getByTestId('issue-form')).toHaveAttribute('data-game', '4821');
    expect(screen.getByTestId('issue-form')).toHaveAttribute('data-context', 'player');
  });

  test('a code that is not four digits is not passed off as a session', () => {
    goTo('/play?gameId=<script>');
    mount({ context: 'player' });
    fireEvent.click(trigger());
    fireEvent.click(item('Report a bug'));
    expect(screen.getByTestId('issue-form')).toHaveAttribute('data-game', '');
  });

  test('Escape closes the menu and gives the keyboard back to the button', () => {
    mount();
    fireEvent.click(trigger());
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(trigger()).toHaveFocus();
  });

  test('a press anywhere else closes it; a press inside does not', () => {
    render(<div><span data-testid="elsewhere">x</span><HelpButton section="host" reports={{ context: 'host' }} tooltip="Help" /></div>);
    fireEvent.click(trigger());
    fireEvent.mouseDown(screen.getByRole('menu'));
    expect(screen.getByRole('menu')).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByTestId('elsewhere'));
    expect(screen.queryByRole('menu')).toBeNull();
  });

  test('pressing the button again closes it', () => {
    mount();
    fireEvent.click(trigger());
    fireEvent.click(trigger());
    expect(screen.queryByRole('menu')).toBeNull();
  });

  test('Escape with the menu closed is left alone — a dialog underneath may want it', () => {
    mount();
    const seen = jest.fn();
    document.addEventListener('keydown', seen);
    fireEvent.keyDown(document, { key: 'Escape' });
    document.removeEventListener('keydown', seen);
    expect(seen).toHaveBeenCalledTimes(1);
    expect(seen.mock.calls[0][0].defaultPrevented).toBe(false);
  });

  test('closing the form or the guides leaves nothing open behind it', () => {
    mount();
    fireEvent.click(trigger());
    fireEvent.click(item('Report a bug'));
    fireEvent.click(screen.getByText('close form'));
    expect(screen.queryByTestId('issue-form')).toBeNull();
    expect(screen.queryByRole('menu')).toBeNull();
  });
});

describe('the menu, as the stylesheet declares it', () => {
  const fs = require('fs');
  const path = require('path');
  const CSS = fs.readFileSync(path.join(__dirname, '..', 'components', 'HelpButton.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const block = (selector) => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const m = CSS.match(new RegExp(`(^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`, 'm'));
    if (!m) throw new Error(`No rule for "${selector}" — renamed?`);
    return m[2];
  };

  test('it hangs off the button, not off the viewport', () => {
    expect(block('.help-menu-anchor')).toMatch(/position:\s*relative/);
    const menu = block('.help-menu');
    expect(menu).toMatch(/position:\s*absolute/);
    expect(menu).toMatch(/top:\s*calc\(100% \+ 6px\)/);
    expect(menu).toMatch(/right:\s*0/);
    expect(menu).not.toMatch(/position:\s*fixed/);
  });

  test('its text and its ground are a token PAIR, so it is readable on dusk and on paper', () => {
    const menu = block('.help-menu');
    expect(menu).toMatch(/background:\s*var\(--surface/);
    expect(menu).toMatch(/color:\s*var\(--text/);
  });

  test('a row is a 44px target', () => {
    expect(block('.help-menu-item')).toMatch(/min-height:\s*44px/);
  });
});
