/**
 * THE FEEDBACK ROUND ON THE WALL — the host page's side, read from source
 * because GameHostPage cannot mount in jsdom.
 *
 * The earlier ruling in GameHostPage ("NO NAMES AND NO TEXT ON THE WALL")
 * is reversed by the owner on 2026-09-22 for the TEXT: comments arrive in
 * the meter unattributed, the host clicks one to put it up for the room,
 * and only the featured one carries its author (the phone told the writer
 * "your name will be shown with this comment"). The count stays.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const SRC = readFileSync(join(__dirname, '..', 'GameHostPage.jsx'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const CSS = readFileSync(join(__dirname, '..', 'styles', 'stage.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

describe('the meter on FEEDBACK', () => {
  test('counts the comments and hands the meter the arrivals', () => {
    const meter = SRC.slice(SRC.indexOf('const meter = (() => {'), SRC.indexOf('const revealNames'));
    expect(meter).toMatch(/hostPhase === 'FEEDBACK'/);
    expect(meter).toMatch(/heading: 'Comments'/);
    expect(meter).toMatch(/roundComments\.length/);
    const el = SRC.slice(SRC.indexOf('<RoomMeter'), SRC.indexOf('/>', SRC.indexOf('<RoomMeter')));
    expect(el).toMatch(/arrivals=\{meterArrivals\}/);
  });

  test('the arrivals are the round\'s comments, gated by the session setting, and a pick features one', () => {
    const def = SRC.slice(SRC.indexOf('const meterArrivals'), SRC.indexOf(';', SRC.indexOf('const meterArrivals')));
    expect(def).toMatch(/hostPhase === 'FEEDBACK'/);
    expect(def).toMatch(/wallComments !== false/);
    expect(def).toMatch(/items:\s*roundComments/);
    expect(def).toMatch(/onPick:\s*handleFeatureComment/);
    expect(def).toMatch(/featuredId/);
  });
});

describe('featuring', () => {
  test('goes through the client helper with the host\'s authFetch, then the socket refetches', () => {
    expect(SRC).toMatch(/import \{ fetchComments, featureComment \} from '\.\/utils\/commentsClient';/);
    const fn = SRC.slice(SRC.indexOf('const handleFeatureComment'), SRC.indexOf('\n  };', SRC.indexOf('const handleFeatureComment')));
    expect(fn).toMatch(/featureComment\(\{/);
    expect(fn).toMatch(/fetchFn:\s*authFetch/);
    // Toggle: featuring the one already featured takes it down.
    expect(fn).toMatch(/const next = !target\.featured/);
    expect(fn).toMatch(/featured:\s*next/);
    expect(SRC).toMatch(/onMessage\('commentFeatured'/);
  });

  /*
    THE WALL IS ITS OWN COMPONENT (components/stage/FeedbackWall.jsx, tested
    by feedbackWall.test.jsx), handed the featured comment and the same
    toggle the meter's cards use, so pressing the quote takes it down.
    The owner, 2026-09-24: "the small type is not needed". The count is the
    meter's, not a second line on the wall; the kicker and the undefined
    `.lede` class are gone with it.
  */
  test('the FEEDBACK wall is FeedbackWall, handed the featured comment and the toggle', () => {
    const from = SRC.indexOf("{hostPhase === 'FEEDBACK' && (");
    const stage = SRC.slice(from, SRC.indexOf("{hostPhase === 'ENDED'", from));
    expect(stage).toMatch(/<FeedbackWall/);
    expect(stage).toMatch(/featured=\{featuredComment\}/);
    expect(stage).toMatch(/onTakeDown=\{handleFeatureComment\}/);
    expect(stage).not.toMatch(/comments so far/);
    expect(stage).not.toMatch(/className="lede"/);
    expect(stage).not.toMatch(/className="kicker"/);
    expect(SRC).toMatch(/import FeedbackWall from '\.\/components\/stage\/FeedbackWall';/);
  });
});

describe('the wall styles', () => {
  test('arrivals and the pull quote are styled, and stilled under reduced motion', () => {
    expect(CSS).toMatch(/\.meter\.arrivals\{/);
    expect(CSS).toMatch(/\.arr\{[^}]*animation:arrive/);
    expect(CSS).toMatch(/\.fb-quote\{[^}]*animation:arrive/);
    const reduced = CSS.slice(CSS.indexOf('@media (prefers-reduced-motion:reduce)'));
    expect(reduced).toMatch(/\.fb-quote\{animation:none\}/);
  });

  // rejects: any of the wall's own type at the label tier, and the old
  // small-type rules left behind as dead selectors.
  test('nothing on the wall is set at the label size, and the old small type is gone', () => {
    const wallRules = CSS.match(/(^|\n)\.(fb-[\w-]+|hero\.fb-question)[^{]*\{[^}]*\}/g) || [];
    expect(wallRules.length).toBeGreaterThanOrEqual(5);
    for (const rule of wallRules) expect(rule).not.toMatch(/--t-meta/);
    expect(CSS).not.toMatch(/\.arr \.n\{/);
    expect(CSS).not.toMatch(/\.meter\.arrivals h5\{/);
    expect(CSS).not.toMatch(/(^|\n)\.featured[ {]/);
  });

  /*
    THE FEATURED QUOTE MUST BE READABLE. The owner, 2026-09-23, with a
    screenshot of "I / thin / k I": "if host clicks on the comment from the
    list, it is not readable." `--measure` is in `ch`, which resolves in the
    font of the element that uses it — the box's small body font, not the
    quote's primary-tier one. Measured in a browser at 1000-1920 wide before
    and after (stage.css carries the account).
  */
  const block = (sel) => {
    const at = CSS.indexOf(`${sel}{`);
    expect(at).toBeGreaterThan(-1);
    return CSS.slice(at, CSS.indexOf('}', at));
  };
  // rejects: the measure on the box, where 26ch is a strip of body characters.
  test('the measure sits on the quote, not on the box around it', () => {
    expect(block('.fb-quote')).not.toMatch(/max-width:var\(--measure\)/);
    expect(block('.fb-quote .say')).toMatch(/max-width:var\(--measure\)/);
  });
  // rejects: `anywhere`, which breaks words between any two letters and
  // shrinks the box's min-content to a single letter.
  test('the quote never breaks a word that fits on a line', () => {
    expect(block('.fb-quote .say')).not.toMatch(/overflow-wrap:anywhere/);
    expect(block('.fb-quote .say')).toMatch(/overflow-wrap:break-word/);
  });
  // rejects: min-width:0 on the dock's room-facing status — the one thing
  // that gave in a crowded dock, down to a word a line ("Results / are / on").
  test('the dock status keeps a floor, and the key hints give way first', () => {
    expect(block('.dock .status')).not.toMatch(/min-width:0/);
    expect(block('.dock .status')).toMatch(/min-width:min\(/);
    expect(CSS).toMatch(/@media \(max-width:1200px\)\{\.dock \.host-action-bar__keyhint\{display:none\}\}/);
    expect(CSS).toMatch(/@media \(max-width:1100px\)\{\.dock \.kbd\{display:none\}\}/);
  });
});
