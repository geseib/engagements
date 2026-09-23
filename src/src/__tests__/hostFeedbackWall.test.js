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

  test('the featured comment is on the stage with its text, its anchor and its author; the arrivals stay nameless', () => {
    const stage = SRC.slice(SRC.indexOf("{hostPhase === 'FEEDBACK' && ("), SRC.indexOf("{hostPhase === 'ENDED' && ("));
    expect(stage).toMatch(/featuredComment && \(/);
    expect(stage).toMatch(/className="featured"/);
    expect(stage).toMatch(/featuredComment\.text/);
    expect(stage).toMatch(/featuredComment\.anchorLabel/);
    expect(stage).toMatch(/featuredComment\.playerName/);
    // The count survives, as before.
    expect(stage).toMatch(/comments so far/);
  });
});

describe('the wall styles', () => {
  test('arrivals and the featured quote are styled, and stilled under reduced motion', () => {
    expect(CSS).toMatch(/\.meter\.arrivals\{/);
    expect(CSS).toMatch(/\.arr\{[^}]*animation:arrive/);
    expect(CSS).toMatch(/\.featured\{/);
    expect(CSS).toMatch(/\.featured \.who\{/);
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
    expect(block('.featured')).not.toMatch(/max-width:var\(--measure\)/);
    expect(block('.featured .say')).toMatch(/max-width:var\(--measure\)/);
  });
  // rejects: `anywhere`, which breaks words between any two letters and
  // shrinks the box's min-content to a single letter.
  test('the quote never breaks a word that fits on a line', () => {
    expect(block('.featured .say')).not.toMatch(/overflow-wrap:anywhere/);
    expect(block('.featured .say')).toMatch(/overflow-wrap:break-word/);
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
