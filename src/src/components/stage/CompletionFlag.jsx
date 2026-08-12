import React from 'react';

/**
 * "Everybody is in", said so a room can see it from twenty-five feet without
 * reading a fraction and without relying on a hue.
 *
 * WHAT WAS THERE BEFORE, AND WHY IT WAS NOT ENOUGH. Completion turned the
 * meter's numeral `--success-text` and turned the dock's status line bold and
 * green (`.meter .count.done`, `.dock .status.go`, plus a three-iteration
 * `cue` pulse). That is one colour change, one weight change, and a motion the
 * reduced-motion media query correctly removes. To read it the host still had
 * to compare two numbers and notice a hue — and the owner's report is exactly
 * that: *"i still think we need it way more apparent when all answers or votes
 * are in."*
 *
 * COLOUR IS THE ONE CHANNEL THAT CANNOT BE TRUSTED HERE. A projector in a lit
 * room lifts the black point and costs roughly 1.6x of every contrast ratio
 * (design spec 4.3), lamps age yellow, and colour-blind hosts exist. The
 * project's own standing rule is NEVER COLOUR ALONE — "Correct is `--success`
 * *plus* a 2px border *plus* a `CORRECT` word-flag". This is that rule applied
 * to the one state the host is actually waiting on.
 *
 * FOUR CHANNELS, THREE OF THEM ACHROMATIC:
 *
 *   - A WORD. "All in" is legible in greyscale, in a photograph, and to a
 *     screen reader. It is the channel that survives everything.
 *   - A GLYPH. The tick is a shape, and a shape is recognised below the size at
 *     which a word can be read — so it lands first at the back of the room and
 *     the word confirms it.
 *   - A PLATE. The flag is filled and bordered, so the completed state is a
 *     block of luminance appearing where there was none. That is a change to
 *     the SILHOUETTE of the region, which is what actually carries across a
 *     room; the hue on top of it is a bonus, not the message.
 *   - Colour, last.
 *
 * IT SITS AT THE LABEL TIER ON PURPOSE, WHICH IS HOW IT SURVIVES THE FITTER.
 * `--t-meta` is the profile's angular floor (20px Room, 26px TV, 16px Table)
 * and it is explicitly excluded from `--fit` scaling — styles/stage.css:
 * "Label and meta tiers do NOT scale." A cue drawn at a scaling tier would be
 * at its smallest on exactly the dense round where the host most needs to know
 * they can move on.
 *
 * IT IS A JUDGEMENT, NOT A SECOND COUNT. Audit check A12 fails a viewport that
 * states progress more than once, and that rule is intact: the fraction is
 * stated once, here or in the dock's mirror but never both (styles/stage.css),
 * and this flag states no number at all. The dock's own "Safe to move on" is a
 * different judgement — whether the HOST may act — which is the pairing the
 * design spec sanctions in 5.2.
 */
export default function CompletionFlag({ label = 'All in' }) {
  return (
    <span className="flag" data-all-in="">
      {/* aria-hidden: the word beside it already says this, and a screen reader
          announcing "check mark All in" reads as two facts. */}
      <span className="tick" aria-hidden="true">✓</span>
      {label}
    </span>
  );
}
