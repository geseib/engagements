import React from 'react';
import { render, screen } from '@testing-library/react';

/**
 * A SIGNED-IN HOST WHO LANDS ON THE MARKETING HOME IS NOT ASKED TO SIGN IN.
 *
 * The mark on the host's main screen and in the console leads to /home, so
 * somebody already inside the app does arrive here. Two doors inviting them to
 * sign in or register would read as having been signed out.
 *
 * Its own file because the auth module has to be mocked at the top of one: the
 * signed-out half lives in brandHome.test.jsx, against the real module.
 */
jest.mock('../auth/navigate', () => ({ navigateTo: jest.fn() }));
let mockAuth = { currentUser: { groups: ['hosts'] }, loading: false };
jest.mock('../auth/AuthContext', () => ({ __esModule: true, useOptionalAuth: () => mockAuth }));

import MarketingShell from '../marketing/MarketingShell';

const mount = () => render(<MarketingShell title="T" current="home"><p>x</p></MarketingShell>);

test('the two auth doors become one way back into the app', () => {
  mockAuth = { currentUser: { groups: ['hosts'] }, loading: false };
  mount();
  expect(screen.getByRole('link', { name: /open the app/i })).toHaveAttribute('href', '/');
  expect(screen.queryByRole('link', { name: /^sign in$/i })).toBeNull();
  expect(screen.queryByRole('link', { name: /create a host account/i })).toBeNull();
});

test('while auth is still resolving, the doors show — never a flash of "Open the app" at a stranger', () => {
  mockAuth = { currentUser: null, loading: true };
  mount();
  expect(screen.getByRole('link', { name: /^sign in$/i })).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: /open the app/i })).toBeNull();
});
