import React from 'react';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import PublicLibraryPanel from '../components/PublicLibraryPanel';

const ROWS = [
  { id: 'orgacme-safety', name: 'Safety walkthrough', engagementType: 'trivia', totalQuestions: 30, canManage: false, scope: 'public', activeVersion: 2, sourceOrgName: 'Acme', sensitivity: ['graphic-medical'] },
  { id: 'mine', name: 'Mine', engagementType: 'trivia', totalQuestions: 5, canManage: true, scope: 'org', activeVersion: 1 },
  { id: 'engage', name: 'Engage one', engagementType: 'poll', totalQuestions: 9, canManage: false, scope: 'platform', activeVersion: 1 },
];

/*
  THE WAY IN — the owner's first report: *"there is a new set button on the
  admin page for public library. it does not seem to do anything."*

  It really did nothing. `QuestionSetsPanel`'s header renders a primary button
  wired to `onCreate && onCreate('new')`, and this panel mounts that table with
  no `onCreate` at all, so the guard short-circuited on every click, in both
  consoles. The design system's rule 2 is exactly this case: a dead control is
  the one people reach for first, so gate the affordance on the handler.

  What replaces it is not a rename. The verb the rest of this flow already uses
  is Share (QuestionSetsPanel's row action, title "Submit the active version for
  the content check; it goes public if it passes"), and the way into the public
  library from the public library is to offer THIS ORGANISATION'S OWN sets with
  that same action beside each.
*/
describe('the way into the public library', () => {
  const SHAREABLE = [
    ...ROWS,
    { id: 'mine-2', name: 'Onboarding week one', engagementType: 'poll', totalQuestions: 8, canManage: true, scope: 'org', activeVersion: 3 },
  ];

  test('there is no dead New set button left on either console', () => {
    for (const mode of ['org', 'platform']) {
      const { unmount } = render(
        <PublicLibraryPanel questionSets={SHAREABLE} mode={mode} onCopy={() => {}} onPreview={() => {}} onShare={() => {}} onOpenScoreCard={() => {}} onUnpublish={() => {}} />,
      );
      expect(screen.queryByRole('button', { name: /new set/i })).toBeNull();
      unmount();
    }
  });

  test('the org console offers Share a set, and it lists this organisation\'s own sets rather than the public rows', async () => {
    render(<PublicLibraryPanel questionSets={SHAREABLE} mode="org" onCopy={() => {}} onPreview={() => {}} onShare={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /share a set/i }));
    const dialog = await screen.findByRole('dialog');
    // The sets this organisation can actually submit — the same rows whose own
    // list row offers Share (`canManage !== false`).
    expect(within(dialog).getByText('Mine')).toBeInTheDocument();
    expect(within(dialog).getByText('Onboarding week one')).toBeInTheDocument();
    // Not a set that is already public, and not Engage's.
    expect(within(dialog).queryByText('Safety walkthrough')).toBeNull();
    expect(within(dialog).queryByText('Engage one')).toBeNull();
  });

  test('Share inside it runs the same callback the list row action runs, and closes the picker so two dialogs never stack', async () => {
    const onShare = jest.fn();
    render(<PublicLibraryPanel questionSets={SHAREABLE} mode="org" onCopy={() => {}} onPreview={() => {}} onShare={onShare} />);
    fireEvent.click(screen.getByRole('button', { name: /share a set/i }));
    const dialog = await screen.findByRole('dialog');
    const row = within(dialog).getByText('Onboarding week one').closest('li');
    fireEvent.click(within(row).getByRole('button', { name: /^share$/i }));
    expect(onShare).toHaveBeenCalledWith(expect.objectContaining({ id: 'mine-2' }));
    // Never a modal opened from inside a modal (admin-container-rule.md): the
    // picker is gone by the time the share dialog its caller opens arrives.
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  test('the picker has both exits, and its per-row Share carries the row action\'s own words', async () => {
    render(<PublicLibraryPanel questionSets={SHAREABLE} mode="org" onCopy={() => {}} onPreview={() => {}} onShare={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /share a set/i }));
    let dialog = await screen.findByRole('dialog');
    expect(within(dialog).getAllByRole('button', { name: /^share$/i })[0])
      .toHaveAttribute('title', expect.stringMatching(/content check/i));
    fireEvent.click(within(dialog).getByRole('button', { name: /^close$/i }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    fireEvent.click(screen.getByRole('button', { name: /share a set/i }));
    dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: /^cancel$/i }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  test('the way in is there when the public library is still empty, which is when it matters most', () => {
    render(<PublicLibraryPanel questionSets={SHAREABLE.filter((r) => r.scope !== 'public')} mode="org" onCopy={() => {}} onPreview={() => {}} onShare={() => {}} />);
    expect(screen.getByText(/nobody has published a set yet/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /share a set/i })).toBeInTheDocument();
  });

  test('an organisation with nothing of its own is told so rather than shown an empty box', async () => {
    render(<PublicLibraryPanel questionSets={ROWS.filter((r) => r.scope !== 'org')} mode="org" onCopy={() => {}} onPreview={() => {}} onShare={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /share a set/i }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent(/no sets of your own/i);
    expect(within(dialog).queryByRole('button', { name: /^share$/i })).toBeNull();
  });

  /*
    ENGAGE'S OWN LIBRARY DOES NOT SHARE, so the staff console gets no way in
    rather than a second one that would be refused. check-question-set.js:62
    is explicit: for a platform set `publish` is false, always — "There is no
    public copy of an Engage set."
  */
  test('the staff console offers no way in, because Engage has nothing to submit', () => {
    render(<PublicLibraryPanel questionSets={SHAREABLE} mode="platform" onOpenScoreCard={() => {}} onUnpublish={() => {}} />);
    expect(screen.queryByRole('button', { name: /share a set/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /new set/i })).toBeNull();
  });

  /*
    THE CROSS-SCOPE CLASS TRAP, which QuestionSetsPanel.css:58-63 records: an
    undefined custom property invalidates the WHOLE declaration, and every
    `.qsets-chip--vis-*` colour is `var(--qsets-…)`, declared on `.qsets`.
    Modal renders no portal, so the picker's card is a child of `.publib` —
    which declares none of them. The card opts into the `.qsets` scope the same
    way QuestionSetUploadPanel and QuestionSetDeleteDialog do, by carrying the
    class itself.
  */
  test('the picker opts into the .qsets scope the chips it draws take their colours from', async () => {
    render(<PublicLibraryPanel questionSets={SHAREABLE} mode="org" onCopy={() => {}} onPreview={() => {}} onShare={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /share a set/i }));
    const dialog = await screen.findByRole('dialog');
    const chip = dialog.querySelector('[class*="qsets-chip"]');
    expect(chip).not.toBeNull();
    expect(chip.closest('.qsets')).not.toBeNull();
  });
});

test('the org library lists only public sets, says who published each, and offers Preview and Copy', () => {
  const onCopy = jest.fn(); const onPreview = jest.fn();
  render(<PublicLibraryPanel questionSets={ROWS} mode="org" onCopy={onCopy} onPreview={onPreview} />);
  expect(screen.getByText(/your own published sets appear here too/i)).toBeInTheDocument();
  expect(screen.getByText('Safety walkthrough')).toBeInTheDocument();
  expect(screen.queryByText('Mine')).toBeNull();
  expect(screen.queryByText('Engage one')).toBeNull();
  const row = screen.getByText('Safety walkthrough').closest('tr');
  /*
    RULING R20 — the publisher is TEXT, not a tooltip.

    This used to read `Acme` off the owner chip's `title`, which is a hover: a
    tablet cannot produce one, and nobody scanning a library for a team they
    recognise finds a name they have to hunt for with a pointer.
    `docs/design/tenancy-redesign/07-public-library.html` prints it as a
    sub-line, and so does the row now.
  */
  expect(within(row).getByText(/by Acme/)).toBeInTheDocument();
  fireEvent.click(within(row).getByRole('button', { name: /copy to my team/i }));
  expect(onCopy).toHaveBeenCalledWith(expect.objectContaining({ id: 'orgacme-safety' }));
  fireEvent.click(within(row).getByRole('button', { name: /^preview$/i }));
  expect(onPreview).toHaveBeenCalledWith(expect.objectContaining({ id: 'orgacme-safety' }));
});
/*
  RULING R20 — DEAD CONTROLS ON A SCREEN THAT CANNOT DRIVE THEM.

  QuestionSetsPanel's State cell carries Active and Quickstart as BUTTONS wired
  to `onToggleActive` / `onToggleQuickstart`. This panel passes neither, so both
  rendered on every public row as live-looking controls that did precisely
  nothing when clicked — and a public set is not this organisation's to
  activate in the first place. The whole column goes when `rowActions` is given.
*/
test('a public row offers no Active or Quickstart toggle, in either console', () => {
  for (const mode of ['org', 'platform']) {
    const { unmount } = render(<PublicLibraryPanel questionSets={ROWS} mode={mode} onCopy={() => {}} onPreview={() => {}} onOpenScoreCard={() => {}} onUnpublish={() => {}} />);
    const row = screen.getByText('Safety walkthrough').closest('tr');
    expect(within(row).queryByRole('button', { name: /^active$|^inactive$/i })).toBeNull();
    expect(within(row).queryByRole('button', { name: /quickstart/i })).toBeNull();
    expect(screen.queryByRole('columnheader', { name: /^state$/i })).toBeNull();
    unmount();
  }
});
test('and the staff console names the publisher in text too', () => {
  render(<PublicLibraryPanel questionSets={ROWS} mode="platform" onOpenScoreCard={() => {}} onUnpublish={() => {}} />);
  const row = screen.getByText('Safety walkthrough').closest('tr');
  expect(within(row).getByText(/by Acme/)).toBeInTheDocument();
});
/*
  Every other callback into this panel is optional and guarded — `onCopy`,
  `onPreview`, `onOpenScoreCard` all read `cb && cb(...)`. `onUnpublish` was
  not, so a caller that omitted it turned its own omission into a TypeError
  raised INSIDE the dialog, whose error path would then have shown a reviewer
  the words "onUnpublish is not a function" beside a note they had just typed.
*/
test('a missing onUnpublish closes the dialog instead of showing the reviewer a TypeError', async () => {
  render(<PublicLibraryPanel questionSets={ROWS} mode="platform" onOpenScoreCard={() => {}} />);
  const row = screen.getByText('Safety walkthrough').closest('tr');
  fireEvent.click(within(row).getByRole('button', { name: /^unpublish$/i }));
  const dialog = await screen.findByRole('dialog');
  fireEvent.change(within(dialog).getByRole('textbox', { name: /note/i }), { target: { value: 'Taken down.' } });
  fireEvent.click(within(dialog).getByRole('button', { name: /^unpublish$/i }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(screen.queryByRole('alert')).toBeNull();
});
test('an empty public library says so honestly', () => {
  render(<PublicLibraryPanel questionSets={ROWS.filter((r) => r.scope !== 'public')} mode="org" onCopy={() => {}} onPreview={() => {}} />);
  expect(screen.getByText(/nobody has published a set yet/i)).toBeInTheDocument();
});
test('the staff library offers the score card and Unpublish behind a stated consequence with a required note', async () => {
  const onUnpublish = jest.fn(); const onOpenScoreCard = jest.fn();
  render(<PublicLibraryPanel questionSets={ROWS} mode="platform" onOpenScoreCard={onOpenScoreCard} onUnpublish={onUnpublish} />);
  const row = screen.getByText('Safety walkthrough').closest('tr');
  fireEvent.click(within(row).getByRole('button', { name: /score card/i }));
  expect(onOpenScoreCard).toHaveBeenCalledWith('orgacme-safety');
  fireEvent.click(within(row).getByRole('button', { name: /^unpublish$/i }));
  const dialog = await screen.findByRole('dialog');
  expect(dialog).toHaveTextContent(/gone for everyone/i);
  expect(dialog).toHaveTextContent(/keeps their copy and sees your note/i);
  const confirm = within(dialog).getByRole('button', { name: /^unpublish$/i });
  expect(confirm).toBeDisabled();
  fireEvent.change(within(dialog).getByRole('textbox', { name: /note/i }), { target: { value: 'Reported; taken down pending an edit.' } });
  fireEvent.click(confirm);
  await waitFor(() => expect(onUnpublish).toHaveBeenCalledWith(expect.objectContaining({ id: 'orgacme-safety' }), 'Reported; taken down pending an edit.'));
  fireEvent.click(within(dialog).getByRole('button', { name: /^close$/i }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
});

/*
  R16 AND R17, THE SAME TWO RULINGS ScoreCard's TakedownDialog (task-10) AND
  ModerationPanel's ReviewDialog (task-9) ALREADY CARRY — not in the brief's
  literal Step 1 block, added per the task's own instructions, in the same
  shape as scoreCard.test.jsx's two tests of the same name so a reader who
  knows one dialog recognises the other.

  Note the footer button here is "Cancel", not the brief's literal "Close":
  the dialog's X carries `aria-label="Close"` (the app's default, per
  ScoreCard/ArchivePanel/ShareSetDialog/CreateOrgDialog/…), and the brief's
  own Step 1 test above looks up that X afterwards via
  `getByRole('button', { name: /^close$/i })` — which only resolves to a
  single element because the footer does NOT also answer to "Close". Naming
  both controls "Close" is exactly the collision ModerationPanel's `.modq-x`
  comment documents (task-9-report.md) and resolves the other way (renaming
  the X to "Close review" instead); ScoreCard resolves it the way this dialog
  does, and R16's own wording — "the bottom Cancel" — says which way this one
  goes.
*/
test('a typed note survives an accidental Escape, but a deliberate Cancel still works (R16)', async () => {
  render(<PublicLibraryPanel questionSets={ROWS} mode="platform" onOpenScoreCard={() => {}} onUnpublish={() => {}} />);
  const row = screen.getByText('Safety walkthrough').closest('tr');
  fireEvent.click(within(row).getByRole('button', { name: /^unpublish$/i }));
  const dialog = await screen.findByRole('dialog');
  fireEvent.change(within(dialog).getByRole('textbox', { name: /note/i }), { target: { value: 'Still drafting this.' } });
  // Accidental exit, gated on the unsaved note: the dialog must stay open.
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(screen.getByRole('dialog')).toBeInTheDocument();
  // Deliberate exit, through requestClose: still works regardless of the note.
  fireEvent.click(within(dialog).getByRole('button', { name: /^cancel$/i }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
});
test('a failed unpublish keeps the dialog, the note and the message; a retry that succeeds closes it (R17)', async () => {
  const onUnpublish = jest.fn()
    .mockRejectedValueOnce(new Error('boom'))
    .mockResolvedValueOnce(undefined);
  render(<PublicLibraryPanel questionSets={ROWS} mode="platform" onOpenScoreCard={() => {}} onUnpublish={onUnpublish} />);
  const row = screen.getByText('Safety walkthrough').closest('tr');
  fireEvent.click(within(row).getByRole('button', { name: /^unpublish$/i }));
  const dialog = await screen.findByRole('dialog');
  const note = within(dialog).getByRole('textbox', { name: /note/i });
  fireEvent.change(note, { target: { value: 'Reported; taken down pending an edit.' } });

  fireEvent.click(within(dialog).getByRole('button', { name: /^unpublish$/i }));
  expect(await within(dialog).findByRole('alert')).toHaveTextContent(/boom/i);
  expect(screen.getByRole('dialog')).toBeInTheDocument();
  expect(note).toHaveValue('Reported; taken down pending an edit.');
  expect(within(dialog).getByRole('button', { name: /^unpublish$/i })).not.toBeDisabled();

  fireEvent.click(within(dialog).getByRole('button', { name: /^unpublish$/i }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(onUnpublish).toHaveBeenCalledTimes(2);
  expect(onUnpublish.mock.calls[0][0]).toEqual(expect.objectContaining({ id: 'orgacme-safety' }));
  expect(onUnpublish.mock.calls[0][1]).toBe('Reported; taken down pending an edit.');
  expect(onUnpublish.mock.calls[1][1]).toBe('Reported; taken down pending an edit.');
});
