import React, { useState } from 'react';
import HelpSystem from './HelpSystem';
import './HelpButton.css';
import Icon from './Icon';

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
}) => {
  const [showHelp, setShowHelp] = useState(false);

  const buttonClass =
    `help-button help-button-${variant} help-button-${size}${className ? ` ${className}` : ''}`;

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