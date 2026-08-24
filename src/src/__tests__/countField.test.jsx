/**
 * "HOW MANY?" WITHOUT A SLIDER.
 *
 * Reported: "the AI builder and Manual builder could use a thoughtful design
 * tweak … the use of slider seems old school and not current cool design. it is
 * used for category count and for question count for generation."
 *
 * Every AI builder asked this with THREE controls stacked together — a range
 * input, a number box beside it, and a row of presets underneath — repeated
 * across five files. Three affordances for one integer, and the weakest of the
 * three (the slider) was the most prominent: nobody drags to 37, they drag near
 * it and correct in the box, which is why the box was there.
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

describe('the slider is gone', () => {
  // rejects: the control coming back, here or by a caller passing one through.
  it('renders no range input at all', () => {
    const { container } = draw();
    expect(container.querySelector('input[type="range"]')).toBeNull();
  });

  // rejects: replacing a slider with a bare number box — losing the one thing
  // the presets were always doing better than the drag.
  it('offers the presets as the primary way in', () => {
    draw();
    for (const n of [5, 10, 20, 50]) {
      expect(screen.getByRole('radio', { name: String(n) })).toBeInTheDocument();
    }
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
  it('states the current value and the permitted range', () => {
    draw({ value: 12, min: 1, max: 24 });
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('1–24')).toBeInTheDocument();
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
