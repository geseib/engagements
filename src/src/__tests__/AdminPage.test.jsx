import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
/*
  THE ONE MOCK THAT STOOD BETWEEN THIS SUITE AND EVER RUNNING.

  It failed on `useAuth must be used within an AuthProvider` — and that single
  unmocked provider is the entire reason this file has been red since it was
  written, and the reason a claim spread through this repo that the component
  "cannot be rendered in jsdom". Three product-down bugs shipped behind that
  claim. The component was always mountable.
*/
jest.mock('../auth/AuthContext', () => ({
  __esModule: true,
  useAuth: () => ({
    currentUser: { username: 'host', attributes: { email: 'host@example.com' } },
    signOut: jest.fn(),
    isAdmin: true,
  }),
  AuthProvider: ({ children }) => children,
}));

jest.mock('../auth/authFetch', () => ({
  __esModule: true,
  authFetch: (...args) => global.fetch(...args),
}));

import AdminPage from '../AdminPage';

/**
 * THE ADMIN CONSOLE RENDERS.
 *
 * This suite has never run: it mounted AdminPage with no AuthProvider and died
 * on `useAuth must be used within an AuthProvider` before reaching a single
 * assertion. Underneath that, its assertions looked for an "Admin Panel"
 * heading and an upload form that today's console does not have — written
 * against an older screen, never re-run, never noticed.
 *
 * What is here now is what only a mounted test can give: the console draws,
 * and it survives a backend that is unavailable or answering badly. The
 * question-set behaviour it used to reach for has its own suites
 * (questionSetUploadPanel, questionSetsPalette, sessionsPanel) which do run.
 */
describe('the admin console', () => {
  beforeEach(() => {
    localStorage.clear();
    window.history.pushState({}, '', '/admin');
    global.fetch.mockClear();
    global.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ questionSets: [], sets: [], games: [], prompts: [] }),
      text: async () => '{}',
    });
  });

  /*
    ASSERTED ON THE NAV, not on a section heading. The console opens on a
    landing view and its sections live behind those entries — an assertion on
    "AI Prompt Management" failed not because the console was broken but
    because that heading is one click away, and its text is split across an
    Icon and a text node besides. The nav is what proves the console drew.
  */
  // rejects: the console failing to render — the same blank-page class that hit
  //          the host page three times this week, on the screen a host opens
  //          BECAUSE something is wrong.
  test('it renders its sections', async () => {
    render(<AdminPage />);
    // `findAllByText`: the console names each section in the nav AND in the
    // breadcrumb, so a single-match query fails on a screen that is perfectly
    // correct. What matters is that the entries are there at all.
    expect((await screen.findAllByText(/Question sets/i)).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Sessions/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Prompts/i).length).toBeGreaterThan(0);
  });

  // rejects: an unreachable backend blanking the console. This is the screen
  //          somebody opens BECAUSE something is wrong, so it has to survive
  //          things being wrong.
  test('an unreachable API does not blank it', async () => {
    global.fetch.mockRejectedValue(new Error('network down'));
    render(<AdminPage />);
    expect((await screen.findAllByText(/Question sets/i)).length).toBeGreaterThan(0);
  });

  // rejects: a non-2xx being parsed as data and crashing the render.
  test('a 500 from every endpoint does not blank it', async () => {
    global.fetch.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => { throw new Error('not json'); },
      text: async () => 'Internal Server Error',
    });
    render(<AdminPage />);
    expect((await screen.findAllByText(/Question sets/i)).length).toBeGreaterThan(0);
  });
});

/**
 * THE PROMPTS SECTION: ONE WAY IN, ONE WAY OUT, FOR BOTH LIBRARIES.
 *
 * The owner: *"the way you get to the Question set AI generator prompts and the
 * Engagement results prompts on the prompt admin screen is slightly different.
 * they should be the same."* They were:
 *
 *   generation — a button that set `showGenerationPromptEditor`, rendering a
 *                fixed-position full-viewport overlay from the TOP-LEVEL
 *                fragment beside <IssueFab>, outside AdminShell entirely
 *   analysis   — a button that toggled `showAnalysisPrompts`, expanding a third
 *                panel INLINE underneath the two cards, both still on screen
 *
 * Every test below fails against that arrangement, and none of them reads a
 * pixel: symmetry here is a claim about document structure and accessible
 * names, which is exactly what jsdom can answer.
 */
describe('the two prompt libraries are reached the same way', () => {
  beforeEach(() => {
    localStorage.clear();
    window.history.pushState({}, '', '/admin');
    global.fetch.mockClear();
    global.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ questionSets: [], sets: [], games: [], prompts: [] }),
      text: async () => '{}',
    });
  });

  /** Open the Prompts section from the console nav. */
  async function openPrompts() {
    render(<AdminPage />);
    const entries = await screen.findAllByText('Prompts');
    fireEvent.click(entries[0].closest('button') || entries[0]);
    return screen.findByRole('button', { name: /Question set generator prompts/ });
  }

  const chooserTiles = () => [
    screen.queryByRole('button', { name: /Question set generator prompts/ }),
    screen.queryByRole('button', { name: /Engagement results prompts/ }),
  ];

  test('both libraries are offered by the same kind of control, side by side', async () => {
    /*
      rejects: the shipped pair, where one tile carried `.btn-primary` reading
      "Manage Generation Prompts" and the other `.btn-secondary` reading
      "Manage Analysis Prompts" / "Hide Analysis Prompts" — different classes,
      different verbs, and one of them a toggle whose label changed under you.
    */
    await openPrompts();
    const [generation, analysis] = chooserTiles();

    expect(generation).toBeInTheDocument();
    expect(analysis).toBeInTheDocument();
    expect(generation.className).toBe(analysis.className);
    expect(generation.parentElement.parentElement)
      .toBe(analysis.parentElement.parentElement);
  });

  test.each([
    ['generation', /Question set generator prompts/],
    ['analysis', /Engagement results prompts/],
  ])('opening the %s library REPLACES the chooser rather than adding to it', async (_which, name) => {
    /*
      rejects BOTH shipped behaviours at once, which is why it is one test run
      twice: the overlay left the chooser mounted underneath it, and the inline
      expander left it mounted ABOVE. Either way the screen held a chooser and a
      library at the same time — a list and its detail as two sections rather
      than two places (RATIONALE §2).
    */
    await openPrompts();
    fireEvent.click(screen.getByRole('button', { name }));

    await waitFor(() => expect(chooserTiles()).toEqual([null, null]));
  });

  test.each([
    ['generation', /Question set generator prompts/],
    ['analysis', /Engagement results prompts/],
  ])('the %s library is left by the same one back control', async (_which, name) => {
    /*
      rejects: two exits. The generation overlay was left by an X in its own
      header or by clicking the scrim (which discarded a half-typed form without
      asking); the analysis panel was left by pressing its entry button again,
      now relabelled "Hide". Neither was the other, and neither was a
      breadcrumb.
    */
    await openPrompts();
    fireEvent.click(screen.getByRole('button', { name }));

    /* Scoped to the work body: the left NAV also carries a button named
       "Prompts", and that one is how you arrive at the section rather than how
       you climb back inside it. */
    const work = document.querySelector('.adm-work-body');
    const backs = within(work).getAllByRole('button', { name: 'Prompts' });
    expect(backs).toHaveLength(1);
    const [back] = backs;
    expect(back).toHaveClass('padm-back');

    fireEvent.click(back);
    await waitFor(() => expect(chooserTiles().filter(Boolean)).toHaveLength(2));
  });

  test('opening one library cannot leave the other open', async () => {
    /*
      rejects: the two booleans this replaced. `showGenerationPromptEditor` and
      `showAnalysisPrompts` were independent, so the analysis panel could be
      expanded underneath while the generation overlay covered it — two
      libraries mounted, both fetching, one of them invisible.
    */
    await openPrompts();
    fireEvent.click(screen.getByRole('button', { name: /Question set generator prompts/ }));

    await waitFor(() => expect(screen.queryByTestId('pmgr-notice')).toBeNull());
    expect(screen.queryByRole('button', { name: /Engagement results prompts/ })).toBeNull();
    // One heading, not two: each library titles itself once it is the place.
    expect(screen.getAllByRole('heading', { name: /prompts/i }).length).toBeLessThanOrEqual(2);
  });

  test('the generation library is inside the themed work body, not outside the shell', async () => {
    /*
      rejects: mounting it from the top-level fragment again. `.adm-work-body`
      is where `contentTheme` is declared (AdminShell.jsx:196); anything
      rendered outside it inherits `data-theme="light"` from <html>, so every
      dusk token it reads resolves to the paper value and the panel renders
      #F4EDE4 copy on #FFFFFF. That is not a style nit — it is the 1.2:1 pairing
      promptEditorPalette.test.js exists to prevent, arrived at by DOM position
      rather than by colour.
    */
    const { container } = { container: document.body };
    await openPrompts();
    fireEvent.click(screen.getByRole('button', { name: /Question set generator prompts/ }));

    const body = await waitFor(() => {
      const el = container.querySelector('.adm-work-body');
      expect(el).not.toBeNull();
      return el;
    });
    expect(body).toHaveAttribute('data-theme', 'dark');
    await waitFor(() => expect(body.querySelector('.pgen')).not.toBeNull());
    expect(body.querySelector('.padm-back')).not.toBeNull();
  });
});
