/**
 * The player side of the two-Chrises defect.
 *
 * PlayerPage.test.jsx cannot render — it dies on the auth provider in jsdom —
 * so the join refusal lives in a component of its own and is tested here,
 * along with the two pure pieces the page leans on: the id that lets the
 * server tell a returning player from a namesake, and the reading of the
 * server's refusal.
 *
 * The behaviours pinned, and what breaks each:
 *   - NAME_TAKEN offers no way through. Add a "continue anyway" button and the
 *     first assertion fails — that button is the silent merge, restored.
 *   - NAME_UNVERIFIED asks rather than assumes, and each answer is wired to a
 *     different handler. Swap them and the click assertions fail.
 *   - the id is minted once and kept per session. Mint per call and the
 *     stability assertion fails; key it globally and the per-game assertion
 *     fails; both would break reconnection or leak a cross-session handle.
 *   - the refusal is read off `code`, not off the status. Match on 409 alone
 *     and the two 409s become one screen.
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import JoinNameCollision from '../components/JoinNameCollision';
import { getClientId, clientIdStorageKey, classifyJoinFailure } from '../components/joinResult';

const memoryStorage = () => {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    size: () => map.size,
  };
};

describe('JoinNameCollision', () => {
  it('refuses a taken name without offering a way to take it anyway', () => {
    render(
      <JoinNameCollision
        kind="name-taken"
        playerName="Chris"
        message='Someone in this session is already answering as "Chris".'
        onRejoinAnyway={() => {}}
        onUseAnotherName={() => {}}
      />
    );

    expect(screen.getByText('That name is taken.')).toBeInTheDocument();
    expect(
      screen.getByText(/already answering as "Chris"/)
    ).toBeInTheDocument();

    // The whole point: one way out, and it is not "join as them".
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toHaveTextContent('Pick a different name');
  });

  it('announces the refusal rather than leaving it to be noticed', () => {
    const { container } = render(
      <JoinNameCollision
        kind="name-taken"
        playerName="Chris"
        message="taken"
        onRejoinAnyway={() => {}}
        onUseAnotherName={() => {}}
      />
    );
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
  });

  it('asks the ambiguous case instead of guessing', () => {
    render(
      <JoinNameCollision
        kind="name-unverified"
        playerName="Chris"
        message="If that was you on another device, rejoin."
        onRejoinAnyway={() => {}}
        onUseAnotherName={() => {}}
      />
    );

    expect(screen.getByText('Are you the Chris already here?')).toBeInTheDocument();
    expect(screen.getAllByRole('button')).toHaveLength(2);
  });

  it('wires each answer to its own handler', () => {
    const onRejoinAnyway = jest.fn();
    const onUseAnotherName = jest.fn();
    render(
      <JoinNameCollision
        kind="name-unverified"
        playerName="Chris"
        message="…"
        onRejoinAnyway={onRejoinAnyway}
        onUseAnotherName={onUseAnotherName}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /yes — rejoin as chris/i }));
    expect(onRejoinAnyway).toHaveBeenCalledTimes(1);
    expect(onUseAnotherName).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /different chris/i }));
    expect(onUseAnotherName).toHaveBeenCalledTimes(1);
    expect(onRejoinAnyway).toHaveBeenCalledTimes(1);
  });
});

describe('getClientId', () => {
  it('mints once and returns the same id thereafter', () => {
    const storage = memoryStorage();
    const first = getClientId('4821', storage);
    expect(first).toBeTruthy();
    // If this were minted per call, every reconnect would look like a
    // different Chris and lock the player out of their own row.
    expect(getClientId('4821', storage)).toBe(first);
  });

  it('keeps a separate id per session', () => {
    const storage = memoryStorage();
    const a = getClientId('4821', storage);
    const b = getClientId('9137', storage);
    expect(a).not.toBe(b);
    expect(storage.getItem(clientIdStorageKey('4821'))).toBe(a);
    expect(storage.getItem(clientIdStorageKey('9137'))).toBe(b);
  });

  it('returns null rather than throwing when storage is unavailable', () => {
    const hostile = {
      getItem: () => { throw new Error('SecurityError'); },
      setItem: () => { throw new Error('SecurityError'); },
    };
    // Private-mode Safari. Joining has to still work — the server falls back
    // to its legacy path when no id is presented.
    expect(getClientId('4821', hostile)).toBeNull();
    expect(getClientId('4821', null)).toBeNull();
  });
});

describe('classifyJoinFailure', () => {
  it('separates the two 409s by code, not by status', () => {
    expect(
      classifyJoinFailure(409, { code: 'NAME_TAKEN', playerName: 'Chris', message: 'm' }).kind
    ).toBe('name-taken');
    expect(
      classifyJoinFailure(409, { code: 'NAME_UNVERIFIED', playerName: 'Chris', message: 'm' }).kind
    ).toBe('name-unverified');
  });

  it('carries the server\'s wording through to the player', () => {
    const result = classifyJoinFailure(409, {
      code: 'NAME_TAKEN', playerName: 'Chris', message: 'Add a last initial.',
    });
    expect(result.message).toBe('Add a last initial.');
    expect(result.playerName).toBe('Chris');
  });

  it('still recognises the pre-existing access code refusal', () => {
    // Matched on the exact string join-game.js sends; the access code screen
    // is reached through this and nothing else.
    expect(
      classifyJoinFailure(401, { error: 'Access code required', message: 'code plz' }).kind
    ).toBe('access-code');
  });

  it('distinguishes a missing session from a session not yet started', () => {
    expect(classifyJoinFailure(404, { error: 'Game not found' }).kind).toBe('not-found');
    expect(
      classifyJoinFailure(403, { error: 'Game not started', message: 'wait' }).kind
    ).toBe('not-started');
  });

  it('falls back to a readable message when the body is not JSON', () => {
    const result = classifyJoinFailure(502, null);
    expect(result.kind).toBe('error');
    expect(result.message).toMatch(/try again/i);
  });
});
