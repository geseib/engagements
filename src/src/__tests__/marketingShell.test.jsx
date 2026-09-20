import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import MarketingShell from '../marketing/MarketingShell';
import { navigateTo } from '../auth/navigate';
import { RETURN_KEY } from '../auth/returnPath';

jest.mock('../auth/navigate', () => ({ navigateTo: jest.fn() }));
beforeEach(() => { jest.clearAllMocks(); sessionStorage.clear(); });

test('the nav reaches every marketing page, and both auth doors', () => {
  render(<MarketingShell title="T" current="home"><p>body</p></MarketingShell>);
  const nav = screen.getByRole('navigation', { name: /main/i });
  for (const [name, href] of [[/how it works/i, '/how-it-works'], [/use cases/i, '/use-cases'], [/reports/i, '/reports'], [/help/i, '/help']]) {
    expect(screen.getAllByRole('link', { name })[0]).toHaveAttribute('href', href);
  }
  expect(nav).toContainElement(screen.getByRole('link', { name: /^sign in$/i }));
  expect(nav).toContainElement(screen.getByRole('link', { name: /create a host account/i }));
});

test('signing in from any marketing page returns a host to /, not to the brochure', () => {
  // rejects: a bare rememberReturnPath(), which would record /how-it-works and
  // land a freshly signed-in host back on a marketing page
  window.history.pushState({}, '', '/how-it-works');
  render(<MarketingShell title="T" current="how"><p>body</p></MarketingShell>);
  fireEvent.click(screen.getByRole('link', { name: /^sign in$/i }));
  expect(sessionStorage.getItem(RETURN_KEY)).toBe('/');
  expect(navigateTo).toHaveBeenCalledWith('/auth');
  window.history.pushState({}, '', '/');
});

test('the current page is marked for assistive tech', () => {
  render(<MarketingShell title="T" current="reports"><p>body</p></MarketingShell>);
  expect(screen.getAllByRole('link', { name: /reports/i })[0]).toHaveAttribute('aria-current', 'page');
});

test('it sets the document title', () => {
  render(<MarketingShell title="How it works" current="how"><p>body</p></MarketingShell>);
  expect(document.title).toBe('How it works · Engagements');
});

test('the ridge scene renders once by default, and not at all with scene={false}', () => {
  const { container: withScene } = render(<MarketingShell title="T" current="home"><p>body</p></MarketingShell>);
  expect(withScene.querySelectorAll('.mk-ridge')).toHaveLength(1);

  const { container: withoutScene } = render(<MarketingShell title="T" current="home" scene={false}><p>body</p></MarketingShell>);
  expect(withoutScene.querySelectorAll('.mk-ridge')).toHaveLength(0);
});

test('a page that throws leaves the doors standing', () => {
  const Boom = () => { throw new Error('chunk'); };
  const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
  render(<MarketingShell title="T" current="home"><Boom /></MarketingShell>);
  expect(screen.getByRole('alert')).toHaveTextContent(/could not load/i);
  expect(screen.getByRole('link', { name: /join a session/i })).toHaveAttribute('href', '/join');
  spy.mockRestore();
});

/* ------------------------------------------------------- fix round 2: the
 * mobile menu button had aria-expanded but no aria-controls (the toggle it
 * mirrors, HelpPage's role-list button, has both), and Escape did not close
 * the menu at all. */
test('the menu button names the links container it controls', () => {
  render(<MarketingShell title="T" current="home"><p>body</p></MarketingShell>);
  const button = screen.getByRole('button', { name: /menu/i });
  const controlledId = button.getAttribute('aria-controls');
  expect(controlledId).toBeTruthy();
  expect(document.getElementById(controlledId)).not.toBeNull();
});

test('Escape closes an open menu and returns focus to the button', () => {
  render(<MarketingShell title="T" current="home"><p>body</p></MarketingShell>);
  const button = screen.getByRole('button', { name: /menu/i });
  fireEvent.click(button);
  expect(button).toHaveAttribute('aria-expanded', 'true');

  fireEvent.keyDown(document, { key: 'Escape' });

  expect(button).toHaveAttribute('aria-expanded', 'false');
  expect(button).toHaveFocus();
});

test('Escape while the menu is already closed does nothing', () => {
  render(<MarketingShell title="T" current="home"><p>body</p></MarketingShell>);
  const button = screen.getByRole('button', { name: /menu/i });
  expect(button).toHaveAttribute('aria-expanded', 'false');

  fireEvent.keyDown(document, { key: 'Escape' });

  expect(button).toHaveAttribute('aria-expanded', 'false');
  expect(button).not.toHaveFocus();
});
