/**
 * DELETING A QUESTION SET — components/QuestionSetDeleteDialog.jsx
 *
 * THE DEFECT. `questionSetDeleteStatus` was assigned in six places in
 * `AdminPage.jsx` and rendered in none; `isDeletingQuestionSet` was assigned
 * twice and read nowhere; and `confirmDeleteQuestionSet` closed the modal on its
 * FIRST LINE, before the request was sent. A delete that failed was therefore
 * pixel-for-pixel identical to one that succeeded — the dialog vanished, the set
 * stayed in the list, and the reason lived only in the console.
 *
 * This file replaces `questionSetDeleteFeedback.test.jsx`, which asserted the
 * same behaviour by mounting `AdminPage` behind a mocked `AuthContext`. Every
 * rejection it carried is carried here, against a component that renders on its
 * own — the SessionsPanel pattern: one mocked module, a `jsonResponse` helper,
 * and a router that throws on an unmatched URL.
 *
 * NO GEOMETRIC ASSERTIONS. jsdom has no layout engine.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import QuestionSetDeleteDialog from '../components/QuestionSetDeleteDialog';
import { authFetch } from '../auth/authFetch';

jest.mock('../auth/authFetch', () => ({ authFetch: jest.fn() }));

const SET = {
  id: 'lessons-learned',
  name: 'Q3 Leadership Offsite',
  engagementType: 'call-and-answer',
  totalQuestions: 42,
  categoryCount: 24,
  active: true,
};

const jsonResponse = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
  text: async () => JSON.stringify(body),
});

/** Every request this dialog can make. An unmatched URL throws, so a stray
 *  request cannot pass silently as an empty response. */
function mockApi({ deleteStatus = 200, body = null, hang = false } = {}) {
  let release;
  authFetch.mockImplementation(async (url, options = {}) => {
    const method = (options.method || 'GET').toUpperCase();
    if (method === 'DELETE' && url.includes('/admin/question-sets/')) {
      if (hang) await new Promise((resolve) => { release = resolve; });
      return deleteStatus === 200
        ? jsonResponse(200, body || { message: 'Deleted question set "Q3 Leadership Offsite"' })
        : jsonResponse(deleteStatus, body || { error: 'Set is in use by an active game' });
    }
    throw new Error(`Unhandled request: ${method} ${url}`);
  });
  return () => release && release();
}

const mount = (props = {}) =>
  render(<QuestionSetDeleteDialog questionSet={SET} onCancel={jest.fn()} {...props} />);

const dialog = () => screen.getByRole('dialog');
const confirmButton = () => within(dialog()).getByRole('button', { name: /delete the set|try again|deleting/i });

beforeEach(() => {
  authFetch.mockReset();
  window.API_BASE = 'https://api.example.test/dev/';
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

/* ------------------------------------------------------ before you press it */

describe('what the dialog says before anything is sent', () => {
  test('it names the set and states what is in it', () => {
    // rejects: "Are you sure you want to delete the question set X? This will
    // permanently remove all questions and categories. This action cannot be
    // undone!" — severity with no quantity. RATIONALE §8: count before you ask.
    mockApi();
    mount();
    expect(within(dialog()).getByText(/42 questions in 24 categories/i)).toBeInTheDocument();
    expect(within(dialog()).getByText(/Q3 Leadership Offsite/)).toBeInTheDocument();
  });

  test('it states the report consequence, which is true whether or not B1 exists', () => {
    // create-report.js builds a report from the LIVE set the first time it is
    // asked for, so deleting a set decides which past sessions can still produce
    // one. rejects: waiting for B1's per-session list before saying anything
    // about reports at all — the sentence is unconditionally true today.
    mockApi();
    mount();
    expect(within(dialog()).getByText(/report is built from the live set/i)).toBeInTheDocument();
  });

  test('it offers the reversible neighbour for an active set', () => {
    // RATIONALE §8: nine times in ten "delete this set" means "stop offering it
    // to hosts", which is what the Active toggle already does. rejects: a dialog
    // that offers only the destructive option — naming the alternative prevents
    // more damage than any amount of red.
    const onDeactivate = jest.fn();
    mockApi();
    mount({ onDeactivate });
    fireEvent.click(within(dialog()).getByRole('button', { name: /deactivate/i }));
    expect(onDeactivate).toHaveBeenCalledWith(expect.objectContaining({ id: 'lessons-learned' }));
    expect(authFetch).not.toHaveBeenCalled();
  });

  test('an already-inactive set is not offered deactivation', () => {
    // rejects: offering an alternative that has already been taken, which reads
    // as a second thing to do and is not one.
    mockApi();
    mount({ questionSet: { ...SET, active: false }, onDeactivate: jest.fn() });
    expect(within(dialog()).queryByRole('button', { name: /deactivate/i })).toBeNull();
  });
});

/* ---------------------------------------------------------------- in flight */

describe('while the request is in flight', () => {
  test('the dialog is still open and both buttons are disabled', () => {
    // rejects: dropping the busy guard, which lets a double-click fire a second
    // DELETE while the first is in flight. `isDeletingQuestionSet` existed for
    // this and was never read.
    const release = mockApi({ hang: true });
    mount();
    fireEvent.click(confirmButton());
    return waitFor(() => {
      expect(within(dialog()).getByRole('button', { name: /deleting/i })).toBeDisabled();
      expect(within(dialog()).getByRole('button', { name: /keep it/i })).toBeDisabled();
    }).then(() => release());
  });

  test('clicking the scrim does not close a delete that is running', () => {
    // rejects: a dismissable scrim during the request, which would unmount the
    // only surface that can report the outcome.
    const onCancel = jest.fn();
    const release = mockApi({ hang: true });
    mount({ onCancel });
    fireEvent.click(confirmButton());
    fireEvent.click(document.querySelector('.qsets-scrim'));
    expect(onCancel).not.toHaveBeenCalled();
    release();
  });

  test('Escape does not close a delete that is running either', () => {
    // The shared <Modal> gives every dialog an Escape it did not have before.
    // rejects: wiring Escape past the gate the scrim above obeys — a second way
    // out that skips the check is the same defect, through a different door.
    const onCancel = jest.fn();
    const release = mockApi({ hang: true });
    mount({ onCancel });
    fireEvent.click(confirmButton());
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onCancel).not.toHaveBeenCalled();
    release();
  });
});

/* ------------------------------------------------------- the ways out of it */

describe('dismissing it', () => {
  test('Escape cancels while nothing has been sent', () => {
    // The dialog shipped with no keyboard way out at all. rejects: dropping
    // Escape when the gate is added — the gate exists to hold it back during
    // the request, not to remove it.
    const onCancel = jest.fn();
    mockApi();
    mount({ onCancel });
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  test('a completed delete is closed by acknowledgement, not by Escape', async () => {
    // The outcome banner is the whole point of the dialog surviving the
    // request. rejects: letting Escape dismiss the success screen, which puts
    // the operator back exactly where the original defect left them — the
    // dialog went away and nothing said what happened.
    const onCancel = jest.fn();
    const onDeleted = jest.fn();
    mockApi();
    mount({ onCancel, onDeleted });
    fireEvent.click(confirmButton());
    await within(dialog()).findByText(/Deleted question set/i);

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onCancel).not.toHaveBeenCalled();
    expect(onDeleted).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});

/* ----------------------------------------------------------------- outcomes */

describe('the outcome, which used to be invisible', () => {
  test('it sends DELETE to the set’s own id, and nothing else', async () => {
    mockApi();
    mount();
    fireEvent.click(confirmButton());
    await waitFor(() => expect(authFetch).toHaveBeenCalled());
    expect(authFetch.mock.calls[0][0]).toBe(
      'https://api.example.test/dev/admin/question-sets/lessons-learned'
    );
    expect(authFetch.mock.calls[0][1].method).toBe('DELETE');
  });

  test('a 500 leaves the dialog open with the reason, and does not report success', async () => {
    // THE headline rejection: restoring the unconditional
    // setShowQuestionSetDeleteConfirm(false) at the top of the handler, and
    // removing the outcome banner from the dialog body. Either one makes a
    // failed delete look exactly like a successful one.
    const onDeleted = jest.fn();
    mockApi({ deleteStatus: 500 });
    mount({ onDeleted });
    fireEvent.click(confirmButton());

    expect(await within(dialog()).findByRole('alert')).toHaveTextContent(
      /Delete failed: Set is in use by an active game/i
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(onDeleted).not.toHaveBeenCalled();
  });

  test('a failed delete can be retried from the dialog it left open', async () => {
    // rejects: an outcome screen with no way forward, which forces the operator
    // back to the list to find the row again.
    mockApi({ deleteStatus: 500 });
    mount();
    fireEvent.click(confirmButton());
    await within(dialog()).findByRole('alert');
    expect(within(dialog()).getByRole('button', { name: /try again/i })).toBeEnabled();
  });

  test('a request that throws is reported in the same place', async () => {
    // rejects: a catch that logs and swallows. The network branch has to reach
    // the same surface as the !ok branch or one of the two is invisible.
    authFetch.mockImplementation(() => Promise.reject(new Error('Network down')));
    mount();
    fireEvent.click(confirmButton());
    expect(await within(dialog()).findByRole('alert')).toHaveTextContent(/Delete failed: Network down/i);
  });

  test('a 200 reports what was deleted and closes only on acknowledgement', async () => {
    // rejects: closing on the response. Success and failure both have to produce
    // something to read — the whole complaint was that "the dialog went away"
    // was the only signal either way.
    const onDeleted = jest.fn();
    mockApi();
    mount({ onDeleted });
    fireEvent.click(confirmButton());

    await within(dialog()).findByText(/Deleted question set "Q3 Leadership Offsite"/i);
    expect(onDeleted).not.toHaveBeenCalled();
    expect(within(dialog()).queryByRole('button', { name: /delete the set/i })).toBeNull();

    fireEvent.click(within(dialog()).getByRole('button', { name: /done/i }));
    expect(onDeleted).toHaveBeenCalledWith(
      expect.stringMatching(/Deleted question set "Q3 Leadership Offsite"/)
    );
  });

  test('failure is an alert and success is not', async () => {
    // rejects: an outcome rendered in one undifferentiated tone — the original
    // complaint, in its most literal form. `role` is the assistive-technology
    // half of the same distinction the colour makes.
    mockApi();
    const { unmount } = mount();
    fireEvent.click(confirmButton());
    await within(dialog()).findByText(/Deleted question set/i);
    expect(within(dialog()).queryByRole('alert')).toBeNull();
    unmount();

    mockApi({ deleteStatus: 500 });
    mount();
    fireEvent.click(confirmButton());
    expect(await within(dialog()).findByRole('alert')).toBeInTheDocument();
  });

  test('a 200 with no message still says something', async () => {
    // delete-question-set.js answers with a `message`, but a body that lost it
    // must not produce an empty banner and a Done button with nothing above it.
    mockApi({ body: {} });
    mount();
    fireEvent.click(confirmButton());
    expect(await within(dialog()).findByText(/Deleted “Q3 Leadership Offsite”/)).toBeInTheDocument();
  });
});
