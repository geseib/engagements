import React, { useState } from 'react';
import { useAuth } from './AuthContext';
import './auth.css';

const PasswordChangeForm = () => {
  const { completeNewPassword, error, loading, newPasswordRequired } = useAuth();
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [validationError, setValidationError] = useState('');

  const validatePassword = (password) => {
    const errors = [];
    
    if (password.length < 8) {
      errors.push('At least 8 characters');
    }
    if (!/[A-Z]/.test(password)) {
      errors.push('One uppercase letter');
    }
    if (!/[a-z]/.test(password)) {
      errors.push('One lowercase letter');
    }
    if (!/\d/.test(password)) {
      errors.push('One number');
    }
    if (!/[!@#$%^&*(),.?":{}|<>]/.test(password)) {
      errors.push('One special character');
    }
    
    return errors;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setValidationError('');

    // Validate passwords match
    if (newPassword !== confirmPassword) {
      setValidationError('Passwords do not match');
      return;
    }

    // Validate password strength
    const passwordErrors = validatePassword(newPassword);
    if (passwordErrors.length > 0) {
      setValidationError(`Password must have: ${passwordErrors.join(', ')}`);
      return;
    }

    try {
      // Complete the password challenge
      await completeNewPassword(newPassword);
    } catch (err) {
      console.error('Password change failed:', err);
    }
  };

  if (!newPasswordRequired) {
    return null;
  }

  return (
    <div className="auth-page">
      <div className="auth-background">
        <div className="auth-pattern"></div>
      </div>
      
      <div className="auth-container">
        <div className="auth-nav">
          <div className="auth-logo">
            <h1>Engagements</h1>
            <span className="tagline">
              Interactive Team Sessions
              {(() => {
                const hostname = window.location.hostname;
                if (hostname.includes('.dev.')) return ' • dev';
                if (hostname.includes('.test.')) return ' • test';
                return '';
              })()}
            </span>
          </div>
        </div>

        <div className="auth-form-container">
          <div className="auth-header">
            <h2>Set New Password</h2>
            <p>You must set a new password to continue</p>
          </div>

          <form onSubmit={handleSubmit} className="auth-form">
            {(error || validationError) && (
              <div className="auth-error" role="alert">
                <i className="error-icon">⚠️</i>
                <span>{validationError || error}</span>
              </div>
            )}

            <div className="form-group">
              <label htmlFor="newPassword">
                New Password
              </label>
              <input
                id="newPassword"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="form-input"
                placeholder="Enter your new password"
                required
                disabled={loading}
              />
            </div>

            <div className="form-group">
              <label htmlFor="confirmPassword">
                Confirm Password
              </label>
              <input
                id="confirmPassword"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="form-input"
                placeholder="Confirm your new password"
                required
                disabled={loading}
              />
            </div>

            <div className="input-hint">
              Password requirements:
              <ul style={{ margin: '8px 0 0 16px', listStyle: 'disc' }}>
                <li>At least 8 characters</li>
                <li>One uppercase and one lowercase letter</li>
                <li>One number and one special character</li>
              </ul>
            </div>

            <button
              type="submit"
              disabled={loading || !newPassword || !confirmPassword}
              className={`auth-button primary ${loading ? 'loading' : ''}`}
            >
              {loading ? (
                <>
                  <span className="loading-spinner"></span>
                  Updating...
                </>
              ) : (
                'Set New Password'
              )}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};

export default PasswordChangeForm;