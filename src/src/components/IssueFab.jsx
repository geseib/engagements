import React, { useEffect, useState } from 'react';
import IssueReportForm from './IssueReportForm';
import './IssueFab.css';
import Icon from './Icon';
import { getIssueGameId } from '../utils/issueContext';

/**
 * Report a bug, request a feature, ask for help.
 *
 * ── WHY THIS IS NO LONGER A FLOATING BUTTON BY DEFAULT ─────────────────────
 *
 * It was a 56px circle pinned `position: fixed` to the bottom-right at
 * `z-index: 20000` — above every dialog, every panel and every stage — on every
 * screen that mounted it. Reported plainly: it is "floating in the way".
 *
 * The sharper problem is that being fixed made it ignore the places that were
 * already built for it. GameHostPage passes it to SessionSetupPanel as
 * `issueControl`, which slots it into that panel's own footer — and it floated
 * anyway, because the CSS overrode the placement its own caller had chosen. A
 * component that cannot be put anywhere is not a component, it is a fixture.
 *
 * So placement is now a decision the CALLER makes:
 *
 *   'inline'   — a normal header/footer control, laid out where it is written.
 *                The default, because every current mount has somewhere to put
 *                it. The menu opens against the button rather than over the page.
 *   'floating' — the old fixed circle, for a surface with no chrome to host it.
 *   'corner'   — a small quiet tab fixed to the bottom-LEFT, UNDER every dialog.
 *
 * ── AND WHY 'corner' IS NOW THE ONE THE APP USES ───────────────────────────
 *
 * Inline fixed the overlap and lost the control. It lived in the admin header
 * and in one tab of the host's setup panel — not on the stage, the lobby, the
 * player page, the phone remote or the builder. Reported plainly again,
 * 2026-09-20: it "is not showing up in most screens".
 *
 * Every screen needs it and no two screens have the same chrome, so it is
 * mounted ONCE, by the router (App.jsx `IssueCorner`), in a place that exists
 * on all of them. What was wrong with the original was never that it was
 * fixed: it was 56px, bottom-right where Submit and Next live, and at
 * z-index 20000 over every dialog. The corner is 36px, bottom-left, and below
 * the lowest dialog layer in the app.
 *
 * `lifted` raises it over a bottom dock that spans the screen — the player's
 * and the remote's — instead of covering the dock's first button.
 *
 * @param {'inline'|'floating'|'corner'} placement Where this instance lives.
 */
const PLACEMENTS = ['inline', 'floating', 'corner'];

/**
 * How far the corner tab must rise to clear a dock that spans the bottom of the
 * screen, in px — or null when there is nothing to clear or no way to measure.
 *
 * A fixed lift was tried first (88px) and was wrong on the first screen it was
 * looked at: the player's join dock is a button PLUS a line of small print,
 * about 130px, and the dock's height changes with every phase. So the dock
 * declares itself (`data-issue-clearance`) and is measured. Only a dock that
 * actually reaches the bottom edge counts — one scrolled out of view, or
 * sitting mid-page on a tall screen, is not in the way.
 */
function useDockClearance(active) {
  const [clearance, setClearance] = useState(null);

  useEffect(() => {
    if (!active || typeof window === 'undefined') return undefined;
    let frame = 0;
    const measure = () => {
      frame = 0;
      let tallest = 0;
      document.querySelectorAll('[data-issue-clearance]').forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.height > 0 && r.bottom >= window.innerHeight - 1 && r.top < window.innerHeight) {
          tallest = Math.max(tallest, window.innerHeight - r.top);
        }
      });
      setClearance(tallest > 0 ? Math.round(tallest) : null);
    };
    const schedule = () => { if (!frame) frame = window.requestAnimationFrame(measure); };

    measure();
    window.addEventListener('resize', schedule);
    window.addEventListener('scroll', schedule, { passive: true });
    // The dock mounts, unmounts and changes height as the session moves through
    // its phases, none of which resizes the window.
    const mutations = typeof MutationObserver === 'function' ? new MutationObserver(schedule) : null;
    if (mutations) mutations.observe(document.body, { childList: true, subtree: true });
    const resizes = typeof ResizeObserver === 'function' ? new ResizeObserver(schedule) : null;
    if (resizes) resizes.observe(document.body);

    return () => {
      window.removeEventListener('resize', schedule);
      window.removeEventListener('scroll', schedule);
      if (mutations) mutations.disconnect();
      if (resizes) resizes.disconnect();
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [active]);

  return clearance;
}

const IssueFab = ({ context = 'host', gameId = null, placement = 'inline', lifted = false }) => {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [formConfig, setFormConfig] = useState(null);
  const isLifted = placement === 'corner' && lifted;
  const clearance = useDockClearance(isLifted);

  const openForm = (type) => {
    // Read at the moment of reporting, not at mount: the corner instance
    // outlives any one session, and the stage publishes its id as it changes.
    setFormConfig({ type, context, gameId: gameId || getIssueGameId() });
    setIsMenuOpen(false);
  };

  const closeForm = () => {
    setFormConfig(null);
  };

  return (
    <>
      <div
        className={[
          'issue-fab-container',
          `issue-fab-container--${PLACEMENTS.includes(placement) ? placement : 'inline'}`,
          isLifted ? 'issue-fab-container--lifted' : '',
          isMenuOpen ? 'menu-open' : '',
        ].filter(Boolean).join(' ')}
        // Measured, when it can be; the stylesheet's own figure otherwise.
        style={isLifted && clearance != null ? { '--issue-fab-lift': `${clearance}px` } : undefined}
      >
        {/* Floating Action Menu */}
        {isMenuOpen && (
          <div className="issue-fab-menu">
            <button 
              className="issue-fab-option bug"
              onClick={() => openForm('bug')}
              title="Report a Bug"
            >
              <span className="icon"><Icon name="Bug" weight="bold" size={16} color="currentColor" /></span>
              <span className="label">Report Bug</span>
            </button>
            
            <button 
              className="issue-fab-option feature"
              onClick={() => openForm('feature')}
              title="Request a Feature"
            >
              <span className="icon"><Icon name="Lightbulb" weight="duotone" size={16} color="var(--primary)" /></span>
              <span className="label">Request Feature</span>
            </button>
            
            <button 
              className="issue-fab-option help"
              onClick={() => openForm('help')}
              title="Get Help"
            >
              <span className="icon"><Icon name="Question" weight="bold" size={16} color="currentColor" /></span>
              <span className="label">Get Help</span>
            </button>
          </div>
        )}

        {/* Main FAB Button */}
        <button 
          className={`issue-fab-main ${isMenuOpen ? 'active' : ''}`}
          onClick={() => setIsMenuOpen(!isMenuOpen)}
          title="Report a problem or ask for something"
          aria-label="Report a problem or ask for something"
          aria-expanded={isMenuOpen}
        >
          {isMenuOpen
            ? <Icon name="X" weight="bold" size={placement === 'floating' ? 20 : 16} />
            : <Icon name="NotePencil" weight="bold" size={placement === 'floating' ? 20 : 16} />}
        </button>
      </div>

      {/* Issue Report Form */}
      {formConfig && (
        <IssueReportForm
          isOpen={true}
          onClose={closeForm}
          initialType={formConfig.type}
          initialContext={formConfig.context}
          gameId={formConfig.gameId}
        />
      )}
    </>
  );
};

export default IssueFab;