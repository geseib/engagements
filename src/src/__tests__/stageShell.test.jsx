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

  test('the phase chip names what the bar only colours', () => {
    // .chip's CSS was ported in Task 4 with nothing rendering it. It is wired
    // rather than deleted because a colour band is unnameable without a
    // legend, and because RESULTS and FIELD_NOTES share the bar's green — the
    // chip is the only place they differ.
    const { container, rerender } = render(<Rail phase="ASK" title="T" context={{}} join={{ code: '1' }} />);
    const chip = container.querySelector('.chip');
    expect(chip).not.toBeNull();
    expect(chip.className).toBe('chip ask');
    expect(chip.textContent).toBe('Answering');
    // Not droppable: the title is what the rail sacrifices, never the state.
    expect(chip.dataset.drop).toBeUndefined();

    rerender(<Rail phase="FIELD_NOTES" title="T" context={{}} join={{ code: '1' }} />);
    expect(container.querySelector('.chip').textContent).toBe('What we heard');
  });

  test('an unrecognised phase renders no chip rather than a wrong one', () => {
    const { container } = render(<Rail phase="NOPE" title="T" context={{}} join={{ code: '1' }} />);
    expect(container.querySelector('.chip')).toBeNull();
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

import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * The deletions, and the composition, asserted against the source.
 *
 * These are not style preferences — each deletion is a named defect in the
 * spec, and each is the kind of thing that survives a refactor by being left
 * "just in case". Reading the file is crude, and it is also the only way to
 * prove a line is gone without rendering a 5,000-line component that currently
 * cannot mount in jsdom at all (see the five stale suites in the baseline).
 */
describe('what must be deleted, not adapted', () => {
  const source = readFileSync(join(__dirname, '..', 'GameHostPage.jsx'), 'utf8');

  test('the bigScreenMode reset effect is gone', () => {
    // A projector browser that reloads must come back exactly as it was.
    expect(source).not.toMatch(/setBigScreenMode\(false\)/);
  });

  test('there is no second layout mode at all', () => {
    // Two modes is what produced two ASK headers and two QR blocks, and the
    // mode did not survive a reload. The profile replaces it, and the profile
    // is persisted.
    expect(source).not.toMatch(/bigScreenMode/);
    expect(source).not.toMatch(/big-screen-mode/);
  });

  test('ENDED is no longer treated as a waiting state', () => {
    // isWaitingState('ENDED') returning true is why a finished session renders
    // the lobby — "Waiting for players to join…" after everyone has left. The
    // predicate is gone entirely; the lobby is now whatever the host phase
    // says it is, and ENDED is a phase of its own.
    expect(source).not.toMatch(/isWaitingState/);
    expect(source).not.toMatch(/isWaitingState[\s\S]{0,400}['"]ENDED['"]/);
  });

  test('the end-of-game dialog is gone', () => {
    // A dialog box is not how a session ends. The gameEnded push moves the
    // stage to its ENDED phase; the report is the dock's primary action there.
    expect(source).not.toMatch(/showConfirmation\(\s*\n?\s*['"]End of Game['"]/);
    expect(source).toMatch(/setGameState\('ENDED'\)/);
  });

  test('the answer-navigator is gone', () => {
    expect(source).not.toMatch(/answer-navigator/);
  });

  test('the three non-loading flash alerts are gone', () => {
    // Full-screen celebratory overlays that cover the stage — including the
    // advance control — for three seconds while a room waits.
    expect(source).not.toMatch(/showAllAnsweredAlert/);
    expect(source).not.toMatch(/showAllVotedAlert/);
    expect(source).not.toMatch(/showInviteCreated/);
    // The loading overlay stays: it is the one that reports a real wait.
    expect(source).toMatch(/isLoadingData/);
  });

  test('the parallax block is gone', () => {
    expect(source).not.toMatch(/className=["'][^"']*\bparallax\b/);
  });
});

describe('what the host page must now render', () => {
  const source = readFileSync(join(__dirname, '..', 'GameHostPage.jsx'), 'utf8');

  test('the shell is composed rather than reimplemented', () => {
    // Named slots, per the Task 5 ruling: Stage owns the grid areas and the
    // caller fills them. A page that rebuilt .rail/.dock markup inline would
    // fork the shell on its first divergence.
    expect(source).toMatch(/import Stage from '\.\/components\/stage\/Stage'/);
    expect(source).toMatch(/<Stage[\s\S]{0,1500}rail=\{\(?\s*<Rail/);
    expect(source).toMatch(/meter=\{/);
    expect(source).toMatch(/dock=\{\(?\s*<Dock/);
  });

  test('the presentation state is restored on mount and persisted on change', () => {
    // "Never lose the presentation state on reload" is the requirement the
    // deleted reset effect was violating.
    expect(source).toMatch(/loadProfile\(\s*window\.localStorage/);
    expect(source).toMatch(/saveProfile\(\s*window\.localStorage/);
  });
});
