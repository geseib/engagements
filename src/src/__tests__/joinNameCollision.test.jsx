/**
 * The player side of the two-Chrises defect.
 *
 * PlayerPage.test.jsx cannot render — it dies on the auth provider in jsdom —
 * so the join refusal lives in a component of its own and is tested here,
 * along with the two pure pieces the page leans on: the id that lets the
 * server tell a returning player from a namesake, and the reading of the
 * server's refusal.
 *
 * THE REFUSAL IS TWO EXPORTS NOW, and the tests follow the seam. The body
 * (heading + sentence) renders into `.plr-stage`; the actions render into
 * `.plr-dock`, which sits outside the one scrolling region so the player is
 * never asked to scroll to get unstuck — every other ACT state on this surface
 * already worked that way, and this was the exception. The button contracts
 * below are unchanged; they are simply asserted on the export that renders the
 * buttons. That the two halves are wired into the same shell, in that order, is
 * asserted where it can only be true or false in situ:
 * `playerSurface.test.jsx` › "the join refusal".
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
import JoinNameCollision, {
  JoinNameCollisionActions, handoverNote,
} from '../components/JoinNameCollision';
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
    const onRejoinAnyway = jest.fn();
    render(
      <>
        <JoinNameCollision
          kind="name-taken"
          playerName="Chris"
          message='Someone in this session is already answering as "Chris".'
        />
        <JoinNameCollisionActions
          kind="name-taken"
          playerName="Chris"
          onRejoinAnyway={onRejoinAnyway}
          onUseAnotherName={() => {}}
          onRequestHandover={() => {}}
          onTakeOver={() => {}}
        />
      </>
    );

    expect(screen.getByText('That name is taken.')).toBeInTheDocument();
    expect(
      screen.getByText(/already answering as "Chris"/)
    ).toBeInTheDocument();

    /* THIS USED TO COUNT ONE BUTTON, and the count was a proxy for the rule
       rather than the rule. There are two now — ask, or rename — and the rule
       is asserted directly: nothing here claims the name, and in particular
       `onRejoinAnyway`, the unconditional claim the NAME_UNVERIFIED screen
       wires up, is not reachable from this one. Wiring it here would be the
       silent merge restored, and a button count would not have noticed. */
    const labels = screen.getAllByRole('button').map((b) => b.textContent.trim());
    expect(labels).toEqual(['Ask the host to hand it over', 'Pick a different name']);
    for (const button of screen.getAllByRole('button')) fireEvent.click(button);
    expect(onRejoinAnyway).not.toHaveBeenCalled();
  });

  it('does not offer a takeover until the person has asked for one', () => {
    const onRequestHandover = jest.fn();
    const onTakeOver = jest.fn();
    const { rerender } = render(
      <JoinNameCollisionActions
        kind="name-taken"
        playerName="Chris"
        handoverStage="idle"
        onRequestHandover={onRequestHandover}
        onTakeOver={onTakeOver}
        onUseAnotherName={() => {}}
      />
    );

    // The step is the guard. A person who mistyped a colleague's name is never
    // one tap away from taking their round.
    fireEvent.click(screen.getByRole('button', { name: /ask the host/i }));
    expect(onRequestHandover).toHaveBeenCalledTimes(1);
    expect(onTakeOver).not.toHaveBeenCalled();

    rerender(
      <JoinNameCollisionActions
        kind="name-taken"
        playerName="Chris"
        handoverStage="asked"
        onRequestHandover={onRequestHandover}
        onTakeOver={onTakeOver}
        onUseAnotherName={() => {}}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /take over the name/i }));
    expect(onTakeOver).toHaveBeenCalledTimes(1);
    expect(onRequestHandover).toHaveBeenCalledTimes(1);
    // Still exactly two ways out — the rename never disappears, because a
    // person who cannot get the name back must always be able to leave.
    expect(screen.getAllByRole('button')).toHaveLength(2);
  });

  it('will not fire the same handover step twice while one is in flight', () => {
    const onTakeOver = jest.fn();
    render(
      <JoinNameCollisionActions
        kind="name-taken"
        playerName="Chris"
        handoverStage="asked"
        busy
        onTakeOver={onTakeOver}
        onRequestHandover={() => {}}
        onUseAnotherName={() => {}}
      />
    );
    // A double tap would send two claims, and the second would try to spend a
    // grant the first already had.
    const takeOver = screen.getByRole('button', { name: /take over the name/i });
    expect(takeOver).toBeDisabled();
    fireEvent.click(takeOver);
    expect(onTakeOver).not.toHaveBeenCalled();
  });

  it('says what happened after each handover step, and never says "error"', () => {
    const { rerender } = render(
      <JoinNameCollision kind="name-taken" playerName="Chris" message="taken" handoverStage="idle" />
    );
    // Nothing narrated before the person has done anything.
    expect(screen.queryByText(/when they say go ahead/i)).toBeNull();

    rerender(
      <JoinNameCollision kind="name-taken" playerName="Chris" message="taken" handoverStage="asked" />
    );
    expect(screen.getByText(/asked the host to hand/i)).toBeInTheDocument();

    rerender(
      <JoinNameCollision kind="name-taken" playerName="Chris" message="taken" handoverStage="refused" />
    );
    // "Not yet", not "something went wrong": the host simply has not got to it,
    // and only one of those two readings tells the person what to do next.
    const note = screen.getByText(/has not unlocked/i);
    expect(note).toBeInTheDocument();
    expect(note.textContent).toMatch(/ask them out loud/i);
    expect(note.textContent).not.toMatch(/error|failed|sorry/i);
  });

  it('keeps the note and the button describing the same step', () => {
    // Two copies of one condition is how a screen ends up asking a question
    // its buttons do not answer, which is why both halves read `handoverStage`.
    for (const stage of ['idle', 'asked', 'refused']) {
      const view = render(
        <>
          <JoinNameCollision kind="name-taken" playerName="Chris" message="m" handoverStage={stage} />
          <JoinNameCollisionActions kind="name-taken" playerName="Chris" handoverStage={stage} />
        </>
      );
      const label = screen.getAllByRole('button')[0].textContent.trim();
      const narrated = Boolean(handoverNote(stage, 'Chris'));
      expect(label === 'Take over the name').toBe(narrated);
      view.unmount();
    }
  });

  it('leaves the ambiguous refusal exactly as it was', () => {
    // The handover belongs to NAME_TAKEN. NAME_UNVERIFIED is a row the server
    // cannot attribute at all, so there is nobody to take it FROM and no host
    // decision to make — offering a handover there would be asking the host to
    // adjudicate a question that has no second party.
    render(
      <JoinNameCollisionActions
        kind="name-unverified"
        playerName="Chris"
        handoverStage="asked"
        onRejoinAnyway={() => {}}
        onUseAnotherName={() => {}}
        onRequestHandover={() => {}}
        onTakeOver={() => {}}
      />
    );
    expect(screen.getAllByRole('button').map((b) => b.textContent.trim())).toEqual([
      'Yes — rejoin as Chris',
      "No — I'm a different Chris",
    ]);
    expect(screen.queryByText(/hand it over/i)).toBeNull();
  });

  it('dresses the ways out as this surface dresses every other primary action', () => {
    // They were `.btn-primary`/`.btn-secondary`/`.btn-large` from the
    // `styles.css` monolith — paper-theme buttons on a dusk shell, next to a
    // sentence painted #444 at 1.79:1 on --bg. The dock vocabulary is
    // `.plr-btn`, and the second choice is the ghost, exactly as the rejoin
    // prompt renders the same pair of choices.
    render(
      <JoinNameCollisionActions
        kind="name-unverified"
        playerName="Chris"
        onRejoinAnyway={() => {}}
        onUseAnotherName={() => {}}
      />
    );

    const [yes, no] = screen.getAllByRole('button');
    expect(yes).toHaveClass('plr-btn');
    expect(yes).not.toHaveClass('plr-btn--ghost');
    expect(no).toHaveClass('plr-btn', 'plr-btn--ghost');
    for (const button of screen.getAllByRole('button')) {
      expect(button.className).not.toMatch(/btn-primary|btn-secondary|btn-large/);
    }
  });

  it('states the refusal at the ladder, not at a viewport-keyed clamp', () => {
    // The heading was `clamp(1.3rem, 6vw, 1.9rem)` in a stylesheet of its own —
    // a fourth ladder on a surface RATIONALE §3.3 gives exactly three literal
    // ones, keyed to a `.join-screen` container that no longer exists.
    render(
      <JoinNameCollision kind="name-taken" playerName="Chris" message="taken" />
    );
    const heading = screen.getByText('That name is taken.');
    expect(heading).toHaveClass('plr-h1', 'plr-h1--primary');
    expect(screen.getByText('taken')).toHaveClass('plr-lede', 'plr-muted');
  });

  it('announces the refusal rather than leaving it to be noticed', () => {
    const { container } = render(
      <JoinNameCollision
        kind="name-taken"
        playerName="Chris"
        message="taken"
      />
    );
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
  });

  it('asks the ambiguous case instead of guessing', () => {
    render(
      <>
        <JoinNameCollision
          kind="name-unverified"
          playerName="Chris"
          message="If that was you on another device, rejoin."
        />
        <JoinNameCollisionActions
          kind="name-unverified"
          playerName="Chris"
          onRejoinAnyway={() => {}}
          onUseAnotherName={() => {}}
        />
      </>
    );

    expect(screen.getByText('Are you the Chris already here?')).toBeInTheDocument();
    expect(screen.getAllByRole('button')).toHaveLength(2);
  });

  it('wires each answer to its own handler', () => {
    const onRejoinAnyway = jest.fn();
    const onUseAnotherName = jest.fn();
    render(
      <JoinNameCollisionActions
        kind="name-unverified"
        playerName="Chris"
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
