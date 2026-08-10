import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import RootPage from '../components/RootPage';
import { navigateTo } from '../auth/navigate';
import { RETURN_KEY } from '../auth/returnPath';

/**
 * Destinations are asserted on `navigateTo`, never on `window.location`.
 * setupTests.js's location mock is a silent no-op under jsdom 26, so
 * `expect(window.location.href).toBe(...)` passes whatever the code does --
 * which is how a whole OAuth return-path fix once shipped as dead code.
 */
jest.mock('../auth/navigate', () => ({ navigateTo: jest.fn() }));

const codeField = () => screen.getByLabelText(/session code/i);
const joinButton = () => screen.getByRole('button', { name: /join|try again/i });
const type = (value) => fireEvent.change(codeField(), { target: { value } });
const paste = (text) =>
  fireEvent.paste(codeField(), { clipboardData: { getData: () => text } });

const respond = (status) => {
  global.fetch.mockResolvedValueOnce({
    status,
    ok: status >= 200 && status < 300,
    json: async () => ({}),
  });
};

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch.mockReset();
  sessionStorage.clear();
});

describe('the root page, both audiences', () => {
  test('renders the join column and the host column', () => {
    // rejects: shipping only the join half, which would leave a host arriving at
    // / with no route to sign in at all
    render(<RootPage />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/4.digit code/i);
    expect(screen.getByRole('link', { name: /^sign in$/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /create a host account/i })).toBeInTheDocument();
  });

  test('the join column comes first in the DOM, at every width', () => {
    // rejects: ordering the columns visually with CSS while leaving the host
    // block first in source -- which puts tab order and screen-reader order on
    // the wrong audience. jsdom has no layout engine, so DOM order is the only
    // honest thing to assert here.
    const { container } = render(<RootPage />);
    const join = container.querySelector('.entry-join');
    const host = container.querySelector('.entry-host');
    expect(join).toBeTruthy();
    expect(host).toBeTruthy();
    // eslint-disable-next-line no-bitwise
    expect(join.compareDocumentPosition(host) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  test('the second column arrives at 900px, not 768', () => {
    // rejects: reaching for the usual 768 breakpoint. At 768 the host column
    // squeezes the four code cells below their derived size, and the code cells
    // are the one element in this design that may not shrink.
    const css = require('fs').readFileSync(
      require('path').join(__dirname, '../components/RootPage.css'),
      'utf8'
    );
    expect(css).toMatch(/@media\s*\(min-width:\s*900px\)/);
    expect(css).not.toMatch(/@media\s*\(min-width:\s*768px\)/);
  });
});

describe('the code field', () => {
  test('Join stays disabled until four digits are in', () => {
    // rejects: an always-live submit, which fires a lookup for "48" and tells
    // the participant there is no session while they are still typing
    render(<RootPage />);
    expect(joinButton()).toBeDisabled();
    type('482');
    expect(joinButton()).toBeDisabled();
    type('4821');
    expect(joinButton()).toBeEnabled();
  });

  test('spaces, dashes and hashes are removed rather than rejected', () => {
    // rejects: a validator that reports "digits only" at someone reading four
    // numbers off a screen thirty feet away
    render(<RootPage />);
    type('#48-2 1');
    expect(codeField()).toHaveValue('4821');
  });

  test('pasting the whole join URL takes the code out of it', () => {
    // rejects: dropping a pasted link on the floor, or stuffing the URL into the
    // field -- both of which leave the participant retyping by hand
    render(<RootPage />);
    paste('https://eng.dev.seibtribe.us/play?gameId=4821&name=Chris');
    expect(codeField()).toHaveValue('4821');
    expect(screen.getByRole('status')).toHaveTextContent(/took the code out of that link/i);
  });

  test('pasting more than four digits is refused, and keeps what was there', () => {
    // rejects: silently truncating to the first four, which sends the
    // participant into a different live room without ever saying so
    render(<RootPage />);
    type('1234');
    paste('48219930');
    expect(codeField()).toHaveValue('1234');
    expect(screen.getByRole('status')).toHaveTextContent(/8 digits/i);
  });
});

describe('the code check', () => {
  test('404 shows the error inline and does NOT navigate', () => {
    // rejects: navigating on any answer. PlayerPage sets readOnly on a code that
    // arrives in the URL, so a typo lands on a play page with a wrong, locked
    // code and no way out but editing the address bar.
    render(<RootPage />);
    respond(404);
    type('4821');
    fireEvent.click(joinButton());
    return waitFor(() => {
      expect(screen.getByText(/nothing is running under 4821/i)).toBeInTheDocument();
      expect(navigateTo).not.toHaveBeenCalled();
    });
  });

  test('200 navigates to the play page with the code', async () => {
    // rejects: a check that resolves and then leaves the participant sitting on
    // the root page; and any destination other than /play?gameId=
    render(<RootPage />);
    respond(200);
    type('4821');
    fireEvent.click(joinButton());
    await waitFor(() => expect(navigateTo).toHaveBeenCalledWith('/play?gameId=4821'));
    expect(global.fetch).toHaveBeenCalledWith('http://localhost:3000/api/games/4821');
  });

  test('a network failure navigates anyway', async () => {
    // rejects: any catch block that reports the failure and stays put. A check
    // that can strand a participant is worse than no check -- the check only
    // ever saves a page load, and /play owns the error.
    render(<RootPage />);
    global.fetch.mockRejectedValueOnce(new Error('Failed to fetch'));
    type('4821');
    fireEvent.click(joinButton());
    await waitFor(() => expect(navigateTo).toHaveBeenCalledWith('/play?gameId=4821'));
  });

  test('a 500 navigates anyway', async () => {
    // rejects: `if (res.ok) navigate else showError`, which is the shape almost
    // everyone writes and which turns a server wobble into "no session with
    // that code" for a code that is perfectly good
    render(<RootPage />);
    respond(500);
    type('4821');
    fireEvent.click(joinButton());
    await waitFor(() => expect(navigateTo).toHaveBeenCalledWith('/play?gameId=4821'));
  });

  test('editing the code clears the error', async () => {
    // rejects: leaving "Nothing is running under 4821" on screen while the
    // participant types the corrected code underneath it
    render(<RootPage />);
    respond(404);
    type('4821');
    fireEvent.click(joinButton());
    await screen.findByText(/nothing is running under 4821/i);
    type('482');
    expect(screen.queryByText(/nothing is running under/i)).not.toBeInTheDocument();
  });
});

describe('the host column', () => {
  test('Sign in remembers where it came from, then goes to /auth', async () => {
    // rejects: dropping rememberReturnPath, which is what sent a host who
    // signed in with Google back to a hardcoded destination; and a Sign in that
    // navigates with a raw window.location assignment nothing can observe
    render(<RootPage />);
    fireEvent.click(screen.getByRole('link', { name: /^sign in$/i }));
    expect(sessionStorage.getItem(RETURN_KEY)).toBe('/');
    expect(navigateTo).toHaveBeenCalledWith('/auth');
  });

  test('Create a host account asks for the register form, not the sign-in form', () => {
    // rejects: pointing it at plain /auth, which drops someone who has just
    // decided to create an account onto a form asking for a password they do
    // not have yet
    render(<RootPage />);
    fireEvent.click(screen.getByRole('link', { name: /create a host account/i }));
    expect(navigateTo).toHaveBeenCalledWith('/auth?mode=register');
  });

  test('Privacy and Terms point at their real routes', () => {
    // rejects: the mockup's placeholder href="#"
    render(<RootPage />);
    expect(screen.getByRole('link', { name: /privacy/i })).toHaveAttribute('href', '/privacy');
    expect(screen.getByRole('link', { name: /terms/i })).toHaveAttribute('href', '/terms');
  });
});
