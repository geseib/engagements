/**
 * "HOW MANY?" — AND WHERE THE TRACK IS ALLOWED TO BE.
 *
 * First reported: "the AI builder and Manual builder could use a thoughtful
 * design tweak … the use of slider seems old school and not current cool
 * design. it is used for category count and for question count for
 * generation." Every builder asked this with THREE SEPARATE controls stacked
 * together — a range input, a number box beside it, and presets underneath —
 * across five files, the range input the most prominent and the least able to
 * hit 37.
 *
 * Then reported: "perhaps sliders can be ok if designed well for question count
 * and categories." They can, and the distinction these tests exist to hold is
 * WHICH slider. Not a third affordance competing with two others, and not a
 * native widget: a secondary track sharing one row with the exact entry that
 * covers its weakness, drawn only where a span is wide enough for a proportion
 * to mean anything, and never the only way to reach a value.
 *
 * So the assertion is no longer "no range input exists". It is that exactly one
 * file may own one, that it never stands alone, and that every value stays
 * reachable without it.
 *
 * These assertions are about behaviour and semantics, not appearance. jsdom has
 * no layout engine, so nothing here measures anything.
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import CountField from '../components/CountField';

function draw(props = {}) {
  const onChange = jest.fn();
  const utils = render(
    <CountField
      label="Questions to generate"
      value={10}
      onChange={onChange}
      min={1}
      max={100}
      presets={[5, 10, 20, 50]}
      {...props}
    />,
  );
  return { onChange, ...utils };
}

describe('the track, and the terms it is allowed back on', () => {
  // rejects: replacing a slider with a bare number box — losing the one thing
  // the presets were always doing better than the drag.
  it('offers the presets as the primary way in', () => {
    draw();
    for (const n of [5, 10, 20, 50]) {
      expect(screen.getByRole('radio', { name: String(n) })).toBeInTheDocument();
    }
  });

  it('draws a track across a wide span, and it is labelled for what it does', () => {
    draw({ min: 1, max: 100 });
    expect(screen.getByRole('slider', { name: /set roughly/i })).toBeInTheDocument();
  });

  /*
    THE WHOLE COMPLAINT, IN ONE ASSERTION. A slider that is the only way to say
    a number cannot say 37. This one never is: the presets, the steppers and a
    typed box are all present in the same field, and the tests below prove each
    of them still reports a value.
  */
  // rejects: the exact entry being dropped once a track is there — which is
  // precisely the state the original three-control stack was in.
  it('never stands alone — the exact entry is beside it', () => {
    draw({ min: 1, max: 100 });
    expect(screen.getByRole('slider')).toBeInTheDocument();
    expect(screen.getByRole('spinbutton')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /one more/i })).toBeInTheDocument();
  });

  it('reports a value when dragged', () => {
    const { onChange } = draw({ min: 1, max: 100 });
    fireEvent.change(screen.getByRole('slider'), { target: { value: '42' } });
    expect(onChange).toHaveBeenCalledWith(42);
  });

  /*
    A track over six values is decoration: it cannot show a proportion worth
    seeing, and its two endpoints say less than the words "1–6" do.
  */
  // rejects: a track on a span too narrow to carry information.
  it('draws no track across a narrow span, and states the range in words instead', () => {
    draw({ min: 1, max: 6, presets: [1, 3] });
    expect(screen.queryByRole('slider')).toBeNull();
    expect(screen.getByText('1–6')).toBeInTheDocument();
  });

  // rejects: a caller that genuinely does not want one being unable to say so.
  it('can be refused outright', () => {
    draw({ min: 1, max: 100, track: false });
    expect(screen.queryByRole('slider')).toBeNull();
    expect(screen.getByText('1–100')).toBeInTheDocument();
  });
});

describe('choosing a value', () => {
  it('a preset reports it', () => {
    const { onChange } = draw();
    fireEvent.click(screen.getByRole('radio', { name: '20' }));
    expect(onChange).toHaveBeenCalledWith(20);
  });

  /*
    A RADIOGROUP, NOT FOUR BUTTONS. These are mutually exclusive choices of one
    value; saying so is what lets a screen reader announce which is current
    instead of four unrelated presses.
  */
  // rejects: dropping the selected state, which is how the current value stays
  // legible at a glance now that no thumb position implies it.
  it('marks the current one as chosen', () => {
    draw({ value: 20 });
    expect(screen.getByRole('radio', { name: '20' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: '5' })).toHaveAttribute('aria-checked', 'false');
  });

  it('the steppers move by one', () => {
    const { onChange } = draw({ value: 10 });
    fireEvent.click(screen.getByRole('button', { name: /one more/i }));
    expect(onChange).toHaveBeenLastCalledWith(11);
    fireEvent.click(screen.getByRole('button', { name: /one fewer/i }));
    expect(onChange).toHaveBeenLastCalledWith(9);
  });

  // rejects: losing exactness. The whole complaint about a slider is that it
  // cannot hit 37; typing has to keep working.
  it('an exact number can still be typed', () => {
    const { onChange } = draw();
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '37' } });
    expect(onChange).toHaveBeenCalledWith(37);
  });
});

describe('the bounds hold, wherever the value comes from', () => {
  // rejects: sending the server a count it will reject. A range input clamped
  // for free; typed input does not.
  it('clamps a typed value that is out of range', () => {
    const { onChange } = draw({ min: 1, max: 24 });
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '400' } });
    expect(onChange).toHaveBeenCalledWith(24);
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '0' } });
    expect(onChange).toHaveBeenLastCalledWith(1);
  });

  // rejects: NaN reaching the caller when the field is emptied mid-edit.
  it('an emptied field falls back to the minimum rather than NaN', () => {
    const { onChange } = draw({ min: 3 });
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '' } });
    expect(onChange).toHaveBeenCalledWith(3);
  });

  it('the steppers stop at the ends', () => {
    draw({ value: 1, min: 1, max: 5 });
    expect(screen.getByRole('button', { name: /one fewer/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /one more/i })).not.toBeDisabled();
  });
});

describe('what it says', () => {
  // rejects: making the reader infer the value from a thumb position — the
  // thing the number box was compensating for.
  /*
    THE RANGE IS STATED EXACTLY ONCE, either way. Where a track is drawn its
    endpoints are the statement, in the place the thing is; where one is not,
    the caption is. Saying it both ways would be the same fact about one object
    twice in a viewport.
  */
  it('states the current value, and the permitted range at the track ends', () => {
    draw({ value: 12, min: 1, max: 24 });
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('24')).toBeInTheDocument();
    expect(screen.queryByText('1–24')).toBeNull();
  });

  it('carries a hint when one is given, and nothing when not', () => {
    const { rerender } = draw({ hint: 'Categories are what the host switches on and off.' });
    expect(screen.getByText(/host switches on and off/i)).toBeInTheDocument();
    rerender(
      <CountField label="X" value={1} onChange={jest.fn()} presets={[]} />,
    );
    expect(screen.queryByText(/host switches on and off/i)).toBeNull();
  });
});

/**
 * AND NO BUILDER OWNS ONE OF ITS OWN.
 *
 * This is the assertion that survived the reversal unchanged, because it was
 * never really about sliders — it is about five files each hand-rolling the
 * same control. The report named both surfaces — "the AI builder and Manual
 * builder … it is used for category count and for question count for
 * generation" — and the manual builder's one was missed on the first pass,
 * because it lives in `AIAssistant.jsx` under `BuilderPage` rather than in the
 * four `*AIBuilder` files. It was only caught by grepping the DEPLOYED bundle
 * for the old class name and finding it still there.
 *
 * CountField may have a range input. Nothing else may, so a redesign of this
 * control lands everywhere at once and cannot be half-applied again.
 */
describe('no builder owns a range input of its own', () => {
  const fs = require('fs');
  const path = require('path');

  const SRC = path.join(__dirname, '..');
  const walk = (dir, out = []) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
        walk(full, out);
      } else if (/\.jsx?$/.test(entry.name)) out.push(full);
    }
    return out;
  };

  // rejects: a builder hand-rolling its own range input instead of taking the
  // shared field — which is how five copies of one control came to exist, and
  // how one of them survived a sweep of the other four.
  it('no range input survives outside CountField', () => {
    const offenders = walk(SRC)
      .filter((f) => !f.endsWith('CountField.jsx'))
      .filter((f) => {
        const src = fs.readFileSync(f, 'utf8')
          .replace(/\/\*[\s\S]*?\*\//g, ' ')
          .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
        return /type=["']range["']/.test(src);
      })
      .map((f) => path.relative(SRC, f));
    expect(offenders).toEqual([]);
  });
});

/**
 * AND NO BUILDER ASKS "HOW MANY?" WITH A BARE NUMBER BOX EITHER.
 *
 * The sweep that replaced the sliders searched for `type="range"`, so the one
 * "how many?" field that was ALREADY a plain `<input type="number">` survived
 * it untouched: the scenario builder's category count, sitting one form-row
 * above a CountField, asking the same kind of question with a different
 * control, browser spinners and all. Its caption read "System supports maximum
 * 24 categories due to bitmask limitations" — an implementation detail offered
 * to a host as an explanation.
 *
 * A number input is fine for a year, a price, a percentage. It is not fine for
 * a bounded count with obvious presets, which is what this component exists
 * for, and two of them on one screen must not disagree about how to ask.
 */
describe('the builders all ask the same way', () => {
  const fs = require('fs');
  const path = require('path');

  const COMPONENTS = path.join(__dirname, '..', 'components');
  const BUILDERS = [
    'AIScenarioBuilder.jsx',
    'TriviaAIBuilder.jsx',
    'PollAIBuilder.jsx',
    'SurveyAIBuilder.jsx',
    'AIAssistant.jsx',
  ];

  const source = (f) => fs.readFileSync(path.join(COMPONENTS, f), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ');

  // rejects: a count asked with a raw number box on any builder.
  it.each(BUILDERS)('%s has no bare number input left', (file) => {
    expect(source(file)).not.toMatch(/type=["']number["']/);
  });

  // rejects: the scenario builder's category count regressing to its own
  // control, which is the exact field this test was written for.
  it('the scenario builder asks for categories with the shared field', () => {
    const src = source('AIScenarioBuilder.jsx');
    expect(src).toMatch(/<CountField[\s\S]*?value=\{scenarioConfig\.numberOfCategories\}/);
    expect(src).not.toMatch(/bitmask/i);
  });
});
