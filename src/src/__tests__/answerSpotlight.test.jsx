/**
 * READING ONE ANSWER, AND STEPPING THROUGH THE REST.
 *
 *   "when the results or voting screen are there it should be easy to click on
 *    an answer and it expand on a large modal, with a x to close or click off
 *    the modal to go back, in case we want to read the answer. we should also
 *    be able to scroll or click through when more answers than fit on the
 *    screen."
 *
 * Four requirements in one sentence, and each is a separate way to ship this
 * broken: open on click, close by X, close by backdrop, and move through a list
 * longer than the screen. The last one is the one with real arithmetic behind
 * it, because the grid shows a PAGE and the dialog walks the WHOLE round.
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import AnswerSpotlight, { dismissesOnKey } from '../components/AnswerSpotlight';
import { openAt, step, canStep, positionLabel, pageOf } from '../utils/answerSpotlight';

describe('stepping through answers the screen cannot hold', () => {
  // rejects: THE PAGE-BOUNDARY BUG this module exists to prevent. If Next were
  //          computed against the visible page instead of the full list it
  //          would stop dead at the last card of every page — which looks
  //          exactly like a dead button, the same symptom as three other bugs
  //          fixed this week.
  test('it steps across a page boundary', () => {
    expect(step(7, 1, 20)).toBe(8);
    expect(canStep(7, 1, 20)).toBe(true);
  });

  // rejects: wrapping. In front of a room the host is reading down a list out
  //          loud; silently restarting at the top reads as "there is more" and
  //          costs them the sentence.
  test('it clamps at both ends rather than wrapping', () => {
    expect(step(11, 1, 12)).toBe(11);
    expect(step(0, -1, 12)).toBe(0);
    expect(canStep(11, 1, 12)).toBe(false);
    expect(canStep(0, -1, 12)).toBe(false);
  });

  // rejects: returning null at an end. null closes the dialog, so a Next press
  //          on the last answer would dismiss what the host is mid-way through
  //          reading.
  test('a step at the end does not close the dialog', () => {
    expect(step(11, 1, 12)).not.toBeNull();
  });

  // rejects: clamping an out-of-range OPEN to the nearest answer. A click on a
  //          card that is no longer there — list re-rendered under the pointer,
  //          page turned mid-tap — must open nothing, not somebody else's
  //          response with their name on it.
  test('opening out of range opens nothing', () => {
    expect(openAt(12, 12)).toBeNull();
    expect(openAt(-1, 12)).toBeNull();
    expect(openAt(null, 12)).toBeNull();
    expect(openAt(3, 12)).toBe(3);
  });

  // rejects: a 0-based counter read aloud to a room, and "0 of 0" on an empty
  //          round.
  test('the position reads the way a person says it', () => {
    expect(positionLabel(2, 12)).toBe('3 of 12');
    expect(positionLabel(0, 0)).toBe('');
  });

  // rejects: dropping the host three answers behind where they got to. Paging
  //          forward inside the dialog and then closing must leave the grid on
  //          the page actually reached.
  test('closing knows which page the answer is on', () => {
    expect(pageOf(9, 4)).toBe(2);
    expect(pageOf(0, 4)).toBe(0);
    expect(pageOf(5, 0)).toBe(0);   // a nonsense page size must not divide by zero
  });
});

describe('the dialog itself', () => {
  const answers = [
    { answer: 'The first response', playerName: 'Ada', points: 3, votes: 2 },
    { answer: 'The second response', playerName: 'Grace', points: 1, votes: 1 },
    { answer: 'The third response', playerName: 'Katherine', points: 0, votes: 0 },
  ];
  const labelFor = (a) => a.playerName;

  function mount(props = {}) {
    const onIndex = jest.fn();
    const onClose = jest.fn();
    const utils = render(
      <AnswerSpotlight
        answers={answers}
        index={1}
        onIndex={onIndex}
        onClose={onClose}
        labelFor={labelFor}
        {...props}
      />,
    );
    return { ...utils, onIndex, onClose };
  }

  // rejects: a dialog that renders when nothing was clicked.
  test('a null index renders nothing at all', () => {
    const { container } = mount({ index: null });
    expect(container).toBeEmptyDOMElement();
  });

  test('it shows the answer that was clicked, and where it sits', () => {
    mount();
    expect(screen.getByText('The second response')).toBeInTheDocument();
    expect(screen.getByText('2 of 3')).toBeInTheDocument();
    expect(screen.getByText('Grace')).toBeInTheDocument();
  });

  // rejects: dropping the X — named explicitly in the request.
  test('the X closes it', () => {
    const { onClose } = mount();
    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(onClose).toHaveBeenCalled();
  });

  // rejects: an inert backdrop — also named explicitly ("click off the modal to
  //          go back"). The question editor deliberately makes its backdrop
  //          inert because it holds an unsaved draft; this holds a copy of
  //          something already submitted, so the cheap dismissal is correct.
  test('clicking off it closes it', () => {
    const { onClose, container } = mount();
    const scrim = container.querySelector('.answer-spotlight__scrim');
    expect(scrim).toBeTruthy();
    fireEvent.click(scrim);
    expect(onClose).toHaveBeenCalled();
  });

  // rejects: clicks inside the card falling through to the backdrop and
  //          dismissing the dialog the moment anyone touches the text.
  test('clicking the answer itself does not close it', () => {
    const { onClose } = mount();
    fireEvent.click(screen.getByText('The second response'));
    expect(onClose).not.toHaveBeenCalled();
  });

  test('Next and Previous move one answer', () => {
    const { onIndex } = mount();
    fireEvent.click(screen.getByRole('button', { name: /next answer/i }));
    expect(onIndex).toHaveBeenCalledWith(2);
    fireEvent.click(screen.getByRole('button', { name: /previous answer/i }));
    expect(onIndex).toHaveBeenCalledWith(0);
  });

  // rejects: live controls at the ends that do nothing when pressed — the
  //          "is it broken or is that the end?" question, asked in front of a
  //          room.
  test('the pager is disabled where it cannot go', () => {
    const first = mount({ index: 0 });
    expect(screen.getByRole('button', { name: /previous answer/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /next answer/i })).not.toBeDisabled();
    first.unmount();

    mount({ index: 2 });
    expect(screen.getByRole('button', { name: /next answer/i })).toBeDisabled();
  });

  // rejects: dropping arrow-key support. This is read from across a room, and
  //          every presentation clicker sends Left/Right.
  test('arrow keys step through it', () => {
    const { onIndex } = mount();
    fireEvent.keyDown(document, { key: 'ArrowRight' });
    expect(onIndex).toHaveBeenCalledWith(2);
    fireEvent.keyDown(document, { key: 'ArrowLeft' });
    expect(onIndex).toHaveBeenCalledWith(0);
  });

  // rejects: the key handler outliving the dialog and moving a spotlight that
  //          is not on screen.
  test('the arrow keys stop working once it is closed', () => {
    const { onIndex, unmount } = mount();
    unmount();
    fireEvent.keyDown(document, { key: 'ArrowRight' });
    expect(onIndex).not.toHaveBeenCalled();
  });

  // rejects: showing a score beside a response on a round whose authors are
  //          still hidden. A score that jumps names its author as surely as a
  //          label does (§5.6.4), so the dialog has to obey the same gate as
  //          the card behind it — and it takes it as a prop rather than
  //          re-deriving it, which is what went wrong at three other sites.
  test('points appear only when the caller allows them', () => {
    const hidden = mount({ showPoints: false });
    expect(screen.queryByText('+1')).not.toBeInTheDocument();
    hidden.unmount();

    mount({ showPoints: true });
    expect(screen.getByText('+1')).toBeInTheDocument();
  });

  /*
    "any key takes you back to the review overview page for the question they
     were looking at."

    Asked for by the owner about the PAST-ROUND review, and it is opt-in here
    for that reason. On the live RESULTS stage the host is running the room
    from this dialog with a clicker in their hand; a stray keypress closing it
    mid-sentence would be a new defect shipped alongside a fix.
  */
  // rejects: turning any-key dismissal on for every caller. The stage spotlight
  //          must survive a keypress.
  test('a keypress does not close it unless the caller asked', () => {
    const { onClose } = mount();
    fireEvent.keyDown(document, { key: 'k' });
    expect(onClose).not.toHaveBeenCalled();
  });

  // rejects: wiring the prop and never reading it.
  test('with closeOnKey, a keypress closes it', () => {
    const { onClose } = mount({ closeOnKey: true });
    fireEvent.keyDown(document, { key: 'k' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // rejects: any-key dismissal eating the pager. Left and Right are this
  //          dialog's own controls and already mean something.
  test('with closeOnKey, the arrows still step rather than close', () => {
    const { onClose, onIndex } = mount({ closeOnKey: true });
    fireEvent.keyDown(document, { key: 'ArrowRight' });
    expect(onIndex).toHaveBeenCalledWith(2);
    expect(onClose).not.toHaveBeenCalled();
  });
});

/*
 * WHICH KEYS ACTUALLY MEAN "I AM DONE READING".
 *
 * A literal any-key handler swallows Tab, every screen-reader chord and every
 * scrolling key — in a dialog that exists precisely because its contents are
 * too long to read in place. The exclusions are the feature; they are unit
 * tested here so the reasoning is pinned somewhere smaller than a mounted
 * dialog.
 */
describe('the keys that dismiss, and the ones that must not', () => {
  // rejects: narrowing the rule to a hand-picked list, which would leave the
  //          owner's "any key" not working for most keys.
  test('ordinary keys dismiss', () => {
    for (const key of ['k', 'K', '7', 'Enter', 'Backspace', '.', 'F5']) {
      expect(dismissesOnKey({ key })).toBe(true);
    }
  });

  // rejects: breaking the focus trap. Tab is how a keyboard user reaches the
  //          X and the pager, and <Modal> traps it deliberately.
  test('Tab is left to the focus trap', () => {
    expect(dismissesOnKey({ key: 'Tab' })).toBe(false);
    expect(dismissesOnKey({ key: 'Tab', shiftKey: true })).toBe(false);
  });

  // rejects: closing twice. <Modal> owns Escape; a second handler for one key
  //          is how a dialog closes the thing behind it as well.
  test('Escape is left to the modal', () => {
    expect(dismissesOnKey({ key: 'Escape' })).toBe(false);
  });

  // rejects: dismissing on the first half of a chord. Screen readers hold
  //          modifiers down, and a bare Shift press is never an instruction.
  test('bare modifiers and chords do not dismiss', () => {
    for (const key of ['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'Dead']) {
      expect(dismissesOnKey({ key })).toBe(false);
    }
    expect(dismissesOnKey({ key: 'c', ctrlKey: true })).toBe(false);
    expect(dismissesOnKey({ key: 'c', metaKey: true })).toBe(false);
    expect(dismissesOnKey({ key: 'f', altKey: true })).toBe(false);
  });

  // rejects: making a long answer unreadable without a mouse. These keys are
  //          how the scroll container this dialog is built around is scrolled.
  test('the reading keys do not dismiss', () => {
    for (const key of ['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' ']) {
      expect(dismissesOnKey({ key })).toBe(false);
    }
  });

  // rejects: a rule that becomes a trap the day someone adds an input to this
  //          dialog — typing "n" would dismiss what was being annotated.
  test('typing into a field dismisses nothing', () => {
    expect(dismissesOnKey({ key: 'n', target: { tagName: 'INPUT' } })).toBe(false);
    expect(dismissesOnKey({ key: 'n', target: { tagName: 'TEXTAREA' } })).toBe(false);
    expect(dismissesOnKey({ key: 'n', target: { isContentEditable: true } })).toBe(false);
    expect(dismissesOnKey({ key: 'n', target: { tagName: 'DIV' } })).toBe(true);
  });

  test('a malformed event dismisses nothing', () => {
    expect(dismissesOnKey(null)).toBe(false);
    expect(dismissesOnKey({})).toBe(false);
  });
});

/*
 * THE SCROLL CONTRACT, READ AS TEXT.
 *
 * "we should also be able to scroll ... when more answers than fit on the
 * screen" — and a long answer is the case this whole dialog exists for. jsdom
 * computes no heights, does no overflow and scrolls nothing, so a rendered
 * assertion that the text is scrollable passes against a stylesheet that makes
 * it impossible. That is precisely how the iPad dialog trap survived 1,859
 * green tests. Same technique as modalReachability.test.js.
 */
describe('a long answer can actually be scrolled', () => {
  const fs = require('fs');
  const path = require('path');
  const CSS = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');

  const block = (selector) => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const m = CSS.match(new RegExp(`(^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`, 'm'));
    if (!m) throw new Error(`No rule for "${selector}" — renamed?`);
    return m[2];
  };

  // rejects: THE FLEX TRAP, for the fifth time in this codebase. `overflow-y:
  //          auto` on a column flex child is inert without `min-height: 0`,
  //          because the item's default `min-height: auto` resolves to its
  //          content height — so it never shrinks, the overflow never exists,
  //          and the text simply runs past the bottom of the card.
  test('the text is the part that scrolls', () => {
    const text = block('.answer-spotlight__text');
    expect(text).toMatch(/overflow-y:\s*auto/);
    expect(text).toMatch(/min-height:\s*0/);
    expect(text).toMatch(/flex:\s*1/);
  });

  // rejects: a height instead of a cap, which would make every short answer a
  //          near-full-screen box; and a card with no cap at all, which is the
  //          original iPad bug — content taller than the viewport with no
  //          scroll container anywhere.
  test('the card is capped against the viewport, not sized to it', () => {
    const card = block('.answer-spotlight');
    expect(card).toMatch(/max-height:/);
    expect(card).not.toMatch(/^\s*height:/m);
    expect(card).toMatch(/flex-direction:\s*column/);
  });

  // rejects: letting the head, meta or pager shrink. If they are what yields,
  //          the Close button and the Next control are what leave the screen —
  //          which is the exact shape of the trap that was reported from an
  //          iPad: a dialog with no way out.
  test('the controls do not shrink away', () => {
    for (const sel of ['.answer-spotlight__head', '.answer-spotlight__meta', '.answer-spotlight__nav']) {
      expect(block(sel)).toMatch(/flex:\s*none/);
    }
  });

  // rejects: a wall of text with no wrapping rule. A pasted URL or an unbroken
  //          string would otherwise push the card wider than the screen and
  //          take the pager off the edge with it.
  test('an unbroken string still wraps', () => {
    expect(block('.answer-spotlight__text')).toMatch(/overflow-wrap:\s*anywhere/);
  });
});
