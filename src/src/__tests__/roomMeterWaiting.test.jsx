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
import {
  waitingRoster, joinedRoster, waitingNamesCaution, MIN_ANONYMOUS_ANSWERS,
} from '../config/anonymity';

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

  /**
   * THE RULE THIS REPLACES, AND IT IS THE POINT OF THIS REVISION.
   *
   * This was `test('a hidden round with too few responses is not named, however
   * many are waiting')`, and it held `answerCount < MIN_ANONYMOUS_ANSWERS →
   * null`: the waiting list withheld on an anonymous round until five responses
   * were in, with no override anywhere. THE OWNER OVERRULED IT — *"i said it was
   * ok to reveal names if the host really wants to... the host has the info and
   * the control"* — so the block is gone and the decision is a session setting.
   * The test is rewritten to assert the NEW rule rather than deleted, because
   * the risk it was protecting against is unchanged; only who decides has moved.
   *
   * The old block also failed the owner's own room. A team of four never reaches
   * five responses, so the list was dead for the whole session and nothing said
   * why — the reason a default-ON setting, not a default-OFF one, is the honest
   * replacement.
   */
  test('a hidden round is named or not because the HOST said so, never because of a count', () => {
    // rejects: leaving the count gate in place under any name. The first case
    // is the one the old rule refused outright — 10 players, 1 response, 9
    // waiting — and it is now offered, because the host has not said otherwise.
    const players = roster('a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j');
    expect(waitingRoster({
      players, responded: ['a'], respondedCount: 1, answerCount: 1, ...hidden,
    })).toEqual(['b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j']);

    // rejects: ignoring the setting, which would make the control decorative.
    expect(waitingRoster({
      players, responded: ['a'], respondedCount: 1, answerCount: 1, ...hidden,
      nameWaitingWhenAnonymous: false,
    })).toBeNull();

    // DEFAULT ON, and only an explicit `false` turns it off — the same rule
    // anonymousUntilReveal uses, so the two host settings read the same way.
    // rejects: a truthiness test (`if (!nameWaiting)`), which would refuse for
    // an undefined prop and kill the feature the moment a caller forgot it.
    [undefined, null, true].forEach((value) => {
      expect(waitingRoster({
        players, responded: ['a'], respondedCount: 1, answerCount: 1, ...hidden,
        nameWaitingWhenAnonymous: value,
      })).not.toBeNull();
    });

    // ...and above the old threshold nothing changed either way: the number no
    // longer decides anything here.
    // rejects: moving the constant into the condition again from the other side.
    expect(waitingRoster({
      players,
      responded: ['a', 'b', 'c', 'd', 'e'],
      respondedCount: MIN_ANONYMOUS_ANSWERS,
      answerCount: MIN_ANONYMOUS_ANSWERS,
      ...hidden,
      nameWaitingWhenAnonymous: false,
    })).toBeNull();
  });

  test('the host setting binds only while there is something to protect', () => {
    // rejects: applying the setting to an open round. On a session that
    // attributes its authors there is no subtraction to worry about, so a host
    // who once switched the waiting names off must not lose the list on a
    // format that never hid anything — that would be a second, invisible rule.
    const players = roster(...Array.from({ length: 40 }, (_, i) => `p${i}`));
    const responded = players.slice(0, 39).map((p) => p.name);
    expect(waitingRoster({
      players, responded, respondedCount: 39, answerCount: 39, ...open,
      nameWaitingWhenAnonymous: false,
    })).toEqual(['p39']);
    // The same room on a hidden round: now it binds.
    expect(waitingRoster({
      players, responded, respondedCount: 39, answerCount: 39, ...hidden,
      nameWaitingWhenAnonymous: false,
    })).toBeNull();
  });

  test('the setting lifts when there is nothing left to protect', () => {
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
 * THE SENTENCE THAT REPLACED THE BLOCK.
 *
 * `MIN_ANONYMOUS_ANSWERS` used to refuse; it now words a caution and the host
 * decides. These tests hold the half of the old rule that survived — the risk is
 * measured in RESPONSES, not in waiters — and the half that is new: it is
 * information, so it must be specific, and it must not be on screen when there
 * is nothing to be careful about.
 */
describe('waitingNamesCaution — information, not gating', () => {
  test('it says nothing when there is nothing to be careful about', () => {
    // rejects: a caution that is always on screen, which is a caution nobody
    // reads. Three ways a round has no anonymity to lose, and all three must
    // silence it or the panel cries wolf on every trivia game.
    expect(waitingNamesCaution({
      answerCount: 1, gameType: 'trivia', anonymousUntilReveal: true,
    })).toBeNull();
    expect(waitingNamesCaution({ answerCount: 1, ...open })).toBeNull();
    expect(waitingNamesCaution({
      answerCount: 1, ...hidden, authorsRevealed: true,
    })).toBeNull();
  });

  test('below the old threshold it says so, and says it strongly', () => {
    // rejects: dropping `strong`, which is the only machine-readable half — the
    // panel styles the caution from it, and without it the dangerous case and
    // the safe one look identical on a projector.
    const c = waitingNamesCaution({ answerCount: 2, ...hidden });
    expect(c.strong).toBe(true);
    // rejects: a generic disclaimer. The live count is IN the sentence, which
    // is the whole difference between "this may reduce anonymity" and a fact
    // the host can act on.
    expect(c.text).toMatch(/\b2 responses\b/);
    // rejects: keeping the old constant as a boundary bug — 4 is cautioned
    // strongly, 5 is not, matching MIN_ANONYMOUS_ANSWERS exactly.
    expect(waitingNamesCaution({ answerCount: MIN_ANONYMOUS_ANSWERS - 1, ...hidden }).strong)
      .toBe(true);
    expect(waitingNamesCaution({ answerCount: MIN_ANONYMOUS_ANSWERS, ...hidden }).strong)
      .toBe(false);
  });

  test('one response is singular, and none is neither', () => {
    // rejects: `${n} responses` unconditionally — "1 responses in" on the one
    // round where the subtraction is total is the sentence a host reads least
    // charitably. And rejects treating an empty round as the dangerous case:
    // there is nothing on the stage to attribute yet, so saying so is honest
    // and saying "0 responses — few enough to identify" is not.
    expect(waitingNamesCaution({ answerCount: 1, ...hidden }).text).toMatch(/\b1 response\b/);
    const none = waitingNamesCaution({ answerCount: 0, ...hidden });
    expect(none.strong).toBe(false);
    expect(none.text).toMatch(/nothing to work out/);
  });

  test('it measures responses, not waiters', () => {
    // THE HALF OF THE OLD RULE THAT DID NOT CHANGE. rejects: wording the
    // caution from the size of the waiting list. 39 responses in and 1 person
    // waiting is the SAFE case; 1 response and 39 waiting is the catastrophic
    // one, and a caution built on the waiting count says the opposite of the
    // truth in both.
    expect(waitingNamesCaution({ answerCount: 39, ...hidden }).strong).toBe(false);
    expect(waitingNamesCaution({ answerCount: 1, ...hidden }).strong).toBe(true);
  });
});

/**
 * THE LOBBY'S LIST — the other polarity, and the owner's second ruling.
 *
 * The lobby was excluded from the reveal precisely because the only list it can
 * draw is who has JOINED. The owner has since asked for that list ("so we know
 * who has joined, and for small groups easily see who is missing"), so it is a
 * separate function with a separate polarity rather than a flag on the one
 * above — and these tests exist to keep the two from being merged by anyone who
 * notices they both subtract from the same roster. One of them does not
 * subtract at all.
 */
describe('joinedRoster — who is already here', () => {
  test('it names everybody in the room, which is the OPPOSITE set to waitingRoster', () => {
    // rejects: implementing the lobby list by calling waitingRoster with an
    // empty `responded` — which returns the same names today and diverges the
    // moment anybody answers, and which would drag the anonymity gate along
    // with it. The two functions are asserted against the same roster here so
    // the difference is visible in one screenful.
    const players = roster('Dana', 'Tomás', 'Jordan');
    expect(joinedRoster({ players })).toEqual(['Dana', 'Tomás', 'Jordan']);
    expect(waitingRoster({
      players, responded: ['Dana'], respondedCount: 1, answerCount: 1, ...open,
    })).toEqual(['Tomás', 'Jordan']);
  });

  test('an empty room offers nothing at all', () => {
    // rejects: returning [] for an empty room. `null` is what the call site
    // reads as "no reveal", and an empty array would hand the meter an
    // affordance that opens a box with nothing in it.
    expect(joinedRoster({ players: [] })).toBeNull();
    expect(joinedRoster({})).toBeNull();
    expect(joinedRoster()).toBeNull();
  });

  test('blanks and duplicates cannot pad the room', () => {
    // rejects: printing the roster raw. Two rows for one name is normal here —
    // join-game.js keys players by name and a rejoin writes a second record —
    // and the same person twice on the wall reads as two people.
    expect(joinedRoster({
      players: [{ name: 'Dana' }, { name: '' }, { playerName: 'Tomás' }, { name: 'Dana' }, null],
    })).toEqual(['Dana', 'Tomás']);
  });

  test('NO ANONYMITY GATE — an anonymous poll still names its lobby', () => {
    // THE OWNER'S RULING, and the one an implementation gets wrong by being
    // careful. The round phases have an anonymity rule at all because naming
    // the waiters shrinks the anonymity set of the responses on the stage. In a
    // lobby there are no responses — answers is empty, no round has opened — so
    // there is nothing to shrink, and the round-phase rule must not reach here
    // in any of its forms. It used to be an automatic threshold against
    // `answerCount`, which in a lobby is a constant zero: routing the lobby
    // through it would have suppressed the list for the entire session on
    // exactly the formats the owner was looking at. It is now a host setting,
    // and routing the lobby through THAT would be the same mistake wearing a
    // checkbox — a host who does not want names inside a round has said nothing
    // about the attendance list before it starts.
    //
    // rejects: routing the lobby through waitingRoster or through
    // anonymityActive/MIN_ANONYMOUS_ANSWERS/nameWaitingWhenAnonymous in any
    // form. Joining is not a response; anonymity here is about authorship of
    // answers.
    const players = roster('Dana', 'Tomás');
    expect(joinedRoster({ players, ...hidden })).toEqual(['Dana', 'Tomás']);
    expect(joinedRoster({ players, ...hidden, nameWaitingWhenAnonymous: false }))
      .toEqual(['Dana', 'Tomás']);
    // The same room, same size, through the round-phase rule with the host's
    // setting off: refused there, and only there.
    expect(waitingRoster({
      players, responded: [], respondedCount: 0, answerCount: 0, ...hidden,
      nameWaitingWhenAnonymous: false,
    })).toBeNull();
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
  // BLOCK **AND** LINE COMMENTS, the same stripper setupPanelCallSite.test.js
  // uses. Block-only was enough until this change: the page now explains in a
  // `//` comment what `authorsHiddenOnStage` was and why it is retired, and a
  // scan that reads the file's own account of a deleted identifier as the
  // identifier reports the explanation as the bug.
  const markup = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '')
    .replace(/([^:'"`\\])\/\/.*$/gm, '$1');

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
      'anonymousUntilReveal', 'authorsRevealed', 'nameWaitingWhenAnonymous'].forEach((arg) => {
      expect(call).toMatch(new RegExp(`\\b${arg}\\b`));
    });
    // The freshness guard only means something if the count passed is the
    // meter's own numerator and the names are the participation list.
    expect(call).toMatch(/responded:\s*hostPhase === 'VOTE' \? playersWhoVoted : playersWhoAnswered/);
    expect(call).toMatch(/respondedCount:\s*hostPhase === 'VOTE' \? playersWhoVoted\.length : answeredCount/);
    // The caution measures the CONTENT on the wall, so the response count is
    // the round's answers — not the voted count, and not the roster.
    expect(call).toMatch(/answerCount:\s*answers\.length/);
    // The server flag — whether THIS round's names are out.
    expect(call).toMatch(/authorsRevealed,/);
    // rejects: the retired per-round display toggle reappearing anywhere.
    expect(markup).not.toMatch(/authorsHiddenOnStage/);
    // THE HOST'S SETTING, passed through rather than re-derived at the meter.
    // rejects: the page reading the count itself (`answers.length >= 5 &&`),
    // which is the old block moved one file over.
    expect(call).toMatch(/nameWaitingWhenAnonymous,/);
    expect(markup).toMatch(/const \[nameWaitingWhenAnonymous, setNameWaitingWhenAnonymous\]/);
  });

  /**
   * THE SETTINGS TAB IS WHERE THE TWO DECISIONS ARE MADE, and the panel is a
   * presentational component — so if the page does not hand it the state and the
   * setters, both controls render, move nothing, and reset on the next open.
   */
  test('both name settings reach the panel, and neither is derived from the display profile', () => {
    const at = markup.indexOf('<SessionSetupPanel');
    expect(at).toBeGreaterThan(-1);
    const el = markup.slice(at, markup.indexOf('/>', at));

    // rejects: rendering the controls with no way to change anything, and
    // rejects a second flag beside anonymousUntilReveal — the setter here is
    // the SAME setter the create path and the restore path use.
    expect(el).toMatch(/anonymousUntilReveal=\{anonymousUntilReveal\}/);
    expect(el).toMatch(/onAnonymousUntilRevealChange=\{setAnonymousUntilReveal\}/);
    expect(el).toMatch(/nameWaitingWhenAnonymous=\{nameWaitingWhenAnonymous\}/);
    expect(el).toMatch(/onNameWaitingChange=\{setNameWaitingWhenAnonymous\}/);
    // The caution needs the live round to say anything specific.
    expect(el).toMatch(/answerCount=\{answers\.length\}/);
    expect(el).toMatch(/gameType=\{currentGameType\}/);

    // THE OWNER'S RULING: *"Don't use screen type for name reveal decision."*
    // rejects: any future shortcut that reads the display profile — a projector
    // is not a proxy for room size, audience or sensitivity, and the owner runs
    // one with a team of four.
    const panelSrc = readFileSync(
      join(__dirname, '..', 'components', 'stage', 'SessionSetupPanel.jsx'), 'utf8',
    ).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
    const names = panelSrc.slice(panelSrc.indexOf('<h3 className="setup-h">Names'));
    const namesSection = names.slice(0, names.indexOf('<h3 className="setup-h">Display'));
    expect(namesSection.length).toBeGreaterThan(200);
    expect(namesSection).not.toMatch(/\bprofile\b/);
  });

  test('the session setting is what makes the server stop redacting', () => {
    // rejects: flipping the client flag and nothing else. The SERVER strips the
    // names (lambda-functions/game/anonymity.js), so a host who switches
    // attribution on would otherwise get a stage that claims to name authors
    // and prints "Response 1" — and would get it again on every later round,
    // because the game's stored preference never changed.
    const at = markup.indexOf('if (anonymousUntilReveal !== false) return;');
    expect(at).toBeGreaterThan(-1);
    const effect = markup.slice(at, markup.indexOf('}, [', at));
    expect(effect).toMatch(/handleRevealAuthors\(\)/);
    // rejects: an effect that re-posts forever. The round's own reveal flag is
    // the stop condition, and there must be a ballot to reveal.
    expect(effect).toMatch(/if \(authorsRevealed\) return;/);
    expect(effect).toMatch(/answers\.length === 0/);
    // rejects: revealing a format with nothing authored to attribute.
    expect(effect).toMatch(/anonymityApplies\(currentGameType\)/);
  });

  /**
   * THE RULE THAT USED TO BE HERE.
   *
   * This was `test('the lobby count is not a reveal')`, and it asserted that
   * the gate was consulted on ASK and VOTE and nowhere else — holding the
   * decision that the lobby keeps a bare count, because the only list a lobby
   * can draw is who has JOINED, the polarity the round phases reject.
   *
   * THE OWNER HAS CHANGED THAT CALL and asked for the joined list by name. The
   * test is rewritten rather than deleted, because the new rule is narrower
   * than the one it replaces: the lobby gets a list, it gets a DIFFERENT list,
   * and it must not be obtained by handing the round-phase gate an empty
   * `responded` — which would return the right names today and drag the
   * anonymity threshold along, suppressing the whole feature on an anonymous
   * poll from the first response onwards.
   */
  test('the lobby reveals who has JOINED, through its own gate', () => {
    const at = markup.indexOf('const revealNames');
    expect(at).toBeGreaterThan(-1);
    const block = markup.slice(at, markup.indexOf('return waitingRoster', at));

    // rejects: leaving the lobby out (the old rule), and rejects assembling
    // the list inline with `players.map(...)` at the meter — which skips the
    // dedupe and the blank-name filter that stop one person appearing twice.
    expect(block).toMatch(/hostPhase === 'LOBBY'\) return joinedRoster\(\{ players \}\)/);
    expect(source).toMatch(/import \{[\s\S]{0,400}joinedRoster[\s\S]{0,400}\} from '\.\/config\/anonymity'/);

    // rejects: routing the lobby through the answer-count threshold. There is
    // no round in a lobby, so `answers.length` is 0 there and the gate would
    // refuse forever on every anonymous format.
    const lobbyBranch = block.slice(block.indexOf("hostPhase === 'LOBBY'"));
    ['answerCount', 'anonymousUntilReveal', 'authorsRevealed', 'waitingRoster']
      .forEach((arg) => expect(lobbyBranch).not.toMatch(new RegExp(`\\b${arg}\\b`)));

    // And the ROUND-phase gate is still exactly two phases, ENUMERATED — not
    // merely "ASK and VOTE appear". An assertion that only looked for those
    // two goes on passing when a third is appended, which is how the lobby
    // would be wired to the wrong gate by someone who saw it needed one.
    const roundBranch = block.slice(block.indexOf('joinedRoster'));
    expect(roundBranch.match(/hostPhase === '(\w+)'/g))
      .toEqual(["hostPhase === 'ASK'", "hostPhase === 'VOTE'"]);
  });

  test('the meter is handed names only when there are names, and handlers with them', () => {
    // rejects: passing `{ names: revealNames }` with no handlers (a control
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
    expect(def).toMatch(/revealNames && revealNames\.length/);
    expect(def).toMatch(/names:\s*revealNames/);
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
