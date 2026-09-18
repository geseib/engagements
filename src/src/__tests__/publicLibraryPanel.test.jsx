import React from 'react';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import PublicLibraryPanel from '../components/PublicLibraryPanel';

const ROWS = [
  { id: 'orgacme-safety', name: 'Safety walkthrough', engagementType: 'trivia', totalQuestions: 30, canManage: false, scope: 'public', activeVersion: 2, sourceOrgName: 'Acme', sensitivity: ['graphic-medical'] },
  { id: 'mine', name: 'Mine', engagementType: 'trivia', totalQuestions: 5, canManage: true, scope: 'org', activeVersion: 1 },
  { id: 'engage', name: 'Engage one', engagementType: 'poll', totalQuestions: 9, canManage: false, scope: 'platform', activeVersion: 1 },
];

test('the org library lists only public sets, says who published each, and offers Preview and Copy', () => {
  const onCopy = jest.fn(); const onPreview = jest.fn();
  render(<PublicLibraryPanel questionSets={ROWS} mode="org" onCopy={onCopy} onPreview={onPreview} />);
  expect(screen.getByText(/your own published sets appear here too/i)).toBeInTheDocument();
  expect(screen.getByText('Safety walkthrough')).toBeInTheDocument();
  expect(screen.queryByText('Mine')).toBeNull();
  expect(screen.queryByText('Engage one')).toBeNull();
  const row = screen.getByText('Safety walkthrough').closest('tr');
  expect(within(row).getByText('Public')).toHaveAttribute('title', expect.stringMatching(/Acme/));
  fireEvent.click(within(row).getByRole('button', { name: /copy to my team/i }));
  expect(onCopy).toHaveBeenCalledWith(expect.objectContaining({ id: 'orgacme-safety' }));
  fireEvent.click(within(row).getByRole('button', { name: /^preview$/i }));
  expect(onPreview).toHaveBeenCalledWith(expect.objectContaining({ id: 'orgacme-safety' }));
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
