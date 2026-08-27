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
    const opener = host.slice(host.indexOf('requestFeedbackRound'));
    const reportAt = opener.indexOf('/report');
    const beatAt = opener.indexOf('stage-beat');
    expect(reportAt).toBeGreaterThan(-1);
    expect(beatAt).toBeGreaterThan(-1);
    expect(reportAt).toBeLessThan(beatAt);
  });
});
