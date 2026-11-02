/**
 * The player side of the two-Chrises defect, and of moving a name to a new
 * device (experience plan §4.4).
 *
 * PlayerPage.test.jsx cannot render — it dies on the auth provider in jsdom —
 * so the join refusal lives in a component of its own and is tested here,
 * along with the two pure pieces the page leans on: the id that lets the
 * server tell a returning player from a namesake, and the reading of the
 * server's refusal. The wait itself (the quiet retry, Ask again, the lapse)
 * is `useHandoverFlow`'s and is pinned in useHandoverFlow.test.jsx; the page
 * wiring in playerNameMove.test.jsx.
 *
 * THE REFUSAL IS TWO EXPORTS, and the tests follow the seam: the body renders
 * into `.plr-stage`, the actions into `.plr-dock`.
 *
 * The behaviours pinned, and what breaks each:
 *   - NAME_TAKEN offers no way through in ANY stage. Add a "continue anyway"
 *     button and the stage walk fails — that button is the silent merge.
 *   - the screen never says "Asked" for an ask that failed.
 *   - Ask again is offered only when the flow says it may be.
 *   - NAME_UNVERIFIED asks rather than assumes, and each answer is wired to a
 *     different handler.
 *   - the id is minted once and kept per session.
 *   - the refusal is read off `code`, not off the status.
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import JoinNameCollision, {
  JoinNameCollisionActions, handoverCopy, HANDOVER_LABELS,
} from '../components/JoinNameCollision';
import NameMoved, { NameMovedActions, NAME_MOVED_LABEL } from '../components/NameMoved';
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

const STAGES = ['idle', 'asking', 'askFailed', 'waiting', 'granted', 'declined', 'lapsed'];
const labelsOf = () => screen.queryAllByRole('button').map((b) => b.textContent.trim());

function actions(stage, extra = {}) {
  const handlers = {
    onRejoinAnyway: jest.fn(),
    onUseAnotherName: jest.fn(),
    onRequestHandover: jest.fn(),
  };
  const view = render(
    <JoinNameCollisionActions kind="name-taken" playerName="Chris" stage={stage} {...handlers} {...extra} />
  );
  return { ...handlers, view };
}

describe('JoinNameCollision — the refusal', () => {
  it('says the name is already here and offers to move it, or to pick another', () => {
    render(
      <JoinNameCollision
        kind="name-taken"
        playerName="Chris"
        message='Someone in this session is already answering as "Chris".'
      />
    );
    expect(screen.getByRole('heading', { name: 'Chris is already in this session.' })).toBeInTheDocument();
    expect(screen.getByText(/already answering as "Chris"/)).toBeInTheDocument();
    const { view } = actions('idle');
    expect(labelsOf()).toEqual(["That's me: use my name on this device", "I'm someone else: pick another name"]);
    view.unmount();
  });

  // rejects: a button that TAKES the name, in any stage, or the unconditional
  //          claim the NAME_UNVERIFIED screen wires up leaking into this one.
  it.each(STAGES)('stage %s: nothing here claims the name', (stage) => {
    const { onRejoinAnyway, onRequestHandover, onUseAnotherName } = actions(stage, { canAskAgain: true });
    for (const label of labelsOf()) {
      expect(label).not.toMatch(/take over|take it|anyway|rejoin/i);
    }
    for (const button of screen.queryAllByRole('button')) fireEvent.click(button);
    expect(onRejoinAnyway).not.toHaveBeenCalled();
    // Every press is an ask or a way out, never anything else.
    const presses = onRequestHandover.mock.calls.length + onUseAnotherName.mock.calls.length;
    expect(presses).toBe(screen.queryAllByRole('button').filter((b) => !b.disabled).length);
  });

  // rejects: a person who cannot get the name being left with no way out.
  it.each(STAGES.filter((s) => s !== 'granted'))('stage %s: a way to pick another name is always there', (stage) => {
    actions(stage);
    expect(labelsOf().some((l) => /pick another name/i.test(l))).toBe(true);
  });

  // rejects: a double tap sending two asks.
  it('disables the ask while it is in flight', () => {
    const { onRequestHandover } = actions('asking');
    const button = screen.getByRole('button', { name: HANDOVER_LABELS.asking });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(onRequestHandover).not.toHaveBeenCalled();
  });

  // rejects: "Asked the host" over an ask that never arrived (audit C §3.2).
  it('a failed ask says so, with Try again, and never says it asked', () => {
    render(<JoinNameCollision kind="name-taken" playerName="Chris" message="m" stage="askFailed" error="Your request did not reach the host." />);
    expect(screen.getByText('Your request did not reach the host.')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/asked|waiting/i);
    const { onRequestHandover } = actions('askFailed');
    fireEvent.click(screen.getByRole('button', { name: HANDOVER_LABELS.tryAgain }));
    expect(onRequestHandover).toHaveBeenCalledTimes(1);
  });

  it('while waiting it says who it is waiting for, how long ago it asked, and that it moves on by itself', () => {
    render(<JoinNameCollision kind="name-taken" playerName="Chris" message="m" stage="waiting" agoText="0:20" />);
    expect(screen.getByRole('heading', { name: 'Waiting for the host to let you in as Chris.' })).toBeInTheDocument();
    expect(screen.getByText('Asked 0:20 ago.')).toHaveAttribute('aria-live', 'polite');
    expect(screen.getByText(/moves on by itself/)).toBeInTheDocument();
  });

  // rejects: Ask again before the minute is up (pestering) or never (stuck).
  it('Ask again appears only when the flow allows it', () => {
    const early = actions('waiting', { canAskAgain: false });
    expect(labelsOf()).toEqual([HANDOVER_LABELS.pickAnother]);
    early.view.unmount();
    const late = actions('waiting', { canAskAgain: true });
    expect(labelsOf()).toEqual([HANDOVER_LABELS.askAgain, HANDOVER_LABELS.pickAnother]);
    fireEvent.click(screen.getByRole('button', { name: HANDOVER_LABELS.askAgain }));
    expect(late.onRequestHandover).toHaveBeenCalledTimes(1);
  });

  it('after Not now, picking another name is the main button and Ask again waits', () => {
    render(<JoinNameCollision kind="name-taken" playerName="Chris" message="m" stage="declined" />);
    expect(screen.getByRole('heading', { name: 'The host said not now.' })).toBeInTheDocument();
    expect(screen.getByText('If this is you, ask them in person.')).toBeInTheDocument();
    const first = actions('declined', { canAskAgain: false });
    const [main] = screen.getAllByRole('button');
    expect(main.textContent).toBe(HANDOVER_LABELS.pickAnother);
    expect(main).not.toHaveClass('ui-btn--quiet');
    expect(labelsOf()).toEqual([HANDOVER_LABELS.pickAnother]);
    first.view.unmount();
    actions('declined', { canAskAgain: true });
    expect(labelsOf()).toEqual([HANDOVER_LABELS.pickAnother, HANDOVER_LABELS.askAgain]);
    expect(screen.getByRole('button', { name: HANDOVER_LABELS.askAgain })).toHaveClass('ui-btn--quiet');
  });

  it('a lapsed ask says the host has not answered, with Ask again or another name', () => {
    render(<JoinNameCollision kind="name-taken" playerName="Chris" message="m" stage="lapsed" />);
    expect(screen.getByRole('heading', { name: "The host hasn't answered." })).toBeInTheDocument();
    actions('lapsed');
    expect(labelsOf()).toEqual([HANDOVER_LABELS.askAgain, HANDOVER_LABELS.pickAnother]);
  });

  it('granted says the answers and score came along, and offers nothing to press', () => {
    render(<JoinNameCollision kind="name-taken" playerName="Chris" message="m" stage="granted" />);
    expect(screen.getByRole('heading', { name: "You're in as Chris." })).toBeInTheDocument();
    expect(screen.getByText('Your answers and score came with you.')).toBeInTheDocument();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    actions('granted');
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('never narrates an "error" for the host simply not having answered', () => {
    for (const stage of ['waiting', 'declined', 'lapsed']) {
      const copy = handoverCopy({ stage, playerName: 'Chris', agoText: '1:00' });
      expect(`${copy.heading} ${copy.lede} ${copy.note || ''}`).not.toMatch(/error|failed|sorry|wrong/i);
    }
  });

  it('leaves the ambiguous refusal exactly as it was', () => {
    render(
      <JoinNameCollisionActions
        kind="name-unverified"
        playerName="Chris"
        stage="waiting"
        onRejoinAnyway={() => {}}
        onUseAnotherName={() => {}}
        onRequestHandover={() => {}}
      />
    );
    expect(labelsOf()).toEqual(['Yes — rejoin as Chris', "No — I'm a different Chris"]);
  });

  it('wires each ambiguous answer to its own handler', () => {
    const onRejoinAnyway = jest.fn();
    const onUseAnotherName = jest.fn();
    render(
      <JoinNameCollisionActions kind="name-unverified" playerName="Chris" onRejoinAnyway={onRejoinAnyway} onUseAnotherName={onUseAnotherName} />
    );
    fireEvent.click(screen.getByRole('button', { name: /yes — rejoin as chris/i }));
    expect(onRejoinAnyway).toHaveBeenCalledTimes(1);
    expect(onUseAnotherName).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /different chris/i }));
    expect(onUseAnotherName).toHaveBeenCalledTimes(1);
  });

  it('asks the ambiguous case instead of guessing', () => {
    render(<JoinNameCollision kind="name-unverified" playerName="Chris" message="If that was you, rejoin." />);
    expect(screen.getByText('Are you the Chris already here?')).toBeInTheDocument();
  });

  it('dresses the ways out in the dock vocabulary (ui/Button at 56px, step 5a)', () => {
    actions('idle');
    const [main, other] = screen.getAllByRole('button');
    expect(main).toHaveClass('ui-btn', 'ui-btn--action', 'ui-btn--h56');
    expect(main).not.toHaveClass('ui-btn--quiet');
    expect(other).toHaveClass('ui-btn', 'ui-btn--quiet', 'ui-btn--h56');
    for (const button of screen.getAllByRole('button')) {
      expect(button.className).not.toMatch(/btn-primary|btn-secondary|btn-large/);
    }
  });

  it('states the refusal at the ladder and announces it', () => {
    const { container } = render(<JoinNameCollision kind="name-taken" playerName="Chris" message="taken" />);
    expect(screen.getByRole('heading')).toHaveClass('plr-h1', 'plr-h1--primary');
    expect(screen.getByText('taken')).toHaveClass('plr-lede', 'plr-muted');
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
  });
});

describe('NameMoved — the old device', () => {
  it('says the name is on another device, that the page stopped, and offers one way on', () => {
    const onJoinAgain = jest.fn();
    render(<><NameMoved playerName="Sam" /><NameMovedActions onJoinAgain={onJoinAgain} /></>);
    expect(screen.getByRole('heading', { name: 'Sam is now on another device.' })).toBeInTheDocument();
    expect(screen.getByText(/This page has stopped/)).toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(labelsOf()).toEqual([NAME_MOVED_LABEL]);
    fireEvent.click(screen.getByRole('button', { name: 'Join again with a different name' }));
    expect(onJoinAgain).toHaveBeenCalledTimes(1);
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

  it('passes the host\'s Not now through, and only when the server said it', () => {
    expect(
      classifyJoinFailure(409, { code: 'NAME_TAKEN', playerName: 'Chris', message: 'm', handoverRefused: true }).handoverRefused
    ).toBe(true);
    expect(
      'handoverRefused' in classifyJoinFailure(409, { code: 'NAME_TAKEN', playerName: 'Chris', message: 'm' })
    ).toBe(false);
    expect(handoverCopy({ stage: 'declined', playerName: 'Chris' }).heading).toBe('The host said not now.');
  });

  it('passes nameMoved through for the browser the name left, and only then', () => {
    expect(
      classifyJoinFailure(409, { code: 'NAME_TAKEN', playerName: 'Chris', message: 'm', nameMoved: true }).nameMoved
    ).toBe(true);
    expect(
      'nameMoved' in classifyJoinFailure(409, { code: 'NAME_TAKEN', playerName: 'Chris', message: 'm' })
    ).toBe(false);
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
