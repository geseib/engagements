/**
 * THE ADMIN CONSOLE'S SHELL — components/AdminShell.jsx
 *
 * `AdminPage.jsx` is 1,805 lines and cannot be mounted in jsdom at all: it dies
 * on `useAuth must be used within an AuthProvider`, which is why its own test
 * file has been failing 8/8 for as long as it has existed. The same move that
 * made GameSetupDialog, SessionSetupPanel, Podium and WelcomeScreen testable is
 * applied here — the chrome is a component that takes what it renders.
 *
 * NO GEOMETRIC ASSERTIONS. jsdom has no layout engine: every width, offset and
 * computed box measures zero, so a geometric expectation passes unconditionally
 * and tests nothing. Layout is verified in a browser and reported as such.
 */
import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import AdminShell from '../components/AdminShell';

const NAV = [
  { id: 'questionsets', label: 'Question sets', icon: 'Books', count: 41 },
  { id: 'games', label: 'Sessions', icon: 'GameController' },
  { id: 'prompts', label: 'Prompts', icon: 'Sparkle' },
  { id: 'archive', label: 'Archive', icon: 'Package' },
  { id: 'users', label: 'Users', icon: 'UsersThree', badge: 3 },
];

const FOOT = [{ id: 'settings', label: 'Settings', icon: 'Gear' }];

const admin = {
  attributes: { name: 'Dana Whitfield', email: 'dana@example.com' },
  groups: ['admins', 'hosts'],
};

const dev = { id: 'dev', label: 'DEV', detail: 'API ouv6fztlig.execute-api.us-east-1.amazonaws.com' };

function setup(props = {}) {
  const handlers = { onNavigate: jest.fn(), onSignOut: jest.fn() };
  const utils = render(
    <AdminShell
      navItems={NAV}
      footNavItems={FOOT}
      activeId="questionsets"
      environment={dev}
      currentUser={admin}
      title="Question sets"
      {...handlers}
      {...props}
    >
      <p>work area content</p>
    </AdminShell>
  );
  return { ...utils, ...handlers };
}

describe('the left nav that replaces the horizontal tab strip', () => {
  test('every section is a button and exactly the active one is current', () => {
    // rejects: the shipped strip's `className={active ? 'active' : ''}` with no
    // ARIA state at all — nothing tells assistive tech which section is open —
    // and rejects marking the wrong item current.
    setup();
    const nav = screen.getByRole('navigation', { name: /sections/i });
    const items = within(nav).getAllByRole('button');
    expect(items).toHaveLength(NAV.length + FOOT.length);

    const current = items.filter((b) => b.getAttribute('aria-current') === 'page');
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveTextContent('Question sets');
  });

  test('pressing a section raises onNavigate with its id', () => {
    // rejects: an unwired nav. Replacing the tab strip means six fresh
    // connections between new elements and the page's existing setActiveTab.
    const { onNavigate } = setup();
    fireEvent.click(screen.getByRole('button', { name: /archive/i }));
    expect(onNavigate).toHaveBeenCalledWith('archive');
  });

  test('the section in the foot navigates like any other', () => {
    // rejects: rendering Settings as decoration because it lives below the
    // `margin-top:auto` rule rather than in the main list.
    const { onNavigate } = setup();
    fireEvent.click(screen.getByRole('button', { name: /settings/i }));
    expect(onNavigate).toHaveBeenCalledWith('settings');
  });

  test('every section carries its name even when the rail collapses', () => {
    // Below 1180px the labels are hidden and the rail is icons only — that is
    // deliberate, and it is also the width at which an unlabelled icon rail
    // becomes a guessing game. rejects: an icon-only nav with the name nowhere,
    // which is what hiding .adm-nav-label alone produces. (Verified in a
    // browser at 1100px; jsdom has no layout engine and cannot see the rule.)
    setup();
    const nav = screen.getByRole('navigation', { name: /sections/i });
    for (const item of [...NAV, ...FOOT]) {
      const button = within(nav).getByRole('button', { name: new RegExp(item.label, 'i') });
      expect(button).toHaveAttribute('title', item.label);
    }
  });

  test('a count prints only where the page actually has one', () => {
    // rejects: defaulting a missing count to 0. Sessions has no list — the API
    // is deployed and the console has never called it — so a "0" beside it is
    // an empty state that lies, which is the one rule both the host spec and
    // RATIONALE §4 carry over unchanged.
    const { container } = setup();
    const sets = screen.getByRole('button', { name: /question sets/i });
    const sessions = screen.getByRole('button', { name: /sessions/i });
    expect(within(sets).getByText('41')).toBeInTheDocument();
    expect(sessions.querySelector('.adm-nav-count')).toBeNull();
    expect(container.querySelectorAll('.adm-nav-count')).toHaveLength(1);
  });

  test('the pending-user badge is a badge, not another grey count', () => {
    // rejects: folding the approval queue's number into the ordinary count
    // treatment. A person waiting for approval is the only thing in this
    // console that decays if nobody looks at it (RATIONALE §7), and it is the
    // one number allowed to be loud.
    setup();
    const users = screen.getByRole('button', { name: /users/i });
    expect(users.querySelector('.adm-nav-badge')).toHaveTextContent('3');
    expect(users.querySelector('.adm-nav-count')).toBeNull();
  });
});

describe('the environment chip', () => {
  test('it names the tier and can be checked against the API host', () => {
    // rejects: the shipped console's total silence about which of the three
    // environments is loaded. API_BASE is read at AdminPage.jsx:24 and rendered
    // nowhere, and the archive service — including DELETE — is shared by all
    // three tiers.
    setup();
    const chip = screen.getByTestId('adm-envchip');
    expect(chip).toHaveTextContent('DEV');
    expect(chip).toHaveAttribute('title', dev.detail);
  });

  test('an unidentifiable environment is shown as unidentifiable', () => {
    // rejects: hiding the chip when the tier is unknown, which restores exactly
    // the silence this control exists to end.
    setup({ environment: { id: 'unknown', label: 'ENV?', detail: 'API endpoint not configured' } });
    expect(screen.getByTestId('adm-envchip')).toHaveTextContent('ENV?');
  });
});

describe('a list and its detail are two places, not two sections', () => {
  test('on a root list the top bar does not restate the screen title', () => {
    // rejects: a breadcrumb reading "Question sets" directly above an <h1>
    // reading "Question sets" — the first cut of the mockups did this and
    // RATIONALE §2 killed it. The top bar's job is "where am I inside this
    // object", and on a root list the answer is "nowhere yet".
    setup();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Question sets');
    const bar = screen.getByTestId('adm-topbar');
    expect(within(bar).queryByText('Question sets')).toBeNull();
  });

  test('on a detail place the back control names the parent and works', () => {
    // rejects: a breadcrumb that prints the object's own name (restating the
    // h1 again), and rejects a back link wired to nothing — which is the only
    // way out of the detail place now that it replaces the list rather than
    // being appended below it.
    const onBack = jest.fn();
    setup({
      title: 'Q3 Leadership Offsite — Lessons Learned',
      breadcrumb: { parentLabel: 'Question sets', onBack },
    });
    // scoped to the top bar on purpose: the left nav also has a "Question sets"
    // button, and the whole point is that these are two different controls.
    const back = within(screen.getByTestId('adm-topbar')).getByRole('button', {
      name: /question sets/i,
    });
    expect(back).toHaveTextContent('Question sets');
    expect(back).not.toHaveTextContent('Q3 Leadership Offsite');
    fireEvent.click(back);
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  test('a title too long for the bar stays recoverable', () => {
    // The title is a single nowrap text node so text-overflow can actually
    // render — the host spec's §5.1 trap, asserted as audit A2. But a clipped
    // string with no way to read the rest is a deletion, not a reduction
    // (host §7.10), and set names in this product run to sixty-odd characters.
    // rejects: clipping the h1 and leaving no way to recover the full name.
    const long = 'Q3 Leadership Offsite — Lessons Learned from the Nakamura Integration (Revised)';
    setup({ title: long });
    expect(screen.getByRole('heading', { level: 1 })).toHaveAttribute('title', long);
  });

  test('the screen title is the level-1 heading', () => {
    // rejects: rendering the title as a styled div, which leaves every screen
    // in the console with no heading for assistive tech to land on.
    setup({ title: 'Users' });
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Users');
  });
});

describe('what scrolls, and what does not', () => {
  test('children are rendered inside the one scrolling region', () => {
    // rejects: children rendered as a sibling of the scroll region. That is the
    // shipped behaviour — the whole document scrolls, which is why the tab bar
    // scrolls away and why pressing Edit on row 34 scroll-jumps the page.
    const { container } = setup();
    const body = container.querySelector('.adm-work-body');
    expect(body).not.toBeNull();
    expect(within(body).getByText('work area content')).toBeInTheDocument();
  });

  test('the work body declares the theme its content was written for', () => {
    // rejects: dropping the seam and letting the legacy tabs render on the dusk
    // field. Wave D owns the tab internals; today they are paper — white cards
    // with hardcoded #333 body copy (styles.css:4635) — and #333 on #0F1A2E is
    // 1.4:1. The default has to be the theme the content actually is, and the
    // flip to 'dark' has to be one prop, not a rebuild.
    const { container, rerender } = setup();
    expect(container.querySelector('.adm-work-body')).toHaveAttribute('data-theme', 'light');

    rerender(
      <AdminShell
        navItems={NAV}
        activeId="questionsets"
        environment={dev}
        currentUser={admin}
        title="Question sets"
        contentTheme="dark"
        onNavigate={jest.fn()}
        onSignOut={jest.fn()}
      >
        <p>work area content</p>
      </AdminShell>
    );
    expect(container.querySelector('.adm-work-body')).toHaveAttribute('data-theme', 'dark');
  });

  test('the shell chrome is dusk regardless of the app\'s paper <html>', () => {
    // rejects: relying on inherited theme. index.html carries
    // data-theme="light" on <html>, so without an explicit declaration every
    // --text/--surface in the nav and top bar resolves to the paper set and the
    // chrome renders dark-on-dark.
    const { container } = setup();
    expect(container.querySelector('.adm-shell')).toHaveAttribute('data-theme', 'dark');
  });
});

describe('the parallax hero, which the owner has not ruled on yet', () => {
  test('nothing is rendered above the work area by default', () => {
    // rejects: hardcoding the three Webflow images back in. They are a
    // third-party CDN dependency on an authenticated operator console.
    const { container } = setup();
    expect(container.querySelector('.adm-hero')).toBeNull();
  });

  test('a hero passed in is rendered above the work head', () => {
    // rejects: deleting the seam. The owner's open question is whether the
    // console keeps the product's visual signature; the shell must be able to
    // answer either way without being rebuilt.
    const { container } = setup({ hero: <div data-testid="banner">signature</div> });
    const hero = container.querySelector('.adm-hero');
    expect(hero).not.toBeNull();
    expect(within(hero).getByTestId('banner')).toBeInTheDocument();
  });

  test('the shell itself loads no image from another origin', () => {
    // rejects: reintroducing cdn.prod.website-files.com — or any remote asset —
    // into a console that sits behind a sign-in wall.
    const { container } = setup();
    expect(container.querySelectorAll('img[src^="http"]')).toHaveLength(0);
  });
});

describe('identity, and the two ways out', () => {
  test('the signed-in admin is named and Sign out is wired', () => {
    // rejects: an unwired Sign out — the control is moving out of an absolutely
    // positioned inline-styled block in the parallax header into the top bar,
    // so the connection is brand new.
    const { onSignOut } = setup();
    expect(screen.getByText('Dana Whitfield')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /sign out/i }));
    expect(onSignOut).toHaveBeenCalledTimes(1);
  });

  test('with nobody signed in there is no identity block and no sign out', () => {
    // rejects: dropping the `currentUser &&` guard, which renders an account
    // corner naming nobody and a Sign out for a session that has none.
    setup({ currentUser: null });
    expect(screen.queryByRole('button', { name: /sign out/i })).toBeNull();
    expect(screen.queryByText('Dana Whitfield')).toBeNull();
  });

  test('the way back to the host opens a new tab and hands it no opener', () => {
    // rejects: dropping target/rel while moving this link. AdminPage.jsx:946
    // documents why: App.jsx is a pathname switch with no client-side routing,
    // so an in-place link is a full page load, and if a host session is live in
    // another tab that is a second host WebSocket connection.
    setup();
    const link = screen.getByRole('link', { name: /host/i });
    expect(link).toHaveAttribute('target', '_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
  });
});
