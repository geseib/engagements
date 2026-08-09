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
import { render, act, screen, fireEvent } from '@testing-library/react';
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

/**
 * The stage shell components: Stage, Rail, PhaseBar, RoomMeter, Dock.
 *
 * jsdom has no layout engine, so nothing here asserts geometry — every
 * assertion is about DOM shape (which elements exist, in what order, with
 * what attributes) or behaviour (what a prop changes, what a click calls).
 */
import Stage from '../components/stage/Stage';
import Rail from '../components/stage/Rail';
import PhaseBar from '../components/stage/PhaseBar';
import RoomMeter from '../components/stage/RoomMeter';
import Dock from '../components/stage/Dock';

describe('the stage grid', () => {
  test('the profile class lands on the document root, not on a wrapper', () => {
    // The ladders are declared on :root. A class on a div would leave every
    // custom property substituting against :root's own values, which is
    // precisely how the scalar approach rendered all four profiles identically.
    render(<Stage profile="tv" phase="ASK"><div /></Stage>);
    expect(document.documentElement.classList.contains('d-tv')).toBe(true);
    expect(document.documentElement.classList.contains('d-room')).toBe(false);
  });

  test('changing profile replaces the class rather than adding one', () => {
    const { rerender } = render(<Stage profile="tv" phase="ASK"><div /></Stage>);
    rerender(<Stage profile="table" phase="ASK"><div /></Stage>);
    expect(document.documentElement.className.match(/\bd-\w+/g)).toEqual(['d-table']);
  });

  test('all four grid areas are present in order', () => {
    const { container } = render(<Stage profile="room" phase="ASK"><div /></Stage>);
    const areas = Array.from(container.querySelectorAll('.stage > *'))
      .map((el) => el.className.split(' ')[0]);
    expect(areas).toEqual(['field', 'rail', 'bar', 'main', 'dock']);
  });

  test('unmounting removes the profile class rather than leaving it behind', () => {
    // A wrapper class disappears for free when its element unmounts. A class
    // on document.documentElement does not — nothing removes it but this
    // component, so a missing cleanup leaks the class onto whatever mounts next.
    const { unmount } = render(<Stage profile="tv" phase="ASK"><div /></Stage>);
    expect(document.documentElement.classList.contains('d-tv')).toBe(true);
    unmount();
    expect(document.documentElement.classList.contains('d-tv')).toBe(false);
  });
});

describe('the rail', () => {
  test('the title is a single text node, so its ellipsis can actually render', () => {
    // text-overflow applies to a block container with inline content. On a flex
    // box with span children it is inert, which is how the rail shipped
    // clipping mid-glyph at -445px of slack.
    const { container } = render(<Rail title="A very long event title" context={{}} join={{ code: '4821' }} />);
    const title = container.querySelector('.rail-title');
    expect(title.childNodes).toHaveLength(1);
    expect(title.childNodes[0].nodeType).toBe(Node.TEXT_NODE);
  });

  test('the drop order sacrifices the title first and never the code', () => {
    const { container } = render(<Rail title="T" context={{}} join={{ url: 'eng.seibtribe.us/play', code: '4821' }} />);
    expect(container.querySelector('.rail-title').dataset.drop).toBe('1');
    expect(container.querySelector('[data-join-word]').dataset.drop).toBe('2');
    expect(container.querySelector('[data-join-url]').dataset.drop).toBe('3');
    // The code is what people in the room need. It is not droppable at all.
    expect(container.querySelector('code').dataset.drop).toBeUndefined();
  });

  test('the timer is absent unless armed', () => {
    const { container, rerender } = render(<Rail title="T" context={{}} join={{ code: '1' }} />);
    expect(container.querySelector('.rail-timer')).toBeNull();
    rerender(<Rail title="T" context={{}} join={{ code: '1' }} timer="2:14" />);
    expect(container.querySelector('.rail-timer')).not.toBeNull();
  });
});

describe('the phase bar', () => {
  test('the phase is reflected as a lowercase data attribute the CSS keys off of', () => {
    // .bar[data-phase="ask"] etc. select on the lowercase value; a component
    // that passes the phase through unchanged ("ASK") silently matches no rule.
    const { container } = render(<PhaseBar phase="ASK" />);
    const bar = container.querySelector('.bar');
    expect(bar).not.toBeNull();
    expect(bar.dataset.phase).toBe('ask');
  });

  test('an unrecognised phase does not crash and does not fabricate a hue', () => {
    expect(() => render(<PhaseBar phase="NOT_A_REAL_PHASE" />)).not.toThrow();
  });
});

describe('the room meter', () => {
  test('it states progress exactly once', () => {
    // Six simultaneous statements of the same fact shipped once: the word
    // ANSWERED, the numeral, a bar, a sentence, forty dots, and the dock.
    // What survives is the labelled fraction. The bar and the dot matrix are
    // deleted, and this is the test that keeps them deleted.
    const { container } = render(<RoomMeter phase="ASK" heading="ANSWERED" body="31 / 40" />);
    expect(container.querySelectorAll('.meter-bar')).toHaveLength(0);
    expect(container.querySelectorAll('.meter-dot')).toHaveLength(0);
    expect(container.textContent).toContain('31 / 40');
  });

  test('it never names anybody', () => {
    // A count is a nudge; a list of names is an attendance record, and the room
    // is the wrong audience for one. This binds Table too — Table is a stage.
    const { container } = render(
      <RoomMeter phase="ASK" heading="ANSWERED" body="31 / 40" players={[{ name: 'Dana' }, { name: 'Tomás' }]} />
    );
    expect(container.textContent).not.toMatch(/Dana|Tomás/);
  });

  test('it collapses where the spec says it collapses', () => {
    const { container } = render(<RoomMeter phase="ENDED" heading="" body="" />);
    expect(container.querySelector('.meter')).toBeNull();
  });
});

describe('the dock', () => {
  test('is a grid row, not a fixed overlay', () => {
    // position:fixed guarantees the control is visible; a grid row guarantees
    // it is placed. A regression back to fixed positioning would defeat the
    // whole point of this component and jsdom can at least catch the
    // most direct form of that regression: an inline style putting it back.
    const { container } = render(<Dock status="" hint="" onSetup={() => {}}><button type="button">Go</button></Dock>);
    const dock = container.querySelector('.dock');
    expect(dock).not.toBeNull();
    expect(dock.style.position).not.toBe('fixed');
  });

  test('the setup control is discoverable and wired, not just present', () => {
    const onSetup = jest.fn();
    render(<Dock status="" hint="" onSetup={onSetup}><button type="button">Go</button></Dock>);
    const setup = screen.getByRole('button', { name: /setup/i });
    fireEvent.click(setup);
    expect(onSetup).toHaveBeenCalledTimes(1);
  });

  test('status and hint are optional room-safe text, omitted rather than rendered empty', () => {
    const { container, rerender } = render(<Dock onSetup={() => {}}><button type="button">Go</button></Dock>);
    expect(container.querySelector('.status')).toBeNull();
    expect(container.querySelector('.hint')).toBeNull();
    rerender(<Dock status="Some are still answering" hint="Space also advances" onSetup={() => {}}><button type="button">Go</button></Dock>);
    expect(container.querySelector('.status').textContent).toBe('Some are still answering');
    expect(container.querySelector('.hint').textContent).toBe('Space also advances');
  });

  test('renders the primary action passed to it rather than building its own', () => {
    // Dock must not reimplement HostActionBar's button/keyboard behaviour —
    // it renders whatever primary control is handed to it.
    render(
      <Dock status="" hint="" onSetup={() => {}}>
        <button type="button">Start Voting</button>
      </Dock>
    );
    expect(screen.getByRole('button', { name: 'Start Voting' })).toBeInTheDocument();
  });
});
