/**
 * THE HELP MODAL AS A DIALOG, AND HELP THAT OPENS AT A SECTION.
 *
 * Help refresh Phase 0. Before this the modal was a pair of divs: no role, no
 * name, Escape did nothing, focus stayed on the page behind it, and every
 * button opened a list of guides rather than the answer. jsdom has no layout,
 * so "scrolled to" is asserted as "the section is marked active and its
 * heading has focus", never as a position.
 */
import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import HelpSystem from '../components/HelpSystem';
import HelpButton from '../components/HelpButton';
import HelpPage, { helpHref, helpSectionFromHash } from '../marketing/HelpPage';
import { sectionDomId } from '../config/help';
import { helpFor } from '../config/help/screens';

jest.mock('../auth/navigate', () => ({ navigateTo: jest.fn() }));

describe('a real dialog', () => {
  test('role="dialog", aria-modal, and named by its own heading', () => {
    render(<HelpSystem onClose={() => {}} />);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    const labelledBy = dialog.getAttribute('aria-labelledby');
    expect(labelledBy).toBeTruthy();
    expect(document.getElementById(labelledBy).textContent).toMatch(/Help/);
    expect(screen.getByRole('dialog', { name: /Help/ })).toBe(dialog);
  });

  test('it declares the dark theme, so it is dusk wherever it opens', () => {
    render(<HelpSystem onClose={() => {}} />);
    expect(screen.getByRole('dialog').closest('[data-theme]')).toHaveAttribute('data-theme', 'dark');
  });

  test('Escape closes it, and does not also reach a panel listening underneath', () => {
    const onClose = jest.fn();
    const underneath = jest.fn();
    document.addEventListener('keydown', underneath);
    render(<HelpSystem onClose={onClose} />);
    fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'Escape' });
    document.removeEventListener('keydown', underneath);
    expect(onClose).toHaveBeenCalledTimes(1);
    // rejects: the Session panel closing under help on the same keypress.
    expect(underneath).not.toHaveBeenCalled();
  });

  test('it renders under <body>, out of the surface that opened it', () => {
    // rejects: the Session panel's `.setup-panel button` repaint reaching
    // every button inside help because the dialog sat in the panel's DOM.
    const { container } = render(<div className="setup-panel"><HelpSystem onClose={() => {}} /></div>);
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(screen.getByRole('dialog').closest('.setup-panel')).toBeNull();
  });

  test('a key typed in help does not reach the page: \\ in search leaves the panel alone', () => {
    const underneath = jest.fn();
    document.addEventListener('keydown', underneath);
    render(<HelpSystem onClose={() => {}} />);
    fireEvent.keyDown(screen.getByRole('searchbox'), { key: '\\' });
    document.removeEventListener('keydown', underneath);
    expect(underneath).not.toHaveBeenCalled();
  });

  test('focus moves in on open: to the close button on a plain open', () => {
    render(<HelpSystem onClose={() => {}} />);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close help' }));
  });

  test('Tab is trapped: from the last control it wraps to the first, and back', () => {
    render(<HelpSystem onClose={() => {}} />);
    const dialog = screen.getByRole('dialog');
    const focusables = dialog.querySelectorAll('button:not([disabled]), input, a[href]');
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    last.focus();
    fireEvent.keyDown(last, { key: 'Tab' });
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(first, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  test('the backdrop closes it; a click inside does not', () => {
    const onClose = jest.fn();
    render(<HelpSystem onClose={onClose} />);
    fireEvent.click(screen.getByRole('dialog'));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('dialog').parentElement);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('opening at a section', () => {
  test('guide + section opens that guide with the section active and its heading focused', () => {
    render(<HelpSystem guide="player-joining" section="name-taken" onClose={() => {}} />);
    expect(screen.getByRole('heading', { level: 1, name: /Joining a session/ })).toBeInTheDocument();
    const el = document.getElementById(sectionDomId('player-joining', 'name-taken'));
    expect(el).toBeTruthy();
    expect(el).toHaveClass('help-doc-section--active');
    expect(document.activeElement).toBe(el.querySelector('h2'));
  });

  test('section="guide#section" does the same', () => {
    render(<HelpSystem section="player-joining#name-taken" onClose={() => {}} />);
    expect(document.getElementById(sectionDomId('player-joining', 'name-taken')))
      .toHaveClass('help-doc-section--active');
  });

  test('an alias as the guide still lands on the section', () => {
    render(<HelpSystem guide="websocket-settings" section="real-time-communication" onClose={() => {}} />);
    expect(document.getElementById(sectionDomId('admin-settings', 'real-time-communication')))
      .toHaveClass('help-doc-section--active');
  });

  test('a **Label** in the corpus renders as a bold UI label, without the asterisks', () => {
    render(<HelpSystem guide="host-reporting" section="session-report" onClose={() => {}} />);
    const label = screen.getByText('Save report', { selector: 'strong.help-ui' });
    expect(label).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('**');
  });

  test('every section of a rendered guide carries its id', () => {
    render(<HelpSystem section="player-playing" onClose={() => {}} />);
    // Phase 2 (W1): voting and reading-long-answer moved to player-voting.
    ['answering', 'call-and-answer', 'trivia', 'held-back'].forEach((id) => {
      expect(document.querySelector(`[data-section-id="${id}"]`)).toBeTruthy();
    });
  });

  test('"My name is taken" goes to the player\'s own way forward, not the host guide', () => {
    render(<HelpSystem onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'My name is taken' }));
    expect(screen.getByRole('heading', { level: 1, name: /Joining a session/ })).toBeInTheDocument();
    expect(document.querySelector('[data-section-id="name-taken"]')).toHaveClass('help-doc-section--active');
  });

  test('the footer reaches the glossary', () => {
    render(<HelpSystem onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Words we use' }));
    expect(screen.getByRole('heading', { level: 1, name: /Words we use/ })).toBeInTheDocument();
  });
});

describe('HelpButton', () => {
  test('helpFor(screen) opens the modal at that screen\'s section', () => {
    render(<HelpButton {...helpFor('admin-settings-realtime')} variant="inline" tooltip="Help: settings" />);
    fireEvent.click(screen.getByRole('button', { name: 'Help: settings' }));
    expect(document.getElementById(sectionDomId('admin-settings', 'real-time-communication')))
      .toHaveClass('help-doc-section--active');
  });

  test('section= alone keeps its old meaning: a role opens the role list', () => {
    render(<HelpButton section="host" tooltip="Help" />);
    fireEvent.click(screen.getByRole('button', { name: 'Help' }));
    expect(screen.getByRole('heading', { level: 1, name: /For hosts/ })).toBeInTheDocument();
  });

  test('closing returns focus to the button that opened it, also from the menu', () => {
    render(<HelpButton section="host" tooltip="Help and feedback" reports={{ context: 'host' }} />);
    const opener = screen.getByRole('button', { name: 'Help and feedback' });
    fireEvent.click(opener);
    fireEvent.click(screen.getByRole('menuitem', { name: /Read the guides/ }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.keyDown(document.activeElement, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });
});

describe('/help/<role>/<guide>#<section>', () => {
  const goTo = (p) => window.history.pushState({}, '', p);
  afterEach(() => goTo('/'));

  test('helpHref writes the section as the hash', () => {
    expect(helpHref({ kind: 'guide', id: 'player-joining', section: 'name-taken' }))
      .toBe('/help/player/player-joining#name-taken');
  });

  test('a hash naming no section of the guide is ignored', () => {
    expect(helpSectionFromHash('player-joining', '#name-taken')).toBe('name-taken');
    expect(helpSectionFromHash('player-joining', '#nope')).toBeNull();
    expect(helpSectionFromHash('player-joining', '')).toBeNull();
  });

  test('the page opens with that section active and focused', () => {
    goTo('/help/player/player-joining#name-taken');
    render(<HelpPage />);
    const el = document.getElementById(sectionDomId('player-joining', 'name-taken'));
    expect(el).toHaveClass('help-doc-section--active');
    expect(document.activeElement).toBe(el.querySelector('h2'));
  });

  test('a later hash change moves to the new section', () => {
    goTo('/help/player/player-joining');
    render(<HelpPage />);
    act(() => {
      window.history.pushState({}, '', '/help/player/player-joining#lost-the-page');
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    expect(document.getElementById(sectionDomId('player-joining', 'lost-the-page')))
      .toHaveClass('help-doc-section--active');
  });
});
