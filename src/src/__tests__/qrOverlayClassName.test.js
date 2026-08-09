import { qrOverlayClassName } from '../utils/qrOverlayClassName';

// The overlay only ever mounts inside GameHostPage, which requires an
// AuthProvider to render at all -- so this pure function is what actually
// gets exercised; the modifier-class rule is otherwise untestable through
// the page itself.
describe('qrOverlayClassName', () => {
  test('a hover/focus preview stays pointer-transparent', () => {
    // rejects: the overlay occluding the `<code>` that opened it, which makes
    // the browser re-hit-test on the next mousemove, fire mouseleave on the
    // now-covered code, unmount the overlay, and re-hover it -- a loop.
    expect(qrOverlayClassName('preview')).toBe('expanded-qr-overlay expanded-qr-overlay--preview');
  });

  test('a pinned QR keeps normal pointer events so click-away still dismisses it', () => {
    expect(qrOverlayClassName('pinned')).toBe('expanded-qr-overlay');
  });

  test('the plain showExpandedQR path (no qrMode) also keeps normal pointer events', () => {
    expect(qrOverlayClassName(null)).toBe('expanded-qr-overlay');
  });
});
