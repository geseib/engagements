/**
 * WHO MAY OPEN /skins (docs/design/themes TOOLING-BRIEF §5.3).
 *
 * The gallery mounts signed-in surfaces from sample data so shoot.js can
 * screenshot them. It is a dev tool: on any tier but development the path is
 * an unknown one (it falls through to the host page, as every unknown path
 * does), and on development it is Engage staff only. Goes through App, like
 * adminRouteAccess.test.jsx, because the guard lives in the router.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';

let mockUser = null;
jest.mock('../auth/AuthContext', () => ({
  __esModule: true,
  useAuth: () => ({ currentUser: mockUser, loading: false, signOut: jest.fn(), isAdmin: () => false }),
  AuthProvider: ({ children }) => children,
}));
jest.mock('../components/SkinGallery', () => ({
  __esModule: true,
  default: () => <div data-testid="skin-gallery">the gallery</div>,
}));
jest.mock('../GameHostPage', () => ({ __esModule: true, default: () => <div data-testid="host-page" /> }));
jest.mock('../AdminPage', () => ({ __esModule: true, default: () => <div /> }));
jest.mock('../PlayerPage', () => ({ __esModule: true, default: () => <div /> }));

import App from '../App';

const open = (env, groups) => {
  window.ENV = env;
  mockUser = groups ? { username: 'u', groups, attributes: {} } : null;
  window.history.pushState({}, '', '/skins');
  render(<App />);
};

afterEach(() => { window.ENV = 'test'; });

it('opens on development for Engage staff', async () => {
  open('development', ['admins']);
  expect(await screen.findByTestId('skin-gallery')).toBeInTheDocument();
});

it('refuses a host who is not staff, even on development', async () => {
  open('development', ['hosts']);
  expect(await screen.findByText(/Admin privileges are required/i)).toBeInTheDocument();
  expect(screen.queryByTestId('skin-gallery')).toBeNull();
});

it.each(['test', 'production', 'prod', undefined])('does not exist on ENV=%s, even for staff', (env) => {
  open(env, ['admins']);
  expect(screen.queryByTestId('skin-gallery')).toBeNull();
  expect(screen.getByTestId('host-page')).toBeInTheDocument();
});
