/**
 * CREATING A TEAM.
 *
 * The switcher has offered "Create an organisation" since it was drawn, and it
 * pointed at `window.location.href = '/admin?section=members'` — the members of
 * the organisation you are already in, and in platform mode a section that does
 * not exist. `POST /orgs` was wired and authorized the whole time and nothing
 * in the product ever called it. Reported from dev as "the add organisation
 * does not work".
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import CreateOrgDialog from '../components/CreateOrgDialog';

jest.mock('../auth/authFetch', () => ({
  __esModule: true,
  authFetch: (...args) => global.fetch(...args),
  setActiveOrgId: jest.fn(),
}));

beforeEach(() => { window.API_BASE = 'https://api.test/'; });

const type = (value) => fireEvent.change(
  screen.getByLabelText(/name/i), { target: { value } },
);

describe('the dialog', () => {
  // rejects: the dead link. This is the whole point — it has to reach POST /orgs.
  it('posts the name to /orgs', async () => {
    const calls = [];
    global.fetch = jest.fn(async (url, init) => {
      calls.push({ url: String(url), body: JSON.parse(init.body || '{}') });
      return { ok: true, status: 201, json: async () => ({ orgId: 'org_9xK4Fq7Pz2mNbVc8dQwLxR' }) };
    });
    const onCreated = jest.fn();
    render(<CreateOrgDialog onClose={jest.fn()} onCreated={onCreated} />);
    type('Northwind Learning');
    fireEvent.click(screen.getByRole('button', { name: /create team/i }));

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].url).toBe('https://api.test/orgs');
    expect(calls[0].body).toEqual({ name: 'Northwind Learning' });
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(
      'org_9xK4Fq7Pz2mNbVc8dQwLxR', expect.any(Object),
    ));
  });

  // rejects: posting an empty or whitespace name, which the server refuses with
  // a 400 the person then has to interpret.
  it('will not submit an empty name', () => {
    global.fetch = jest.fn();
    render(<CreateOrgDialog onClose={jest.fn()} />);
    expect(screen.getByRole('button', { name: /create team/i })).toBeDisabled();
    type('   ');
    expect(screen.getByRole('button', { name: /create team/i })).toBeDisabled();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  // rejects: swallowing the server's refusal. A name that collides, or an
  // account that may not create one, has to say so.
  it('shows what the server said when it refuses', async () => {
    global.fetch = jest.fn(async () => ({
      ok: false, status: 400, json: async () => ({ error: 'Keep the name under 80 characters.' }),
    }));
    render(<CreateOrgDialog onClose={jest.fn()} />);
    type('A team');
    fireEvent.click(screen.getByRole('button', { name: /create team/i }));
    expect(await screen.findByRole('alert'))
      .toHaveTextContent('Keep the name under 80 characters.');
    // and it lets you try again rather than staying stuck in the busy state
    expect(screen.getByRole('button', { name: /create team/i })).not.toBeDisabled();
  });

  // rejects: a dialog with only one way out, and one that can be dismissed
  // mid-write leaving the caller unsure whether the team exists.
  it('has an X and a Cancel, and neither works while it is writing', async () => {
    let release;
    global.fetch = jest.fn(() => new Promise((resolve) => { release = resolve; }));
    const onClose = jest.fn();
    render(<CreateOrgDialog onClose={onClose} />);
    expect(screen.getByRole('button', { name: /close/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();

    type('A team');
    fireEvent.click(screen.getByRole('button', { name: /create team/i }));
    await waitFor(() => expect(screen.getByRole('button', { name: /cancel/i })).toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onClose).not.toHaveBeenCalled();
    release({ ok: true, status: 201, json: async () => ({ orgId: 'org_x' }) });
  });
});
