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

/*
  ONE CONSOLE, OTHER USES (parity PLAN §2.6, B8; owner, 19 Oct 2026: "one
  app, different use cases"). The Build Room's laptop on two screens is this
  console with its own parts in the same places. Every prop below is optional
  and leaves Call & Answer's console exactly as it was:
    variant     a modifier class on the root (`hc--build`)
    railSlot    the type's own rail, in the rail's place (four Section slots)
    side        a side column right of the centre (the Build Room's folds)
    topExtra    the type's own top-line parts, after the room's window
    onLeave     a way out that is not a round control (the Build Room's Main menu)
    stripIdle   the strip with nothing live: kept, dimmed (answer (c))
    mainLabel   the main area's accessible name
*/
export default function HostConsole({
  top, strip, rail, footer, children,
  variant = '', railSlot = null, side = null, topExtra = null, onLeave: leaveTo = null, stripIdle = false, mainLabel = undefined,
}) {
  const { controls, leave } = splitLeave(footer && footer.controls);
  const onLeave = leave && footer && typeof footer.onAction === 'function' ? () => footer.onAction(leave) : leaveTo;
  const cls = ['hc', variant, side ? 'hc--side' : ''].filter(Boolean).join(' ');
  return (
    <div className={cls} data-theme="dark" onClick={releasePointerFocus}>
      <ConsoleTop {...top} onLeave={onLeave}>{topExtra}</ConsoleTop>
      <div className={`hc-loop${stripIdle ? ' is-idle' : ''}`}>{strip && strip.strip ? <WorkflowStrip {...strip} places={null} hidePart /> : null}</div>
      {railSlot || <ConsoleRail {...rail} />}
      <ConsoleFooter {...footer} controls={controls} />
      <main className="hc-main" aria-label={mainLabel}>{children}</main>
      {side ? <aside className="hc-side" aria-label="What happened">{side}</aside> : null}
    </div>
  );
}
