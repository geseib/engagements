/**
 * THE FIRST MINUTE USES ONE BUTTON (experience plan §5.1, Phase 5 step 5c).
 *
 * Home, New engagement, the shelf, Sessions, Reports, the agenda and Setup
 * moved onto components/ui/Button: one orange primary per screen, the
 * outlined secondary for every other action, the tertiary for a text link,
 * the filled danger for the answer to a destructive confirm. Their scoped
 * button families (.wel-btn, .gsd-btn, .slist-btn, .rp-btn, .sp-btn,
 * .hea-btn, .evb-btn, .evts-btn) and scoped primaries (.wel-action.is-primary,
 * .gsd .btn-primary, .hea-btn--primary, .evb-btn--primary, .evts-btn--primary)
 * are deleted.
 *
 * Rendered where a surface mounts cheaply in jsdom (Home, the sets list,
 * Setup); read as source where it needs a server behind it. No geometry:
 * jsdom has no layout engine.
 */
import React from 'react';
import { render, screen, within } from '@testing-library/react';
import WelcomeScreen from '../components/WelcomeScreen';
import QuestionSetsPanel from '../components/QuestionSetsPanel';
import SetupBeforeStart from '../components/SetupBeforeStart';

const fs = require('fs');
const path = require('path');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const PRIMARY = '.ui-btn--action';

describe('Home', () => {
  const NOW = Date.now();
  const ago = (h) => new Date(NOW - h * 3600000).toISOString();
  const sessions = [
    { gameId: '1001', title: 'Live now', gameType: 'call-and-answer', started: true, ended: false, byMe: true, createdAt: ago(2), lastPlayedAt: ago(1) },
    { gameId: '1003', title: 'Done yesterday', gameType: 'poll', started: true, ended: true, byMe: true, createdAt: ago(20) },
    { gameId: '1004', title: 'Not yet', gameType: 'call-and-answer', started: false, byMe: true, createdAt: ago(1) },
  ];
  const draw = () => render(
    <WelcomeScreen
      currentUser={{ attributes: { name: 'Sam Okafor', email: 'sam@example.com' }, groups: ['hosts'] }}
      continueGameId=""
      sessions={sessions}
      onCreateEngagement={() => {}}
      onQuestionSets={() => {}}
      onReports={() => {}}
      onSignOut={() => {}}
      onContinue={() => {}}
      onContinueGameIdChange={() => {}}
      rowActions={{
        onStart: () => {}, onEdit: () => {}, onOpen: () => {}, onReport: () => {}, onResults: () => {},
        onInvite: () => {}, onCopyPlayerUrl: () => {}, onDelete: () => Promise.resolve(),
      }}
    />,
  );

  test('exactly one primary, and it is New engagement', () => {
    const { container } = draw();
    const primaries = container.querySelectorAll(PRIMARY);
    expect(primaries).toHaveLength(1);
    expect(primaries[0]).toHaveTextContent(/New engagement/);
  });

  test('every action on Home is ui/Button, and no scoped button class is left', () => {
    const { container } = draw();
    for (const name of [/new engagement/i, /^rejoin live now$/i, /^continue$/i, /^question sets$/i, /^reports$/i, /^sign out$/i]) {
      const found = screen.getAllByRole('button', { name });
      found.forEach((b) => expect(b).toHaveClass('ui-btn'));
    }
    expect(screen.getByRole('link', { name: /see all/i })).toHaveClass('ui-btn', 'ui-btn--quiet');
    for (const link of screen.getAllByRole('link', { name: /^library & team$/i })) {
      expect(link).toHaveClass('ui-btn', 'ui-btn--tertiary');
    }
    expect(container.querySelector('[class*="wel-btn"], [class*="slist-btn"], .is-primary')).toBeNull();
  });

  test('the recent sessions\' row actions are ui/Button, none of them orange', () => {
    const { container } = draw();
    const list = container.querySelector('.slist');
    expect(list).not.toBeNull();
    const rowButtons = [...list.querySelectorAll('.slist-acts button')];
    expect(rowButtons.length).toBeGreaterThan(0);
    rowButtons.forEach((b) => expect(b).toHaveClass('ui-btn'));
    expect(list.querySelectorAll(PRIMARY)).toHaveLength(0);
  });
});

describe('the sets list (the console shelf)', () => {
  const SETS = [
    { id: 'a', name: 'Offsite', engagementType: 'call-and-answer', totalQuestions: 12, categoryCount: 3, active: true, createdAt: '2026-08-01T10:00:00.000Z' },
    { id: 'b', name: 'Fresh from the generator', engagementType: 'trivia', totalQuestions: 20, categoryCount: 2, active: false, isAIGenerated: true, createdAt: '2026-08-02T10:00:00.000Z' },
  ];
  test('New set is the one primary; a row\'s Review is the outlined lead, never orange', () => {
    const { container } = render(
      <QuestionSetsPanel questionSets={SETS} onCreate={() => {}} onEdit={() => {}} onDelete={() => {}} />,
    );
    const primaries = container.querySelectorAll(PRIMARY);
    expect(primaries).toHaveLength(1);
    expect(primaries[0]).toHaveTextContent(/New set/);
    const table = screen.getByRole('table');
    const review = within(table).getByRole('button', { name: /^review$/i });
    expect(review).toHaveClass('ui-btn', 'ui-btn--quiet', 'qsets-lead');
    within(table).getAllByRole('button', { name: /^delete$/i }).forEach((b) => expect(b).toHaveClass('ui-btn', 'qsets-del'));
    expect(container.querySelector('[class*="qsets-btn"]')).toBeNull();
  });

  test('the empty shelf\'s one primary is Generate with AI', () => {
    const { container } = render(<QuestionSetsPanel questionSets={[]} loading={false} onCreate={() => {}} />);
    const primaries = container.querySelectorAll(PRIMARY);
    expect(primaries).toHaveLength(1);
    expect(primaries[0]).toHaveTextContent(/Generate with AI/);
  });
});

describe('Setup, before Start', () => {
  test('Start is the one primary; Main menu, Edit and Invite are secondaries', () => {
    const { container } = render(
      <SetupBeforeStart
        title="Friday retro"
        code="4821"
        formatLabel="Call & Answer"
        startLabel="Start"
        onStart={() => {}}
        onEdit={() => {}}
        onInvite={() => {}}
        onMainMenu={() => {}}
        onChoose={() => {}}
      />,
    );
    const primaries = container.querySelectorAll(PRIMARY);
    expect(primaries).toHaveLength(1);
    expect(primaries[0]).toHaveTextContent(/Start/);
    expect(primaries[0]).toHaveClass('ui-btn--h44');
    for (const b of container.querySelectorAll('.sbs-top .ui-btn, .sbs-acts .ui-btn:not(.sbs-start)')) {
      expect(b).toHaveClass('ui-btn--quiet');
    }
  });
});

/*
  READ AS SOURCE: the surfaces that need a server (or a whole host page)
  behind them. Each holds its buttons on ui/Button, names at most the
  primaries it should, and keeps no scoped button class in its markup or
  its stylesheet.
*/
const SURFACES = [
  // [file, the most `variant="primary"` it may name, a family it must not use]
  ['components/WelcomeScreen.jsx', 1, /wel-btn|wel-action is-primary/],
  ['components/WelcomeEvents.jsx', 0, /wel-btn/],
  ['components/GameSetupDialog.jsx', 0, /gsd-btn|btn-primary|btn-secondary/],
  ['components/FormatCompare.jsx', 1, /gsd-btn|btn-primary|btn-secondary/],
  ['components/CreateSummary.jsx', 0, /gsd-btn/],
  ['components/SessionOptions.jsx', 0, /gsd-btn/],
  ['components/BriefingField.jsx', 0, /gsd-btn/],
  ['components/QuestionSetsPanel.jsx', 2, /qsets-btn/],
  ['components/HostQuestionSetsDialog.jsx', 1, /qsets-btn/],
  ['components/QuestionSetDeleteDialog.jsx', 1, /qsets-btn/],
  ['components/DraftsStrip.jsx', 0, /qsets-btn/],
  ['components/NewSetDialog.jsx', 0, /qsets-btn/],
  ['components/HostReportsDialog.jsx', 0, /qsets-btn/],
  ['components/SessionList.jsx', 0, /slist-btn/],
  ['components/SessionsPanel.jsx', 0, /sp-btn/],
  ['components/SessionHistoryPanel.jsx', 1, /<button[^>]*className="shist__(done-start|mode-switch)/],
  ['components/ReportsPanel.jsx', 0, /rp-btn/],
  ['components/event/HostEventAgenda.jsx', 0, /hea-btn/],
  ['components/EventBuilder.jsx', 1, /evb-btn/],
  ['components/EventItemDialog.jsx', 1, /evb-btn/],
  ['components/EventsPanel.jsx', 2, /evts-btn/],
  ['components/EventDetailsDialog.jsx', 1, /evts-btn/],
  ['components/event/EventStage.jsx', 3, /<button[^>]*className="ag-(b|yes|end|close)\b/],
];

describe.each(SURFACES)('%s', (file, maxPrimaries, family) => {
  const src = stripComments(read(file));
  test('imports ui/Button and renders its actions with it', () => {
    expect(src).toMatch(/import Button from '(\.\.?\/)+(components\/)?ui\/Button'/);
    expect((src.match(/<Button\b/g) || []).length).toBeGreaterThan(0);
  });
  test(`names at most ${maxPrimaries} primary, and no scoped button class`, () => {
    expect((src.match(/variant="primary"/g) || []).length).toBeLessThanOrEqual(maxPrimaries);
    expect(src).not.toMatch(family);
  });
  test('asks with the small confirm dialog, never the browser\'s', () => {
    expect(src).not.toMatch(/window\.(confirm|alert)\(/);
  });
});

/* Where a file names more than one primary, they are on different screens:
   the empty state and the list (one or the other renders), the head and a
   plan refusal, or the stage's separate asks. Create in New engagement is
   the one primary unless the Format guide is up, where Use <format> is. */
test('New engagement: Create steps down while the Format guide is up', () => {
  const src = read('components/GameSetupDialog.jsx');
  expect(src).toMatch(/variant=\{view === 'compare' \? 'secondary' : 'primary'\}/);
});

const STYLESHEETS = [
  ['components/WelcomeScreen.css', /\.wel-btn|\.wel-action\.is-primary/],
  ['components/GameSetupDialog.css', /\.gsd-btn|\.btn-primary|\.btn-secondary/],
  ['components/SessionList.css', /\.slist-btn/],
  ['components/SessionsPanel.css', /\.sp-btn/],
  ['components/ReportsPanel.css', /\.rp-btn/],
  ['components/event/HostEventAgenda.css', /\.hea-btn/],
  ['components/EventBuilder.css', /\.evb-btn/],
  ['components/EventsPanel.css', /\.evts-btn/],
];

test.each(STYLESHEETS)('%s declares no button family of its own any more', (file, family) => {
  expect(stripComments(read(file))).not.toMatch(family);
});
