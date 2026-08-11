/**
 * THE ROSTER REVEAL — the gate, the interaction, and the call site.
 *
 * The owner retired RoomMeter's "it never names anybody" rule and replaced it
 * with a narrower one: the meter names WHO IS STILL WAITING, on demand, never
 * who has acted. stageShell.test.jsx holds what the component renders. This
 * file holds the three things that can go wrong somewhere else:
 *
 *   1. the gate — config/anonymity.js's waitingRoster, which decides whether
 *      the list may be offered at all;
 *   2. the interaction — Rail's QR pattern, including the part where SPACE is
 *      left alone;
 *   3. the call site — GameHostPage, which cannot be mounted in jsdom, so the
 *      wiring is asserted against the source the way hostOverlays and the
 *      stage shell tests already do. A gate the page forgets to call is the
 *      standing failure mode in this repo (see `shortcutsSuppressed`).
 */
import React, { useEffect, useState } from 'react';
import { render, fireEvent, act } from '@testing-library/react';
import { readFileSync } from 'fs';
import { join } from 'path';
import RoomMeter from '../components/stage/RoomMeter';
import HostActionBar from '../components/HostActionBar';
import { hostControlsFor } from '../config/hostControls';
import { shortcutsSuppressed } from '../utils/hostOverlays';
import { waitingRoster, MIN_ANONYMOUS_ANSWERS } from '../config/anonymity';

const roster = (...names) => names.map((name) => ({ name }));

/** An open round: poll with anonymity switched off, so no gate applies. */
const open = {
  gameType: 'poll',
  anonymousUntilReveal: false,
};

/** A hidden round: poll, anonymous, authors not yet revealed. */
const hidden = {
  gameType: 'poll',
  anonymousUntilReveal: true,
  authorsRevealed: false,
};

describe('waitingRoster — who may be named', () => {
  test('it returns the people who have NOT responded', () => {
    // rejects: subtracting the wrong way round, which would name the answerers
    // — a participation league table, and the exact polarity the owner
    // rejected. Every other assertion in this file passes against that bug.
    expect(waitingRoster({
      players: roster('Dana', 'Tomás', 'Jordan'),
      responded: ['Tomás'],
      respondedCount: 1,
      answerCount: 1,
      ...open,
    })).toEqual(['Dana', 'Jordan']);
  });

  test('nobody waiting is [] and not null — the two mean different things', () => {
    // rejects: collapsing "everyone is in" onto "do not offer this". `null` is
    // the gate saying no; `[]` is an answered question with an empty answer.
    // A caller that cannot tell them apart cannot report either honestly.
    expect(waitingRoster({
      players: roster('Dana'), responded: ['Dana'], respondedCount: 1, answerCount: 1, ...open,
    })).toEqual([]);
    expect(waitingRoster({
      players: [], responded: [], respondedCount: 0, answerCount: 0, ...open,
    })).toBeNull();
  });

  test('a participation list that lags the count offers nothing at all', () => {
    // THE CORRECTNESS GUARD, and the one that fires most often. On a hidden
    // round message.js strips the name from every playerAnswered frame, so
    // playersWhoAnswered is only as fresh as the last /state resync while the
    // row count keeps climbing. Subtracting a stale list prints "still
    // waiting: Dana" twenty seconds after Dana answered — and understates the
    // answerer set, which misattributes rather than merely leaking.
    //
    // rejects: dropping the freshness check, or comparing the wrong pair (a
    // check against players.length instead of the count would pass here).
    expect(waitingRoster({
      players: roster('Dana', 'Tomás', 'Jordan'),
      responded: ['Tomás'],       // one name known...
      respondedCount: 2,          // ...but two responses counted
      answerCount: 2,
      ...open,
    })).toBeNull();
  });

  test('a hidden round with too few responses is not named, however many are waiting', () => {
    // THE ANONYMITY GATE. Naming the waiters hands the room the answerer set
    // by subtraction: every response on the stage drops from "one of N" to
    // "one of k". At k = 1 that is complete de-anonymisation produced by a
    // list that mentions the author nowhere.
    //
    // rejects: shipping the reveal with no anonymity gate at all, and rejects
    // the intuitive gate — "only when several people are waiting, so nobody is
    // singled out" — which is backwards on both halves. Nine of ten waiting is
    // the dangerous case; one of forty is the safe one.
    const players = roster('a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j');
    expect(waitingRoster({
      players, responded: ['a'], respondedCount: 1, answerCount: 1, ...hidden,
    })).toBeNull();

    // ...and the same round, once enough responses exist to hide inside.
    const many = ['a', 'b', 'c', 'd', 'e'].slice(0, MIN_ANONYMOUS_ANSWERS);
    expect(waitingRoster({
      players,
      responded: many,
      respondedCount: many.length,
      answerCount: MIN_ANONYMOUS_ANSWERS,
      ...hidden,
    })).not.toBeNull();
  });

  test('the gate counts responses, not waiters', () => {
    // rejects: gating on the size of the waiting list. That guard would block
    // this case — 39 answered, 1 waiting, no leak whatsoever — while
    // permitting the 1-answered/39-waiting case above.
    const players = roster(...Array.from({ length: 40 }, (_, i) => `p${i}`));
    const responded = players.slice(0, 39).map((p) => p.name);
    expect(waitingRoster({
      players, responded, respondedCount: 39, answerCount: 39, ...hidden,
    })).toEqual(['p39']);
  });

  test('the gate lifts when there is nothing left to protect', () => {
    // Two ways a round stops being hidden, and both must lift it or the
    // feature is dead on the states that need it most.
    //
    // rejects: gating on the game TYPE alone (which would keep an
    // anonymity-off poll gated forever), and rejects ignoring authorsRevealed
    // (which would keep a revealed round gated for the rest of its life).
    const players = roster('Dana', 'Tomás', 'Jordan');
    // Trivia never had authorship to protect: the response is a letter.
    expect(waitingRoster({
      players, responded: ['Dana'], respondedCount: 1, answerCount: 1,
      gameType: 'trivia', anonymousUntilReveal: true, authorsRevealed: false,
    })).toEqual(['Tomás', 'Jordan']);
    // A poll whose host switched anonymity off at setup.
    expect(waitingRoster({
      players, responded: ['Dana'], respondedCount: 1, answerCount: 1, ...open,
    })).toEqual(['Tomás', 'Jordan']);
    // An anonymous round whose authors the host has already revealed.
    expect(waitingRoster({
      players, responded: ['Dana'], respondedCount: 1, answerCount: 1,
      ...hidden, authorsRevealed: true,
    })).toEqual(['Tomás', 'Jordan']);
  });

  test('blank and duplicate names cannot pad either side of the subtraction', () => {
    // rejects: counting a redacted row as a person. answeredNamesFrom already
    // drops empties for this reason; a roster entry with no name would
    // otherwise appear on the wall as an empty pill, and a blank in
    // `responded` would inflate the fresh-list check and unblock a stale one.
    expect(waitingRoster({
      players: [{ name: 'Dana' }, { name: '' }, { playerName: 'Tomás' }, { name: 'Dana' }],
      responded: ['', 'Tomás', 'Tomás'],
      respondedCount: 1,
      answerCount: 1,
      ...open,
    })).toEqual(['Dana']);
  });
});

/**
 * The interaction, in the tree the page builds. `rosterMode` lives in
 * GameHostPage — which cannot mount here — so the harness reproduces that
 * wiring, and the source assertions at the bottom are what tie the two
 * together.
 */
function MeterHarness({ names = ['Dana', 'Tomás'], phase = 'ASK', onAdvance = () => {} }) {
  const [rosterMode, setRosterMode] = useState(null);
  useEffect(() => {
    if (!rosterMode) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setRosterMode(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [rosterMode]);

  return (
    <>
      <RoomMeter
        phase={phase}
        heading="Answered"
        body="31 / 40"
        waiting={{
          names,
          mode: rosterMode,
          onPreview: () => setRosterMode((m) => (m === 'pinned' ? m : 'preview')),
          onPreviewEnd: () => setRosterMode((m) => (m === 'pinned' ? m : null)),
          onPin: () => setRosterMode((m) => (m === 'pinned' ? null : 'pinned')),
        }}
      />
      <span data-testid="roster-mode">{String(rosterMode)}</span>
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

describe('the reveal behaves like the QR trigger it was copied from', () => {
  const setup = (props = {}) => {
    const onAdvance = jest.fn();
    const { container, getByTestId } = render(<MeterHarness onAdvance={onAdvance} {...props} />);
    const count = container.querySelector('.meter .count');
    return {
      container,
      count,
      onAdvance,
      mode: () => getByTestId('roster-mode').textContent,
      list: () => container.querySelector('[data-waiting-list]'),
      focusTheCount: () => act(() => { count.focus(); }),
    };
  };

  test('hover previews and leaving dismisses', () => {
    // rejects: click-only, which makes the host stop the session to answer a
    // question they could have glanced at.
    const { count, list, mode } = setup();
    fireEvent.mouseEnter(count);
    expect(mode()).toBe('preview');
    expect(list()).not.toBeNull();
    fireEvent.mouseLeave(count);
    expect(mode()).toBe('null');
    expect(list()).toBeNull();
  });

  test('focus previews, so a keyboard reaches it at all', () => {
    // rejects: a mouse-only implementation — unusable on a laptop driven by
    // keyboard and invisible to a screen reader.
    const { focusTheCount, mode, list } = setup();
    focusTheCount();
    expect(mode()).toBe('preview');
    expect(list()).not.toBeNull();
  });

  test('click pins, and clicking again puts it away', () => {
    // rejects: hover-only (which does not exist on a touchscreen), and rejects
    // a pin with no toggle — this list has no overlay and no scrim, so a
    // second press of the same control is the ONLY dismissal a touchscreen
    // has. Rail can skip the toggle because its QR overlay closes on a click
    // anywhere; there is no such surface here.
    const { count, mode, list } = setup();
    fireEvent.click(count);
    expect(mode()).toBe('pinned');
    // ...and a mouse leaving does not take a pinned list down.
    fireEvent.mouseLeave(count);
    expect(mode()).toBe('pinned');
    expect(list()).not.toBeNull();
    fireEvent.click(count);
    expect(mode()).toBe('null');
    expect(list()).toBeNull();
  });

  test('Enter pins and never reaches a window-level shortcut listener', () => {
    // rejects: role="button" with no onKeyDown. React does not synthesize a
    // click from Enter on an ARIA role the way a native <button> does, so
    // without the handler the keyboard path does not exist — and the element
    // announces itself as a button regardless.
    const windowKeydown = jest.fn();
    window.addEventListener('keydown', windowKeydown);
    const { count, mode } = setup();
    fireEvent.keyDown(count, { key: 'Enter' });
    window.removeEventListener('keydown', windowKeydown);
    expect(mode()).toBe('pinned');
    expect(windowKeydown).not.toHaveBeenCalled();
  });

  test('Escape puts a pinned list away', () => {
    // rejects: deleting the Escape effect. This fails without it — the
    // listener is the only thing that moves the state, and jsdom has no
    // default behaviour for Escape that could pass the test on its own.
    const { count, mode, list } = setup();
    fireEvent.click(count);
    expect(list()).not.toBeNull();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(mode()).toBe('null');
    expect(list()).toBeNull();
  });

  test.each([
    [' ', 'Space'],
    ['Spacebar', 'the legacy Space key name some clickers still send'],
    ['ArrowRight', 'a presenter clicker\'s forward button'],
  ])('%s advances the round instead of toggling the list (%s)', (key) => {
    // SPACE IS NOT OURS TO TAKE. Rail.jsx:98-126 traces what happens when a
    // control on this stage swallows it: clicking to pin focuses the control,
    // Escape dismisses without firing a blur, so focus is still here when the
    // host reaches for the advance key the dock is still advertising.
    //
    // rejects: any handler that intercepts Space here, and any that covers
    // Space but not 'Spacebar' or ArrowRight — HostActionBar treats all three
    // as advance keys, so a clicker's two buttons would otherwise behave
    // differently depending on where focus happened to land.
    const { count, focusTheCount, onAdvance, mode } = setup();
    focusTheCount();
    fireEvent.click(count);
    expect(mode()).toBe('pinned');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(document.activeElement).toBe(count);

    fireEvent.keyDown(count, { key });
    expect(onAdvance).toHaveBeenCalledTimes(1);
    expect(mode()).toBe('null');
  });

  test('a pinned list leaves the advance key live', () => {
    // rejects: adding the roster to shortcutsSuppressed by analogy with the
    // pinned QR. The QR covers the stage including the dock, so suppressing
    // is right there; this draws a few lines inside the meter's own column
    // with the primary button untouched beneath it, so suppressing would take
    // SPACE away while the dock went on printing it.
    const { count, onAdvance, mode } = setup();
    fireEvent.click(count);
    expect(mode()).toBe('pinned');
    fireEvent.keyDown(count, { key: ' ' });
    expect(onAdvance).toHaveBeenCalledTimes(1);
  });

  test('a long list abbreviates the count, never a person', () => {
    // rejects: printing forty names into a fixed-height column (the fitter
    // clips it), and rejects truncating a name to fit — "Aleksandra …" on
    // 10-ended.html is the defect two of three evaluators called a blocker,
    // and these are the same people's names.
    //
    // Not a geometric assertion: what is checked is that the overflow is
    // expressed as a count and that every name printed is printed whole.
    const names = Array.from({ length: 12 }, (_, i) => `Person ${i}`);
    const { container } = setup({ names });
    fireEvent.click(container.querySelector('.meter .count'));
    const items = Array.from(container.querySelectorAll('[data-waiting-list] li'));
    expect(items).toHaveLength(8);
    items.forEach((li, i) => expect(li.textContent).toBe(`Person ${i}`));
    expect(container.querySelector('[data-waiting-list] .more').textContent).toBe('+ 4 more');
  });
});

/**
 * THE CALL SITE. Six precedents say GameHostPage cannot be rendered in jsdom,
 * so the wiring is read from the source — the same technique the stage-shell
 * and panel tests use, and the answer to this repo's standing failure mode:
 * an extracted, tested rule that the page then calls with the wrong arguments,
 * or does not call at all.
 */
describe('GameHostPage wires the reveal through the gate', () => {
  const source = readFileSync(join(__dirname, '..', 'GameHostPage.jsx'), 'utf8');
  const markup = source.replace(/\/\*[\s\S]*?\*\//g, '');

  test('the page asks the gate rather than assembling a list itself', () => {
    // rejects: computing `players.filter(...)` inline at the meter, which is
    // the shortest path to shipping this and skips every guard in
    // waitingRoster — including the anonymity one.
    expect(source).toMatch(/import \{[\s\S]{0,400}waitingRoster[\s\S]{0,400}\} from '\.\/config\/anonymity'/);
    const at = markup.indexOf('waitingRoster({');
    expect(at).toBeGreaterThan(-1);
    const call = markup.slice(at, markup.indexOf('})', at));
    // Every argument the gate needs. A missing anonymity argument does not
    // throw — it reads as undefined and quietly opens the gate.
    ['players', 'responded', 'respondedCount', 'answerCount', 'gameType',
      'anonymousUntilReveal', 'authorsRevealed'].forEach((arg) => {
      expect(call).toMatch(new RegExp(`\\b${arg}\\b`));
    });
    // The freshness guard only means something if the count passed is the
    // meter's own numerator and the names are the participation list.
    expect(call).toMatch(/responded:\s*hostPhase === 'VOTE' \? playersWhoVoted : playersWhoAnswered/);
    expect(call).toMatch(/respondedCount:\s*hostPhase === 'VOTE' \? playersWhoVoted\.length : answeredCount/);
    // The anonymity gate measures the CONTENT on the wall, so the response
    // count is the round's answers — not the voted count, and not the roster.
    expect(call).toMatch(/answerCount:\s*answers\.length/);
    // The server flag, not the RESULTS display toggle, which does not exist
    // on the two phases this meter appears on.
    expect(call).toMatch(/authorsRevealed,/);
    expect(call).not.toMatch(/authorsHiddenOnStage/);
  });

  test('the lobby count is not a reveal', () => {
    // rejects: extending the affordance to LOBBY, where the only list
    // available is who has JOINED — the polarity the owner rejected. The
    // guard is that the gate is only consulted on ASK and VOTE.
    const at = markup.indexOf('const waitingNames');
    expect(at).toBeGreaterThan(-1);
    const condition = markup.slice(at, markup.indexOf('? waitingRoster', at));
    // The phases named, ENUMERATED — not merely "ASK and VOTE appear". An
    // assertion that only looked for those two goes on passing when a third
    // is appended, which is exactly how this would be extended by someone
    // reading the design sentence ("the room count and the fractions")
    // without the reason the lobby is excluded.
    expect(condition.match(/hostPhase === '(\w+)'/g))
      .toEqual(["hostPhase === 'ASK'", "hostPhase === 'VOTE'"]);
  });

  test('the meter is handed names only when there are names, and handlers with them', () => {
    // rejects: passing `{ names: waitingNames }` with no handlers (a control
    // that opens nothing) and passing an empty list (a control that opens an
    // empty box). RoomMeter refuses both, and this keeps the page from
    // relying on that refusal.
    const at = markup.indexOf('<RoomMeter');
    expect(at).toBeGreaterThan(-1);
    const el = markup.slice(at, markup.indexOf('/>', at));
    expect(el).toMatch(/waiting=\{meterWaiting\}/);

    const defAt = markup.indexOf('const meterWaiting');
    expect(defAt).toBeGreaterThan(-1);
    const def = markup.slice(defAt, markup.indexOf(';', defAt));
    expect(def).toMatch(/waitingNames && waitingNames\.length/);
    expect(def).toMatch(/names:\s*waitingNames/);
    expect(def).toMatch(/mode:\s*rosterReveal/);
    expect(def).toMatch(/\.\.\.rosterHandlers/);
    expect(def).toMatch(/:\s*null/);
  });

  test('a pinned list cannot ride into the next round', () => {
    // rejects: a bare `useState(null)` mode. The one property that makes
    // naming the waiting acceptable is that the host asked for it NOW; a mode
    // that survives the beat puts names on the wall in the next round with
    // nobody having asked. The mode carries the round it belongs to and is
    // read back only for that round.
    expect(markup).toMatch(/const rosterKey = `\$\{hostPhase\}#\$\{lessonNumber\}`/);
    expect(markup).toMatch(/rosterMode\.key === rosterKey \? rosterMode\.mode : null/);
  });

  test('the page, not just the harness, gives a pinned list a way down', () => {
    // The harness above proves a TOGGLING onPin dismisses the list; it cannot
    // prove the page's onPin toggles, because the harness writes its own. On
    // a touchscreen — no hover, no Escape key — a non-toggling pin is a list
    // that goes up and stays up for the rest of the round.
    //
    // rejects: copying Rail's `onPin: () => setMode('pinned')` unchanged.
    // Rail can afford that; its QR overlay closes on a click anywhere, and
    // this has no overlay.
    const at = markup.indexOf('const rosterHandlers');
    expect(at).toBeGreaterThan(-1);
    const handlers = markup.slice(at, markup.indexOf('\n  };', at));
    ['onPreview', 'onPreviewEnd', 'onPin'].forEach((h) => {
      expect(handlers).toMatch(new RegExp(`${h}:`));
    });
    // A preview must not clear a pin, and a pin must clear itself.
    expect(handlers).toMatch(/onPreview: \(\) => setRosterMode\(\(m\) => \(m && m\.key === rosterKey && m\.mode === 'pinned'/);
    expect(handlers).toMatch(/onPin: \(\) => setRosterMode\(\(m\) => \(m && m\.key === rosterKey && m\.mode === 'pinned'\s*\n?\s*\? null/);
  });

  test('the page, not just the harness, dismisses on Escape', () => {
    // THE HARNESS ABOVE PROVES THE COMPONENT, NOT THE PAGE. `rosterMode` and
    // its Escape listener live in GameHostPage, which cannot mount here, so
    // the interaction tests reimplement that wiring — and would stay green if
    // the page shipped without it. This is the half they cannot see.
    //
    // rejects: deleting the Escape effect, and rejects binding it to anything
    // but the roster's own mode (a listener that never detaches, or one that
    // clears qrMode instead, would leave a pinned list on the wall with the
    // keyboard's only dismissal gone).
    const at = markup.indexOf('const [rosterMode, setRosterMode]');
    expect(at).toBeGreaterThan(-1);
    const effect = markup.slice(at, at + 500);
    expect(effect).toMatch(/if \(!rosterMode\) return undefined;/);
    expect(effect).toMatch(/e\.key === 'Escape'/);
    expect(effect).toMatch(/setRosterMode\(null\)/);
    expect(effect).toMatch(/removeEventListener\('keydown'/);
    expect(effect).toMatch(/\}, \[rosterMode\]\)/);
  });

  test('the reveal re-keys the fitter', () => {
    // rejects: opening the list without re-measuring. The meter is a box the
    // fitter fits (`.rail, .meter`), and its deps live in Stage while the
    // state lives here — so a reveal that is not in fitKey opens a list into
    // a column sized for a two-line count.
    const at = markup.indexOf('fitKey={[');
    expect(at).toBeGreaterThan(-1);
    const key = markup.slice(at, markup.indexOf('].join', at));
    expect(key).toMatch(/rosterReveal/);
  });

  test('the roster is not folded into the shortcut suppressor', () => {
    // rejects: `shortcutsSuppressed({ ..., rosterMode })`. The QR does belong
    // there and this does not: an inline list in the meter's column covers
    // nothing, so suppressing would take the host's advance key away while
    // the dock still advertised SPACE.
    const at = markup.indexOf('shortcutsSuppressed({');
    expect(at).toBeGreaterThan(-1);
    expect(markup.slice(at, markup.indexOf('})', at))).not.toMatch(/rosterMode/);
  });
});
