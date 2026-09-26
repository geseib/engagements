/**
 * THE HOST PAGE ACTUALLY KNOWS ABOUT THE THIRD BEAT.
 *
 * `GameHostPage.jsx` does not mount under jsdom — it dies on the auth provider —
 * so its wiring is asserted by reading the source with comments stripped. That
 * is the established idiom here (`gameSetupCallSite.test.js`,
 * `builderJobCallSite.test.js`), and the comment-stripping is load-bearing: a
 * previous agent's test in this repo passed against a comment.
 *
 * ── WHAT THIS EXISTS TO CATCH ──────────────────────────────────────────────
 *
 * Adding `feedback` to the closed set `STAGE_BEATS` does NOT make the feature
 * work, and design review found three separate places that collapsed the beat
 * back to a two-value binary. Two were server-side or config and are pinned by
 * their own suites; this one is the host page, which had
 *
 *     beat: gameStateData.stageBeat === 'field-notes' ? 'field-notes' : 'results'
 *
 * — so a host who reloaded during a feedback round came back up on the tally,
 * with the room still holding the report on forty phones.
 *
 * The failure mode is what makes this worth a test rather than a careful read:
 * nothing errors. The row on disk is correct, the endpoint returns the correct
 * beat, and the page quietly substitutes a different one.
 */
const fs = require('fs');
const path = require('path');

const src = (...p) => path.join(__dirname, '..', ...p);

/** Source with every comment and string literal's comment-lookalikes removed. */
function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')      // block comments, including JSX {/* */}
    .replace(/^[ \t]*\/\/.*$/gm, '')       // whole-line // comments
    .replace(/([^:'"`\\])\/\/.*$/gm, '$1'); // trailing // comments, sparing URLs
}

const host = stripComments(fs.readFileSync(src('GameHostPage.jsx'), 'utf8'));

describe('the host page does not collapse the beat to a binary', () => {
  test('no equality test against the single beat survives', () => {
    /*
      The shape being banned, not a specific line number: any comparison of a
      server-supplied beat against the one string. Both spellings, because
      `!==` inverted is the same defect.
    */
    const equality = host.match(/stageBeat\s*[=!]==\s*'field-notes'/g) || [];
    expect(equality).toEqual([]);
  });

  test('the beat it adopts is validated against the shared closed set', () => {
    // STAGE_BEATS is the mirror of the server's BEATS. Membership, never
    // equality — the same correction get-game-state.js and hostRemote.js took.
    expect(host).toMatch(/STAGE_BEATS\.includes\(/);
  });

  test('STAGE_BEATS is imported, not redeclared', () => {
    // A local copy is how the two lists drift, and a drifted list fails
    // silently: the write succeeds, the frame goes out, and a button does
    // nothing in front of a room.
    expect(host).not.toMatch(/const\s+STAGE_BEATS\s*=/);
    expect(host).toMatch(/STAGE_BEATS/);
  });
});

describe('the host page can open a feedback round', () => {
  test('it handles the FEEDBACK intent', () => {
    expect(host).toMatch(/HOST_INTENTS\.FEEDBACK/);
  });

  test('it builds the report before opening the round, not after', () => {
    /*
      A feedback round whose report row does not exist is a blank screen on
      forty phones: `GET /feedback-round` reads the stored REPORT row and does
      not rebuild it. So Request feedback is two calls in order — POST /report,
      then POST /stage-beat — and the ORDER is the whole point, which is why
      this asserts on their relative position rather than on their presence.
    */
    // The declaration, not the whole file: `publishStageBeat` is defined
    // ABOVE this function, so searching from the top would find its URL first
    // and prove nothing about the order these two run in.
    const start = host.indexOf('const requestFeedbackRound');
    expect(start).toBeGreaterThan(-1);
    const body = host.slice(start, host.indexOf('\n  };', start));

    const reportAt = body.indexOf('/report');
    const beatAt = body.indexOf('publishStageBeat');
    expect(reportAt).toBeGreaterThan(-1);
    expect(beatAt).toBeGreaterThan(-1);
    expect(reportAt).toBeLessThan(beatAt);
  });

  test('and it does not open the round when the report could not be built', () => {
    /*
      Half-opening it is the worse outcome: the room is told to comment on
      something their devices cannot show them, and the host — looking at the
      projector, which needs no report — cannot see that anything is wrong.
    */
    const start = host.indexOf('const requestFeedbackRound');
    const body = host.slice(start, host.indexOf('\n  };', start));
    // An early return between the build and the beat.
    const guardAt = body.search(/if \(!built\.ok\)[\s\S]{0,200}?return;/);
    expect(guardAt).toBeGreaterThan(-1);
    expect(guardAt).toBeLessThan(body.indexOf('publishStageBeat'));
  });
});

/**
 * A ROUND CHANGE RESETS THE COMMENT COUNT; ENTERING RESULTS RELOADS IT.
 *
 * `serverStageBeatRef` (above `resultsBeat`'s declaration) already restores
 * WHICH STAGE the host sees on reload — that was the earlier fix
 * (`beat: gameStateData.stageBeat === 'field-notes' ? ...` collapsing
 * 'feedback' to the tally). `roundComments` is separate state.
 *
 * Fix round 1, item 4: this used to be keyed on `resultsBeat === 'feedback'`
 * alone, which left `roundComments` holding round 3's rows straight through
 * round 4's ASK/VOTE and into round 4's RESULTS whenever round 4 never
 * itself reached the feedback beat — exactly the case a player's own
 * "Feedback" button (needing no beat at all, since comments.js's 26 Sep 2026
 * ruling) makes routine. The stage's widened arrivals then showed the
 * PREVIOUS round's comments as though they belonged to the current one.
 */
describe('the comment count follows the round, not the beat', () => {
  /** Every top-level `useEffect(...)` call, () balanced, so a body containing
   *  its own parens (an `if (...)`) does not truncate the extraction. */
  function allEffects(text) {
    const out = [];
    const re = /useEffect\(/g;
    let m;
    // eslint-disable-next-line no-cond-assign
    while ((m = re.exec(text))) {
      let depth = 1;
      let i = m.index + m[0].length;
      while (depth > 0 && i < text.length) {
        if (text[i] === '(') depth++;
        else if (text[i] === ')') depth--;
        i++;
      }
      out.push(text.slice(m.index, i));
    }
    return out;
  }

  test('an effect keyed on gameState itself — not resultsBeat — reloads or resets the comments', () => {
    const candidates = allEffects(host).filter(
      (e) => /\[\s*gameState\s*\]/.test(e) && /loadRoundComments/.test(e),
    );
    expect(candidates.length).toBeGreaterThan(0);
  });

  test('it reloads on any RESULTS phase, not only the feedback beat', () => {
    const candidates = allEffects(host).filter(
      (e) => /\[\s*gameState\s*\]/.test(e) && /loadRoundComments/.test(e),
    );
    expect(candidates[0]).toMatch(/phaseOfGameState\(gameState\) === 'RESULTS'/);
    expect(candidates[0]).not.toMatch(/resultsBeat === 'feedback'/);
  });

  test('it clears roundComments once the room leaves RESULTS, so the next round never opens on a stale count', () => {
    const candidates = allEffects(host).filter(
      (e) => /\[\s*gameState\s*\]/.test(e) && /loadRoundComments/.test(e),
    );
    expect(candidates[0]).toMatch(/setRoundComments\(\[\]\)/);
  });

  test('no effect still keys on resultsBeat alone for this', () => {
    // The old, narrower effect is gone outright rather than left beside the
    // new one — two readers of the same fact is how they drift.
    const stale = allEffects(host).filter(
      (e) => /\[\s*resultsBeat\s*\]/.test(e) && /loadRoundComments/.test(e),
    );
    expect(stale).toEqual([]);
  });
});


/**
 * THE PLAYER PAGE LETS GO OF WHAT IT SUBSCRIBED TO.
 *
 * `GameHostPage` has had a registered/removed symmetry test since `gameEnded`
 * was registered and never removed — a handler that outlived its session and
 * fired with a stale closure. The PLAYER page had no such test, and adding two
 * handlers to it reproduced exactly that defect before this was written.
 */
describe('the player page registers and removes symmetrically', () => {
  const player = stripComments(fs.readFileSync(src('PlayerPage.jsx'), 'utf8'));

  const registered = new Set(
    [...player.matchAll(/webSocketClient\.onMessage\(\s*'([^']+)'/g)].map((m) => m[1]),
  );
  const removed = new Set(
    [...player.matchAll(/webSocketClient\.offMessage\(\s*'([^']+)'/g)].map((m) => m[1]),
  );

  test('it registers the two frames a feedback round needs', () => {
    // Without `stageBeatChanged` a phone never learns the round opened:
    // `gameState` is RESULTS#nnn for all three beats and cannot tell them apart.
    expect(registered.has('stageBeatChanged')).toBe(true);
    expect(registered.has('commentPosted')).toBe(true);
  });

  test('every handler it registers, it also removes', () => {
    const leaked = [...registered].filter((type) => !removed.has(type));
    expect(leaked).toEqual([]);
  });
});
