import React, { useState } from 'react';
import { useAuth } from './AuthContext';
import './auth.css';
import Icon from '../components/Icon';

// Two-step self-service password reset:
//   1. "request" — enter email, Cognito emails a 6-digit code
//   2. "reset"   — enter code + new password, Cognito sets the new password
const ForgotPasswordForm = ({ onToggleMode, initialEmail = '' }) => {
  const [step, setStep] = useState('request');
  const [formData, setFormData] = useState({
    email: initialEmail,
    code: '',
    newPassword: '',
    confirmNewPassword: '',
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [validationErrors, setValidationErrors] = useState({});

  const { forgotPassword, confirmPassword, error, setError } = useAuth();

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    const nextValue = name === 'code' ? value.replace(/\D/g, '').slice(0, 6) : value;
    setFormData((prev) => ({ ...prev, [name]: nextValue }));
    if (validationErrors[name]) {
      setValidationErrors((prev) => ({ ...prev, [name]: '' }));
    }
    if (error) setError(null);
  };

  const passwordIsStrong = (pw) =>
    pw.length >= 8 && /[A-Z]/.test(pw) && /[a-z]/.test(pw) && /\d/.test(pw) && /[^A-Za-z0-9]/.test(pw);

  const handleRequest = async (e) => {
    e.preventDefault();
    const errors = {};
    if (!formData.email.trim()) errors.email = 'Email is required';
    else if (!/\S+@\S+\.\S+/.test(formData.email)) errors.email = 'Please enter a valid email address';
    setValidationErrors(errors);
    if (Object.keys(errors).length) return;

    setIsSubmitting(true);
    try {
      await forgotPassword(formData.email.trim());
      setStep('reset');
    } catch (err) {
      // error surfaced via AuthContext
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReset = async (e) => {
    e.preventDefault();
    const errors = {};
    if (formData.code.length !== 6) errors.code = 'Enter the 6-digit code from your email';
    if (!passwordIsStrong(formData.newPassword)) {
      errors.newPassword = 'At least 8 chars with uppercase, lowercase, number, and symbol';
    }
    if (formData.newPassword !== formData.confirmNewPassword) {
      errors.confirmNewPassword = 'Passwords do not match';
    }
    setValidationErrors(errors);
    if (Object.keys(errors).length) return;

    setIsSubmitting(true);
    try {
      await confirmPassword(formData.email.trim(), formData.code, formData.newPassword);
      // Send them back to login with a fresh slate
      onToggleMode('login');
    } catch (err) {
      // error surfaced via AuthContext
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResend = async () => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    setError(null);
    try {
      await forgotPassword(formData.email.trim());
    } catch (err) {
      // error surfaced via AuthContext
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="auth-form-container">
      <div className="auth-header">
        <h2>Reset Your Password</h2>
        <p>
          {step === 'request'
            ? "Enter your email and we'll send you a reset code."
            : 'Enter the code we emailed you and choose a new password.'}
        </p>
      </div>

      {step === 'request' ? (
        <form onSubmit={handleRequest} className="auth-form">
          {error && (
            <div className="auth-error" role="alert">
              <i className="error-icon"><Icon name="Warning" weight="fill" size={16} color="var(--primary)" /></i>
              <span>{error}</span>
            </div>
          )}

          <div className="form-group">
            <label htmlFor="email">Email Address</label>
            <input
              id="email"
              type="email"
              name="email"
              value={formData.email}
              onChange={handleInputChange}
              className={`form-input ${validationErrors.email ? 'error' : ''}`}
              placeholder="Enter your email"
              disabled={isSubmitting}
              required
              autoComplete="email"
            />
            {validationErrors.email && <span className="field-error">{validationErrors.email}</span>}
          </div>

          <button type="submit" className={`auth-button primary ${isSubmitting ? 'loading' : ''}`} disabled={isSubmitting}>
            {isSubmitting ? (
              <>
                <span className="loading-spinner"></span>
                Sending code...
              </>
            ) : (
              'Send reset code'
            )}
          </button>

          <div className="auth-links">
            <button type="button" onClick={() => onToggleMode('login')} className="link-button" disabled={isSubmitting}>
              Back to <strong>Sign in</strong>
            </button>
          </div>
        </form>
      ) : (
        <form onSubmit={handleReset} className="auth-form">
          {error && (
            <div className="auth-error" role="alert">
              <i className="error-icon"><Icon name="Warning" weight="fill" size={16} color="var(--primary)" /></i>
              <span>{error}</span>
            </div>
          )}

          <div className="form-group">
            <label htmlFor="code">Reset Code</label>
            <input
              id="code"
              type="text"
              name="code"
              value={formData.code}
              onChange={handleInputChange}
              className={`form-input verification-code ${validationErrors.code ? 'error' : ''}`}
              placeholder="Enter 6-digit code"
              disabled={isSubmitting}
              required
              maxLength="6"
              autoComplete="one-time-code"
              inputMode="numeric"
            />
            {validationErrors.code && <span className="field-error">{validationErrors.code}</span>}
          </div>

          <div className="form-group">
            <label htmlFor="newPassword">New Password</label>
            <input
              id="newPassword"
              type="password"
              name="newPassword"
              value={formData.newPassword}
              onChange={handleInputChange}
              className={`form-input ${validationErrors.newPassword ? 'error' : ''}`}
              placeholder="Choose a new password"
              disabled={isSubmitting}
              required
              autoComplete="new-password"
            />
            {validationErrors.newPassword && <span className="field-error">{validationErrors.newPassword}</span>}
            <div className="input-hint">At least 8 characters, with uppercase, lowercase, a number, and a symbol.</div>
          </div>

          <div className="form-group">
            <label htmlFor="confirmNewPassword">Confirm New Password</label>
            <input
              id="confirmNewPassword"
              type="password"
              name="confirmNewPassword"
              value={formData.confirmNewPassword}
              onChange={handleInputChange}
              className={`form-input ${validationErrors.confirmNewPassword ? 'error' : ''}`}
              placeholder="Re-enter your new password"
              disabled={isSubmitting}
              required
              autoComplete="new-password"
            />
            {validationErrors.confirmNewPassword && (
              <span className="field-error">{validationErrors.confirmNewPassword}</span>
            )}
          </div>

          <button type="submit" className={`auth-button primary ${isSubmitting ? 'loading' : ''}`} disabled={isSubmitting}>
            {isSubmitting ? (
              <>
                <span className="loading-spinner"></span>
                Resetting...
              </>
            ) : (
              'Reset password'
            )}
          </button>

          <div className="verification-actions">
            <button type="button" onClick={handleResend} className="link-button" disabled={isSubmitting}>
              Resend code
            </button>
            <button type="button" onClick={() => onToggleMode('login')} className="link-button" disabled={isSubmitting}>
              Back to Sign in
            </button>
          </div>
        </form>
      )}
    </div>
  );
};

export default ForgotPasswordForm;
