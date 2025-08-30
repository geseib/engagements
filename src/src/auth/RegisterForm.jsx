import React, { useState } from 'react';
import { useAuth } from './AuthContext';
import './auth.css';

const RegisterForm = ({ onToggleMode, onSuccess }) => {
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    password: '',
    confirmPassword: ''
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [validationErrors, setValidationErrors] = useState({});
  const [showPassword, setShowPassword] = useState(false);
  
  const { signUp, error, setError } = useAuth();

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
    
    // Clear validation error when user starts typing
    if (validationErrors[name]) {
      setValidationErrors(prev => ({
        ...prev,
        [name]: ''
      }));
    }
    
    // Clear auth error when user makes changes
    if (error) {
      setError(null);
    }
  };

  const validateForm = () => {
    const errors = {};
    
    if (!formData.name.trim()) {
      errors.name = 'Full name is required';
    } else if (formData.name.trim().length < 2) {
      errors.name = 'Name must be at least 2 characters';
    }
    
    if (!formData.email.trim()) {
      errors.email = 'Email is required';
    } else if (!/\S+@\S+\.\S+/.test(formData.email)) {
      errors.email = 'Please enter a valid email address';
    }
    
    if (!formData.password) {
      errors.password = 'Password is required';
    } else if (formData.password.length < 8) {
      errors.password = 'Password must be at least 8 characters';
    } else if (!/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/.test(formData.password)) {
      errors.password = 'Password must contain uppercase, lowercase, number, and special character';
    }
    
    if (!formData.confirmPassword) {
      errors.confirmPassword = 'Please confirm your password';
    } else if (formData.password !== formData.confirmPassword) {
      errors.confirmPassword = 'Passwords do not match';
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
      const result = await signUp(formData.email, formData.password, formData.name);
      console.log('Sign up successful:', result);
      
      // Move to verification step
      if (onSuccess) {
        onSuccess({ 
          email: formData.email, 
          name: formData.name,
          nextStep: 'verify'
        });
      }
    } catch (err) {
      console.error('Sign up failed:', err);
      // Error is handled by AuthContext and displayed via the error prop
    } finally {
      setIsSubmitting(false);
    }
  };

  const getErrorMessage = (fieldName) => {
    if (validationErrors[fieldName]) {
      return validationErrors[fieldName];
    }
    return '';
  };

  const handleGoogleSignUp = () => {
    console.log('🚀 Google sign-up clicked');
    
    // Track that we're in register mode
    sessionStorage.setItem('authMode', 'register');
    
    // Use window variables with fallback to env variables (same as AuthContext)
    const userPoolId = window.USER_POOL_ID || process.env.REACT_APP_USER_POOL_ID;
    const clientId = window.USER_POOL_CLIENT_ID || process.env.REACT_APP_CLIENT_ID;
    const cognitoDomain = window.COGNITO_DOMAIN;
    
    console.log('Using Cognito config:', { userPoolId, clientId, cognitoDomain });

    // Extract region from User Pool ID
    const region = userPoolId.split('_')[0];
    const redirectUri = encodeURIComponent(window.location.origin + '/auth/callback');
    
    const googleSignUpUrl = `https://${cognitoDomain}.auth.${region}.amazoncognito.com/oauth2/authorize?` +
      `identity_provider=Google&` +
      `redirect_uri=${redirectUri}&` +
      `response_type=token&` +
      `client_id=${clientId}&` +
      `scope=openid+email+profile+aws.cognito.signin.user.admin&` +
      `prompt=select_account&` +
      `state=register`;
    
    console.log('📍 Built OAuth URL:', googleSignUpUrl);
    console.log('📍 About to redirect...');
    
    // Add a small delay to ensure logs are visible
    setTimeout(() => {
      console.log('⏰ Executing redirect now');
      window.location.href = googleSignUpUrl;
    }, 100);
  };

  const getPasswordStrength = () => {
    const password = formData.password;
    if (!password) return '';
    
    let strength = 0;
    if (password.length >= 8) strength++;
    if (/[a-z]/.test(password)) strength++;
    if (/[A-Z]/.test(password)) strength++;
    if (/\d/.test(password)) strength++;
    if (/[@$!%*?&]/.test(password)) strength++;
    
    if (strength < 2) return 'weak';
    if (strength < 4) return 'medium';
    return 'strong';
  };

  return (
    <div className="auth-form-container">
      <div className="auth-header">
        <h2>Create Your Account</h2>
        <p>Join Engagements to host interactive sessions</p>
      </div>

      {/* Google Sign-Up Button - Outside of form to avoid form submission interference */}
      <div className="auth-form">
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            handleGoogleSignUp();
          }}
          className="auth-button google"
          disabled={isSubmitting}
          style={{ marginBottom: '16px' }}
        >
          <svg width="18" height="18" viewBox="0 0 18 18" style={{ marginRight: '8px' }}>
            <path fill="#4285F4" d="M16.51 8H8.98v3h4.3c-.18 1-.74 1.48-1.6 2.04v2.01h2.6a7.8 7.8 0 0 0 2.38-5.88c0-.57-.05-.66-.15-1.18Z"/>
            <path fill="#34A853" d="M8.98 17c2.16 0 3.97-.72 5.3-1.94l-2.6-2.01a4.8 4.8 0 0 1-2.7.75 4.92 4.92 0 0 1-4.64-3.4H1.73v2.08A8.02 8.02 0 0 0 8.98 17Z"/>
            <path fill="#FBBC05" d="M4.34 10.4a4.9 4.9 0 0 1 0-3.12V5.2H1.73a8.08 8.08 0 0 0 0 7.28l2.6-2.08Z"/>
            <path fill="#EA4335" d="M8.98 3.58c1.32 0 2.5.45 3.44 1.35l2.54-2.54A7.72 7.72 0 0 0 8.98 1a8.02 8.02 0 0 0-7.25 4.47l2.6 2.08c.6-1.83 2.35-3.4 4.65-3.4Z"/>
          </svg>
          Sign Up with Google
        </button>

        {/* Divider */}
        <div className="auth-divider">
          <span>or</span>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="auth-form">
        {error && (
          <div className="auth-error" role="alert">
            <i className="error-icon">⚠️</i>
            <span>{error}</span>
          </div>
        )}

        <div className="form-group">
          <label htmlFor="name">
            Full Name
          </label>
          <input
            id="name"
            type="text"
            name="name"
            value={formData.name}
            onChange={handleInputChange}
            className={`form-input ${validationErrors.name ? 'error' : ''}`}
            placeholder="Enter your full name"
            disabled={isSubmitting}
            required
            autoComplete="name"
          />
          {getErrorMessage('name') && (
            <span className="field-error">{getErrorMessage('name')}</span>
          )}
        </div>

        <div className="form-group">
          <label htmlFor="email">
            Email Address
          </label>
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
          {getErrorMessage('email') && (
            <span className="field-error">{getErrorMessage('email')}</span>
          )}
        </div>

        <div className="form-group">
          <label htmlFor="password">
            Password
          </label>
          <div className="password-input-container">
            <input
              id="password"
              type={showPassword ? 'text' : 'password'}
              name="password"
              value={formData.password}
              onChange={handleInputChange}
              className={`form-input ${validationErrors.password ? 'error' : ''}`}
              placeholder="Create a strong password"
              disabled={isSubmitting}
              required
              autoComplete="new-password"
            />
            <button
              type="button"
              className="password-toggle"
              onClick={() => setShowPassword(!showPassword)}
              disabled={isSubmitting}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
            >
              {showPassword ? '👁️‍🗨️' : '👁️'}
            </button>
          </div>
          
          {formData.password && (
            <div className={`password-strength ${getPasswordStrength()}`}>
              <div className="strength-meter">
                <div className="strength-bar"></div>
              </div>
              <span className="strength-text">
                {getPasswordStrength().charAt(0).toUpperCase() + getPasswordStrength().slice(1)}
              </span>
            </div>
          )}
          
          {getErrorMessage('password') && (
            <span className="field-error">{getErrorMessage('password')}</span>
          )}
        </div>

        <div className="form-group">
          <label htmlFor="confirmPassword">
            Confirm Password
          </label>
          <input
            id="confirmPassword"
            type="password"
            name="confirmPassword"
            value={formData.confirmPassword}
            onChange={handleInputChange}
            className={`form-input ${validationErrors.confirmPassword ? 'error' : ''}`}
            placeholder="Confirm your password"
            disabled={isSubmitting}
            required
            autoComplete="new-password"
          />
          {getErrorMessage('confirmPassword') && (
            <span className="field-error">{getErrorMessage('confirmPassword')}</span>
          )}
        </div>

        <div className="form-info">
          <p>
            <strong>Account Approval:</strong> New accounts require admin approval before you can create sessions.
            You'll receive an email once your account is approved.
          </p>
        </div>

        <button
          type="submit"
          className={`auth-button primary ${isSubmitting ? 'loading' : ''}`}
          disabled={isSubmitting}
        >
          {isSubmitting ? (
            <>
              <span className="loading-spinner"></span>
              Creating Account...
            </>
          ) : (
            'Create Account'
          )}
        </button>

        <div className="auth-links">
          <button
            type="button"
            onClick={() => onToggleMode('login')}
            className="link-button"
            disabled={isSubmitting}
          >
            Already have an account? <strong>Sign in</strong>
          </button>
        </div>
      </form>

      <div className="auth-footer">
        <p className="help-text">
          By creating an account, you agree to our terms of service and privacy policy.
        </p>
      </div>
    </div>
  );
};

export default RegisterForm;