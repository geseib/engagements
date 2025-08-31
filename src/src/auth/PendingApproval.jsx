import React from 'react';
import { useAuth } from './AuthContext';
import './auth.css';

const PendingApproval = ({ email, name, onSignOut }) => {
  const { currentUser, signOut } = useAuth();

  const handleSignOut = () => {
    signOut();
    if (onSignOut) {
      onSignOut();
    }
  };

  const userName = name || currentUser?.attributes?.name || 'there';

  return (
    <div className="auth-form-container pending-approval">
      <div className="auth-header">
        <div className="pending-icon">
          <div className="hourglass">⏳</div>
        </div>
        <h2>Account Pending Approval</h2>
        <p>Welcome, <strong>{userName}</strong>!</p>
      </div>

      <div className="pending-content">
        <div className="status-card">
          <div className="status-header">
            <h3>Your account has been created successfully</h3>
            <div className="status-badge pending">Pending Approval</div>
          </div>
          
          <div className="status-details">
            <p>
              Your registration for <strong>{email}</strong> is now under review by our administrators.
            </p>
            
            <div className="next-steps">
              <h4>What happens next?</h4>
              <ul>
                <li>Our team will review your account within 24-48 hours</li>
                <li>You'll receive an email notification once approved</li>
                <li>After approval, you'll be able to create and host sessions</li>
              </ul>
            </div>
          </div>
        </div>

        <div className="info-card">
          <h4>While you wait...</h4>
          <div className="info-grid">
            <div className="info-item">
              <div className="info-icon">🎮</div>
              <div>
                <strong>Join as a Player</strong>
                <p>You can participate in sessions using game codes - no approval needed!</p>
              </div>
            </div>
            
            <div className="info-item">
              <div className="info-icon">📚</div>
              <div>
                <strong>Learn More</strong>
                <p>Explore our help documentation to get familiar with Engagements</p>
              </div>
            </div>
            
            <div className="info-item">
              <div className="info-icon">💡</div>
              <div>
                <strong>Plan Sessions</strong>
                <p>Start thinking about what types of sessions you'd like to host</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="pending-actions">
        <button
          type="button"
          onClick={handleSignOut}
          className="auth-button secondary"
        >
          Sign Out
        </button>
        
        <a 
          href="/" 
          className="auth-button primary"
          onClick={(e) => {
            e.preventDefault();
            window.location.href = '/';
          }}
        >
          Join a Session as Player
        </a>
      </div>

      <div className="auth-footer">
        <div className="contact-info">
          <p>
            <strong>Questions about your approval?</strong>
          </p>
          <p>
            Contact your administrator or check back in 24-48 hours.
          </p>
        </div>
      </div>
    </div>
  );
};

export default PendingApproval;