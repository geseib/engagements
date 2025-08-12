import React, { useEffect, useState } from 'react';
import { useAuth } from './AuthContext';
import './auth.css';

const OAuthCallback = ({ onSuccess, onError }) => {
  const [processing, setProcessing] = useState(true);
  const [error, setError] = useState(null);
  const { getCurrentUser } = useAuth();

  useEffect(() => {
    const handleUserAuthentication = async () => {
      try {
        console.log('🔍 OAuth Callback: Getting current user after token setup...');
        const user = await getCurrentUser();
        console.log('🔍 OAuth Callback: User retrieved:', {
          exists: !!user,
          groups: user?.groups,
          status: user?.status,
          name: user?.attributes?.name
        });
        
        if (user) {
          // Clean up session storage on successful authentication
          sessionStorage.removeItem('authMode');
          
          // Check user status and redirect appropriately
          const isPending = user.groups?.includes('pending') || user.status === 'pending';
          console.log('🔍 OAuth Callback: User status check:', { isPending, groups: user.groups, status: user.status });
          
          if (isPending) {
            // New user or pending approval - redirect to auth with pending state
            console.log('🔍 OAuth Callback: Redirecting to pending approval...');
            window.location.href = '/auth?status=pending';
          } else {
            // Approved user - redirect to main app
            console.log('🔍 OAuth Callback: Redirecting approved user to main app...');
            if (onSuccess) {
              onSuccess(user);
            } else {
              window.location.href = '/';
            }
          }
        } else {
          // No user found - redirect to auth login
          console.log('🔍 OAuth Callback: No user found, redirecting to login...');
          window.location.href = '/auth';
        }
      } catch (err) {
        console.error('Failed to get user after OAuth:', err);
        setError(err.message);
        if (onError) {
          onError(err.message);
        }
      }
    };

    const handleOAuthCallback = async () => {
      try {
        // Log the full URL for debugging
        console.log('🔍 OAuth Callback URL:', window.location.href);
        console.log('🔍 Search params:', window.location.search);
        console.log('🔍 Hash params:', window.location.hash);
        
        // Check URL for authorization code or tokens (implicit flow) or error
        const urlParams = new URLSearchParams(window.location.search);
        const hashParams = new URLSearchParams(window.location.hash.substring(1));
        
        const code = urlParams.get('code');
        const error = urlParams.get('error') || hashParams.get('error');
        const errorDescription = urlParams.get('error_description') || hashParams.get('error_description');
        
        // Check for tokens in hash (implicit flow)
        const accessToken = hashParams.get('access_token');
        const idToken = hashParams.get('id_token');
        const tokenType = hashParams.get('token_type');
        
        console.log('🔍 OAuth params:', { 
          code: code ? 'present' : 'missing', 
          accessToken: accessToken ? 'present' : 'missing',
          idToken: idToken ? 'present' : 'missing',
          error, 
          errorDescription 
        });

        if (error) {
          let errorMsg = errorDescription || `OAuth error: ${error}`;
          
          // Provide better error messages for common scenarios
          // This error happens when trying to link a social login to an existing Cognito account
          if (errorDescription && errorDescription.includes('Attribute cannot be updated')) {
            // Check if we came from the register page or login page
            const referrer = document.referrer;
            const isFromRegister = referrer.includes('/auth') && sessionStorage.getItem('authMode') === 'register';
            
            if (isFromRegister) {
              errorMsg = 'An account with this email already exists. Please sign in with your email and password, or use the same method you used to create your account.';
            } else {
              // This is likely a configuration issue - the account exists but can't be linked
              errorMsg = 'Unable to sign in with Google. This email may be associated with a different sign-in method. Please try signing in with email and password.';
            }
          } else if (error === 'invalid_request' && errorDescription?.includes('already exists')) {
            errorMsg = 'This account already exists. Please use the Sign In option instead.';
          }
          
          console.error('😨 OAuth callback error:', errorMsg);
          console.error('Full error details:', { error, errorDescription });
          setError(errorMsg);
          
          // Clean up session storage
          sessionStorage.removeItem('authMode');
          
          // Add a delay before redirecting to allow error to be seen
          setTimeout(() => {
            if (onError) {
              onError(errorMsg);
            } else {
              // Redirect to login page with error message
              window.location.href = `/auth?error=${encodeURIComponent(errorMsg)}`;
            }
          }, 2000);
          return;
        }

        // Handle implicit flow tokens
        if (accessToken && idToken) {
          console.log('✅ OAuth tokens received via implicit flow');
          
          // Store the tokens for Cognito SDK
          const userPoolId = 'us-east-1_bKTK5F5Jm';
          const clientId = '5brt6hub6e2gmi7hmuuidfi3nc';
          const tokenKey = `CognitoIdentityServiceProvider.${clientId}`;
          
          localStorage.setItem(`${tokenKey}.LastAuthUser`, 'oauth_user');
          localStorage.setItem(`${tokenKey}.oauth_user.accessToken`, accessToken);
          localStorage.setItem(`${tokenKey}.oauth_user.idToken`, idToken);
          
          // Wait a moment for tokens to be stored, then get user
          setTimeout(async () => {
            await handleUserAuthentication();
          }, 500);
          return;
        }

        // No tokens found
        const errorMsg = 'No OAuth tokens received from provider';
        console.error('OAuth callback error:', errorMsg);
        setError(errorMsg);
        if (onError) {
          onError(errorMsg);
        }
        return;

      } catch (err) {
        console.error('OAuth callback processing error:', err);
        setError(err.message);
        if (onError) {
          onError(err.message);
        }
      } finally {
        setProcessing(false);
      }
    };

    handleOAuthCallback();
  }, [getCurrentUser, onSuccess, onError]);

  if (processing) {
    return (
      <div className="auth-page">
        <div className="auth-container">
          <div className="auth-loading">
            <div className="loading-spinner large"></div>
            <p>Processing sign-in...</p>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="auth-page">
        <div className="auth-container">
          <div className="auth-form-container">
            <div className="auth-header">
              <h2>Sign-In Error</h2>
              <p>There was a problem completing your sign-in</p>
            </div>
            
            <div className="auth-error">
              <i className="error-icon">⚠️</i>
              <span>{error}</span>
            </div>
            
            <div style={{ marginTop: '24px', textAlign: 'center' }}>
              <button
                onClick={() => window.location.href = '/'}
                className="auth-button primary"
              >
                Return to Login
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-page">
      <div className="auth-container">
        <div className="auth-loading">
          <div className="loading-spinner large"></div>
          <p>Completing sign-in...</p>
        </div>
      </div>
    </div>
  );
};

export default OAuthCallback;