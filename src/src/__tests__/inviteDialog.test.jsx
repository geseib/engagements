/**
 * THE INVITE, AND THE DATE IT WILL NOT SURVIVE.
 *
 * §2 is the important one. The owner asked to "warn if >90 days from current
 * date", and that is the wrong clock: a session's deadline is CREATION + 90
 * days, so in session history the request under-warns by exactly the session's
 * age. A 70-day-old session has 20 days left, but `now + 90` accepts a date 89
 * days out — an invitation pointing a room at a session that will have been
 * deleted for 69 days. The tests measure from `createdAt` and say so.
 *
 * §1 also pins two live bugs the merge fixes: the history invite's title was
 * ALWAYS wrong (it read `eventTitle`; the API sends `title`), and the panel
 * invite dropped the join code entirely.
 *
 * jsdom has no layout engine. Nothing here is geometric; the stylesheet
 * contracts are read as text in §5.
 */
import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import InviteDialog from '../components/InviteDialog';
import {
  buildInvite, retentionStatus, retentionDeadline, formatDeadline,
  NOW_LINE, RETENTION_DAYS,
} from '../config/invite';

const DAY = 24 * 60 * 60 * 1000;
const target = {
  gameId: '4821',
  title: 'Q3 Offsite',
  gameType: 'call-and-answer',
  setName: 'Strategy Starters',
  categories: [{ name: 'Pricing', questionCount: 7 }, { name: 'Packaging' }],
  createdAt: '2026-08-01T09:00:00Z',
};
const NOW = new Date('2026-08-16T09:00:00Z');

const mount = (props = {}) => {
  const onClose = jest.fn();
  const utils = render(
    <InviteDialog target={target} origin="https://engage.test" onClose={onClose} now={NOW} {...props} />
  );
  return { ...utils, onClose };
};

const preview = () => screen.getByLabelText('What gets copied').value;

describe('§1 what the invite says', () => {
  const text = () => buildInvite({ ...target, origin: 'https://engage.test' });

  test('"Now" inserts the owner\'s exact sentence', () => {
    expect(text()).toContain(NOW_LINE);
    expect(NOW_LINE).toBe('Happening now, join us!');
  });

  test('a scheduled invite names the date and drops the now line', () => {
    const t = buildInvite({ ...target, origin: 'x', when: 'scheduled', at: '2026-09-03T14:30' });
    expect(t).not.toContain(NOW_LINE);
    expect(t).toMatch(/September/);
  });

  test('it carries the detail the panel version had', () => {
    // The half the owner asked to keep: type, set and categories with counts.
    expect(text()).toContain('Call & Answer');
    expect(text()).toContain('Strategy Starters');
    expect(text()).toContain('Pricing (7)');
    expect(text()).toContain('Packaging');
  });

  /*
    THE HALF THE PANEL VERSION DROPPED. It put only the URL on the clipboard,
    so somebody reading the invite off paper, or on a machine that will not open
    links, had nothing to type into the four-digit box.
  */
  test('it carries the join code as text, not only as a link', () => {
    expect(text()).toMatch(/session code 4821/);
  });

  /*
    THE HISTORY INVITE'S TITLE WAS ALWAYS WRONG: it read `game.eventTitle`, and
    get-games-list.js sends the field as `title`, so every invite copied from
    that list said "Engagement Session".
  */
  test('a row that carries only `title` still gets its real title', () => {
    const t = buildInvite({ title: 'Q3 Offsite', gameId: '4821', origin: 'x' });
    expect(t).toContain('Q3 Offsite');
    expect(t).not.toContain('Engagement Session');
  });

  test('the URL is /play, never /player', () => {
    expect(text()).toContain('/play?gameId=4821');
    expect(text()).not.toContain('/player?');
  });

  /*
    `RootPage.jsx` scrapes a pasted invite for `gameId=NNNN` so a player can
    paste the whole blob into the join box. The URL is load-bearing, not
    decoration, and nothing else in the codebase says so.
  */
  test('a pasted invite still yields its four-digit code', () => {
    const match = text().match(/[?&]gameId=(\d{4})(?!\d)/);
    expect(match && match[1]).toBe('4821');
  });

  test('unknown categories omit the line rather than claiming "All categories"', () => {
    // null means "we could not find out" — a history row carries no category
    // data — and [] means "none were narrowed". Collapsing them would print a
    // claim onto an invite nobody had checked.
    expect(buildInvite({ ...target, categories: null, origin: 'x' })).not.toMatch(/Categories:/);
    expect(buildInvite({ ...target, categories: [], origin: 'x' })).toMatch(/All categories/);
  });
});

describe('§2 the deadline is measured from creation, not from today', () => {
  const created = '2026-06-07T09:00:00Z';           // 70 days before NOW
  const deadline = retentionDeadline(created);

  test('the deadline is exactly creation + 90 days', () => {
    expect(deadline.getTime()).toBe(Date.parse(created) + RETENTION_DAYS * DAY);
  });

  /*
    THE ASSERTION THE WHOLE RULE TURNS ON. Measured from today this date is
    fine — it is 80 days out and the limit is 90. Measured from creation it is
    ten days past the session's deletion. A version of this that used `now`
    would return 'ok' here and the warning would never appear in the place it
    matters most.
  */
  test('a date inside 90 days of TODAY but past the session is refused', () => {
    const at = new Date(NOW.getTime() + 80 * DAY).toISOString();
    expect(retentionStatus({ createdAt: created, at, now: NOW }).verdict)
      .toBe('beyond-deadline');
  });

  test('a date before the deadline is fine', () => {
    const at = new Date(NOW.getTime() + 5 * DAY).toISOString();
    expect(retentionStatus({ createdAt: created, at, now: NOW }).verdict).toBe('ok');
  });

  test('a date in the past is its own verdict, not the deadline one', () => {
    // Different mistakes need different sentences.
    const at = new Date(NOW.getTime() - DAY).toISOString();
    expect(retentionStatus({ createdAt: created, at, now: NOW }).verdict).toBe('past');
  });

  test('a session already past its own deadline says so', () => {
    expect(retentionStatus({ createdAt: '2026-01-01T00:00:00Z', now: NOW }).verdict)
      .toBe('session-expired');
  });

  test('an unreadable creation date is unknown, never ok', () => {
    // An all-clear we cannot justify is worse than admitting we do not know.
    expect(retentionStatus({ createdAt: undefined, now: NOW }).verdict).toBe('unknown');
    expect(retentionStatus({ createdAt: 'not a date', now: NOW }).verdict).toBe('unknown');
  });
});

describe('§3 the dialog', () => {
  test('it defaults to "Happening now" and shows what that inserts', () => {
    mount();
    expect(screen.getByRole('radio', { name: /Happening now/i })).toBeChecked();
    expect(preview()).toContain(NOW_LINE);
  });

  test('the date field appears only when a date is chosen', () => {
    mount();
    expect(screen.queryByLabelText('Date and time')).toBeNull();
    fireEvent.click(screen.getByRole('radio', { name: /At a date and time/i }));
    expect(screen.getByLabelText('Date and time')).toBeInTheDocument();
  });

  test('the preview follows the choice', () => {
    mount();
    fireEvent.click(screen.getByRole('radio', { name: /At a date and time/i }));
    fireEvent.change(screen.getByLabelText('Date and time'), {
      target: { value: '2026-08-20T14:30' },
    });
    expect(preview()).not.toContain(NOW_LINE);
    expect(preview()).toMatch(/August/);
  });

  test('a date past the deadline warns, and names the deadline', () => {
    mount();
    fireEvent.click(screen.getByRole('radio', { name: /At a date and time/i }));
    fireEvent.change(screen.getByLabelText('Date and time'), {
      target: { value: '2027-06-01T10:00' },
    });
    /*
      The deadline is NAMED, not merely alluded to — "that date is too late" on
      its own leaves the host guessing which date would not be. Read out of the
      warning's own text rather than matched against a typed string, so the
      assertion does not depend on how the runtime's locale spells a date.
    */
    const warning = screen.getByText(/after this session is deleted/i);
    expect(warning).toHaveTextContent(formatDeadline(retentionDeadline(target.createdAt)));
  });

  test('the warning does not block the copy', () => {
    // A dialog that refuses to do the thing it exists for is worse than one
    // that says what will happen. The host may have a reason.
    mount();
    fireEvent.click(screen.getByRole('radio', { name: /At a date and time/i }));
    fireEvent.change(screen.getByLabelText('Date and time'), {
      target: { value: '2027-06-01T10:00' },
    });
    expect(screen.getByRole('button', { name: /Copy invite/i })).toBeEnabled();
  });

  test('with no date chosen it states the deadline rather than warning', () => {
    mount();
    expect(screen.getByText(/kept until/i)).toBeInTheDocument();
  });

  test('the warning region is a live region, so it is announced', () => {
    const { container } = mount();
    expect(container.querySelector('[aria-live="polite"]')).toBeInTheDocument();
  });

  /*
    A dialog needs an exit at the TOP and at the BOTTOM, and one of them being
    dead is the failure people reach for first. Both are asserted separately
    and both must call the same handler — a first version of this test asked
    for a button named "Close" and got two, which is the right answer to the
    wrong question.
  */
  test('the X closes it', () => {
    const { container, onClose } = mount();
    fireEvent.click(container.querySelector('.inv__x'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('the footer Close closes it too, through the same handler', () => {
    const { container, onClose } = mount();
    const footer = container.querySelector('.inv__acts');
    fireEvent.click(within(footer).getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('no target renders nothing at all', () => {
    const { container } = render(<InviteDialog target={null} onClose={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('§4 copying', () => {
  const withClipboard = (impl) => {
    Object.assign(navigator, { clipboard: { writeText: impl } });
  };

  test('it copies exactly what the preview showed', async () => {
    const writeText = jest.fn().mockResolvedValue();
    withClipboard(writeText);
    mount();
    const shown = preview();
    await fireEvent.click(screen.getByRole('button', { name: /Copy invite/i }));
    expect(writeText).toHaveBeenCalledWith(shown);
  });

  test('a clipboard failure says so inline, never as an alert', async () => {
    // An alert() here is a second modal over the first, in front of a room.
    withClipboard(jest.fn().mockRejectedValue(new Error('denied')));
    mount();
    await fireEvent.click(screen.getByRole('button', { name: /Copy invite/i }));
    expect(await screen.findByText(/Could not reach the clipboard/i)).toBeInTheDocument();
  });
});

describe('§5 the stylesheet contracts jsdom cannot measure', () => {
  const fs = require('fs');
  const path = require('path');
  const CSS = fs
    .readFileSync(path.join(__dirname, '..', 'components', 'InviteDialog.css'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '');

  test('the scrim outranks both surfaces that can open it', () => {
    // `.setup-panel` is 1000 and `.new-game-overlay` is 10000. Below either,
    // the dialog opened from session history renders UNDER the screen that
    // opened it.
    const z = Number(CSS.match(/\.inv-scrim\s*\{[^}]*z-index:\s*(\d+)/)[1]);
    expect(z).toBeGreaterThan(10000);
  });

  test('the action group uses margin-left:auto, never flex-end', () => {
    expect(CSS).toMatch(/\.inv__acts\s*>\s*:first-child\s*\{[^}]*margin-left:\s*auto/);
    const group = CSS.slice(CSS.indexOf('.inv__acts {'));
    expect(group.slice(0, group.indexOf('}'))).not.toMatch(/justify-content:\s*flex-end/);
  });

  test('no destructive text uses --danger, which measures under AA', () => {
    expect(CSS).not.toMatch(/color:\s*var\(--danger\)\s*;/);
    expect(CSS).toMatch(/--danger-text/);
  });

  test('every selector is rooted at the scope', () => {
    const selectors = [...CSS.matchAll(/^(\.[^{]+)\{/gm)].map((m) => m[1].trim());
    expect(selectors.filter((s) => !s.includes('.inv'))).toEqual([]);
  });

  test('nothing drops below the 12px floor', () => {
    const sizes = [...CSS.matchAll(/font-size:\s*(\d+)px/g)].map((m) => Number(m[1]));
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(12);
  });

  test('the date input is at least 16px, so iOS does not zoom the page', () => {
    const rule = CSS.slice(CSS.indexOf('.inv__at input {'));
    const size = Number(rule.slice(0, rule.indexOf('}')).match(/font:[^;]*?(\d+)px/)[1]);
    expect(size).toBeGreaterThanOrEqual(16);
  });
});
