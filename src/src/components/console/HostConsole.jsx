import React from 'react';
import ConsoleTop from './ConsoleTop';
import ConsoleRail from './ConsoleRail';
import ConsoleFooter from './ConsoleFooter';
import WorkflowStrip from '../stage/WorkflowStrip';
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

export default function HostConsole({ top, strip, rail, footer, children }) {
  return (
    <div className="hc" data-theme="dark" onClick={releasePointerFocus}>
      <ConsoleTop {...top} />
      <div className="hc-loop">{strip && strip.strip ? <WorkflowStrip {...strip} places={null} hidePart /> : null}</div>
      <ConsoleRail {...rail} />
      <main className="hc-main">{children}</main>
      <ConsoleFooter {...footer} />
    </div>
  );
}
