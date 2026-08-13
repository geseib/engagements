/**
 * THE ROUND DIRECTION PICKER — components/RoundKindPicker.jsx.
 *
 * Rendered, because the property that matters is what somebody who has never
 * read this codebase can SEE at the moment of choosing. The pair that will be
 * got wrong is Apply versus Improve: mechanically identical — hand the room a
 * passage, ask for work on it — and different only in who wrote the passage. If
 * the ownership distinction is not on screen, the wrong one gets picked and the
 * generator writes the wrong questions, which is the whole reported defect.
 *
 * jsdom has no layout engine, so nothing here asserts geometry. Roles, names,
 * checked state and text — plus one COLOUR block, which is arithmetic over
 * declared values and not a measurement of anything rendered.
 */
import React, { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import fs from 'fs';
import path from 'path';
import RoundKindPicker from '../components/RoundKindPicker';
import { ROUND_KINDS } from '../config/roundKinds';

/** A host that actually holds state, so a click has to travel the real path. */
function Harness({ initial = 'produce', withInstruction = true }) {
  const [kind, setKind] = useState(initial);
  const [brief, setBrief] = useState('');
  const [instruction, setInstruction] = useState('');
  return (
    <RoundKindPicker
      value={kind}
      onChange={setKind}
      brief={brief}
      onBriefChange={setBrief}
      instruction={instruction}
      onInstructionChange={withInstruction ? setInstruction : undefined}
    />
  );
}

describe('all five choices are visible at once', () => {
  test('five radios in one group, one of them checked', () => {
    // rejects: a <select>. The owner sketched a dropdown; a dropdown shows one
    // option at a time and the choice that goes wrong is a COMPARISON between
    // two options that read almost identically. You cannot compare what you
    // cannot see side by side.
    render(<Harness />);
    const group = screen.getByRole('radiogroup');
    expect(group).toBeInTheDocument();
    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(5);
    expect(radios.filter((r) => r.checked)).toHaveLength(1);
  });

  test('each option is reachable by its own name', () => {
    // rejects: labels that are not associated with their input, which takes the
    // whole control off the keyboard and out of the accessibility tree.
    render(<Harness />);
    for (const id of ['produce', 'apply', 'improve', 'judge', 'custom']) {
      expect(screen.getByRole('radio', { name: new RegExp(ROUND_KINDS[id].label, 'i') })).toBeInTheDocument();
    }
  });

  test('every card states what you HAND the room, not only what the room does', () => {
    // rejects: trimming the cards down to a label and a verb. "Improve" and
    // "Apply" are both "work on this material"; the hand-them line is the only
    // thing on screen that separates them.
    render(<Harness />);
    expect(screen.getByText(ROUND_KINDS.apply.blurb)).toBeInTheDocument();
    expect(screen.getByText(ROUND_KINDS.improve.blurb)).toBeInTheDocument();
    expect(ROUND_KINDS.apply.blurb).toMatch(/somebody else's/i);
    expect(ROUND_KINDS.improve.blurb).toMatch(/our own/i);
  });
});

describe('choosing a kind changes what the screen says about it', () => {
  test('selecting Apply shows the foreign-material framing; Improve shows ours', () => {
    // rejects: a static detail strip that does not follow the selection, which
    // would leave an operator reading Produce's explanation while Apply is
    // selected — the exact confusion between the two axes this control exists
    // to end.
    render(<Harness />);
    fireEvent.click(screen.getByRole('radio', { name: /Apply/i }));
    expect(screen.getByText(ROUND_KINDS.apply.handThem)).toBeInTheDocument();
    expect(screen.getByText(ROUND_KINDS.apply.pickWhen)).toBeInTheDocument();
    expect(screen.queryByText(ROUND_KINDS.improve.handThem)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('radio', { name: /Improve/i }));
    expect(screen.getByText(ROUND_KINDS.improve.handThem)).toBeInTheDocument();
    expect(screen.queryByText(ROUND_KINDS.apply.handThem)).not.toBeInTheDocument();
  });

  test('the checked radio follows the click', () => {
    // rejects: rendering selection from a local visual flag rather than from
    // the value prop, which would let the picker show one kind and report
    // another to the generator.
    render(<Harness />);
    fireEvent.click(screen.getByRole('radio', { name: /Judge/i }));
    expect(screen.getByRole('radio', { name: /Judge/i }).checked).toBe(true);
    expect(screen.getByRole('radio', { name: /Produce/i }).checked).toBe(false);
  });

  test('an unrecognised stored value renders as Produce rather than nothing', () => {
    // rejects: crashing or rendering an empty picker for a set carrying a value
    // written before the enum closed. A reader resolves; only the writers refuse.
    render(<RoundKindPicker value="reflect" onChange={() => {}} />);
    expect(screen.getByRole('radio', { name: /Produce/i }).checked).toBe(true);
  });
});

describe('the custom escape hatch', () => {
  test('the two free-text boxes appear only for Something else', () => {
    // rejects: showing them always, which invites an operator to type a
    // direction that will be ignored because the kind is Produce.
    render(<Harness />);
    expect(screen.queryByLabelText(/What should this round do/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: /Something else/i }));
    expect(screen.getByLabelText(/What should this round do/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/What is the room told/i)).toBeInTheDocument();
  });

  test('an empty custom direction says which box is missing and why', () => {
    // rejects: a silently disabled Generate button. The four named kinds carry
    // their own direction and instruction; custom carries neither, and an
    // operator who is not told that assumes the control is broken.
    render(<Harness />);
    fireEvent.click(screen.getByRole('radio', { name: /Something else/i }));
    const gap = screen.getByRole('status');
    expect(gap).toHaveTextContent(/no direction to follow/i);
    expect(gap).toHaveTextContent(/no instruction/i);

    fireEvent.change(screen.getByLabelText(/What should this round do/i), {
      target: { value: 'Hand them two proposals and ask which they would fund.' },
    });
    expect(screen.getByRole('status')).not.toHaveTextContent(/no direction to follow/i);
    expect(screen.getByRole('status')).toHaveTextContent(/no instruction/i);
  });

  test('a host that supplies no instruction handler is not asked for one', () => {
    // rejects: demanding a participant instruction in the set editor, where the
    // Custom Instructions field beside this picker already is that instruction.
    render(<Harness withInstruction={false} />);
    fireEvent.click(screen.getByRole('radio', { name: /Something else/i }));
    expect(screen.getByLabelText(/What should this round do/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/What is the room told/i)).not.toBeInTheDocument();
    expect(screen.getByRole('status')).not.toHaveTextContent(/no instruction/i);
  });

  test('the brief is capped at the length the backend accepts', () => {
    // rejects: an uncapped box that lets somebody type 5,000 characters and
    // discover the 400 only at save time.
    render(<Harness />);
    fireEvent.click(screen.getByRole('radio', { name: /Something else/i }));
    expect(screen.getByLabelText(/What should this round do/i)).toHaveAttribute('maxlength', '500');
  });
});

/* ------------------------------------------------------------------ colour -- */

/**
 * THE COLOUR PAIRINGS THIS COMPONENT INTRODUCES.
 *
 * Same discipline as questionSetsPalette.test.js, and the functions are lifted
 * verbatim from docs/design/admin-redesign/audit.html for the same reason.
 * Not geometry: this is arithmetic over the hex values declared in
 * RoundKindPicker.css, read out of the file. Change a token and these move.
 *
 * The component paints its own cards (#ffffff and the amber tint #fdf3e4)
 * rather than inheriting, because it renders on TWO different surfaces — the AI
 * builder modal and the set editor's Details panel — and a control that
 * inherits its surface has to be audited twice and drifts when either parent is
 * repainted.
 */
// Comments stripped before any assertion. A source assertion in this repo has
// already passed on a comment once (RESUME, Landmines), and this file's own
// header comment names `var(--primary)` as the colour NOT to use — which would
// otherwise fail the borrowed-token check on the strength of a warning about it.
const CSS = fs.readFileSync(path.join(__dirname, '..', 'components', 'RoundKindPicker.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');
const tokenValue = (name) => {
  const m = CSS.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{3,8})`));
  if (!m) throw new Error(`RoundKindPicker.css declares no --${name}`);
  return m[1];
};
const rgb = (s) => String(s).replace('#', '').match(/.{2}/g).map((h) => parseInt(h, 16));
const lin = (c) => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const lum = (c) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
const ratio = (a, b) => {
  const [A, B] = [lum(rgb(a)), lum(rgb(b))];
  return (Math.max(A, B) + 0.05) / (Math.min(A, B) + 0.05);
};

describe('the picker is legible on both surfaces it paints', () => {
  const surfaces = () => [tokenValue('rkp-card'), tokenValue('rkp-card-selected')];

  test('body copy clears AA on the plain card and on the selected tint', () => {
    // rejects: repainting the selected card darker without moving the text
    // colour. The selected card is the one an operator reads longest, and it is
    // the one a tint change would break first.
    for (const bg of surfaces()) {
      expect(ratio(tokenValue('rkp-text'), bg)).toBeGreaterThanOrEqual(4.5);
    }
  });

  test('the card blurbs — the copy that separates Apply from Improve — clear AA', () => {
    // rejects: muting the blurb further "because it is secondary". It is not
    // secondary: it is the only text on the card that says who owns the
    // material, which is the distinction the whole slice turns on.
    for (const bg of surfaces()) {
      expect(ratio(tokenValue('rkp-muted'), bg)).toBeGreaterThanOrEqual(4.5);
    }
  });

  test('the accent is a paper amber, not the dusk one', () => {
    // rejects: reaching for var(--primary) #F6A94C, which is 1.96:1 on white
    // and cannot be a label, a border cue or a meaningful icon on this surface.
    // #8a5300 is the paper amber GeneratedItemsTable.css already uses in the
    // same modal; reused rather than reinvented.
    for (const bg of surfaces()) {
      expect(ratio(tokenValue('rkp-accent'), bg)).toBeGreaterThanOrEqual(4.5);
    }
    expect(ratio('#F6A94C', tokenValue('rkp-card'))).toBeLessThan(3);
  });

  test('every colour is declared on the component root, never borrowed', () => {
    // rejects: `var(--primary)` or `var(--text)` inside this stylesheet. An
    // undefined custom property invalidates the whole declaration, so a
    // borrowed token renders an unstyled control anywhere styles.css is not
    // loaded — which is every component test, including this one.
    const borrowed = CSS.match(/var\(--(?!rkp-)[a-z-]+\)/g) || [];
    expect(borrowed).toEqual([]);
  });
});
