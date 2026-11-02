/**
 * THE HOST'S SESSION HISTORY.
 *
 * §3 is the one that matters and the reason the panel was extracted at all.
 * Owner: *"i cant edit the session without starting it today. maybe fix it."*
 *
 * The card list this replaces had ONE primary button per row, forking on
 * `game.started`:
 *
 *     if (game.started) selectGameFromHistory(...)   // just loads it
 *     else               startGameFromHistory(...)   // POSTs /start, THEN loads
 *
 * so the only route into an unstarted session went through the call that opens
 * the doors to players. §3 pins both halves: Open exists, and Open does NOT
 * start. The second assertion is the whole feature — a panel that renders an
 * Open button wired to `onStart` passes every other test in this file.
 *
 * jsdom has no layout engine, so there is not one geometric assertion here.
 * The column widths and the action-group alignment are contracts in the
 * stylesheet and are read AS TEXT in §6 — the technique
 * `modalReachability.test.js` uses, and for the same reason.
 */
import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import SessionHistoryPanel, {
  rowActions, matchesSearch, orderSessions,
} from '../components/SessionHistoryPanel';
import { countOrDash } from '../config/tableCells';
import { rowAction, clickRowAction } from '../testUtils/sessionRows';

const started = {
  gameId: '4821', title: 'Q3 Offsite', gameType: 'call-and-answer',
  questionSetId: 'set-alpha', hostName: 'Ada',
  createdAt: '2026-08-10T09:00:00Z', lastPlayedAt: '2026-08-11T09:00:00Z',
  started: true, playerCount: 7, roundsPlayed: 4,
};
const fresh = {
  gameId: '9137', title: 'Pricing Workshop', gameType: 'trivia',
  questionSetId: 'set-beta', hostName: 'Grace',
  createdAt: '2026-08-14T09:00:00Z', lastPlayedAt: null,
  started: false, playerCount: 0, roundsPlayed: 0,
};

const mount = (props = {}) => {
  const handlers = {
    onCopyPlayerUrl: jest.fn(), onInvite: jest.fn(), onReport: jest.fn(),
    onOpen: jest.fn(), onStart: jest.fn(), onEdit: jest.fn(), onClose: jest.fn(),
    onResults: jest.fn(),
  };
  const utils = render(
    <SessionHistoryPanel sessions={[started, fresh]} {...handlers} {...props} />
  );
  return { ...utils, ...handlers };
};

const rowFor = (title) => screen.getByText(title).closest('tr');
/* Since the experience plan's 4a a row has ONE primary button and a ⋯ menu
   with the rest; `act` finds an action in either (testUtils/sessionRows.js). */
const act = (title, name) => rowAction(rowFor(title), name);

describe('§1 the pure rules', () => {
  test('a started session offers Continue and a report, never Start or Edit', () => {
    // No edit: PUT /games/{id} refuses any session whose STATE is not
    // CREATED, so an Edit button here could only ever produce a 400.
    expect(rowActions(started)).toEqual({
      start: false, continue: true, report: true, edit: false, results: false,
    });
  });

  test('an unstarted session offers Edit and Start — two actions, not three', () => {
    /*
      No report, because there is nothing to report on yet. Edit, because
      "edit a session before it starts" is exactly this window.

      NO OPEN, and this assertion used to demand it. The owner, on the
      three-button row: "i think thats too many. we want to edit a session
      without allowing players into it... and then we want to start a session."
      Open existed so setup was reachable without /start, back when the Edit
      dialog could not touch categories; Edit grew categories and Open's job
      disappeared. rowActions carries the full argument.
    */
    expect(rowActions(fresh)).toEqual({
      start: true, continue: false, report: false, edit: true, results: false,
    });
  });
});

describe('§1b a closed survey offers Results AND Report — I-2, 2026-09-26 final review', () => {
  /*
    Task 3 fix round 1 had `results` REPLACE `report` in a closed survey's
    row, on the premise that "a survey has no session report to open at
    all" — false once Task 4 shipped: create-report.js reuses
    survey-host.js's surveyResultsPayload, so a closed survey's report is a
    real document with every chart and every open answer. `results` is the
    lightweight modal (GET /games/{id}/survey-results, Task 3); `report` is
    the full saved document (Task 4). They show different things and a host
    coming back for either one should find it. So both are true for a closed
    survey now, alongside `continue` — see the JSX comment by `.shist__acts`
    for how the fixed 2-column grid holds a third verb button.
    `session.surveyClosed` (get-games-list.js) is the ONLY thing this reads —
    the flag already means "SURVEY#CLOSED or ENDED", so rowActions asks
    nothing else about state.
  */
  const closedSurvey = {
    ...started, gameId: '5001', title: 'Pulse check', gameType: 'survey', surveyClosed: true,
  };
  const collectingSurvey = {
    ...started, gameId: '5002', title: 'Still open', gameType: 'survey', surveyClosed: false,
  };

  test('a closed survey: Continue, Results and Report — never Start or Edit', () => {
    expect(rowActions(closedSurvey)).toEqual({
      start: false, continue: true, report: true, edit: false, results: true,
    });
  });

  test('a survey still collecting offers no Results — the same shape as any other started session', () => {
    expect(rowActions(collectingSurvey)).toEqual({
      start: false, continue: true, report: true, edit: false, results: false,
    });
  });

  test('a non-survey session is never offered Results, even if surveyClosed is (wrongly) set', () => {
    expect(rowActions({ ...started, surveyClosed: true })).toEqual({
      start: false, continue: true, report: true, edit: false, results: false,
    });
  });

  test('an unstarted survey offers Edit and Start, not Results', () => {
    expect(rowActions({ ...fresh, gameType: 'survey', surveyClosed: false })).toEqual({
      start: true, continue: false, report: false, edit: true, results: false,
    });
  });

  test('search matches title, code, host and set', () => {
    expect(matchesSearch(started, 'offsite')).toBe(true);
    expect(matchesSearch(started, '4821')).toBe(true);
    expect(matchesSearch(started, 'ada')).toBe(true);
    expect(matchesSearch(started, 'alpha')).toBe(true);
    expect(matchesSearch(started, 'nothing')).toBe(false);
  });

  test('an empty search matches everything rather than nothing', () => {
    // The inverse would empty the table on first render.
    expect(matchesSearch(started, '')).toBe(true);
    expect(matchesSearch(started, '   ')).toBe(true);
  });

  test('search is case-insensitive', () => {
    expect(matchesSearch(started, 'OFFSITE')).toBe(true);
  });

  test('sessions are newest first and the newest is the latest', () => {
    const { sorted, latestId } = orderSessions([started, fresh]);
    expect(sorted.map((s) => s.gameId)).toEqual(['9137', '4821']);
    expect(latestId).toBe('9137');
  });

  test('an empty list has no latest, rather than a crash', () => {
    expect(orderSessions([])).toEqual({ sorted: [], latestId: null });
  });
});

describe('§2 the table', () => {
  test('one row shape: session, format, status, date and the actions', () => {
    mount();
    ['Session', 'Format', 'Status', 'Date'].forEach((h) => {
      expect(screen.getByRole('columnheader', { name: h })).toBeInTheDocument();
    });
    expect(screen.getByRole('columnheader', { name: 'Actions' })).toBeInTheDocument();
  });

  test('the code and the set are on the row, under the title', () => {
    mount();
    expect(within(rowFor('Q3 Offsite')).getByText(/4821/)).toBeInTheDocument();
    expect(within(rowFor('Q3 Offsite')).getByText(/Set: set-alpha/)).toBeInTheDocument();
  });

  test('the type is named, not guessed, for a row that has one', () => {
    mount();
    expect(within(rowFor('Q3 Offsite')).getByText('Call & Answer')).toBeInTheDocument();
  });

  test('a legacy row with no type prints an em dash rather than a default', () => {
    // resolveGameType, not normalizeGameType: the latter always returns
    // something, which would label every untyped legacy row "Call & Answer".
    mount({ sessions: [{ ...fresh, gameType: undefined }] });
    const cells = rowFor('Pricing Workshop').cells;
    const typeColumn = screen.getAllByRole('columnheader').findIndex((th) => th.textContent === 'Format');
    expect(cells[typeColumn].textContent).toBe('—');
  });

  test('state is a word, not only a colour', () => {
    mount();
    expect(within(rowFor('Q3 Offsite')).getByText('Played')).toBeInTheDocument();
    expect(within(rowFor('Pricing Workshop')).getByText('Not started')).toBeInTheDocument();
  });

  test('a session that was read as running or ended says which', () => {
    mount({ sessions: [{ ...started, ended: false }, { ...fresh, gameId: '7001', title: 'Done one', started: true, ended: true }] });
    expect(within(rowFor('Q3 Offsite')).getByText('Running')).toBeInTheDocument();
    expect(within(rowFor('Done one')).getByText('Ended')).toBeInTheDocument();
  });

  test('the session on the stage is flagged', () => {
    mount({ currentGameId: '4821' });
    expect(within(rowFor('Q3 Offsite')).getByText('On stage')).toBeInTheDocument();
  });
});

describe('§3 a session can be prepared without being started', () => {
  /*
    The bug guarded here is unchanged since the Open button was retired: a
    control on an unstarted row that quietly POSTs /start. EDIT is the way to
    touch an unstarted session without starting it; it is under ⋯ now, with
    Start the row's one primary (experience plan 4a).
  */
  test('an unstarted session offers no Open — Edit is the way in', () => {
    mount();
    expect(act('Pricing Workshop', /^Open/)).toBeNull();
    expect(act('Pricing Workshop', /^Edit/)).not.toBeNull();
  });

  test('Edit raises the edit flow and starts nothing', () => {
    const { onEdit, onStart, onOpen } = mount();
    clickRowAction(rowFor('Pricing Workshop'), /^Edit/);
    expect(onEdit).toHaveBeenCalledWith('9137', 'Pricing Workshop');
    expect(onStart).not.toHaveBeenCalled();
    expect(onOpen).not.toHaveBeenCalled();
  });

  test('Start is the row\'s primary, and it starts', () => {
    const { onOpen, onStart } = mount();
    const start = act('Pricing Workshop', /^Start/);
    expect(start).toHaveClass('slist-lead');
    fireEvent.click(start);
    expect(onStart).toHaveBeenCalledWith('9137', 'Pricing Workshop');
    expect(onOpen).not.toHaveBeenCalled();
  });

  test('a started session has no Start button to press again', () => {
    mount();
    expect(act('Q3 Offsite', /^Start/)).toBeNull();
  });

  test('Continue loads a started session', () => {
    const { onOpen } = mount();
    clickRowAction(rowFor('Q3 Offsite'), /^Continue/);
    expect(onOpen).toHaveBeenCalledWith('4821', 'Q3 Offsite');
  });

  test('a report is offered only where there is something to report', () => {
    mount();
    expect(act('Q3 Offsite', /^Report/)).not.toBeNull();
    expect(act('Pricing Workshop', /^Report/)).toBeNull();
  });

  test('an ended session leads with its report, and Continue is still there', () => {
    const { onReport, onOpen } = mount({ sessions: [{ ...started, ended: true }] });
    const report = act('Q3 Offsite', /^Report/);
    expect(report).toHaveClass('slist-lead');
    fireEvent.click(report);
    expect(onReport).toHaveBeenCalledWith('4821', 'Q3 Offsite');
    clickRowAction(rowFor('Q3 Offsite'), /^Continue/);
    expect(onOpen).toHaveBeenCalledWith('4821', 'Q3 Offsite');
  });
});

describe('§3b a session can be edited before it starts', () => {
  /*
    THE SAME TRAP AS OPEN-WIRED-TO-START, one row over: an Edit wired to
    onOpen (or onStart) reproduces the bug this feature exists to fix.
  */
  test('Edit raises onEdit — not onOpen, and never onStart', () => {
    const { onEdit, onOpen, onStart } = mount();
    clickRowAction(rowFor('Pricing Workshop'), /^Edit/);
    expect(onEdit).toHaveBeenCalledWith('9137', 'Pricing Workshop');
    expect(onOpen).not.toHaveBeenCalled();
    expect(onStart).not.toHaveBeenCalled();
  });

  test('a started session has no Edit — the backend would refuse it', () => {
    mount();
    expect(act('Q3 Offsite', /^Edit/)).toBeNull();
  });
});

describe('§4 the other row actions', () => {
  test('the link and invite controls name the session they act on', () => {
    mount();
    expect(act('Q3 Offsite', /^Copy join link/)).toHaveAttribute('title', expect.stringContaining('Q3 Offsite'));
    expect(act('Q3 Offsite', /^Invite/)).toHaveAttribute('title', expect.stringContaining('Q3 Offsite'));
  });

  test('the link control passes the code, the invite passes the whole session', () => {
    // The invite needs the title, type and set; the player URL needs only the id.
    const { onCopyPlayerUrl, onInvite } = mount();
    clickRowAction(rowFor('Q3 Offsite'), /^Copy join link/);
    clickRowAction(rowFor('Q3 Offsite'), /^Invite/);
    expect(onCopyPlayerUrl).toHaveBeenCalledWith('4821');
    expect(onInvite).toHaveBeenCalledWith(started);
  });

  test('the ⋯ menu is a real menu: named, keyboard-closable, and focus goes back', () => {
    mount();
    const more = within(rowFor('Q3 Offsite')).getByRole('button', { name: 'More for "Q3 Offsite"' });
    expect(more).toHaveAttribute('aria-haspopup', 'menu');
    fireEvent.click(more);
    const menu = screen.getByRole('menu', { name: 'More for "Q3 Offsite"' });
    expect(within(menu).getAllByRole('menuitem').length).toBeGreaterThan(0);
    fireEvent.keyDown(menu, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(more);
  });

  test('Delete is offered only when the page can delete, and asks on the row first', async () => {
    mount();
    expect(act('Q3 Offsite', /^Delete/)).toBeNull();
    const onDelete = jest.fn(() => Promise.resolve());
    render(<SessionHistoryPanel sessions={[{ ...started, gameId: '6001', title: 'Deletable' }]} onDelete={onDelete} />);
    clickRowAction(rowFor('Deletable'), /^Delete/);
    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.getByTestId('delete-confirm')).toHaveTextContent(/Every answer, vote and player record/);
    fireEvent.click(within(screen.getByTestId('delete-confirm')).getByRole('button', { name: 'Delete' }));
    expect(onDelete).toHaveBeenCalledWith(expect.objectContaining({ gameId: '6001' }), '');
  });

  test('close is reachable by its accessible name', () => {
    const { onClose } = mount();
    fireEvent.click(screen.getByRole('button', { name: /Close your sessions/i }));
    expect(onClose).toHaveBeenCalled();
  });
});

describe('§4b Survey results, rendered — Task 3 fix round 1', () => {
  const closedSurvey = {
    gameId: '5001', title: 'Pulse check', gameType: 'survey',
    questionSetId: 'set-alpha', hostName: 'Ada',
    createdAt: '2026-09-20T09:00:00Z', lastPlayedAt: '2026-09-20T09:40:00Z',
    started: true, playerCount: 12, roundsPlayed: 0, surveyClosed: true,
  };
  const collectingSurvey = { ...closedSurvey, gameId: '5002', title: 'Still open', surveyClosed: false };

  test('a closed survey row leads with Survey results, and it names the session it opens', () => {
    mount({ sessions: [closedSurvey] });
    const btn = act('Pulse check', /^Survey results/);
    expect(btn).toHaveClass('slist-lead');
    expect(btn).toHaveAttribute('title', expect.stringContaining('Pulse check'));
  });

  test('clicking it calls onResults with the session\'s id and title', () => {
    const { onResults } = mount({ sessions: [closedSurvey] });
    clickRowAction(rowFor('Pulse check'), /^Survey results/);
    expect(onResults).toHaveBeenCalledWith('5001', 'Pulse check');
  });

  test('a survey still collecting offers no Survey results', () => {
    mount({ sessions: [collectingSurvey] });
    expect(act('Still open', /^Survey results/)).toBeNull();
  });

  // I-2 (2026-09-26 final review): the row must offer both, wired to the
  // same two independent handlers.
  test('a closed survey row ALSO offers Report, wired to the same report path other sessions use', () => {
    const { onReport } = mount({ sessions: [closedSurvey] });
    const btn = act('Pulse check', /^Report/);
    expect(btn).toHaveAttribute('title', expect.stringContaining('Pulse check'));
    fireEvent.click(btn);
    expect(onReport).toHaveBeenCalledWith('5001', 'Pulse check');
  });

  test('an ordinary (non-survey) closed session offers no Survey results', () => {
    mount();
    expect(act('Q3 Offsite', /^Survey results/)).toBeNull();
  });
});

describe('§5 two empty states, saying different things', () => {
  test('no sessions at all says so', () => {
    mount({ sessions: [] });
    expect(screen.getByText(/No sessions yet/i)).toBeInTheDocument();
  });

  test('a search matching nothing says something different, with a way out', () => {
    mount();
    fireEvent.change(screen.getByRole('searchbox', { name: /Search sessions/i }), {
      target: { value: 'zzzz' },
    });
    expect(screen.getByText(/No session matches this filter/i)).toBeInTheDocument();
    expect(screen.queryByText(/No sessions yet/i)).toBeNull();
    expect(screen.getByRole('button', { name: /Clear all filters/i })).toBeInTheDocument();
  });

  test('with no sessions there is no search box to filter with', () => {
    mount({ sessions: [] });
    expect(screen.queryByRole('searchbox')).toBeNull();
  });

  test('searching narrows the rows', () => {
    mount();
    fireEvent.change(screen.getByRole('searchbox', { name: /Search sessions/i }), {
      target: { value: 'pricing' },
    });
    expect(screen.getByText('Pricing Workshop')).toBeInTheDocument();
    expect(screen.queryByText('Q3 Offsite')).toBeNull();
  });
});

/*
  A REFUSED START IS SAID ON THE LIST, in the server's words (`notice`).
*/
describe('§5a a notice from the page', () => {
  test('is shown as an alert, in the server\'s words', () => {
    render(<SessionHistoryPanel sessions={[fresh]} notice="Nothing to ask yet: this survey's question set has no questions in it." />);
    expect(screen.getByRole('alert')).toHaveTextContent("Nothing to ask yet: this survey's question set has no questions in it.");
  });

  test('no notice, no alert', () => {
    render(<SessionHistoryPanel sessions={[fresh]} />);
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('§5b the two counts, under the status', () => {
  const statusOfRow = (title) => {
    const i = screen.getAllByRole('columnheader').findIndex((th) => th.textContent === 'Status');
    return rowFor(title).cells[i].textContent;
  };

  test('a session that was played says how many people and rounds', () => {
    mount();
    expect(statusOfRow('Q3 Offsite')).toMatch(/7 people · 4 rounds/);
  });

  /*
    ZERO IS A REAL ANSWER AND MUST SURVIVE. A `!value` guard would turn every
    empty session into "unknown".
  */
  test('zero prints as zero, not as unknown', () => {
    mount();
    expect(statusOfRow('Pricing Workshop')).toMatch(/0 people · 0 rounds/);
  });

  test('null claims nothing — "we could not read it" is not "nobody"', () => {
    mount({ sessions: [{ ...started, playerCount: null, roundsPlayed: null }] });
    expect(statusOfRow('Q3 Offsite')).not.toMatch(/\d/);
  });

  test('a row from an API that never sent the fields still renders', () => {
    mount({ sessions: [{ ...started, playerCount: undefined, roundsPlayed: undefined }] });
    expect(statusOfRow('Q3 Offsite')).toBe('Played');
  });

  test.each([[0, '0'], [7, '7'], [null, '—'], [undefined, '—']])(
    'countOrDash(%s) is %s', (input, expected) => {
      expect(countOrDash(input)).toBe(expected);
    }
  );
});

describe('§6 the stylesheet contracts jsdom cannot measure', () => {
  const fs = require('fs');
  const path = require('path');
  const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '');
  const CSS = strip(fs.readFileSync(path.join(__dirname, '..', 'components', 'SessionHistoryPanel.css'), 'utf8'));
  const LIST = strip(fs.readFileSync(path.join(__dirname, '..', 'components', 'SessionList.css'), 'utf8'));

  test('the action group starts with margin-left: auto and wraps, never flex-end (hard rule 9)', () => {
    const group = LIST.slice(LIST.indexOf('.slist-acts {'));
    const body = group.slice(0, group.indexOf('}'));
    expect(body).toMatch(/flex-wrap:\s*wrap/);
    expect(body).not.toMatch(/justify-content:\s*flex-end/);
    expect(LIST).toMatch(/\.slist-acts > :first-child\s*\{[^}]*margin-left:\s*auto/);
  });

  test('the actions are always visible, not revealed on hover', () => {
    expect(LIST).not.toMatch(/\.slist-acts\s*\{[^}]*opacity:\s*0/);
  });

  test('the ⋯ menu is fixed-position, so no cell or scroll box clips it', () => {
    expect(LIST).toMatch(/\.slist-menu\s*\{[^}]*position:\s*fixed/);
    expect(LIST).toMatch(/td\.slist-c-acts\s*\{[^}]*overflow:\s*visible/);
  });

  test('the table is fixed layout', () => {
    expect(LIST).toMatch(/\.slist-tbl\s*\{[^}]*table-layout:\s*fixed/);
  });

  test('the five column widths sum to 100', () => {
    const widths = ['name', 'kind', 'state', 'when', 'acts'].map((k) => {
      const m = LIST.match(new RegExp(`\\.slist-c-${k}\\s*\\{\\s*width:\\s*(\\d+)%`));
      if (!m) throw new Error(`no width for .slist-c-${k}`);
      return Number(m[1]);
    });
    expect(widths.reduce((a, b) => a + b, 0)).toBe(100);
  });

  test('the dialog is wide enough for the table', () => {
    const global2 = strip(fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8'));
    const rule = global2.slice(global2.indexOf('.reports-modal {'));
    const body = rule.slice(0, rule.indexOf('}'));
    const px = Number(body.match(/max-width:\s*min\((\d+)px/)[1]);
    expect(px).toBeGreaterThanOrEqual(1100);
    expect(body).toMatch(/95vw/);
  });

  test('only the list scrolls, not the dialog as well', () => {
    const global2 = strip(fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8'));
    const rule = global2.slice(global2.indexOf('.reports-modal {'));
    expect(rule.slice(0, rule.indexOf('}'))).toMatch(/overflow:\s*hidden/);
    expect(CSS).toMatch(/\.shist__scroll\s*\{[^}]*overflow-y:\s*auto/);
  });

  test.each([['SessionHistoryPanel.css', () => CSS], ['SessionList.css', () => LIST]])(
    '%s: nothing drops below the 12px floor', (_n, get) => {
      // Literal sizes and the ladder's own steps (`--x-t-floor: 12px`) both count.
      const sizes = [...get().matchAll(/(?:font-size|-t-[a-z]+):\s*(\d+)px/g)].map((m) => Number(m[1]));
      expect(sizes.length).toBeGreaterThan(0);
      expect(Math.min(...sizes)).toBeGreaterThanOrEqual(12);
    },
  );

  test.each([['SessionHistoryPanel.css', () => CSS, '.shist'], ['SessionList.css', () => LIST, '.slist']])(
    '%s: every selector is rooted at its scope', (_n, get, scope) => {
      const selectors = [...get().matchAll(/^([.@][^{]+)\{/gm)].map((m) => m[1].trim());
      const leaked = selectors.filter((sel) => !sel.startsWith('@') && !sel.includes(scope));
      expect(leaked).toEqual([]);
    },
  );

  test('SessionList.css paints with tokens only: no raw colour at all', () => {
    expect(LIST).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(LIST).not.toMatch(/rgba?\((?!var\()/);
  });

  test('colour comes from tokens, not from raw hex outside the token block', () => {
    const afterTokens = CSS.slice(CSS.indexOf('.shist__head'));
    expect(afterTokens).not.toMatch(/#[0-9a-fA-F]{6}/);
  });

  test('the destructive-text rule is respected — no color: var(--danger)', () => {
    expect(CSS).not.toMatch(/color:\s*var\(--danger\)/);
    expect(LIST).not.toMatch(/color:\s*var\(--danger\)/);
  });

  test('on a phone the rows are cards and every control is 44px', () => {
    const phone = LIST.slice(LIST.lastIndexOf('@media (max-width: 600px)'));
    expect(phone).toMatch(/\.slist \.slist-tbl tr \{[^}]*display:\s*flex/);
    expect(phone).toMatch(/\.slist \.slist-act,\s*\.slist \.slist-lead \{[^}]*min-height:\s*44px/);
  });
});


describe('creating a session deletes nothing — issue #26, the real mechanism', () => {
  /*
    CloudWatch, 2026-08-19: 10:17:46 "Successfully deleted game 9209 and all
    related data"; 10:17:47 session "80s 3" created. 9209 was "80s 2", and the
    deleter was handleStartNewGame itself — a pre-create "clear old game data"
    call left over from the one-throwaway-demo era, pointed at whatever session
    was on stage. History is the feature that makes that call catastrophic:
    sessions are durable now, and "make a new one" must never mean "burn the
    one I was on".

    Source-level, because the deletion was a side effect three layers from any
    rendered control: the ONLY caller of the destructive endpoint must be the
    Delete flow, which stands behind its own confirmation.
  */
  test('the create flow contains no clear-game call', () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(path.join(__dirname, '..', 'GameHostPage.jsx'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')      // the post-mortem comment may name it
      .replace(/^\s*\/\/.*$/gm, '');
    expect(src).not.toMatch(/clear-game/);
  });
});
