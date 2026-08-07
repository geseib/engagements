import React, { useState, useEffect } from 'react';
import { useAuth } from './AuthContext';
import './auth.css';
import Icon from '../components/Icon';

const VerificationForm = ({ email, name, onToggleMode, onSuccess }) => {
  const [verificationCode, setVerificationCode] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const [resendTimer, setResendTimer] = useState(0);
  const [validationErrors, setValidationErrors] = useState({});
  
  const { confirmSignUp, resendConfirmationCode, error, setError } = useAuth();

  // Timer for resend button
  useEffect(() => {
    if (resendTimer > 0) {
      const timer = setTimeout(() => setResendTimer(resendTimer - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [resendTimer]);

  const handleInputChange = (e) => {
    const value = e.target.value.replace(/\D/g, ''); // Only allow digits
    if (value.length <= 6) {
      setVerificationCode(value);
      
      // Clear validation error when user starts typing
      if (validationErrors.code) {
        setValidationErrors({});
      }
      
      // Clear auth error when user makes changes
      if (error) {
        setError(null);
      }
    }
  };

  const validateForm = () => {
    const errors = {};
    
    if (!verificationCode.trim()) {
      errors.code = 'Verification code is required';
    } else if (verificationCode.length !== 6) {
      errors.code = 'Verification code must be 6 digits';
    }
    
    setValidationErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!validateForm()) {
      return;
    }
    
    setIsSubmitting(true);
    
    try {
      await confirmSignUp(email, verificationCode);
      console.log('Email verification successful');
      
      if (onSuccess) {
        onSuccess({ 
          email, 
          name,
          verified: true,
          nextStep: 'pending'
        });
      }
    } catch (err) {
      console.error('Verification failed:', err);
      // Error is handled by AuthContext and displayed via the error prop
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResendCode = async () => {
    if (resendTimer > 0 || isResending) return;
    
    setIsResending(true);
    setError(null);
    
    try {
      await resendConfirmationCode(email);
      setResendTimer(60); // 60 second cooldown
      console.log('Verification code resent');
    } catch (err) {
      console.error('Failed to resend code:', err);
    } finally {
      setIsResending(false);
    }
  };

  const maskEmail = (email) => {
    const [localPart, domain] = email.split('@');
    if (localPart.length <= 2) {
      return `${localPart[0]}***@${domain}`;
    }
    return `${localPart.substring(0, 2)}${'*'.repeat(localPart.length - 2)}@${domain}`;
  };

  return (
    <div className="auth-form-container">
      <div className="auth-header">
        <h2>Verify Your Email</h2>
        <p>We've sent a verification code to</p>
        <p className="email-highlight">{maskEmail(email)}</p>
      </div>

      <form onSubmit={handleSubmit} className="auth-form">
        {error && (
          <div className="auth-error" role="alert">
            <i className="error-icon"><Icon name="Warning" weight="fill" size={16} color="var(--primary)" /></i>
            <span>{error}</span>
          </div>
        )}

        <div className="form-group">
          <label htmlFor="verificationCode">
            Verification Code
          </label>
          <input
            id="verificationCode"
            type="text"
            value={verificationCode}
            onChange={handleInputChange}
            className={`form-input verification-code ${validationErrors.code ? 'error' : ''}`}
            placeholder="Enter 6-digit code"
            disabled={isSubmitting}
            required
            maxLength="6"
            autoComplete="one-time-code"
            inputMode="numeric"
          />
          {validationErrors.code && (
            <span className="field-error">{validationErrors.code}</span>
          )}
          <div className="input-hint">
            Enter the 6-digit code from your email
          </div>
        </div>

        <button
          type="submit"
          className={`auth-button primary ${isSubmitting ? 'loading' : ''}`}
          disabled={isSubmitting}
        >
          {isSubmitting ? (
            <>
              <span className="loading-spinner"></span>
              Verifying...
            </>
          ) : (
            'Verify Email'
          )}
        </button>

        <div className="verification-actions">
          <button
            type="button"
            onClick={handleResendCode}
            className={`link-button ${(resendTimer > 0 || isResending) ? 'disabled' : ''}`}
            disabled={resendTimer > 0 || isResending || isSubmitting}
          >
            {isResending ? (
              'Sending...'
            ) : resendTimer > 0 ? (
              `Resend code in ${resendTimer}s`
            ) : (
              'Resend verification code'
            )}
          </button>
          
          <button
            type="button"
            onClick={() => onToggleMode('register')}
            className="link-button"
            disabled={isSubmitting || isResending}
          >
            Use a different email
          </button>
        </div>
      </form>

      <div className="auth-footer">
        <div className="verification-help">
          <h4>Didn't receive the code?</h4>
          <ul>
            <li>Check your spam or junk folder</li>
            <li>Make sure you entered the correct email address</li>
            <li>Wait a few minutes and try resending</li>
          </ul>
        </div>
      </div>
    </div>
  );
};

export default VerificationForm;