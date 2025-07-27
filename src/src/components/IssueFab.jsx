import React, { useState } from 'react';
import IssueReportForm from './IssueReportForm';
import './IssueFab.css';

const IssueFab = ({ context = 'host', gameId = null }) => {
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
      <div className={`issue-fab-container ${isMenuOpen ? 'menu-open' : ''}`}>
        {/* Floating Action Menu */}
        {isMenuOpen && (
          <div className="issue-fab-menu">
            <button 
              className="issue-fab-option bug"
              onClick={() => openForm('bug')}
              title="Report a Bug"
            >
              <span className="icon">🐛</span>
              <span className="label">Report Bug</span>
            </button>
            
            <button 
              className="issue-fab-option feature"
              onClick={() => openForm('feature')}
              title="Request a Feature"
            >
              <span className="icon">💡</span>
              <span className="label">Request Feature</span>
            </button>
            
            <button 
              className="issue-fab-option help"
              onClick={() => openForm('help')}
              title="Get Help"
            >
              <span className="icon">❓</span>
              <span className="label">Get Help</span>
            </button>
          </div>
        )}

        {/* Main FAB Button */}
        <button 
          className={`issue-fab-main ${isMenuOpen ? 'active' : ''}`}
          onClick={() => setIsMenuOpen(!isMenuOpen)}
          title="Report Issue or Request Feature"
        >
          {isMenuOpen ? '×' : '📝'}
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