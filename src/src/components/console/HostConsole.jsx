import React from 'react';
import ConsoleTop from './ConsoleTop';
import ConsoleRail from './ConsoleRail';
import ConsoleFooter from './ConsoleFooter';
import WorkflowStrip from '../stage/WorkflowStrip';
import './HostConsole.css';

/**
 * THE HOST CONSOLE (docs/superpowers/specs/2026-10-15-host-console-design.md):
 * the laptop's private screen on two screens. Data and callbacks only; the
 * page owns the session. The panel for the moment is the child.
 *
 * data-theme="dark" (dusk) on its own root, as HostRemote and PresentStage do:
 * public/index.html puts data-theme="light" on <html>.
 */
export default function HostConsole({ top, strip, rail, footer, children }) {
  return (
    <div className="hc" data-theme="dark">
      <ConsoleTop {...top} />
      <div className="hc-loop">{strip && strip.strip ? <WorkflowStrip {...strip} places={null} hidePart /> : null}</div>
      <ConsoleRail {...rail} />
      <main className="hc-main">{children}</main>
      <ConsoleFooter {...footer} />
    </div>
  );
}
