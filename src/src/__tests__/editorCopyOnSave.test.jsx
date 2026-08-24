/**
 * SAVING SOMEBODY ELSE'S SET MAKES IT YOURS.
 *
 * Reported: "when i go to save a copy of someone elses set (in this case an
 * engage set) it is not obvious that i have to change something besides just a
 * name and cant use the save button under the main settings of the question set
 * … it should be fine to use the save button up top and it should do the same
 * copy action."
 *
 * Engage's shared library and other organisations' published sets are readable
 * by everyone and writable by nobody but their owner. Opening one in the editor
 * and pressing Save meant a 403 — and before the platform-mode interlock, an
 * Engage admin standing in a team silently edited the library every
 * organisation reads.
 *
 * Two separate complaints in one sentence, and both are answered: the SAVE now
 * copies, and the screen says so BEFORE the press rather than after.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

jest.mock('../auth/authFetch', () => ({
  __esModule: true,
  authFetch: (...args) => global.fetch(...args),
}));

import QuestionSetEditor from '../components/QuestionSetEditor';

const ENGAGE_SET = {
  id: '80strivia',
  name: '80s Trivia',
  description: 'A shared set.',
  scope: 'platform',
  canManage: false,
  engagementType: 'trivia',
  totalQuestions: 10,
};
const MY_SET = { ...ENGAGE_SET, id: 'teamretro', name: 'Team Retro', scope: 'org', canManage: true };

/** Records every write the editor makes, in order. */
function serve({ copyOk = true } = {}) {
  const calls = [];
  global.fetch = jest.fn(async (url, init = {}) => {
    const href = String(url);
    if (init.method === 'POST' && href.includes('/copy')) {
      calls.push({ kind: 'copy', href, body: JSON.parse(init.body || '{}') });
      return copyOk
        ? { ok: true, status: 201, json: async () => ({ setId: '80strivia2', name: '80s Trivia (ours)' }) }
        : { ok: false, status: 403, json: async () => ({ error: 'You are not a member of this organisation.' }) };
    }
    if (init.method === 'PUT') {
      calls.push({ kind: 'edit', href, body: JSON.parse(init.body || '{}') });
      return { ok: true, status: 200, json: async () => ({ updated: { name: true } }) };
    }
    return { ok: true, status: 200, json: async () => ({ questions: [], categories: [], versions: [] }) };
  });
  return calls;
}

beforeEach(() => { window.API_BASE = 'https://api.test/'; });

const draw = (set, props = {}) => render(
  <QuestionSetEditor questionSet={set} onSaved={jest.fn()} onCopied={jest.fn()} {...props} />,
);
/* The DETAILS save. The Questions panel below has its own copy control already
   — "Save as my own copy…", with a naming step — so the two are named
   differently on purpose: this one saves the settings form, that one saves the
   questions. */
const saveButton = () => screen.getByRole('button', { name: /save details as my copy|save changes/i });

describe('a set that is not yours', () => {
  // rejects: leaving the person to discover it at the moment of pressing, or
  // after a 403. This is the "it is not obvious" half of the report.
  it('says so on arrival, before anything is typed', () => {
    serve();
    draw(ENGAGE_SET);
    const notice = screen.getByTestId('not-yours-notice');
    expect(notice).toHaveTextContent(/belongs to Engage/i);
    expect(notice).toHaveTextContent(/makes your organisation its own copy/i);
    expect(notice).toHaveTextContent(/leaves the original exactly as it is/i);
  });

  // rejects: a button that says "Save Changes" and does something else.
  it('names the action on the button', () => {
    serve();
    draw(ENGAGE_SET);
    expect(saveButton()).toHaveTextContent(/save details as my copy/i);
  });

  // rejects: THE REPORT. Save used to PUT straight at the original.
  it('copies first, then applies the edit to the COPY', async () => {
    const calls = serve();
    draw(ENGAGE_SET);
    fireEvent.click(saveButton());

    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[0].kind).toBe('copy');
    expect(calls[0].href).toContain('/question-sets/80strivia/copy');
    expect(calls[0].body).toEqual({ scope: 'platform' });

    // The edit lands on the NEW id, never the original.
    expect(calls[1].kind).toBe('edit');
    expect(calls[1].href).toContain('/admin/edit-question-set/80strivia2');
    expect(calls[1].href).not.toContain('edit-question-set/80strivia?');
  });

  // rejects: reporting success when the copy failed, and leaving a half-done
  // write behind. Copy first is the safe order precisely because of this.
  it('stops and says why when the copy is refused, editing nothing', async () => {
    const calls = serve({ copyOk: false });
    draw(ENGAGE_SET);
    fireEvent.click(saveButton());

    await waitFor(() => expect(screen.getByText(/Could not make your copy/i)).toBeInTheDocument());
    expect(screen.getByText(/not a member of this organisation/i)).toBeInTheDocument();
    expect(calls.filter((c) => c.kind === 'edit')).toHaveLength(0);
  });

  /*
    ONE COPY, NOT TWO. The Questions panel below is still holding whatever was
    typed into it; if the editor CLOSED on a copy, that work would either be
    lost or saved afterwards against the original — making a second copy of the
    same set.
  */
  // rejects: closing the editor on a copy, which orphans the questions panel.
  it('hands back the new id so the editor rebinds to the copy', async () => {
    serve();
    const onCopied = jest.fn();
    const onSaved = jest.fn();
    draw(ENGAGE_SET, { onCopied, onSaved });
    fireEvent.click(saveButton());

    await waitFor(() => expect(onCopied).toHaveBeenCalled());
    expect(onCopied.mock.calls[0][0]).toBe('80strivia2');
    expect(onCopied.mock.calls[0][1]).toMatch(/own copy/i);
    // and NOT the close-the-editor path
    expect(onSaved).not.toHaveBeenCalled();
  });

  // rejects: a public set being described as Engage's.
  it('names another organisation when the set is a public one', () => {
    serve();
    draw({ ...ENGAGE_SET, scope: 'public' });
    expect(screen.getByTestId('not-yours-notice')).toHaveTextContent(/another organisation/i);
  });
});

describe('a set that IS yours', () => {
  // rejects: turning every ordinary save into a copy, which would fill an
  // organisation with duplicates of its own work.
  it('saves in place, with no copy call and no notice', async () => {
    const calls = serve();
    draw(MY_SET);
    expect(screen.queryByTestId('not-yours-notice')).toBeNull();
    expect(saveButton()).toHaveTextContent(/save changes/i);

    fireEvent.click(saveButton());
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].kind).toBe('edit');
    expect(calls[0].href).toContain('/admin/edit-question-set/teamretro');
  });

  /*
    `canManage` ABSENT is not the same as `canManage: false`. Some surfaces do
    not project ownership at all; those rows must keep behaving exactly as they
    did rather than silently becoming copy-on-save.
  */
  // rejects: treating a row from an ownership-blind surface as somebody else's.
  it('a row with no canManage at all saves in place', async () => {
    const { canManage, ...noOwnership } = MY_SET;
    const calls = serve();
    draw(noOwnership);
    expect(screen.queryByTestId('not-yours-notice')).toBeNull();
    fireEvent.click(saveButton());
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].kind).toBe('edit');
  });
});
