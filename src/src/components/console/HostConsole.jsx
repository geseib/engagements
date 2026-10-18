import React from 'react';
import ConsoleTop from './ConsoleTop';
import ConsoleRail from './ConsoleRail';
import ConsoleFooter from './ConsoleFooter';
import WorkflowStrip from '../stage/WorkflowStrip';
import { HOST_INTENTS } from '../../config/hostControls';
import './HostConsole.css';

/**
 * THE HOST CONSOLE (docs/superpowers/specs/2026-10-15-host-console-design.md):
 * the laptop's private screen on two screens. Data and callbacks only; the
 * page owns the session. The panel for the moment is the child. The moment
 * itself travels on `rail.moment` (the rail opens its section from it).
 *
 * data-theme="dark" (dusk) on its own root, as HostRemote and PresentStage do:
 * public/index.html puts data-theme="light" on <html>.
 */
/*
  A CLICKED CONTROL DOES NOT KEEP THE KEYS (walk, 15 Oct). The host clicked a
  response, pressed → (fine), then Space: Chrome had flipped the still-focused
  button to :focus-visible after the key press, so the action bar's console
  exemption let Space press the response again instead of advancing. A
  control pressed with a pointer (event.detail > 0) lets go of focus after the
  click; a keyboard press (detail 0) keeps it, so Tab users keep native Space.
  Text fields are never blurred.
*/
export function releasePointerFocus(event) {
  if (!event || !(event.detail > 0)) return;
  const t = event.target;
  if (!t || typeof t.closest !== 'function') return;
  const ctl = t.closest('button, a[href], summary, [role="button"]');
  if (!ctl || !ctl.closest('.hc')) return;
  if (ctl.isContentEditable || t.closest('input, textarea, select, [contenteditable="true"]')) return;
  if (typeof ctl.blur === 'function') ctl.blur();
}

/*
  THE WAY OUT IS NOT A ROUND CONTROL (owner, 18 Oct 2026: "the back to menu
  (which menu? this game menu, thats cool. oops it took us out of the game").
  A LEAVE control (the lobby's and the end's secondary) comes off the action
  bar and becomes the top line's "All sessions", where it says where it goes
  and never sits beside Start round 1. A LEAVE primary (a finished survey,
  "Back to the agenda") stays the primary: there it is the next step.
*/
export function splitLeave(controls) {
  if (!controls) return { controls, leave: null };
  const isLeave = (c) => Boolean(c && c.intent === HOST_INTENTS.LEAVE);
  const leave = isLeave(controls.secondary) ? controls.secondary : isLeave(controls.tertiary) ? controls.tertiary : null;
  if (!leave) return { controls, leave: null };
  return {
    controls: {
      ...controls,
      secondary: isLeave(controls.secondary) ? null : controls.secondary,
      tertiary: isLeave(controls.tertiary) ? null : controls.tertiary,
    },
    leave,
  };
}

export default function HostConsole({ top, strip, rail, footer, children }) {
  const { controls, leave } = splitLeave(footer && footer.controls);
  const onLeave = leave && footer && typeof footer.onAction === 'function' ? () => footer.onAction(leave) : null;
  return (
    <div className="hc" data-theme="dark" onClick={releasePointerFocus}>
      <ConsoleTop {...top} onLeave={onLeave} />
      <div className="hc-loop">{strip && strip.strip ? <WorkflowStrip {...strip} places={null} hidePart /> : null}</div>
      <ConsoleRail {...rail} />
      <ConsoleFooter {...footer} controls={controls} />
      <main className="hc-main">{children}</main>
    </div>
  );
}
