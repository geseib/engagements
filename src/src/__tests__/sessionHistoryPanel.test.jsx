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

const started = {
  gameId: '4821', title: 'Q3 Offsite', gameType: 'call-and-answer',
  questionSetId: 'set-alpha', hostName: 'Ada',
  createdAt: '2026-08-10T09:00:00Z', lastPlayedAt: '2026-08-11T09:00:00Z',
  started: true,
};
const fresh = {
  gameId: '9137', title: 'Pricing Workshop', gameType: 'trivia',
  questionSetId: 'set-beta', hostName: 'Grace',
  createdAt: '2026-08-14T09:00:00Z', lastPlayedAt: null,
  started: false,
};

const mount = (props = {}) => {
  const handlers = {
    onCopyPlayerUrl: jest.fn(), onInvite: jest.fn(), onReport: jest.fn(),
    onOpen: jest.fn(), onStart: jest.fn(), onClose: jest.fn(),
  };
  const utils = render(
    <SessionHistoryPanel sessions={[started, fresh]} {...handlers} {...props} />
  );
  return { ...utils, ...handlers };
};

const rowFor = (title) => screen.getByText(title).closest('tr');

describe('§1 the pure rules', () => {
  test('a started session offers Continue and a report, never Start', () => {
    expect(rowActions(started)).toEqual({
      open: false, start: false, continue: true, report: true,
    });
  });

  test('an unstarted session offers Open AND Start, and no report', () => {
    // No report, because there is nothing to report on yet.
    expect(rowActions(fresh)).toEqual({
      open: true, start: true, continue: false, report: false,
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
  test('every column the cards carried is a column here', () => {
    mount();
    ['Session', 'Code', 'Type', 'State', 'Created', 'Last played'].forEach((h) => {
      expect(screen.getByRole('columnheader', { name: h })).toBeInTheDocument();
    });
  });

  test('the type is named, not guessed, for a row that has one', () => {
    mount();
    expect(within(rowFor('Q3 Offsite')).getByText('Call & Answer')).toBeInTheDocument();
  });

  test('a legacy row with no type prints an em dash rather than a default', () => {
    /*
      resolveGameType, not normalizeGameType: the latter always returns
      something, which would label every untyped legacy row "Call & Answer".

      Addressed by COLUMN, not by text. A row with no type usually also has no
      last-played date, so both cells hold an em dash and a text query matches
      two elements — a version of this test that settled for the first was
      asserting about whichever came first in the document, not about the type.
    */
    mount({ sessions: [{ ...fresh, gameType: undefined }] });
    const cells = rowFor('Pricing Workshop').cells;
    const typeColumn = screen.getAllByRole('columnheader').findIndex(
      (th) => th.textContent === 'Type'
    );
    expect(cells[typeColumn].textContent).toBe('—');
  });

  test('state is a word, not only a colour', () => {
    mount();
    expect(within(rowFor('Q3 Offsite')).getByText('Played')).toBeInTheDocument();
    expect(within(rowFor('Pricing Workshop')).getByText('Not started')).toBeInTheDocument();
  });

  test('the session on the stage is flagged', () => {
    mount({ currentGameId: '4821' });
    expect(within(rowFor('Q3 Offsite')).getByText('On stage')).toBeInTheDocument();
  });
});

describe('§3 a session can be opened without being started', () => {
  test('an unstarted session offers Open', () => {
    mount();
    expect(within(rowFor('Pricing Workshop')).getByRole('button', { name: /Open/i }))
      .toBeInTheDocument();
  });

  /*
    THE ASSERTION THIS WHOLE CHANGE EXISTS FOR. A panel that renders an Open
    button wired to `onStart` satisfies every other test in this file and
    reproduces the exact bug being fixed.
  */
  test('Open loads the session and does NOT start it', () => {
    const { onOpen, onStart } = mount();
    fireEvent.click(within(rowFor('Pricing Workshop')).getByRole('button', { name: /Open/i }));
    expect(onOpen).toHaveBeenCalledWith('9137', 'Pricing Workshop');
    expect(onStart).not.toHaveBeenCalled();
  });

  test('Start is a separate control, and it starts', () => {
    const { onOpen, onStart } = mount();
    fireEvent.click(within(rowFor('Pricing Workshop')).getByRole('button', { name: /Start/i }));
    expect(onStart).toHaveBeenCalledWith('9137', 'Pricing Workshop');
    expect(onOpen).not.toHaveBeenCalled();
  });

  test('a started session has no Start button to press again', () => {
    mount();
    expect(within(rowFor('Q3 Offsite')).queryByRole('button', { name: /^Start/i })).toBeNull();
  });

  test('Continue loads a started session', () => {
    const { onOpen } = mount();
    fireEvent.click(within(rowFor('Q3 Offsite')).getByRole('button', { name: /Continue/i }));
    expect(onOpen).toHaveBeenCalledWith('4821', 'Q3 Offsite');
  });

  test('a report is offered only where there is something to report', () => {
    mount();
    expect(within(rowFor('Q3 Offsite')).getByRole('button', { name: /Report/i }))
      .toBeInTheDocument();
    expect(within(rowFor('Pricing Workshop')).queryByRole('button', { name: /Report/i }))
      .toBeNull();
  });
});

describe('§4 the other row actions', () => {
  test('the link and invite controls name the session they act on', () => {
    mount();
    const row = within(rowFor('Q3 Offsite'));
    expect(row.getByRole('button', { name: /Link/i })).toHaveAttribute(
      'title', expect.stringContaining('Q3 Offsite')
    );
    expect(row.getByRole('button', { name: /Invite/i })).toHaveAttribute(
      'title', expect.stringContaining('Q3 Offsite')
    );
  });

  test('the link control passes the code, the invite passes the whole session', () => {
    // The invite needs the title, type and set; the player URL needs only the id.
    const { onCopyPlayerUrl, onInvite } = mount();
    const row = within(rowFor('Q3 Offsite'));
    fireEvent.click(row.getByRole('button', { name: /Link/i }));
    fireEvent.click(row.getByRole('button', { name: /Invite/i }));
    expect(onCopyPlayerUrl).toHaveBeenCalledWith('4821');
    expect(onInvite).toHaveBeenCalledWith(started);
  });

  test('close is reachable by its accessible name', () => {
    const { onClose } = mount();
    fireEvent.click(screen.getByRole('button', { name: /Close session history/i }));
    expect(onClose).toHaveBeenCalled();
  });
});

describe('§5 two empty states, saying different things', () => {
  test('no sessions at all says so', () => {
    mount({ sessions: [] });
    expect(screen.getByText(/No sessions yet/i)).toBeInTheDocument();
  });

  test('a search matching nothing says something different', () => {
    /*
      The card list had only the first message, so a host with forty sessions
      who filtered to none would have been told they had none at all. "Nothing
      exists" and "nothing matches" are different situations with different
      ways out.
    */
    mount();
    fireEvent.change(screen.getByRole('searchbox', { name: /Search sessions/i }), {
      target: { value: 'zzzz' },
    });
    expect(screen.getByText(/No session matches that search/i)).toBeInTheDocument();
    expect(screen.queryByText(/No sessions yet/i)).toBeNull();
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

describe('§6 the stylesheet contracts jsdom cannot measure', () => {
  const fs = require('fs');
  const path = require('path');
  const CSS = fs
    .readFileSync(path.join(__dirname, '..', 'components', 'SessionHistoryPanel.css'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '');

  test('the action group uses margin-left:auto, never justify-content:flex-end', () => {
    // Hard rule 9. Inside an overflow:hidden cell, flex-end pushes the overflow
    // towards the START of the row, where it cannot be reached — the leading
    // buttons silently disappear as the column narrows. `.sp-rowact` in the
    // admin sheet does exactly this, which is why it was not copied.
    expect(CSS).toMatch(/\.shist__acts\s*>\s*:first-child\s*\{[^}]*margin-left:\s*auto/);
    const group = CSS.slice(CSS.indexOf('.shist__acts {'));
    expect(group.slice(0, group.indexOf('}'))).not.toMatch(/justify-content:\s*flex-end/);
  });

  test('the actions are always visible, not revealed on hover', () => {
    // The admin sheet hides them at opacity 0 until hover. On this screen the
    // actions ARE the screen, and hover does not exist on a touch laptop.
    expect(CSS).not.toMatch(/\.shist__acts\s*\{[^}]*opacity:\s*0/);
  });

  test('the table is fixed layout', () => {
    expect(CSS).toMatch(/\.shist__tbl\s*\{[^}]*table-layout:\s*fixed/);
  });

  test('the column widths sum to 100', () => {
    const widths = ['name', 'id', 'type', 'state', 'acts'].map((k) => {
      const m = CSS.match(new RegExp(`\\.shist__c-${k}\\s*\\{\\s*width:\\s*(\\d+)%`));
      if (!m) throw new Error(`no width for .shist__c-${k}`);
      return Number(m[1]);
    });
    const when = Number(CSS.match(/\.shist__c-when\s*\{\s*width:\s*(\d+)%/)[1]);
    // Two `when` columns share one rule.
    expect(widths.reduce((a, b) => a + b, 0) + when * 2).toBe(100);
  });

  test('nothing drops below the 12px floor', () => {
    const sizes = [...CSS.matchAll(/font-size:\s*(\d+)px/g)].map((m) => Number(m[1]));
    expect(sizes.length).toBeGreaterThan(0);
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(12);
  });

  test('every selector is rooted at the scope', () => {
    const selectors = [...CSS.matchAll(/^([.@][^{]+)\{/gm)].map((m) => m[1].trim());
    const leaked = selectors.filter((s) => !s.startsWith('@') && !s.includes('.shist'));
    expect(leaked).toEqual([]);
  });

  test('colour comes from tokens, not from raw hex outside the token block', () => {
    const afterTokens = CSS.slice(CSS.indexOf('.shist__head'));
    expect(afterTokens).not.toMatch(/#[0-9a-fA-F]{6}/);
  });

  test('the destructive-text rule is respected — no color: var(--danger)', () => {
    expect(CSS).not.toMatch(/color:\s*var\(--danger\)/);
  });
});
