/**
 * THE DATA & PRIVACY SCREEN, RENDERED — components/PrivacyPanel.jsx.
 *
 * Zero `jest.mock` calls, like podium / welcomeScreen / adminShell: the panel is
 * pure props and callbacks precisely so it can be mounted. `AdminPage.jsx`
 * cannot be — `useAuth` hard-throws outside the real Cognito provider — so a
 * surface that only exists inside it is a surface nobody can test.
 *
 * NO GEOMETRIC ASSERTIONS. jsdom has no layout engine; every width and offset is
 * zero and would pass unconditionally. Geometry lives in
 * privacyPanelPalette.test.js, read out of the stylesheet as text.
 */
import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PrivacyPanel, { HONEST_LIMIT, DEFAULT_ENCRYPTION } from '../components/PrivacyPanel';

const ORG = { id: 'org-northwind', name: 'Northwind Learning' };

const ENTRIES = [
  {
    id: 'a1',
    who: { name: 'Dai Ferreira', kind: 'engage', affiliation: 'Engage staff' },
    what: 'Support access, granted by Amara Reyes',
    reason: '“Report shows no responses for round 3” — ticket NW-1183',
    touched: 'Sessions from 2–3 August',
    when: '12 Aug, expired after 4 hours',
  },
  {
    id: 'a2',
    who: { name: 'Jonah Osei', kind: 'member', affiliation: 'Northwind Learning' },
    what: 'Exported a session report',
    reason: null,
    touched: 'Delivery retro, 28 July',
    when: '28 July',
  },
];

const mount = (props = {}) => render(
  <PrivacyPanel
    org={ORG}
    accessLog={{ entries: ENTRIES }}
    onExport={jest.fn()}
    onDelete={jest.fn()}
    {...props}
  />,
);

describe('the promise the page makes', () => {
  // rejects: somebody softening the honest limit into "we cannot read your
  //          data". That claim is FALSE while anyone holds the AWS account, and
  //          a customer who discovers it has learned something worse than the
  //          limit itself. What is true — and what the access log below proves —
  //          is that we cannot do it QUIETLY.
  test('it states the limit honestly and does not claim we cannot read the data', () => {
    mount();
    expect(screen.getByText(new RegExp(HONEST_LIMIT.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/we (can ?not|cannot|can't) read your data/i);
  });

  // rejects: the encryption section drifting into a marketing version of the
  //          boundary. Category names and access codes ARE customer content and
  //          ARE stored in the clear (tenant-crypto.js: the mask is addressed
  //          positionally by the stored names), so the page says so.
  test('it names what is NOT encrypted, including the awkward parts', () => {
    mount();
    expect(screen.getByText(/Not encrypted/)).toBeInTheDocument();
    expect(DEFAULT_ENCRYPTION.notEncrypted).toMatch(/category names/i);
    expect(DEFAULT_ENCRYPTION.notEncrypted).toMatch(/timestamps/i);
    expect(document.body.textContent).toMatch(/category names/i);
  });

  // rejects: the log being presented as something the customer or we could
  //          tidy. An editable record is not a record.
  test('it says the log cannot be edited or cleared, by either side', () => {
    mount();
    expect(screen.getByText(/cannot be edited or cleared, by you\s+or by us/i)).toBeInTheDocument();
  });
});

describe('the access log', () => {
  // rejects: splitting our access and theirs into two tables. Two reads as a
  //          surveillance panel; one reads as a record, and it answers "who
  //          exported that report?" on the same screen.
  test('our access and the customer’s own share one table', () => {
    mount();
    expect(screen.getAllByRole('table')).toHaveLength(1);
    const rows = within(screen.getByRole('table')).getAllByRole('row');
    expect(rows).toHaveLength(ENTRIES.length + 1);
    expect(screen.getByText('Dai Ferreira')).toBeInTheDocument();
    expect(screen.getByText('Jonah Osei')).toBeInTheDocument();
  });

  // rejects: dropping the reason. A support-access row without the free-text
  //          reason is "somebody looked", which is worse than no row at all.
  test('a support-access row carries the reason that was given, in full', () => {
    mount();
    expect(screen.getByText('“Report shows no responses for round 3” — ticket NW-1183')).toBeInTheDocument();
  });

  // rejects: every row carrying the four facts the record is made of.
  test('each row carries who, what, what it touched and when', () => {
    mount();
    const row = screen.getByText('Support access, granted by Amara Reyes').closest('tr');
    expect(within(row).getByText('Dai Ferreira')).toBeInTheDocument();
    expect(within(row).getByText('Engage staff')).toBeInTheDocument();
    expect(within(row).getByText('Sessions from 2–3 August')).toBeInTheDocument();
    expect(within(row).getByText('12 Aug, expired after 4 hours')).toBeInTheDocument();
  });

  // rejects: an empty log reading as a broken screen. "Nobody has read
  //          anything" is a GOOD state and the best one this page can report.
  test('an empty log says nobody has read anything, and does not look like a failure', () => {
    mount({ accessLog: { entries: [] } });
    expect(screen.getByText(/Nobody at Engage has read anything/i)).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/could not be loaded|try again|error/i);
  });

  // rejects: a failed fetch being rendered as an empty log. That is the one lie
  //          this page cannot afford: it would report "nobody read anything"
  //          when the truth is "we do not know".
  test('a failed load is not shown as an empty log', () => {
    mount({ accessLog: { error: 'The request timed out.', entries: [] } });
    expect(screen.getByText(/could not be loaded/i)).toBeInTheDocument();
    expect(screen.getByText(/display failure, not an empty log/i)).toBeInTheDocument();
    expect(screen.queryByText(/Nobody at Engage has read anything/i)).not.toBeInTheDocument();
  });

  // rejects: loading and empty sharing one sentence.
  test('loading is its own state', () => {
    mount({ accessLog: { loading: true, entries: [] } });
    expect(screen.getByText(/Loading the access log/i)).toBeInTheDocument();
    expect(screen.queryByText(/Nobody at Engage has read anything/i)).not.toBeInTheDocument();
  });
});

describe('leaving', () => {
  // rejects: export being turned back into a conversation. A retention promise
  //          is only credible if leaving is self-service; an email address in
  //          this flow is a negotiation.
  test('export is one click and asks for nothing', async () => {
    const onExport = jest.fn();
    mount({ onExport });
    const btn = screen.getByRole('button', { name: /Export everything/i });
    await userEvent.click(btn);
    expect(onExport).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  // rejects: delete happening on one click. Type-to-confirm is spent here on
  //          purpose — the console permits it exactly twice.
  test('delete needs the organisation’s name typed, and does nothing until it matches', async () => {
    const onDelete = jest.fn();
    mount({ onDelete });
    await userEvent.click(screen.getByRole('button', { name: /Delete Northwind Learning/i }));

    const confirm = screen.getByRole('button', { name: /Delete for ever/i });
    expect(confirm).toBeDisabled();

    await userEvent.type(screen.getByLabelText(/Type .*to confirm/i), 'Northwind');
    expect(confirm).toBeDisabled();
    expect(onDelete).not.toHaveBeenCalled();

    await userEvent.type(screen.getByLabelText(/Type .*to confirm/i), ' Learning');
    expect(confirm).toBeEnabled();
    await userEvent.click(confirm);
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  // rejects: a destructive dialog that ranks severity ("this is dangerous")
  //          instead of stating what happens, and one that fails to offer the
  //          reversible neighbour.
  test('the dialog states the consequence and offers export first', async () => {
    mount();
    await userEvent.click(screen.getByRole('button', { name: /Delete Northwind Learning/i }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/encryption key is deleted/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/access log survives/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/cannot be undone/i)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: /Export everything/i })).toBeInTheDocument();
  });

  // rejects: the dead-X trap of commit 4fd425d6 — a dialog whose only exit is
  //          one control, or whose X does nothing. Both exits route through one
  //          requestClose.
  test('the dialog has an X and a bottom exit, and both close it', async () => {
    mount();
    const open = () => userEvent.click(screen.getByRole('button', { name: /Delete Northwind Learning/i }));

    await open();
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /close/i }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await open();
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /Keep Northwind Learning/i }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  // rejects: a live X during the delete. Unmounting mid-flight removes the only
  //          surface that can report the outcome — a deliberately dead control,
  //          which is allowed exactly when it is a decision.
  test('while the delete is in flight the exits are disabled, not removed', async () => {
    mount({ deleting: true });
    await userEvent.click(screen.getByRole('button', { name: /Delete Northwind Learning/i }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('button', { name: /close/i })).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: /Keep Northwind Learning/i })).toBeDisabled();
  });

  // rejects: a delete failure vanishing because the dialog closed itself. The
  //          page reports it where the person is looking.
  test('a delete failure is reported inside the dialog', async () => {
    mount({ deleteError: 'The organisation still has an unpaid invoice.' });
    await userEvent.click(screen.getByRole('button', { name: /Delete Northwind Learning/i }));
    expect(within(screen.getByRole('dialog')).getByText(/unpaid invoice/i)).toBeInTheDocument();
  });
});

describe('the endpoints it does not have yet', () => {
  // rejects: a wired-looking control with nothing behind it. Until AdminPage
  //          passes a callback the button says so by being disabled rather than
  //          swallowing the click.
  test('with no callbacks the destructive and export controls are inert and say so', () => {
    render(<PrivacyPanel org={ORG} accessLog={{ entries: [] }} />);
    expect(screen.getByRole('button', { name: /Export everything/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Delete Northwind Learning/i })).toBeDisabled();
  });
});
