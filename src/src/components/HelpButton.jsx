import React, { useState } from 'react';
import HelpSystem from './HelpSystem';
import './HelpButton.css';
import Icon from './Icon';

const HelpButton = ({ section, variant = 'floating', size = 'medium', tooltip = 'Help & Documentation' }) => {
  const [showHelp, setShowHelp] = useState(false);

  const buttonClass = `help-button help-button-${variant} help-button-${size}`;

  const handleClick = () => {
    setShowHelp(true);
  };

  return (
    <>
      <button 
        className={buttonClass}
        onClick={handleClick}
        title={tooltip}
        aria-label={tooltip}
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

      {showHelp && (
        <HelpSystem 
          section={section}
          onClose={() => setShowHelp(false)}
        />
      )}
    </>
  );
};

export default HelpButton;