/**
 * THE ONE DIALOG HEAD AND FOOT (experience plan §5.1 "Dialog", step 5b):
 * components/ui/DialogParts.jsx, and that every Modal caller draws them.
 *
 * rejects: a dialog closed by a "×" or "✕" text glyph; a dead X (one drawn
 * with nothing to call); a foot with the action on the left; a Modal caller
 * that hand-rolls its own head again.
 */
import React from 'react';
import fs from 'fs';
import path from 'path';
import { render, screen, fireEvent } from '@testing-library/react';
import Modal from '../components/Modal';
import { DialogHead, DialogFoot, DialogClose, DialogCancel } from '../components/ui/DialogParts';

const D = require('../testing/driftScan');

describe('DialogHead', () => {
  test('a title, a sub, an eyebrow, and ONE close: the Icon X with its label', () => {
    const onClose = jest.fn();
    const { container } = render(
      <DialogHead titleId="t1" title="End this session?" eyebrow="Round 3" sub="The report keeps every round." onClose={onClose} />,
    );
    const head = container.querySelector('header.ui-dialog-head');
    expect(head).not.toBeNull();
    expect(screen.getByRole('heading', { level: 2, name: 'End this session?' })).toHaveAttribute('id', 't1');
    expect(container.querySelector('.ui-dialog-eyebrow')).toHaveTextContent('Round 3');
    expect(container.querySelector('.ui-dialog-sub')).toHaveTextContent('The report keeps every round.');
    const x = screen.getByRole('button', { name: 'Close' });
    expect(x).toHaveClass('ui-dialog-x');
    expect(x.querySelector('svg')).not.toBeNull();
    expect(x.textContent).toBe('');
    fireEvent.click(x);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('no handler, no X: a dialog never shows a dead close (hard rule 2)', () => {
    render(<DialogHead title="Read only" />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  test('the dialog\'s own classes ride beside the shared ones; head controls sit before the X', () => {
    const { container } = render(
      <DialogHead className="obill-head" titleClassName="obill-t" closeClassName="obill-x" title="T" onClose={() => {}} closeLabel="Close the review" closeDisabled>
        <span data-testid="extra">Live: v3</span>
      </DialogHead>,
    );
    expect(container.querySelector('header')).toHaveClass('ui-dialog-head', 'obill-head');
    expect(container.querySelector('h2')).toHaveClass('ui-dialog-title', 'obill-t');
    const x = screen.getByRole('button', { name: 'Close the review' });
    expect(x).toHaveClass('ui-dialog-x', 'obill-x');
    expect(x).toBeDisabled();
    const kids = [...container.querySelector('header').children];
    expect(kids.indexOf(screen.getByTestId('extra'))).toBeLessThan(kids.indexOf(x));
  });

  test('as="h3" and titleProps reach the title', () => {
    render(<DialogHead as="h3" title="Pull questions" titleProps={{ tabIndex: -1 }} onClose={() => {}} />);
    expect(screen.getByRole('heading', { level: 3, name: 'Pull questions' })).toHaveAttribute('tabindex', '-1');
  });
});

describe('DialogFoot', () => {
  test('the way back on the left, the action on the right', () => {
    const { container } = render(
      <DialogFoot cancel={<DialogCancel onClick={() => {}}>Keep it running</DialogCancel>}>
        <button type="button">End session</button>
      </DialogFoot>,
    );
    const foot = container.querySelector('footer.ui-dialog-foot');
    const [start, end] = foot.children;
    expect(start).toHaveClass('ui-dialog-foot-start');
    expect(start).toHaveTextContent('Keep it running');
    expect(end).toHaveClass('ui-dialog-foot-end');
    expect(end).toHaveTextContent('End session');
    // The way back is the library's secondary at the 44px touch height.
    expect(screen.getByRole('button', { name: 'Keep it running' })).toHaveClass('ui-btn--quiet', 'ui-btn--h44');
  });

  test('passes its own class and attributes (an inline confirm strip keeps its role)', () => {
    const { container } = render(<DialogFoot className="dialog-actions is-confirm" role="alertdialog"><button type="button">Discard</button></DialogFoot>);
    expect(container.querySelector('footer')).toHaveClass('ui-dialog-foot', 'dialog-actions', 'is-confirm');
    expect(container.querySelector('footer')).toHaveAttribute('role', 'alertdialog');
  });

  test('the stylesheet pushes the right group by margin and lets both wrap (hard rule 9)', () => {
    const css = fs.readFileSync(path.join(__dirname, '..', 'components', 'ui', 'Dialog.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(css).toMatch(/\.ui-dialog-foot-start \+ \.ui-dialog-foot-end\s*\{\s*margin-left:\s*auto/);
    expect(css).toMatch(/\.ui-dialog-foot-start,\s*\.ui-dialog-foot-end\s*\{[^}]*flex-wrap:\s*wrap/);
    expect(css).not.toMatch(/justify-content:\s*flex-end/);
  });
});

describe('inside a Modal', () => {
  test('the X and the foot exit go through the one close', () => {
    const requestClose = jest.fn();
    render(
      <Modal overlayClassName="ui-scrim" contentClassName="ui-dialog" labelledBy="m1" onClose={requestClose}>
        <DialogHead titleId="m1" title="New code" onClose={requestClose} />
        <DialogFoot cancel={<DialogCancel onClick={requestClose} />}><button type="button">Create</button></DialogFoot>
      </Modal>,
    );
    expect(screen.getByRole('dialog', { name: 'New code' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(requestClose).toHaveBeenCalledTimes(2);
  });
});

/* ------------------------------------------- every Modal caller, statically ---- */

/*
 * VIEWERS, NOT FORMS: a full-screen look at one thing (an answer, a past round,
 * a QR code), with no title bar and nothing to commit. They carry the shared
 * close (DialogClose, the Icon X) and no foot, because there is no action to
 * put on the right. Every other caller draws the shared head AND foot.
 */
const VIEWERS = {
  'components/AnswerSpotlight.jsx': 'one answer, full size; arrows step, any key returns',
  'components/PastRound.jsx': 'a round already played, read; arrows step between rounds',
  'buildroom/screens/QrZoom.jsx': 'a QR code at full size; a tap anywhere returns',
  'buildroom/MockupViewer.jsx': 'a picture or mockup at full size; its labelled Back and the X both return',
};

const modalCallers = D.jsFiles().filter((r) => r.endsWith('.jsx') && /^import Modal from /m.test(D.read(r)));

describe('every Modal caller draws the shared head and foot (step 5b)', () => {
  test('the scan found the callers', () => {
    expect(modalCallers.length).toBeGreaterThan(40);
  });

  test.each(modalCallers.map((r) => [r]))('%s', (r) => {
    const src = D.read(r);
    expect([r, /ui\/DialogParts'/.test(src)]).toEqual([r, true]);
    if (VIEWERS[r]) {
      expect([r, /<DialogClose\b/.test(src)]).toEqual([r, true]);
    } else {
      expect([r, /<(Shared)?DialogHead\b/.test(src)]).toEqual([r, true]);
      expect([r, /<DialogFoot\b/.test(src)]).toEqual([r, true]);
    }
    // And never a text glyph for a close, anywhere in the file.
    expect([r, D.scanCloseGlyphs(src, r)]).toEqual([r, []]);
  });

  test('no shared head is hand-rolled again: no caller declares its own .ui-dialog-x button', () => {
    const rolled = modalCallers.filter((r) => /className="ui-dialog-x"/.test(D.read(r)));
    expect(rolled).toEqual([]);
  });
});

describe('DialogClose alone', () => {
  test('is the Icon X with a label, and nothing without a handler', () => {
    const { rerender } = render(<DialogClose onClose={() => {}} label="Close the picture" className="brm-viewer-x" />);
    expect(screen.getByRole('button', { name: 'Close the picture' })).toHaveClass('ui-dialog-x', 'brm-viewer-x');
    rerender(<DialogClose />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});
