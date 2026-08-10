import React, { useState } from 'react';
import { useAuth } from './AuthContext';
import './auth.css';
import Icon from '../components/Icon';
import { rememberReturnPath } from './returnPath';

const LoginForm = ({ onToggleMode, onSuccess, initialError }) => {
  const [formData, setFormData] = useState({
    email: '',
    password: ''
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [validationErrors, setValidationErrors] = useState({});
  
  const { signIn, error, setError } = useAuth();
  
  // Use initial error if provided and no current error
  const displayError = error || initialError;

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
    
    if (!formData.email.trim()) {
      errors.email = 'Email is required';
    } else if (!/\S+@\S+\.\S+/.test(formData.email)) {
      errors.email = 'Please enter a valid email address';
    }
    
    if (!formData.password) {
      errors.password = 'Password is required';
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
      const user = await signIn(formData.email, formData.password);
      console.log('Sign in successful:', user);
      if (onSuccess) {
        onSuccess(user);
      }
    } catch (err) {
      console.error('Sign in failed:', err);
      // Error is handled by AuthContext and displayed via the error prop
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleGoogleSignIn = () => {
    console.log('🚀 Google sign-in clicked');
    
    // Track that we're in login mode
    sessionStorage.setItem('authMode', 'login');
    // Where we were headed, so the callback can put us back -- without it the
    // callback's fallback '/' sends a host scanning the remote QR to a second
    // host page on their phone. This form renders both in place (ProtectedRoute
    // leaves the URL on /remote, and that is the path worth keeping) and on
    // /auth, where the call is a deliberate no-op: `rememberReturnPath` refuses
    // auth surfaces, so whatever sent the host here keeps its destination.
    rememberReturnPath();

    // Use window variables with fallback to env variables (same as AuthContext)
    const userPoolId = window.USER_POOL_ID || process.env.REACT_APP_USER_POOL_ID;
    const clientId = window.USER_POOL_CLIENT_ID || process.env.REACT_APP_CLIENT_ID;
    const cognitoDomain = window.COGNITO_DOMAIN;
    
    console.log('Using Cognito config:', { userPoolId, clientId, cognitoDomain });

    // Extract region from User Pool ID
    const region = userPoolId.split('_')[0];
    
    // When using identity_provider=Google, Cognito handles the redirect internally
    // The redirect_uri here is where Cognito will redirect AFTER Google auth
    const appCallbackUrl = encodeURIComponent(window.location.origin + '/auth/callback');
    
    const googleSignInUrl = `https://${cognitoDomain}.auth.${region}.amazoncognito.com/oauth2/authorize?` +
      `identity_provider=Google&` +
      `redirect_uri=${appCallbackUrl}&` +
      `response_type=token&` +
      `client_id=${clientId}&` +
      `scope=openid+email+profile+aws.cognito.signin.user.admin&` +
      `prompt=select_account&` +
      `state=login`;
    
    console.log('📍 Built OAuth URL:', googleSignInUrl);
    console.log('📍 About to redirect...');
    
    // Add a small delay to ensure logs are visible
    setTimeout(() => {
      console.log('⏰ Executing redirect now');
      window.location.href = googleSignInUrl;
    }, 100);
  };

  const getErrorMessage = (fieldName) => {
    if (validationErrors[fieldName]) {
      return validationErrors[fieldName];
    }
    return '';
  };

  return (
    <div className="auth-form-container">
      <div className="auth-header">
        <h2>Sign In to Engagements</h2>
        <p>Host engaging sessions with your team</p>
      </div>

      <form onSubmit={handleSubmit} className="auth-form">
        {displayError && (
          <div className="auth-error" role="alert">
            <i className="error-icon"><Icon name="Warning" weight="fill" size={16} color="var(--primary)" /></i>
            <span>{displayError}</span>
          </div>
        )}

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
          <input
            id="password"
            type="password"
            name="password"
            value={formData.password}
            onChange={handleInputChange}
            className={`form-input ${validationErrors.password ? 'error' : ''}`}
            placeholder="Enter your password"
            disabled={isSubmitting}
            required
            autoComplete="current-password"
          />
          {getErrorMessage('password') && (
            <span className="field-error">{getErrorMessage('password')}</span>
          )}
        </div>

        <button
          type="submit"
          className={`auth-button primary ${isSubmitting ? 'loading' : ''}`}
          disabled={isSubmitting}
        >
          {isSubmitting ? (
            <>
              <span className="loading-spinner"></span>
              Signing In...
            </>
          ) : (
            'Sign In'
          )}
        </button>

        {/* Divider */}
        <div className="auth-divider">
          <span>or</span>
        </div>

        {/* Google Sign-In Button */}
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            handleGoogleSignIn();
          }}
          className="auth-button google"
          disabled={isSubmitting}
        >
          <svg width="18" height="18" viewBox="0 0 18 18" style={{ marginRight: '8px' }}>
            <path fill="#4285F4" d="M16.51 8H8.98v3h4.3c-.18 1-.74 1.48-1.6 2.04v2.01h2.6a7.8 7.8 0 0 0 2.38-5.88c0-.57-.05-.66-.15-1.18Z"/>
            <path fill="#34A853" d="M8.98 17c2.16 0 3.97-.72 5.3-1.94l-2.6-2.01a4.8 4.8 0 0 1-2.7.75 4.92 4.92 0 0 1-4.64-3.4H1.73v2.08A8.02 8.02 0 0 0 8.98 17Z"/>
            <path fill="#FBBC05" d="M4.34 10.4a4.9 4.9 0 0 1 0-3.12V5.2H1.73a8.08 8.08 0 0 0 0 7.28l2.6-2.08Z"/>
            <path fill="#EA4335" d="M8.98 3.58c1.32 0 2.5.45 3.44 1.35l2.54-2.54A7.72 7.72 0 0 0 8.98 1a8.02 8.02 0 0 0-7.25 4.47l2.6 2.08c.6-1.83 2.35-3.4 4.65-3.4Z"/>
          </svg>
          Continue with Google
        </button>

        <div className="auth-links">
          <button
            type="button"
            onClick={() => onToggleMode('register')}
            className="link-button"
            disabled={isSubmitting}
          >
            Don't have an account? <strong>Sign up</strong>
          </button>
          
          <button
            type="button"
            onClick={() => onToggleMode('forgot')}
            className="link-button"
            disabled={isSubmitting}
          >
            Forgot your password?
          </button>
        </div>
      </form>

      <div className="auth-footer">
        <p className="help-text">
          <strong>Players:</strong> No account needed to join sessions! 
          Just use the game code provided by your host.
        </p>
      </div>
    </div>
  );
};

export default LoginForm;