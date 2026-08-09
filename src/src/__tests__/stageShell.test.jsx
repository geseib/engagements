/**
 * What can honestly be asserted about the hook in jsdom.
 *
 * Not the geometry — jsdom reports every box as zero-sized, so a "does it fit"
 * assertion here would be a lie. What IS real: the hook must be idempotent
 * (it is called on every render in practice), it must reset drop state before
 * measuring rather than accumulating it, and it must not leak listeners.
 * Those are lifecycle properties, and lifecycle is exactly what jsdom models
 * correctly.
 */
import React, { useRef } from 'react';
import { render, act } from '@testing-library/react';
import useStageFit from '../hooks/useStageFit';

function Harness({ deps = [] }) {
  const ref = useRef(null);
  useStageFit(ref, deps);
  return (
    <div ref={ref} className="stage">
      <div className="content">
        <div className="fitbox">
          <h1 className="q">A question</h1>
          <p className="qdetail" data-drop="1" data-drop-note="Full prompt">Detail</p>
        </div>
        <p className="reduced" hidden />
      </div>
    </div>
  );
}

describe('useStageFit lifecycle', () => {
  test('it mounts without throwing in a zero-sized document', () => {
    expect(() => render(<Harness />)).not.toThrow();
  });

  test('a state that fits leaves no reduction applied', () => {
    // Every box is 0x0 in jsdom, so nothing overflows and nothing should be
    // sacrificed. A hook that drops groups here is dropping them unconditionally.
    const { container } = render(<Harness />);
    expect(container.querySelector('[data-drop="1"]').hidden).toBe(false);
    expect(container.querySelector('.content').dataset.clamped).toBeUndefined();
    expect(container.querySelector('.reduced').hidden).toBe(true);
  });

  test('re-running is idempotent — drop state resets before measuring', () => {
    const { container, rerender } = render(<Harness deps={[1]} />);
    const dropped = container.querySelector('[data-drop="1"]');
    dropped.hidden = true; // simulate a previous pass having sacrificed it
    act(() => { rerender(<Harness deps={[2]} />); });
    expect(dropped.hidden).toBe(false);
  });

  test('it removes its resize listener on unmount', () => {
    const add = jest.spyOn(window, 'addEventListener');
    const remove = jest.spyOn(window, 'removeEventListener');
    const { unmount } = render(<Harness />);
    const added = add.mock.calls.filter(([e]) => e === 'resize').length;
    unmount();
    const removed = remove.mock.calls.filter(([e]) => e === 'resize').length;
    expect(removed).toBe(added);
    add.mockRestore();
    remove.mockRestore();
  });

  test('a null ref is survivable', () => {
    function NullHarness() {
      const ref = useRef(null);
      useStageFit(ref, []);
      return null;
    }
    expect(() => render(<NullHarness />)).not.toThrow();
  });
});
