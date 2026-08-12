/**
 * THE PAGER AS A COMPONENT, AND THE KEY IT SHARES A WINDOW WITH.
 *
 * The second describe block is the one that earns its place. `Pager` and
 * `HostActionBar` both attach a `keydown` listener to `window`, and a presenter
 * clicker sends keys with no meaningful `event.target` — so "it works when I
 * click on the list first" is not a property this feature can have. The harness
 * mounts both, exactly as the stage does, and presses the keys a clicker sends.
 *
 * No geometry is asserted anywhere. jsdom returns zero for every measurement,
 * so a test asking whether a page "fits" would pass with the whole feature
 * deleted.
 */
import React, { useState } from 'react';
import { render, fireEvent, screen } from '@testing-library/react';
import Pager from '../components/stage/Pager';
import HostActionBar from '../components/HostActionBar';
import { hostControlsFor } from '../config/hostControls';
import { shortcutsSuppressed } from '../utils/hostOverlays';

describe('the pager renders a position, or nothing at all', () => {
  test('a list that fits gets no pager', () => {
    // rejects: rendering "page 1 of 1 · ↑ ↓ to page" over three responses. It
    // is a line of stage spent telling a room about a control that would do
    // nothing, and it advertises a key that then appears not to work.
    const { container } = render(
      <Pager total={3} page={0} pageSize={3} onPage={() => {}} />
    );
    expect(container.querySelector('[data-pager]')).toBeNull();
  });

  test('a list that does not fit gets one pip per page and one readable line', () => {
    const { container } = render(
      <Pager total={20} page={1} pageSize={3} onPage={() => {}} />
    );
    expect(container.querySelectorAll('.pip')).toHaveLength(7);
    expect(container.querySelector('.pip.on').getAttribute('aria-current')).toBe('true');
    expect(container.querySelectorAll('.pip.on')).toHaveLength(1);
    expect(container.querySelector('.pgr-label').textContent)
      .toBe('Responses 4–6 of 20 · page 2 of 7 · ↑ ↓ to page');
  });

  test('the last short page still names the responses it is showing', () => {
    // rejects: re-deriving the page size as Math.ceil(total / pages). For 4
    // responses in pages of 3 that is 2, so the line would read "Responses 1–2
    // of 4" over three cards.
    const { container } = render(
      <Pager total={4} page={0} pageSize={3} onPage={() => {}} />
    );
    expect(container.querySelector('.pgr-label').textContent).toContain('Responses 1–3 of 4');
  });

  test('the pips are pressable, because a host may have only a trackpad', () => {
    // rejects: porting the mockup's inert <i> dots unchanged. The arrow keys
    // are the room-facing route; a host driving from a laptop with one hand on
    // a trackpad has no other way to reach page 5.
    const onPage = jest.fn();
    render(<Pager total={20} page={0} pageSize={3} onPage={onPage} />);
    fireEvent.click(screen.getByRole('button', { name: 'Page 5 of 7' }));
    expect(onPage).toHaveBeenCalledWith(4);
  });

  test('it is not in the fitter\'s sacrifice list', () => {
    // rejects: copying 05-vote.html's data-drop="1" across. The mockup's pager
    // annotates a cut the FITTER made; this one announces a cut the PAGER made,
    // so dropping it leaves a room looking at three of twenty responses with
    // nothing on screen saying seventeen more exist. A reduction with no
    // recovery is a deletion (design spec §7.10) and the pager is the recovery.
    const { container } = render(
      <Pager total={20} page={0} pageSize={3} onPage={() => {}} />
    );
    expect(container.querySelector('[data-pager]').hasAttribute('data-drop')).toBe(false);
  });
});

/**
 * The stage's real key surface: a pager and the advance bar on one window.
 */
function StageKeysHarness({ total = 20, pageSize = 3, enabled = true, onAdvance }) {
  const [page, setPage] = useState(0);
  return (
    <>
      <Pager total={total} page={page} pageSize={pageSize} onPage={setPage} enabled={enabled} />
      <span data-testid="page">{String(page)}</span>
      <HostActionBar
        controls={hostControlsFor({
          gameType: 'poll', phase: 'ASK', playerCount: 4, answeredCount: 4,
          votedCount: 0, answerCount: 4, hasQuestionSet: true,
        })}
        onAction={onAdvance}
        shortcutsEnabled={!shortcutsSuppressed({})}
      />
    </>
  );
}

describe('paging shares a window with the room\'s advance key', () => {
  const setup = (props = {}) => {
    const onAdvance = jest.fn();
    const view = render(<StageKeysHarness onAdvance={onAdvance} {...props} />);
    return { ...view, onAdvance, page: () => view.getByTestId('page').textContent };
  };

  test('Down turns the page and Up turns it back', () => {
    // rejects: a component that renders the position and binds nothing, which
    // is the version that passes every rendering test above and leaves the
    // owner's complaint exactly where it was.
    const { page } = setup();
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    expect(page()).toBe('1');
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    expect(page()).toBe('2');
    fireEvent.keyDown(window, { key: 'ArrowUp' });
    expect(page()).toBe('1');
  });

  test('it wraps rather than dead-ending', () => {
    // rejects: clamping at the ends. A key that silently stops working reads as
    // broken from the front of a room; a wrap is legible because the printed
    // position says where it went.
    const { page } = setup({ total: 6, pageSize: 3 });
    fireEvent.keyDown(window, { key: 'ArrowUp' });
    expect(page()).toBe('1');
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    expect(page()).toBe('0');
  });

  test.each([
    [' ', 'Space'],
    ['Spacebar', 'the legacy Space name'],
    ['ArrowRight', 'a clicker\'s forward button'],
  ])('%s still advances the round and does not page (%s)', (k) => {
    // THE DEFECT THIS EXISTS TO PREVENT. A clicker sends keys with no
    // meaningful target, so a pager that swallowed one would take the room's
    // advance key away for the whole of VOTE and RESULTS — the two phases it
    // renders on — while the dock went on printing SPACE.
    //
    // rejects: an unconditional preventDefault/stopPropagation in the pager's
    // handler, and rejects binding any of these three to a page turn.
    const { page, onAdvance } = setup();
    fireEvent.keyDown(window, { key: k });
    expect(onAdvance).toHaveBeenCalledTimes(1);
    expect(page()).toBe('0');
  });

  test('the pager alone marks none of the clicker\'s keys handled', () => {
    // The test above proves the round still advances; this proves the PAGER is
    // why, rather than a swallowed key that happened to reach the bar first.
    // A weaker handler could page nothing and still call preventDefault, which
    // suppresses the browser's own space-activation of a focused button — the
    // exact hazard HostActionBar scopes its own preventDefault for. Rendered
    // WITHOUT HostActionBar, so nothing else can be doing the preventing.
    //
    // rejects: an unconditional `event.preventDefault()` at the top of the
    // pager's handler, before pageIntentFor has declined the key.
    const seen = [];
    const spy = (e) => seen.push({ key: e.key, prevented: e.defaultPrevented });
    render(<Pager total={20} page={0} pageSize={3} onPage={() => {}} />);
    window.addEventListener('keydown', spy);
    [' ', 'Spacebar', 'ArrowRight', 'ArrowLeft', 'PageDown', 'PageUp'].forEach((k) => {
      fireEvent.keyDown(window, { key: k });
    });
    window.removeEventListener('keydown', spy);
    expect(seen).toHaveLength(6);
    seen.forEach((s) => expect(`${s.key}:${s.prevented}`).toBe(`${s.key}:false`));
  });

  test('Down is marked handled, so the document behind the stage does not scroll', () => {
    // rejects: omitting preventDefault on the keys it DOES take. The stage is
    // height:100dvh with overflow:hidden, so the browser's own Down-scroll does
    // nothing visible and moves focus off screen.
    let prevented = null;
    const spy = (e) => { if (e.key === 'ArrowDown') prevented = e.defaultPrevented; };
    setup();
    window.addEventListener('keydown', spy);
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    window.removeEventListener('keydown', spy);
    expect(prevented).toBe(true);
  });

  test('an overlay that takes SPACE away takes the page keys away too', () => {
    // rejects: a pager that ignores `enabled`, and rejects inventing a second
    // suppression rule alongside shortcutsSuppressed. A pinned QR covers the
    // stage including the list being paged; paging underneath it moves content
    // nobody can see and leaves the host on a different page when it comes down.
    const { page } = setup({ enabled: !shortcutsSuppressed({ qrMode: 'pinned' }) });
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    expect(page()).toBe('0');
  });

  test('a PREVIEW does not take the page keys away', () => {
    // rejects: folding qrMode into a boolean. The three-valued qrMode is the
    // whole point of shortcutsSuppressed — a preview is something the host got
    // by resting a mouse near the rail, and taking their keys away for that is
    // taking them away by accident.
    const { page } = setup({ enabled: !shortcutsSuppressed({ qrMode: 'preview' }) });
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    expect(page()).toBe('1');
  });

  test('a list that fits binds nothing', () => {
    // rejects: attaching the listener before the one-page early return, which
    // would preventDefault on Down for every state in the session including the
    // ones with no list at all.
    let prevented = null;
    const spy = (e) => { prevented = e.defaultPrevented; };
    setup({ total: 2, pageSize: 3 });
    window.addEventListener('keydown', spy);
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    window.removeEventListener('keydown', spy);
    expect(prevented).toBe(false);
  });
});
