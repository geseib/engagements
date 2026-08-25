/**
 * WHO MAY OPEN /admin.
 *
 * ── THE DEFECT ─────────────────────────────────────────────────────────────
 *
 * `/admin` was routed through `<ProtectedRoute requireAdmin>`, which refuses
 * anybody outside the Cognito `admins` group. But `admins` is PLATFORM_GROUP —
 * "the group that means 'works on Engage', not 'runs an organisation'"
 * (config/consoleSections.js). A customer is approved into `hosts`, and their
 * org role is a DynamoDB fact carried on `GET /orgs` as `yourRole`.
 *
 * So a team OWNER, a team ADMIN, a team MEMBER and every PERSONAL space hit a
 * bare "Access Denied · Admin privileges are required" page at the door. Three
 * of the four consoles `sectionsFor` computes had never been seen by anybody
 * they were computed for — the entire multi-tenant console was staff-only.
 *
 * It survived every test in this repo because they all mount `AdminPage`
 * DIRECTLY. Nothing exercised the router in front of it, so the guard was
 * invisible to jsdom and to a green build alike.
 *
 * ── WHY OPENING IT GRANTS NOTHING ──────────────────────────────────────────
 *
 * The nav is computed per person (`sectionsFor`), the platform sections are
 * separately gated on `onPlatform && isStaff` in AdminPage, and every platform
 * route re-checks the `admins` group server-side. The door is not the
 * permission; it never was.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';

let mockUser = null;
jest.mock('../auth/AuthContext', () => ({
  __esModule: true,
  useAuth: () => ({ currentUser: mockUser, loading: false, signOut: jest.fn(), isAdmin: () => false }),
  AuthProvider: ({ children }) => children,
}));
jest.mock('../AdminPage', () => ({
  __esModule: true,
  default: () => <div data-testid="admin-console">the console</div>,
}));
jest.mock('../GameHostPage', () => ({ __esModule: true, default: () => <div /> }));
jest.mock('../PlayerPage', () => ({ __esModule: true, default: () => <div /> }));

import App from '../App';

const openAdmin = (groups) => {
  mockUser = { username: 'u', groups, attributes: {} };
  window.history.pushState({}, '', '/admin');
  render(<App />);
};

const denied = () => screen.queryByText(/Admin privileges are required/i);

describe('/admin', () => {
  // rejects: THE DEFECT. A host is every customer — owners and team admins
  // included, because an org role is not a Cognito group.
  it('opens for a host, who is every customer there is', () => {
    openAdmin(['hosts']);
    expect(screen.getByTestId('admin-console')).toBeInTheDocument();
    expect(denied()).toBeNull();
  });

  it('opens for Engage staff', () => {
    openAdmin(['admins', 'hosts']);
    expect(screen.getByTestId('admin-console')).toBeInTheDocument();
  });

  // rejects: opening the console to accounts nobody has approved yet. The
  // pending screen is a different refusal and it stays.
  it('does not open for somebody still pending approval', () => {
    openAdmin(['pending']);
    expect(screen.queryByTestId('admin-console')).toBeNull();
  });

  // rejects: dropping the guard altogether. An account in NO group has been
  // approved into nothing and has no space of its own to manage.
  it('does not open for an account in no group at all', () => {
    openAdmin([]);
    expect(screen.queryByTestId('admin-console')).toBeNull();
  });
});
