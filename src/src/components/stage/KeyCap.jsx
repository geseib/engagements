import React, { createContext, useContext } from 'react';

/**
 * THE KEY THAT ALSO PRESSES THIS BUTTON, DRAWN INSIDE IT.
 *
 * The owner, 31 Oct 2026: "i dont like the word SPACE just dangling outside
 * the button. it is confusing as to what its for." It had been a boxed
 * "SPACE" beside the main button, then the words "or press Space" (25 Oct);
 * either way it sat outside the thing it described. Tools that show a
 * shortcut (Linear, GitHub, Figma) put it on the control, as a small keycap
 * at its trailing edge. So does this.
 *
 * WHO SAYS WHETHER THE KEY WORKS. A `Dock` that is given `kbd` ('SPACE' when
 * the key presses the main button, '' when it does nothing right now) passes
 * it down through `DockKeyContext`, and the cap inside its main button reads
 * that: one decision, made where the dock's keys are wired. Outside a Dock —
 * the two-screen console, the event's board — the caller says it with `on`.
 *
 * ALWAYS IN ITS PLACE. When the key does nothing the cap stays, invisible
 * (`data-off`), so the button never changes width under the host's pointer
 * (docs/design/parity/PLAN.md §2a: "the bottom row buttons jump all over the
 * place"). It is shown on every display profile: hiding it on Room and TV was
 * tried and reversed — that is where the operator is furthest from the
 * machine (styles/stage.css). `aria-hidden`: the button's own
 * `aria-keyshortcuts` is what a screen reader announces.
 */
export const DockKeyContext = createContext(null);

/** How a key reads on its cap: 'SPACE' → 'Space', '→' stays '→'. */
export const keyName = (k) => (/^[A-Z]{2,}$/.test(String(k)) ? String(k).charAt(0) + String(k).slice(1).toLowerCase() : String(k));

export default function KeyCap({ k = 'SPACE', on }) {
  const fromDock = useContext(DockKeyContext);
  // A Dock that names its key decides; otherwise the caller's `on`. Neither:
  // there is no key to speak of here, so no cap at all.
  let live;
  if (typeof fromDock === 'string') live = Boolean(fromDock);
  else if (typeof on === 'boolean') live = on;
  else return null;
  const name = keyName((typeof fromDock === 'string' && fromDock) || k);
  return (
    <span className="keycap" aria-hidden="true" data-off={live ? undefined : ''}>{name}</span>
  );
}
