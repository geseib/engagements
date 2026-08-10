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

function Harness({ deps = [], dock = false }) {
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
      {dock && <footer className="dock" />}
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
    // `removed === added` alone is satisfied by 0 === 0, so a hook whose whole
    // effect body were `return undefined` — no listener, no fitting, no
    // cleanup to get wrong — passed this test. Assert the listener was
    // actually attached before asserting it was taken away.
    expect(added).toBeGreaterThan(0);
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

  /**
   * The named slots — the Task 5 ruling's whole subject, and until now the one
   * part of it nothing asserted.
   */
  test('a supplied rail replaces the placeholder rather than nesting inside it', () => {
    // The ruling says "rendered inside the wrapper div that already exists".
    // Taken literally that puts <header class="rail"> inside <div class="rail">:
    // two elements on one grid area, doubled padding, and TWO boxes for the
    // fitter's `.rail` query — which measures and sacrifices per box.
    const { container } = render(
      <Stage profile="room" phase="ASK" rail={<div className="rail">R</div>}><div /></Stage>
    );
    expect(container.querySelectorAll('.rail')).toHaveLength(1);
    expect(container.querySelector('.rail').textContent).toBe('R');
    // And the grid areas are still in order with a slot filled.
    const areas = Array.from(container.querySelectorAll('.stage > *'))
      .map((el) => el.className.split(' ')[0]);
    expect(areas).toEqual(['field', 'rail', 'bar', 'main', 'dock']);
  });

  test('a supplied dock replaces the placeholder rather than nesting inside it', () => {
    const { container } = render(
      <Stage profile="room" phase="ASK" dock={<footer className="dock">D</footer>}><div /></Stage>
    );
    expect(container.querySelectorAll('.dock')).toHaveLength(1);
  });

  test('.main runs solo exactly when there is no meter', () => {
    // `solo` is what collapses the meter's column, and it is also what
    // widen() toggles when the fitter sacrifices the meter. A .main that is
    // never solo leaves an empty 233px column on every state that has no
    // meter — RESULTS, FIELD_NOTES and ENDED, which is half the session.
    const { container, rerender } = render(<Stage profile="room" phase="RESULTS"><div /></Stage>);
    expect(container.querySelector('.main').classList.contains('solo')).toBe(true);

    rerender(
      <Stage profile="room" phase="ASK" meter={<aside className="meter">4</aside>}><div /></Stage>
    );
    expect(container.querySelector('.main').classList.contains('solo')).toBe(false);
    expect(container.querySelectorAll('.main .meter')).toHaveLength(1);
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

  test('a closed session states that it is closed rather than inviting people in', () => {
    // ENDED passed `join` unconditionally, so a finished session went on
    // reading "JOIN eng.seibtribe.us/play 4821" at a room that had just been
    // told the session was over — an instruction to do something that no
    // longer works, on the one screen that exists to say it is over.
    // 10-ended.html's rail: `Session 4821 · closed`.
    const { container } = render(
      <Rail phase="ENDED" title="T" context={{}} join={{ code: '4821', closed: true }} />
    );
    expect(container.querySelector('[data-join-word]')).toBeNull();
    expect(container.querySelector('[data-join-url]')).toBeNull();
    expect(container.querySelector('.rail-join').textContent).toBe('Session 4821 · closed');
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
    // not.toThrow() alone asserts only half of the test's own name: a PhaseBar
    // that passed "not_a_real_phase" straight through — or worse, fell back to
    // "ask" and painted the room amber mid-results — would not throw either.
    // The named fallback is the neutral one.
    const { container } = render(<PhaseBar phase="NOT_A_REAL_PHASE" />);
    const bar = container.querySelector('.bar');
    expect(bar).not.toBeNull();
    expect(bar.dataset.phase).toBe('lobby');
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
    // STRENGTHENED, not deleted. The previous version asserted
    // `dock.style.position !== 'fixed'` — an INLINE style, which nothing in
    // this codebase has ever written and no plausible regression would. It
    // passed against every implementation including ones with no dock at all,
    // and it would have gone on passing if `.dock` in the stylesheet were
    // changed to position:fixed, which is the only way this regression can
    // actually happen. jsdom applies no stylesheet, so the rule is read from
    // the source instead — the same technique the panel tests below use.
    const { container } = render(<Dock status="" hint="" onSetup={() => {}}><button type="button">Go</button></Dock>);
    const dock = container.querySelector('.dock');
    expect(dock).not.toBeNull();
    // A footer, not a floating div: the element is placed by the grid.
    expect(dock.tagName).toBe('FOOTER');
    expect(dock.style.position).toBe('');

    const stageCss = readFileSync(join(__dirname, '..', 'styles', 'stage.css'), 'utf8');
    const at = stageCss.indexOf('\n.dock{');
    expect(at).toBeGreaterThan(-1);
    const rule = stageCss.slice(at, stageCss.indexOf('}', at));
    expect(rule).toMatch(/grid-area:\s*dock/);
    expect(rule).not.toMatch(/position:\s*fixed/);
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

  test('the SPACE affordance is the dock\'s own, not HostActionBar\'s', () => {
    // HostActionBar renders a `.host-action-bar__kbd` and then hides it under
    // `.big-screen-mode` — the mode the dock ALWAYS passes — so the hint was
    // invisible in all four profiles. That is the state the `.dock .kbd` note
    // in styles/stage.css exists to prevent, undone by composition. Every
    // mockup dock carries this span.
    const { container, rerender } = render(<Dock onSetup={() => {}}><button type="button">Go</button></Dock>);
    expect(container.querySelector('.kbd')).toBeNull();
    rerender(<Dock kbd="SPACE" onSetup={() => {}}><button type="button">Go</button></Dock>);
    const kbd = container.querySelector('.kbd');
    expect(kbd.textContent).toBe('SPACE');
    // A visual affordance for the operator, not a control the room's assistive
    // tech should announce between the button and its status.
    expect(kbd.getAttribute('aria-hidden')).toBe('true');
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
    //
    // Scoped to the <Stage> element rather than to the file. The first version
    // of this asserted `/meter=\{/` against the whole 5,000-line source, which
    // any `meter={` anywhere would satisfy — and it asserted `rail={(<Rail`
    // with the parenthesis and whitespace spelled out, which had to be widened
    // twice for the implementer's own formatting. Both are fixed here: the
    // window makes it falsifiable, and asking for the prop and the component
    // separately makes it survive a reformat.
    expect(source).toMatch(/import Stage from '\.\/components\/stage\/Stage'/);

    const windows = [];
    for (let i = source.indexOf('<Stage'); i !== -1; i = source.indexOf('<Stage', i + 1)) {
      windows.push(source.slice(i, i + 2000));
    }
    expect(windows.length).toBeGreaterThan(0);

    // ONE <Stage> has to carry all three, which is what "composed" means. A
    // window per occurrence because the identifier also appears in prose above
    // the element; requiring the conjunction is what keeps that from counting.
    const slots = [['rail', '<Rail'], ['meter', '<RoomMeter'], ['dock', '<Dock']];
    const composed = windows.some((w) => slots.every(
      ([slot, component]) => new RegExp(`\\b${slot}=\\{`).test(w) && w.includes(component)
    ));
    expect(composed).toBe(true);
  });

  test('the dock carries the keyboard affordance and the disabled reason', () => {
    // HostActionBar renders both and then hides both under .big-screen-mode —
    // the mode the dock always passes — so a dock that does not pass them
    // itself leaves the host with a greyed-out button and no reason, and a
    // keyboard shortcut with no sign it exists, in all four profiles.
    const at = source.indexOf('<Dock');
    const dockEl = source.slice(at, at + 400);
    expect(dockEl).toMatch(/\bkbd=\{/);
    expect(dockEl).toMatch(/\bhint=\{/);
  });

  test('the RESULTS authors toggle is not something the fitter may sacrifice', () => {
    // On RESULTS the meter runs solo, so this was the ONLY data-drop group on
    // the state: the first and only thing dropped before the terminal clamp,
    // with no note to say it had gone. Losing it while the names are showing
    // leaves them on the projector with no way to take them down.
    const at = source.indexOf('stage-authors-toggle');
    expect(at).toBeGreaterThan(-1);
    expect(source.slice(at, at + 200)).not.toMatch(/data-drop=/);
  });

  test('a finished session does not advertise a live join on the rail', () => {
    // Rail honours `closed` when it is given it (see 'a closed session
    // states that it is closed' above) — but that only matters if
    // GameHostPage actually passes it. It used to not: `join={gameId ? {url,
    // code} : {}}` was unconditional, so a finished room still projected
    // `JOIN eng.seibtribe.us/play 4821`. Scoped to the join prop's own
    // window, the same technique as the toggle test above, so a revert of
    // the ENDED branch fails here even though Rail's own test stays green.
    const at = source.indexOf('join={gameId');
    expect(at).toBeGreaterThan(-1);
    const joinProp = source.slice(at, at + 300);
    expect(joinProp).toMatch(/hostPhase === 'ENDED'/);
    expect(joinProp).toMatch(/closed:\s*true/);
  });

  /**
   * CHROME IS SACRIFICED BEFORE CONTENT — the rule the whole drop ladder
   * exists to express, and the one thing nothing asserted.
   *
   * The fitter drops ASCENDING, and the mockups fix the polarity:
   * 06-results-call-and-answer numbers its un-noted chrome "1" and "2" and its
   * room-facing content "3" ("3rd place") and "4" ("2nd place"). A group with a
   * data-drop-note is content — it announces its own loss through .reduced —
   * and a group without one is chrome, which goes silently. So every chrome
   * number must sort before every content number.
   *
   * This shipped exactly backwards. "Full prompt" was 1 and "How to answer" was
   * 2 on ASK, "The prompt" was 1 on VOTE, and the host-only Reveal Authors
   * control and its two-line irreversibility warning were 4 — so a dense ASK
   * discarded the question's own text, then the instructions for answering it,
   * and kept a button nobody in the room can press. On VOTE it discarded the
   * one line saying what was being voted on. Each number was reviewed on its
   * own, by the task that added it; nothing ever compared them.
   *
   * Read from the source rather than rendered: the numbers are scoped per
   * .content and the phases are mutually exclusive, so no single render shows
   * more than one state's worth, and GameHostPage cannot mount in jsdom at all
   * (see the stale suites in the baseline). Asserting it file-wide is stricter
   * than the DOM requires, which is the right direction for this rule.
   */
  test('chrome is sacrificed before content, in every state', () => {
    // Comments are stripped first. The numbering is documented in prose right
    // above the markup — including the numbers it used to have — and a scan
    // that counted those would report the file's own explanation of the bug as
    // the bug.
    const markup = source.replace(/\/\*[\s\S]*?\*\//g, '');
    // Each match runs from `data-drop="N"` to the end of that JSX tag, so the
    // note is found only when it is on the SAME element.
    const groups = [];
    const re = /data-drop="(\d+)"([^>]*)>/g;
    let m = re.exec(markup);
    while (m !== null) {
      groups.push({ order: Number(m[1]), announced: /data-drop-note="/.test(m[2]) });
      m = re.exec(markup);
    }
    // The states this covers: LOBBY, ASK, VOTE and FIELD_NOTES all carry
    // groups. A refactor that silently stopped matching would pass everything
    // below on an empty set.
    expect(groups.length).toBeGreaterThanOrEqual(7);

    const chrome = groups.filter((g) => !g.announced).map((g) => g.order);
    const content = groups.filter((g) => g.announced).map((g) => g.order);
    // Both kinds have to exist, or the comparison below is vacuous — the same
    // 0 === 0 hole the resize-listener test had.
    expect(chrome.length).toBeGreaterThan(0);
    expect(content.length).toBeGreaterThan(0);
    expect(Math.max(...chrome)).toBeLessThan(Math.min(...content));
  });

  test('the presentation state is restored on mount and persisted on change', () => {
    // "Never lose the presentation state on reload" is the requirement the
    // deleted reset effect was violating.
    expect(source).toMatch(/loadProfile\(\s*window\.localStorage/);
    expect(source).toMatch(/saveProfile\(\s*window\.localStorage/);
  });
});

describe('the side panels and the dock', () => {
  const css = readFileSync(join(__dirname, '..', 'styles.css'), 'utf8');

  /**
   * THE CRITICAL, as close as jsdom can get to it.
   *
   * Both panels are fixed at z-index 1000; `.stage` is position:relative with
   * no z-index, so it creates no stacking context and `.dock`'s z-index 12
   * competes with 1000 in the root stacking context and loses. Measured at
   * 1920x1080 with a question set chosen, the 600px Game Info panel covered
   * x∈[1320,1920] and the primary action sat at roughly [1600,1864]: fully
   * covered, by the panel its own SETUP button opens.
   *
   * jsdom applies no stylesheet and cannot see a z-index, so this asserts the
   * rule and the browser pass asserts the geometry. It fails against the file
   * as it stood.
   */
  /*
   * `.instructions-sidebar` and `.qr-sidebar` were the two panels this was
   * written against. Both are deleted; `.setup-panel` replaced them, along
   * with the full-screen question browser that used to cover the dock at
   * `z-index: 999999`. The RULE is unchanged and now has one subject plus its
   * scrim — the scrim matters as much as the panel, because a scrim over the
   * dock swallows the click even where nothing is drawn.
   */
  for (const selector of ['.setup-panel', '.setup-panel-scrim']) {
    test(`${selector} stops short of the dock rather than covering it`, () => {
      const at = css.indexOf(`\n${selector} {`);
      expect(at).toBeGreaterThan(-1);
      const rule = css.slice(at, css.indexOf('}', at));
      // --dock-measured, not --dock-h: the token is the dock's MIN-height and
      // the dock outgrows it on a short viewport, which left the panel lapping
      // over the primary button by 2px at 1280x720 in Table.
      expect(rule).toMatch(/bottom:\s*var\(--dock-measured, var\(--dock-h/);
      expect(rule).toMatch(/position:\s*fixed/);
      expect(rule).not.toMatch(/bottom:\s*0/);
    });
  }

  test('nothing on the host page carries the browser modal\'s old z-index', () => {
    // rejects: reintroducing `z-index: 999999`, which was the highest in the
    // codebase by three orders of magnitude and drew over the dock — audit A6.
    expect(css).not.toMatch(/z-index:\s*999999/);
  });

  test('the dock publishes its measured height for the panels to subtract, and clears it on unmount', () => {
    // jsdom reports every box as zero-sized (scrollHeight/clientHeight are
    // always 0), but getBoundingClientRect is a separate code path — the one
    // publishDockHeight actually reads — so it can be stubbed here without
    // disturbing the fitter's own scrollHeight-based measurements elsewhere
    // in this file. That is what makes this assertion real rather than a
    // restatement of the source: delete the `publishDockHeight()` call in
    // useStageFit.js and this fails, because nothing sets the property.
    const getRect = jest.spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockReturnValue({
        height: 100, width: 0, top: 0, left: 0, right: 0, bottom: 100, x: 0, y: 0, toJSON() {},
      });
    try {
      const { unmount } = render(<Harness dock />);
      expect(document.documentElement.style.getPropertyValue('--dock-measured')).toBe('100px');
      unmount();
      // Nothing else removes a property set on the document root, and a
      // stale one would size a panel on a page that has no dock at all.
      expect(document.documentElement.style.getPropertyValue('--dock-measured')).toBe('');
    } finally {
      getRect.mockRestore();
    }
  });
});
