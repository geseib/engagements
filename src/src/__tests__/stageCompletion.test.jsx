import React from 'react';
import { readFileSync } from 'fs';
import { join } from 'path';
import { render } from '@testing-library/react';
import RoomMeter from '../components/stage/RoomMeter';
import Dock from '../components/stage/Dock';

const STAGE_CSS = readFileSync(join(__dirname, '..', 'styles', 'stage.css'), 'utf8');

describe('the completed state reaches the DOM', () => {
  test('the meter fraction takes the done class when complete', () => {
    // rejects: a `complete` prop that is accepted and ignored
    const { container } = render(
      <RoomMeter phase="ASK" heading="ANSWERED" body="8 / 8" complete />
    );
    expect(container.querySelector('.count.done')).not.toBeNull();
    expect(container.querySelector('.meter.is-complete')).not.toBeNull();
  });

  test('and does not when it is not', () => {
    const { container } = render(
      <RoomMeter phase="ASK" heading="ANSWERED" body="7 / 8" />
    );
    expect(container.querySelector('.count.done')).toBeNull();
    expect(container.querySelector('.meter.is-complete')).toBeNull();
  });

  test('the dock status takes the go class, which is already styled and was never applied', () => {
    // rejects: leaving `.dock .status.go` dead, which is how it shipped
    const { container } = render(<Dock status="Safe to move on" complete />);
    expect(container.querySelector('.status.go')).not.toBeNull();
  });

  test('the dock status is plain when the room is still working', () => {
    const { container } = render(<Dock status="Some are still answering" />);
    expect(container.querySelector('.status')).not.toBeNull();
    expect(container.querySelector('.status.go')).toBeNull();
  });
});

/**
 * "ALL IN" — the owner's third report: *"i still think we need it way more
 * apparent when all answers or votes are in."*
 *
 * What was there was a hue change and a weight change, on a surface the design
 * spec itself says cannot be trusted with hue (a lit-room projector lifts the
 * black point and costs ~1.6x of every ratio), plus a pulse that
 * prefers-reduced-motion correctly removes. The rule this restores is the
 * project's own: NEVER COLOUR ALONE.
 */
describe('completion is legible without colour', () => {
  test('the meter flies a word-flag, not just a tint', () => {
    // rejects: `complete` that only sets `.count.done`. Every assertion here is
    // about a channel that survives greyscale — a word, a glyph, and a filled
    // plate — because the hue is the one channel a projector in a lit room is
    // guaranteed to mangle.
    const { container } = render(
      <RoomMeter phase="ASK" heading="Answered" body="8 / 8" complete />
    );
    const flag = container.querySelector('.flag[data-all-in]');
    expect(flag).not.toBeNull();
    expect(flag.textContent).toContain('All in');
    expect(flag.querySelector('.tick')).not.toBeNull();
    // The word already says it; a screen reader announcing "check mark All in"
    // reads as two facts.
    expect(flag.querySelector('.tick').getAttribute('aria-hidden')).toBe('true');
  });

  test('and flies nothing while the room is still answering', () => {
    // rejects: a flag rendered unconditionally and merely styled differently,
    // which puts "All in" on the wall of a round nobody has finished.
    const { container } = render(
      <RoomMeter phase="ASK" heading="Answered" body="7 / 8" />
    );
    expect(container.querySelector('[data-all-in]')).toBeNull();
  });

  test('the flag is a plate, not a coloured word', () => {
    // rejects: styling `[data-all-in]` with `color:` alone — which is the
    // change that looks done in a screenshot on a good monitor and reads as
    // nothing at all through a projector with an aged lamp, or to a
    // colour-blind host. A background and a border are shape, and shape is what
    // carries across a room.
    const at = STAGE_CSS.indexOf('.flag[data-all-in]{');
    expect(at).toBeGreaterThan(-1);
    const rule = STAGE_CSS.slice(at, STAGE_CSS.indexOf('}', at));
    expect(rule).toMatch(/background:/);
    expect(rule).toMatch(/border-color:/);
  });

  test('the flag sits at the label tier, which the fitter never scales', () => {
    // rejects: sizing the flag off --t-body or --t-primary. Those are the tiers
    // `--fit` shrinks, so the cue would be at its smallest on exactly the dense
    // round that drives the fitter to its floor — the round where the host most
    // needs to know they can move on. styles/stage.css: "Label and meta tiers
    // do NOT scale."
    const at = STAGE_CSS.indexOf('.flag[data-all-in]{');
    const rule = STAGE_CSS.slice(at, STAGE_CSS.indexOf('}', at));
    expect(rule).toMatch(/font-size:calc\(var\(--t-meta\)/);
    expect(rule).not.toMatch(/--t-body|--t-primary|--t-secondary|--fit/);
  });
});

/**
 * THE COUNT WHEN THE FITTER TAKES THE METER'S COLUMN — the owner's second
 * report: *"the larger views also dont have the player counts for
 * answered/voted."*
 *
 * Diagnosed rather than guessed: fitPolicy.js enters the meter into the ordered
 * sacrifice at priority -1 and `widen()` surrenders the column with
 * `meter.hidden = true`. Measured against the mockups with the shipped fitter,
 * at 1280x720 on 05-vote Room, TV AND Call all lose the meter and only Table
 * keeps it; TV loses it on 03-ask-trivia at 1920x1080 too. The bigger the
 * ladder, the sooner the content overflows.
 */
describe('the answered/voted count survives losing the meter\'s column', () => {
  test('the dock carries the same heading and fraction', () => {
    // rejects: leaving the count nowhere to go, which is the shipped behaviour.
    const { container } = render(
      <Dock status="Some are still answering" progress={{ heading: 'Answered', body: '31 / 40' }} />
    );
    const mirror = container.querySelector('[data-progress-mirror]');
    expect(mirror).not.toBeNull();
    expect(mirror.querySelector('.lbl').textContent).toBe('Answered');
    expect(mirror.querySelector('.val').textContent).toBe('31 / 40');
  });

  test('it carries the completion flag too', () => {
    // rejects: mirroring the number and dropping the cue. The profile that
    // loses the meter most often is TV, so a completion state that only exists
    // in the meter is a completion state the largest display never shows.
    const { container } = render(
      <Dock progress={{ heading: 'Voted', body: '40 / 40', complete: true }} />
    );
    expect(container.querySelector('.dock-progress.done')).not.toBeNull();
    expect(container.querySelector('.dock-progress [data-all-in]')).not.toBeNull();
  });

  test('no progress, no element', () => {
    // rejects: rendering an empty label on RESULTS, FIELD_NOTES and ENDED,
    // where the meter is null and there is no count to mirror.
    const { container } = render(<Dock status="Reading the room" />);
    expect(container.querySelector('[data-progress-mirror]')).toBeNull();
  });

  test('exactly one of the two is ever visible, and the fitter decides which', () => {
    // THE A12 GUARANTEE. The audit fails a viewport that states progress more
    // than once, so this may not simply be a second permanent readout.
    //
    // rejects: deleting the `display:none` default (two fractions on every
    // state that keeps its meter), and rejects keying the reveal on `.solo`
    // instead of `[data-auto-solo]` — RESULTS, FIELD_NOTES and ENDED are solo
    // from the start with no meter at all, so that version prints an empty
    // label in the dock for the rest of the session.
    const at = STAGE_CSS.indexOf('.dock-progress{');
    expect(at).toBeGreaterThan(-1);
    expect(STAGE_CSS.slice(at, STAGE_CSS.indexOf('}', at))).toMatch(/display:none/);
    expect(STAGE_CSS).toMatch(
      /\.main\[data-auto-solo="1"\] ~ \.dock \.dock-progress\{display:inline-flex\}/
    );
    expect(STAGE_CSS).not.toMatch(/\.main\.solo ~ \.dock \.dock-progress/);
  });

  test('the attribute the reveal is keyed on is the one the fitter writes', () => {
    // rejects: a CSS selector that drifts from the fitter. `widen()` sets
    // `main.dataset.autoSolo` and `unwiden()` deletes it; if either name
    // changes, the count silently stops appearing and nothing fails.
    const fitter = readFileSync(join(__dirname, '..', 'hooks', 'useStageFit.js'), 'utf8');
    expect(fitter).toMatch(/main\.dataset\.autoSolo = '1'/);
    expect(fitter).toMatch(/delete main\.dataset\.autoSolo/);
  });
});
