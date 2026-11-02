/**
 * THE SMALL CONFIRM DIALOG IN PLACE OF window.confirm (experience plan step 5b).
 *
 * `useConfirm()` (components/ConfirmDialog.jsx) asks a decision in a dialog built
 * on Modal and resolves true or false. These pin what a browser confirm gave for
 * free and what it never did: the keyboard (Escape cancels, Enter answers the
 * focused button, Tab stays inside), where focus starts (on the safe answer),
 * and where it goes back to (the button that asked).
 *
 * rejects: a window.confirm on the ten decision paths coming back; a confirm
 * that opens with focus on the destructive button; a confirm Escape cannot
 * leave; focus dropped on <body> afterwards.
 */
import React, { useState } from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useConfirm } from '../components/ConfirmDialog';

const D = require('../testing/driftScan');

function Asker({ onAnswer, danger = false }) {
  const [ask, dialog] = useConfirm();
  const [last, setLast] = useState('');
  const go = async () => {
    const yes = await ask({ title: 'Delete Sam’s account?', message: 'They would have to register again.', confirmText: 'Delete the account', danger });
    setLast(String(yes));
    onAnswer(yes);
  };
  return (
    <div>
      <button type="button" onClick={go}>Remove Sam</button>
      <output data-testid="last">{last}</output>
      {dialog}
    </div>
  );
}

describe('useConfirm', () => {
  test('opens a labelled dialog with the consequence, the safe answer focused', async () => {
    render(<Asker onAnswer={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove Sam' }));
    const dialog = await screen.findByRole('dialog', { name: 'Delete Sam’s account?' });
    expect(dialog).toHaveTextContent('They would have to register again.');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }));
  });

  test('the action resolves true and the dialog goes', async () => {
    const onAnswer = jest.fn();
    render(<Asker onAnswer={onAnswer} />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove Sam' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete the account' }));
    await waitFor(() => expect(onAnswer).toHaveBeenCalledWith(true));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  test.each([
    ['Cancel', () => fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))],
    ['the X', () => fireEvent.click(screen.getByRole('button', { name: 'Close' }))],
    ['Escape', () => fireEvent.keyDown(document.body, { key: 'Escape' })],
    ['the backdrop', () => fireEvent.click(document.querySelector('.ui-scrim'))],
  ])('%s resolves false', async (_name, leave) => {
    const onAnswer = jest.fn();
    render(<Asker onAnswer={onAnswer} />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove Sam' }));
    await screen.findByRole('dialog');
    leave();
    await waitFor(() => expect(onAnswer).toHaveBeenCalledWith(false));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  test('Enter on the focused Cancel cancels; Enter on the action confirms', async () => {
    const user = userEvent.setup();
    const onAnswer = jest.fn();
    render(<Asker onAnswer={onAnswer} />);
    await user.click(screen.getByRole('button', { name: 'Remove Sam' }));
    await screen.findByRole('dialog');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(onAnswer).toHaveBeenLastCalledWith(false));
    await user.click(screen.getByRole('button', { name: 'Remove Sam' }));
    await screen.findByRole('dialog');
    screen.getByRole('button', { name: 'Delete the account' }).focus();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(onAnswer).toHaveBeenLastCalledWith(true));
  });

  test('Tab stays inside the dialog', async () => {
    const user = userEvent.setup();
    render(<Asker onAnswer={() => {}} />);
    await user.click(screen.getByRole('button', { name: 'Remove Sam' }));
    const dialog = await screen.findByRole('dialog');
    for (let i = 0; i < 5; i += 1) {
      await user.tab();
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
  });

  test('focus goes back to the button that asked', async () => {
    render(<Asker onAnswer={() => {}} />);
    const opener = screen.getByRole('button', { name: 'Remove Sam' });
    opener.focus();
    fireEvent.click(opener);
    await screen.findByRole('dialog');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });

  test('danger paints the action destructive; no arrow hints on a decision', async () => {
    render(<Asker onAnswer={() => {}} danger />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove Sam' }));
    const ok = await screen.findByRole('button', { name: 'Delete the account' });
    expect(ok).toHaveClass('ui-btn--danger');
    expect(document.querySelector('.ui-confirm kbd')).toBeNull();
    // ArrowRight is not a yes on a decision dialog.
    fireEvent.keyDown(document.body, { key: 'ArrowRight' });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  test('the browser confirm is never called', async () => {
    const browser = jest.spyOn(window, 'confirm');
    render(<Asker onAnswer={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove Sam' }));
    await screen.findByRole('dialog');
    expect(browser).not.toHaveBeenCalled();
    browser.mockRestore();
  });

  test('a second ask while one is open answers the first with false', async () => {
    const answers = [];
    let ask;
    function Twice() {
      const [a, dialog] = useConfirm();
      ask = a;
      return dialog;
    }
    render(<Twice />);
    let first;
    let second;
    act(() => { first = ask({ title: 'One?' }); });
    act(() => { second = ask({ title: 'Two?' }); });
    first.then((v) => answers.push(['one', v]));
    await screen.findByRole('dialog', { name: 'Two?' });
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    await second.then((v) => answers.push(['two', v]));
    expect(answers).toEqual([['one', false], ['two', true]]);
  });
});

/* The ten (here twelve) decision confirms of step 5b, each now the dialog. */
describe('the decision paths ask in the dialog, not the browser', () => {
  const PATHS = [
    'AdminPage.jsx', 'GameHostPage.jsx', 'components/DiscountCodesPanel.jsx', 'components/DraftReview.jsx',
    'components/OrgBillingDrawer.jsx', 'components/OverviewPanel.jsx', 'components/PlanRequestsPanel.jsx',
    'components/PlatformOrgsPanel.jsx', 'components/UserManagement.jsx',
  ];
  test.each(PATHS)('%s: no window.confirm, and useConfirm in its place', (r) => {
    const src = D.read(r);
    expect(D.scanDialogs(src, r).filter((f) => /confirm/.test(f.literal))).toEqual([]);
    expect(src).toMatch(/useConfirm\(\)/);
    expect(src).toMatch(/\{confirmDialog\}/);
  });
});
