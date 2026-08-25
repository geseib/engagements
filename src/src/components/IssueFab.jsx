import React, { useState } from 'react';
import IssueReportForm from './IssueReportForm';
import './IssueFab.css';
import Icon from './Icon';

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
 *
 * @param {'inline'|'floating'} placement Where this instance lives.
 */
const IssueFab = ({ context = 'host', gameId = null, placement = 'inline' }) => {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [formConfig, setFormConfig] = useState(null);

  const openForm = (type) => {
    setFormConfig({ type, context, gameId });
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
          `issue-fab-container--${placement === 'floating' ? 'floating' : 'inline'}`,
          isMenuOpen ? 'menu-open' : '',
        ].filter(Boolean).join(' ')}
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