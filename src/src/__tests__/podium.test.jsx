/**
 * The podium — top three on the room's screen, on RESULTS and ENDED only.
 *
 * Owner rulings this file exists to hold in place: top three and never a full
 * roster; RESULTS and ENDED and not every phase; and no podium for wavelength.
 *
 * THE RULE THIS FILE WAS CARVED OUT OF NO LONGER EXISTS IN THAT FORM.
 * `RoomMeter`'s "it never names anybody" test in stageShell.test.jsx is gone,
 * retired by the owner and replaced there by tests for what the meter may now
 * name: WHO IS STILL WAITING, on demand, never who has acted. That does not
 * loosen anything here. The podium's own limits are the ones below — top
 * three, ordered and earned, on RESULTS and ENDED only — and they were never
 * consequences of the meter's rule; the meter simply happened to be where the
 * distinction got written down first. A full roster with scores beside the
 * names is still refused in both places, and for the same reason
 * (`standingsVisible`: a score beside a response is attribution by
 * arithmetic).
 */
import React from 'react';
import { render } from '@testing-library/react';
import fs from 'fs';
import path from 'path';
import { podiumEntries, PODIUM_SIZE } from '../config/podium';
import Podium from '../components/stage/Podium';

const src = (...p) => path.join(__dirname, '..', ...p);

/** Source with every comment removed — a previous agent's test passed on one. */
function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')       // block comments, including JSX {/* */}
    .replace(/^[ \t]*\/\/.*$/gm, '')        // whole-line // comments
    .replace(/([^:'"`\\])\/\/.*$/gm, '$1'); // trailing // comments, sparing URLs
}

const host = stripComments(fs.readFileSync(src('GameHostPage.jsx'), 'utf8'));
const podiumSrc = stripComments(fs.readFileSync(src('components', 'stage', 'Podium.jsx'), 'utf8'));
const meterSrc = stripComments(fs.readFileSync(src('components', 'stage', 'RoomMeter.jsx'), 'utf8'));

const scored = [
  { name: 'Grace', score: 9 },
  { name: 'Alan', score: 5 },
  { name: 'Ada', score: 3 },
  { name: 'Edsger', score: 1 },
];

/** A voting session that withheld authorship — the gate's live case. */
const anonymous = {
  phase: 'RESULTS',
  gameType: 'call-and-answer',
  anonymousUntilReveal: true,
  players: scored,
};

describe('where the podium is allowed to exist', () => {
  test('RESULTS and ENDED, and nowhere else', () => {
    // rejects: rendering it in every phase. The owner ruled two states, and
    // the meter — which the fitter drops first — occupies the others.
    for (const phase of ['RESULTS', 'ENDED']) {
      expect(podiumEntries({ phase, gameType: 'trivia', players: scored }).length)
        .toBeGreaterThan(0);
    }
    for (const phase of ['LOBBY', 'ASK', 'VOTE', 'FIELD_NOTES', undefined]) {
      expect(podiumEntries({ phase, gameType: 'trivia', players: scored })).toEqual([]);
    }
  });
});

describe('top three, never a roster', () => {
  test('twenty players yield three entries', () => {
    // rejects: mapping the roster. This is the single line between a podium
    // and the attendance record RoomMeter refuses.
    const twenty = Array.from({ length: 20 }, (_, i) => ({ name: `P${i}`, score: 100 - i }));
    const entries = podiumEntries({ phase: 'ENDED', gameType: 'trivia', players: twenty });
    expect(entries).toHaveLength(3);
    expect(PODIUM_SIZE).toBe(3);
    expect(entries.map((e) => e.name)).toEqual(['P0', 'P1', 'P2']);
  });

  test('players who never scored are not on it', () => {
    // rejects: slicing the ranked roster before dropping the zeros, which
    // fills the third card with a nought and calls it a placing.
    const entries = podiumEntries({
      phase: 'ENDED',
      gameType: 'trivia',
      players: [{ name: 'Grace', score: 4 }, { name: 'Alan', score: 2 },
        { name: 'Ada', score: 0 }, { name: 'Edsger' }, { name: 'Barbara', score: 0 }],
    });
    expect(entries.map((e) => e.name)).toEqual(['Grace', 'Alan']);
  });

  test('a tie shares a rank and the next card skips one', () => {
    // rejects: re-deriving rank as index+1 — the tie handling
    // calculatePlayerRankings already gets right, and the reason it is reused
    // rather than rewritten.
    const entries = podiumEntries({
      phase: 'ENDED',
      gameType: 'trivia',
      players: [{ name: 'Grace', score: 9 }, { name: 'Alan', score: 9 }, { name: 'Ada', score: 3 }],
    });
    expect(entries.map((e) => e.rank)).toEqual([1, 1, 3]);
  });
});

describe('the anonymity gate — the one that matters', () => {
  test('nothing at all while a round is anonymous and unrevealed', () => {
    // rejects: dropping standingsVisible. A score beside a response is
    // attribution by arithmetic (anonymity.js:154-173); a session podium is a
    // score table for the whole session, so it goes where the names go.
    expect(podiumEntries({ ...anonymous, authorsRevealed: false })).toEqual([]);
    expect(podiumEntries({ ...anonymous, authorsRevealed: undefined })).toEqual([]);
    expect(podiumEntries({ ...anonymous, phase: 'ENDED', authorsRevealed: false })).toEqual([]);
  });

  test('the same session shows it once authors are revealed', () => {
    // rejects: a gate that is simply always false — which would make the test
    // above pass against an implementation that never renders a podium at all.
    expect(podiumEntries({ ...anonymous, authorsRevealed: true })).toHaveLength(3);
  });

  test('a session that never hid its authors is never gated', () => {
    // rejects: gating on the type rather than on whether THIS game withheld
    // anything. anonymityActive is false when the host switched it off, and
    // there is then no reveal to wait for.
    expect(podiumEntries({ ...anonymous, anonymousUntilReveal: false })).toHaveLength(3);
  });
});

describe('capability, not game type', () => {
  test('a session with no score records has no podium, whatever the type', () => {
    // rejects: `gameType !== 'wavelength'` as the gate. Wavelength writes no
    // scores at all (get-results.js:952-960 hardcodes totalScore 0), and
    // survey is flagged rather than settled — so the honest question is
    // whether points exist, not what the type string says.
    const unscored = [{ name: 'Grace', score: 0 }, { name: 'Alan', score: 0 }];
    for (const gameType of ['wavelength', 'trivia', 'survey', 'poll']) {
      expect(podiumEntries({ phase: 'ENDED', gameType, players: unscored })).toEqual([]);
    }
    expect(podiumEntries({ phase: 'ENDED', gameType: 'trivia', players: [] })).toEqual([]);
  });
});

describe('the lead card is labelled by what the number is', () => {
  test('vote points are "Most backed", not a championship', () => {
    // rejects: one label for every type. These points are votes other people
    // gave you, and a "champion" framing on a strategy session is the exact
    // complaint the ENDED review records from the consultancy partner.
    // anonymousUntilReveal:false because a voted format that DID withhold
    // authorship has no podium at all — proven three tests above.
    const voted = podiumEntries({
      phase: 'ENDED', gameType: 'call-and-answer', anonymousUntilReveal: false, players: scored,
    });
    expect(voted.map((e) => e.label)).toEqual(['Most backed', '2nd', '3rd']);
  });

  test('trivia is scored, so trivia says so', () => {
    // rejects: calling a trivia total "most backed" — nobody backed it.
    const quiz = podiumEntries({ phase: 'ENDED', gameType: 'trivia', players: scored });
    expect(quiz[0].label).toBe('Top score');
    expect(quiz.map((e) => e.label).slice(1)).toEqual(['2nd', '3rd']);
  });
});

describe('<Podium>', () => {
  const props = { phase: 'ENDED', gameType: 'trivia', players: scored };

  test('three cards, not one champion beside a stat', () => {
    // rejects: 10-ended.html's actual shape — `.podium` with two `.pod`
    // children, one of them a statistic. The owner asked for a top three.
    const { container } = render(<Podium {...props} />);
    expect(container.querySelectorAll('.podium .pod')).toHaveLength(3);
    expect(container.textContent).toContain('Grace');
    expect(container.textContent).toContain('Ada');
  });

  test('the "Rounds captured · 100%" stat stays deleted', () => {
    // rejects: porting the mockup verbatim. You only count rounds that
    // happened, so that figure can only ever read 100% — the same structural
    // lie as get-ai-summary.js:1599, reproduced in the design layer.
    const { container } = render(<Podium {...props} />);
    expect(container.textContent).not.toMatch(/100%|Rounds captured/);
  });

  test('it declares data-attribution="revealed"', () => {
    // rejects: omitting the declaration. Audit A13 fails any stage document
    // carrying a roster name without it — and that is conveniently the same
    // condition as the gate above.
    const { container } = render(<Podium {...props} />);
    expect(container.querySelector('.podium').getAttribute('data-attribution'))
      .toBe('revealed');
  });

  test('nothing renders, and no name reaches the DOM, while authorship is withheld', () => {
    // rejects: a component that computes the gate and renders the shell
    // anyway. THE ONE THAT MATTERS: the failure mode is a name on a projector
    // during a round the host chose not to attribute.
    const { container } = render(<Podium {...anonymous} authorsRevealed={false} />);
    expect(container.querySelector('.podium')).toBeNull();
    expect(container.textContent).not.toMatch(/Grace|Alan|Ada|Edsger/);
  });

  test('twenty players put three names on the wall', () => {
    // rejects: a component that maps `players` instead of the entries — the
    // shape that turns a podium back into an attendance record.
    const twenty = Array.from({ length: 20 }, (_, i) => ({ name: `Person${i}`, score: 100 - i }));
    const { container } = render(<Podium phase="ENDED" gameType="trivia" players={twenty} />);
    expect(container.querySelectorAll('.pod')).toHaveLength(3);
    expect(container.textContent).not.toMatch(/Person3\b/);
  });

  test('it is content, so it is not droppable', () => {
    // rejects: carrying the mockup's `data-drop="1"` across. fitPolicy.js
    // sacrifices chrome before content; a podium the host has promised the
    // room must earn its space through the scale search like everything else.
    expect(podiumSrc).not.toMatch(/data-drop/);
  });
});

describe('the page actually renders it, in the right place, from the right source', () => {
  test('it imports and renders <Podium>', () => {
    // rejects: the whole stream shipping as dead code — a component file that
    // nothing mounts. The gating condition is load-bearing: a bare
    // /<Podium/ still matches after the element is renamed.
    expect(host).toMatch(/import\s+Podium\s+from\s+'\.\/components\/stage\/Podium'/);
    expect((host.match(/<Podium\s/g) || []).length).toBe(2);
  });

  /**
   * THE RULE THIS REPLACES. This was `test('RESULTS reads the display toggle;
   * ENDED reads the server reveal')`, and the display toggle was
   * `authorsHiddenOnStage` — a per-round Show/Hide authors button on the RESULTS
   * stage. The owner replaced it with ONE session setting in the sidebar, with
   * no per-round override, so RESULTS now reads that setting. ENDED is
   * unchanged and the two must still not be merged.
   */
  test('RESULTS reads the session setting; ENDED reads the server reveal', () => {
    // rejects: wiring both to one source. Point ENDED at the session setting
    // and a whole anonymous session loses its closing podium — which attributes
    // no response, only ranks people by score with nothing on screen to pin to
    // anybody. Point RESULTS at the server flag and the podium is always on,
    // because entering RESULTS reveals the round server-side whatever the host
    // chose — so hiding the names would leave the arithmetic, and therefore the
    // attribution, on the wall.
    expect(host).toMatch(
      /<Podium[^>]*[\s\S]{0,400}?authorsRevealed=\{!anonymityActive\(\{\s*\n?\s*gameType: currentGameType, anonymousUntilReveal,\s*\n?\s*\}\)\}/
    );
    expect(host).toMatch(/<Podium[^>]*[\s\S]{0,400}?authorsRevealed=\{authorsRevealed\}/);
    // rejects: the retired per-round toggle coming back anywhere near it.
    expect(host).not.toMatch(/authorsHiddenOnStage/);
  });

  test('it is content inside the stage, not the meter', () => {
    // rejects: hanging it off RoomMeter. The meter returns null on exactly
    // these phases, and fitPolicy.js:65 enters it at priority -1 ahead of
    // every data-drop group — so a podium there vanishes first on the densest
    // results screen, which is worse than no podium because it was promised.
    expect(meterSrc).not.toMatch(/[Pp]odium/);
    expect(host).not.toMatch(/<RoomMeter[^>]*podium/i);
    const contentOpen = host.indexOf('className="content"');
    const stageClose = host.indexOf('</Stage>');
    expect(contentOpen).toBeGreaterThan(-1);
    expect(stageClose).toBeGreaterThan(contentOpen);
    // EVERY occurrence, not the first. Checking only the first passed against
    // a version with the ENDED podium hoisted out of <Stage> entirely.
    const at = [];
    for (let i = host.indexOf('<Podium'); i !== -1; i = host.indexOf('<Podium', i + 1)) at.push(i);
    expect(at).toHaveLength(2);
    for (const i of at) {
      expect(i).toBeGreaterThan(contentOpen);
      expect(i).toBeLessThan(stageClose);
    }
  });

  test('the ranking function has one definition, and it is the shared one', () => {
    // rejects: a fourth copy of the tie-handling sort. GameHostPage held its
    // own; the podium needed the same arithmetic, and two copies drift.
    //
    // The only caller on the host side is now the session report, which was
    // extracted out of GameHostPage into components/GameReport.jsx — so the
    // import is asserted where the call actually is. Asserting it on
    // GameHostPage after the move would pin an import that file no longer has
    // any use for, which is how a "shared function" test starts demanding dead
    // code. Neither file may redefine it.
    const report = stripComments(
      fs.readFileSync(path.join(__dirname, '..', 'components', 'GameReport.jsx'), 'utf8'),
    );
    expect(report).toMatch(/import\s*\{[^}]*calculatePlayerRankings[^}]*\}\s*from\s*'\.\.\/config\/podium'/);
    expect(report).toMatch(/calculatePlayerRankings\(/);
    expect(report).not.toMatch(/const calculatePlayerRankings\s*=/);
    expect(host).not.toMatch(/const calculatePlayerRankings\s*=/);
  });
});
