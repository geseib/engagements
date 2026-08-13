/**
 * THE SHARED MODAL PRIMITIVE — components/Modal.jsx
 *
 * Four dialogs each grew their own overlay and each got a different subset of
 * the behaviour a modal needs: one backdrop closed unconditionally, one closed
 * only when it was safe to, one did not close at all; two carried `role`,
 * `aria-modal` and a label and two carried nothing; none of the four had Escape,
 * a focus trap, focus restore or a scroll lock. This file is the contract for
 * the one implementation they now share.
 *
 * WHAT IT DELIBERATELY DOES NOT ASSERT. The primitive owns no class names — the
 * overlay and content classes arrive as props and are rendered verbatim, because
 * `.qsets-scrim`, `.new-game-overlay` and `.modal-overlay` carry z-index and
 * palette that other suites read straight out of the stylesheets. So the class
 * tests below check PASS-THROUGH, not any particular name.
 *
 * NO GEOMETRIC ASSERTIONS. jsdom has no layout engine, so "is it on top",
 * "is it centred" and "does it cover the page" are unfalsifiable here and are
 * asserted in the palette suites against the CSS instead. Everything below is
 * DOM structure, attributes, focus and callbacks.
 */
import React, { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import Modal from '../components/Modal';

const mount = (props = {}, children = <button type="button">inside</button>) =>
  render(
    <Modal overlayClassName="ov" contentClassName="ct" onClose={jest.fn()} {...props}>
      {children}
    </Modal>
  );

const overlay = () => document.querySelector('.ov');

afterEach(() => {
  // The lock is module state. A test that leaked one would otherwise be paid
  // for by the next file in the worker.
  document.body.style.overflow = '';
});

/* ------------------------------------------------------- the DOM it renders */

describe('the DOM it renders', () => {
  test('the overlay and content class names are passed straight through', () => {
    // rejects: the primitive owning, defaulting or normalising a class name.
    // `.new-game-dialog { background: white }`, `.qsets-scrim--over`'s z-index
    // and the `.qsets--onlight .qsets` theme scope are all read out of the
    // stylesheets by other suites and all keyed on the exact selector, so a
    // helpfully-added `modal` class or a dropped one is a silent visual break.
    mount({
      overlayClassName: 'qsets qsets--onlight qsets-scrim qsets-scrim--over',
      contentClassName: 'qsets-modal qsets-modal--wide',
    });
    const box = screen.getByRole('dialog');
    expect(box.className).toBe('qsets-modal qsets-modal--wide');
    expect(box.parentElement.className).toBe('qsets qsets--onlight qsets-scrim qsets-scrim--over');
  });

  test('the content is a child of the overlay, in the document, not a portal', () => {
    // rejects: reaching for createPortal. The three dialogs nest three deep and
    // the inner two are DOM DESCENDANTS of the outer — that is how the light
    // theme reaches them (`.qsets--onlight .qsets`) and how the inner scrims'
    // clicks are absorbed instead of closing the screen behind. A portal moves
    // both out from under the ancestor and neither failure is visible in a
    // rendered-output check.
    const { container } = mount();
    expect(container.querySelector('.ov .ct')).not.toBeNull();
  });

  test('`afterContent` renders inside the overlay but outside the dialog box', () => {
    // GameSetupDialog hangs the host's question-sets dialog off its overlay as a
    // SIBLING of the card. rejects: folding it into `children`, which would clip
    // a full-screen scrim inside a fixed-width card.
    mount({ afterContent: <div data-testid="sibling" /> });
    const sibling = screen.getByTestId('sibling');
    expect(sibling.parentElement.className).toBe('ov');
    expect(screen.getByRole('dialog').contains(sibling)).toBe(false);
  });
});

/* ------------------------------------------------------------------- naming */

describe('what assistive technology is told', () => {
  test('it is a dialog, and it says so', () => {
    // rejects: QuestionPullDialog and GameSetupDialog keeping the nothing they
    // shipped with — two of the four carried role/aria-modal and two carried no
    // attributes at all, which is not a decision, it is an omission.
    mount();
    const box = screen.getByRole('dialog');
    expect(box).toHaveAttribute('aria-modal', 'true');
  });

  test('`labelledBy` points the name at the heading that is already on screen', () => {
    // rejects: naming the dialog with a duplicated string that drifts from the
    // <h2>. hostQuestionSets.test.jsx finds these dialogs by accessible name.
    mount({ labelledBy: 'h' }, <h2 id="h">Delete this question set?</h2>);
    expect(screen.getByRole('dialog', { name: /delete this question set/i })).toBeTruthy();
  });

  test('`label` names a dialog that has no heading element to point at', () => {
    mount({ label: 'Nameless' });
    expect(screen.getByRole('dialog', { name: 'Nameless' })).toBeTruthy();
  });

  test('`labelledBy` wins over `label` rather than emitting both', () => {
    // rejects: rendering aria-label AND aria-labelledby, where the label silently
    // loses and the two can disagree forever without anyone noticing.
    mount({ labelledBy: 'h', label: 'Ignored' }, <h2 id="h">Real name</h2>);
    const box = screen.getByRole('dialog');
    expect(box).toHaveAttribute('aria-labelledby', 'h');
    expect(box).not.toHaveAttribute('aria-label');
  });
});

/* ----------------------------------------------------------------- backdrop */

describe('the backdrop', () => {
  test('a click on it closes by default', () => {
    const onClose = jest.fn();
    mount({ onClose });
    fireEvent.click(overlay());
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('a click INSIDE the dialog never closes it', () => {
    // rejects: dropping the stopPropagation on the content box, which turns
    // every button, label and stretch of text in the dialog into a dismiss.
    const onClose = jest.fn();
    mount({ onClose });
    fireEvent.click(screen.getByRole('button', { name: 'inside' }));
    expect(onClose).not.toHaveBeenCalled();
  });

  test('`closeOnBackdrop={false}` leaves the backdrop inert', () => {
    // GameSetupDialog is rendered by a page-level early return: there is nothing
    // behind it to go back to, and a mis-aimed click on the margin would throw
    // away a half-filled form. rejects: a default that closes everything.
    const onClose = jest.fn();
    mount({ onClose, closeOnBackdrop: false });
    fireEvent.click(overlay());
    expect(onClose).not.toHaveBeenCalled();
  });

  test('a predicate is evaluated at CLICK time, not at render time', () => {
    // THE delete dialog's rule: not while the request is in flight. rejects:
    // reading the gate once into a captured boolean, which would answer with
    // whatever was true when the listener was created.
    const onClose = jest.fn();
    let allowed = false;
    mount({ onClose, closeOnBackdrop: () => allowed });
    fireEvent.click(overlay());
    expect(onClose).not.toHaveBeenCalled();
    allowed = true;
    fireEvent.click(overlay());
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

/* ------------------------------------------------------------------- escape */

describe('escape', () => {
  test('Escape closes it from anywhere on the page, not only from inside it', () => {
    // The listener is document-level, which is the convention every other
    // keyboard surface here already follows and the one the suites fire against
    // (quickstartMenu.test.jsx:122, sessionSetupPanel.test.jsx:168).
    // rejects: an `onKeyDown` on the dialog element instead — the shape
    // SessionSetupPanel uses for its Tab trap. It only fires once focus is
    // already inside, and nothing here moves focus in on mount, so a host who
    // has not tabbed into the dialog would have no keyboard way out at all.
    const onClose = jest.fn();
    mount({ onClose });
    document.body.focus();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('Escape obeys the same predicate the backdrop does', () => {
    // rejects: gating the scrim and leaving Escape open — a second way out that
    // skips the gate is the same defect the gate was written for.
    const onClose = jest.fn();
    let allowed = false;
    mount({ onClose, closeOnEscape: () => allowed });
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
    allowed = true;
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('`closeOnEscape={false}` means no key closes it', () => {
    const onClose = jest.fn();
    mount({ onClose, closeOnEscape: false });
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });

  test('a closed dialog no longer answers the keyboard', () => {
    // rejects: leaving the closed dialog's handler live — its `onClose` would
    // be called again from under a page that has moved on.
    const onClose = jest.fn();
    const { unmount } = mount({ onClose });
    unmount();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });

  test('the keydown listener is taken off the document again', () => {
    // NOT the same assertion as the one above, which the topmost check answers
    // on its own even when nothing is unsubscribed. rejects: an effect with no
    // cleanup — a host who opens and closes the setup dialog forty times in a
    // session accumulates forty listeners that run on every keystroke for the
    // rest of it. Counting the pair is the only way to see that from outside.
    const add = jest.spyOn(document, 'addEventListener');
    const remove = jest.spyOn(document, 'removeEventListener');
    const keydowns = (spy) => spy.mock.calls.filter(([type]) => type === 'keydown').length;

    const { unmount } = mount();
    expect(keydowns(add)).toBe(1);
    unmount();
    expect(keydowns(remove)).toBe(1);

    add.mockRestore();
    remove.mockRestore();
  });
});

/* ------------------------------------------------------------------ nesting */

/** The real shape: an outer dialog whose CHILD is another dialog. */
function Nested({ outerClose, innerClose, innerOpen = true }) {
  return (
    <Modal overlayClassName="outer-ov" contentClassName="outer-ct" onClose={outerClose}>
      <button type="button">outer button</button>
      {innerOpen && (
        <Modal overlayClassName="inner-ov" contentClassName="inner-ct" onClose={innerClose}>
          <button type="button">inner button</button>
        </Modal>
      )}
    </Modal>
  );
}

describe('three deep, which is what this app actually renders', () => {
  test('Escape is answered by the innermost dialog only', () => {
    // `new-game-overlay` → `qsets-scrim--over` → `qsets-scrim` are all open at
    // once when a host deletes a set from the create screen. rejects: a
    // document listener per modal with no topmost check, which closes all three
    // on one keypress and drops the host back on an empty stage.
    const outerClose = jest.fn();
    const innerClose = jest.fn();
    render(<Nested outerClose={outerClose} innerClose={innerClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(innerClose).toHaveBeenCalledTimes(1);
    expect(outerClose).not.toHaveBeenCalled();
  });

  test('closing the inner one hands the keyboard back to the outer one', () => {
    // rejects: a "topmost" that is decided once at mount and never recomputed.
    const outerClose = jest.fn();
    const innerClose = jest.fn();
    const { rerender } = render(<Nested outerClose={outerClose} innerClose={innerClose} />);
    rerender(<Nested outerClose={outerClose} innerClose={innerClose} innerOpen={false} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(outerClose).toHaveBeenCalledTimes(1);
  });

  test('the outer dialog still holds the scroll lock after the inner one closes', () => {
    // THE REFERENCE COUNT. rejects: lock-on-mount/unlock-on-unmount, which gives
    // the page its scrollbar back the moment the innermost of three dialogs
    // closes — the page then scrolls away underneath two dialogs that are still
    // open.
    const { rerender, unmount } = render(<Nested outerClose={jest.fn()} innerClose={jest.fn()} />);
    expect(document.body.style.overflow).toBe('hidden');
    rerender(<Nested outerClose={jest.fn()} innerClose={jest.fn()} innerOpen={false} />);
    expect(document.body.style.overflow).toBe('hidden');
    unmount();
    expect(document.body.style.overflow).toBe('');
  });

  test('a click on the inner backdrop does not also reach the outer one', () => {
    // The inner scrim is a DOM descendant of the outer content, so its clicks
    // bubble. rejects: dropping the content stopPropagation, which closes the
    // whole stack from one click on the inner dialog's margin.
    const outerClose = jest.fn();
    const innerClose = jest.fn();
    render(<Nested outerClose={outerClose} innerClose={innerClose} />);
    fireEvent.click(document.querySelector('.inner-ov'));
    expect(innerClose).toHaveBeenCalledTimes(1);
    expect(outerClose).not.toHaveBeenCalled();
  });
});

/* -------------------------------------------------------------------- focus */

describe('focus', () => {
  test('Tab from outside the dialog lands inside it', () => {
    // rejects: no trap at all. Tab out of a modal reaches the live host controls
    // behind it, where the next Space advances a round the host was still
    // setting up — the hazard SessionSetupPanel's trap was written for.
    mount({}, (
      <>
        <button type="button">first</button>
        <button type="button">last</button>
      </>
    ));
    document.body.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'first' }));
  });

  test('Tab off the last control wraps to the first', () => {
    mount({}, (
      <>
        <button type="button">first</button>
        <button type="button">last</button>
      </>
    ));
    screen.getByRole('button', { name: 'last' }).focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'first' }));
  });

  test('Shift+Tab off the first control wraps to the last', () => {
    mount({}, (
      <>
        <button type="button">first</button>
        <button type="button">last</button>
      </>
    ));
    screen.getByRole('button', { name: 'first' }).focus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'last' }));
  });

  test('a disabled control is not a place Tab can land', () => {
    // The disabled button is LAST on purpose: with a selector that ignores
    // [disabled] it becomes the element the wrap-around aims at, focusing it is
    // a no-op, and the real last control stops wrapping at all — focus sticks
    // and the next Tab walks out of the dialog. rejects: a focusable selector
    // that ignores [disabled]. The delete dialog disables BOTH its buttons
    // while the request is in flight, which is exactly when it must not be
    // possible to Tab out of the only surface reporting the outcome.
    mount({}, (
      <>
        <button type="button">first</button>
        <button type="button">last</button>
        <button type="button" disabled>busy</button>
      </>
    ));
    screen.getByRole('button', { name: 'last' }).focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'first' }));
  });

  test('the trap belongs to the innermost dialog', () => {
    // rejects: every open modal running its own trap, which pulls focus back to
    // the outer dialog's first control the moment the inner one wraps.
    render(<Nested outerClose={jest.fn()} innerClose={jest.fn()} />);
    screen.getByRole('button', { name: 'inner button' }).focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'inner button' }));
  });

  test('focus goes back to whatever opened the dialog', () => {
    // rejects: unmounting with no restore, which drops a keyboard host at the
    // top of the document mid-session — the same defect SessionSetupPanel's
    // openerRef exists to prevent.
    const opener = document.createElement('button');
    opener.textContent = 'open it';
    document.body.appendChild(opener);
    opener.focus();

    const { unmount } = mount();
    screen.getByRole('button', { name: 'inside' }).focus();
    unmount();

    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  test('an opener that left the document is not chased', () => {
    // rejects: a restore that assumes the opener survived. The button that opens
    // a row's delete dialog is inside a list the delete then removes.
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();

    const { unmount } = mount();
    opener.remove();
    expect(() => unmount()).not.toThrow();
  });
});

/* -------------------------------------------------------------- scroll lock */

describe('the scroll lock', () => {
  test('it locks while open and gives back exactly what it took', () => {
    // rejects: hardcoding `overflow: ''` on the way out, which erases a page
    // that was deliberately non-scrolling before the dialog opened.
    document.body.style.overflow = 'clip';
    const { unmount } = mount();
    expect(document.body.style.overflow).toBe('hidden');
    unmount();
    expect(document.body.style.overflow).toBe('clip');
  });
});
