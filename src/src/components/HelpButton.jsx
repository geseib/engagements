import React, { useEffect, useId, useRef, useState } from 'react';
import HelpSystem from './HelpSystem';
import IssueReportForm from './IssueReportForm';
import './HelpButton.css';
import Icon from './Icon';

/**
 * The three things somebody can tell us, as the report form names them.
 * `type` is what IssueReportForm and the GitHub issue are keyed on.
 */
const REPORT_CHOICES = [
  { type: 'bug', label: 'Report a bug', icon: 'Bug' },
  { type: 'feature', label: 'Request a feature', icon: 'Lightbulb' },
  { type: 'help', label: 'Ask for help', icon: 'ChatCircleText' },
];

/** A session code off the address, for the player page. Four digits or nothing. */
function gameIdFromAddress() {
  try {
    const value = new URLSearchParams(window.location.search || '').get('gameId');
    return value && /^\d{4}$/.test(value) ? value : null;
  } catch (_) {
    return null;
  }
}

const HelpButton = ({
  section,
  variant = 'floating',
  size = 'medium',
  tooltip = 'Help & Documentation',
  /**
   * A class the HOST SURFACE dresses this control with — the same escape hatch
   * `Modal` gets, and for the same reason: only the caller knows what polarity
   * and what palette it is being dropped onto.
   *
   * The base `.help-button` is a #3b82f6 circle with a blue shadow. That colour
   * is in no Warm Summit palette, and it was the only paint this control had.
   * On the player's dusk bar it read as a stray browser affordance rather than
   * part of the product. Surfaces re-tint through this, at `.plr .help-button
   * .plr-helpbtn` specificity so the result does not depend on stylesheet
   * import order.
   */
  className = '',
  /**
   * `{ context: 'host'|'player'|'admin', gameId? }` — and with it this button
   * is ALSO where a bug, a feature request or a question is sent from.
   *
   * REPORTING HAS HAD THREE HOMES, AND THIS IS THE FOURTH BECAUSE THE FIRST
   * THREE WERE EACH WRONG IN A DIFFERENT WAY. A 56px circle fixed bottom-right
   * above every dialog: "floating in the way". An inline icon beside this one:
   * only two screens had a bar to put it in, so "it is not showing up in most
   * screens". A quiet tab fixed to the bottom-left of everything: present, and
   * still a second control competing with the docks. The owner, 2026-09-21:
   * put it on the menu bar — and is it not the same button as help? "Use the ?
   * button to bring up these three options plus a choice to read help."
   *
   * It is the same button. Somebody who is lost and somebody who has found a
   * fault are reaching for the same thing, and a bar that has room for one `?`
   * has room for this.
   *
   * Without `reports` nothing changes: one press opens `section`. The small
   * contextual buttons inside the admin sections stay that way on purpose —
   * they answer "what is this field", not "something is wrong".
   */
  reports = null,
}) => {
  const [showHelp, setShowHelp] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [report, setReport] = useState(null);
  const anchorRef = useRef(null);
  const buttonRef = useRef(null);
  const menuId = `help-menu-${useId().replace(/:/g, '')}`;

  const buttonClass =
    `help-button help-button-${variant} help-button-${size}${className ? ` ${className}` : ''}`;

  // Only while it is open, so that Escape on a closed menu is left for whatever
  // is underneath — this button sits in the header of a panel that closes on it.
  useEffect(() => {
    if (!menuOpen) return undefined;
    const onKeyDown = (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      setMenuOpen(false);
      if (buttonRef.current) buttonRef.current.focus();
    };
    const onMouseDown = (event) => {
      if (anchorRef.current && !anchorRef.current.contains(event.target)) setMenuOpen(false);
    };
    // Capture, so the panel this sits in does not also close on the same key.
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('mousedown', onMouseDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('mousedown', onMouseDown);
    };
  }, [menuOpen]);

  const handleClick = () => {
    if (reports) setMenuOpen((open) => !open);
    else setShowHelp(true);
  };

  const openGuides = () => { setMenuOpen(false); setShowHelp(true); };

  const openReport = (type) => {
    setMenuOpen(false);
    // Read when the report is opened, not when the bar mounted: the panel this
    // sits in outlives a session, and the player's code is in the address.
    setReport({ type, context: reports.context || 'host', gameId: reports.gameId || gameIdFromAddress() });
  };

  const button = (
    <button
      ref={buttonRef}
      type="button"
      className={buttonClass}
      onClick={handleClick}
      title={tooltip}
      aria-label={tooltip}
      {...(reports ? { 'aria-haspopup': 'menu', 'aria-expanded': menuOpen, 'aria-controls': menuOpen ? menuId : undefined } : {})}
    >
      {variant === 'text' ? (
        <>
          <span className="help-button-icon"><Icon name="Books" weight="duotone" size={16} color="var(--primary)" /></span>
          <span className="help-button-text">Help</span>
        </>
      ) : (
        <span className="help-button-icon"><Icon name="Question" weight="bold" size={16} color="currentColor" /></span>
      )}
    </button>
  );

  return (
    <>
      {reports ? (
        <span className="help-menu-anchor" ref={anchorRef}>
          {button}
          {menuOpen && (
            <div className="help-menu" id={menuId} role="menu" aria-label={tooltip}>
              <button type="button" role="menuitem" className="help-menu-item" onClick={openGuides}>
                <Icon name="Books" weight="bold" size={16} color="currentColor" />
                <span>Read the guides</span>
              </button>
              <div className="help-menu-rule" role="separator" />
              {REPORT_CHOICES.map((choice) => (
                <button key={choice.type} type="button" role="menuitem" className="help-menu-item" onClick={() => openReport(choice.type)}>
                  <Icon name={choice.icon} weight="bold" size={16} color="currentColor" />
                  <span>{choice.label}</span>
                </button>
              ))}
            </div>
          )}
        </span>
      ) : button}

      {showHelp && (
        <HelpSystem
          section={section}
          onClose={() => setShowHelp(false)}
        />
      )}

      {report && (
        <IssueReportForm
          isOpen={true}
          onClose={() => setReport(null)}
          initialType={report.type}
          initialContext={report.context}
          gameId={report.gameId}
        />
      )}
    </>
  );
};

export default HelpButton;
