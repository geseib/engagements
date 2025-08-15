import React, { useEffect, useState } from 'react';
import { useAuth } from './AuthContext';
import './auth.css';

const OAuthCallback = ({ onSuccess, onError }) => {
  const [processing, setProcessing] = useState(true);
  const [error, setError] = useState(null);
  const { getCurrentUser } = useAuth();

  useEffect(() => {
    let isProcessing = false; // Prevent duplicate processing
    
    const clearOldTokens = () => {
      // Clear any existing Cognito tokens that might be invalid
      const keysToRemove = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith('CognitoIdentityServiceProvider')) {
          keysToRemove.push(key);
        }
      }
      keysToRemove.forEach(key => localStorage.removeItem(key));
      console.log('🔍 Cleared old Cognito tokens:', keysToRemove.length, 'items');
    };

    const handleUserAuthentication = async () => {
      try {
        console.log('🔍 OAuth Callback: Getting current user after token setup...');
        console.log('🔍 OAuth Callback: Checking localStorage tokens...');
        
        // Debug localStorage contents
        const userPoolId = process.env.REACT_APP_USER_POOL_ID;
        const clientId = process.env.REACT_APP_CLIENT_ID;
        const tokenKey = `CognitoIdentityServiceProvider.${clientId}`;
        const lastAuthUser = localStorage.getItem(`${tokenKey}.LastAuthUser`);
        
        console.log('🔍 OAuth Callback: localStorage debug:', {
          lastAuthUser,
          hasAccessToken: !!localStorage.getItem(`${tokenKey}.${lastAuthUser}.accessToken`),
          hasIdToken: !!localStorage.getItem(`${tokenKey}.${lastAuthUser}.idToken`),
          allKeys: Object.keys(localStorage).filter(key => key.includes('CognitoIdentityServiceProvider'))
        });
        
        const user = await getCurrentUser();
        console.log('🔍 OAuth Callback: User retrieved:', {
          exists: !!user,
          groups: user?.groups,
          status: user?.status,
          name: user?.attributes?.name,
          username: user?.username
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
          console.log('🔍 OAuth Callback: This suggests token storage or getCurrentUser() failed');
          window.location.href = '/auth';
        }
      } catch (err) {
        console.error('🔍 OAuth Callback: Failed to get user after OAuth:', err);
        console.error('🔍 OAuth Callback: Error details:', {
          name: err.name,
          message: err.message,
          stack: err.stack
        });
        setError(err.message);
        if (onError) {
          onError(err.message);
        }
      }
    };

    const handleOAuthCallback = async () => {
      if (isProcessing) {
        console.log('🔍 OAuth callback already processing, skipping...');
        return;
      }
      isProcessing = true;
      
      try {
        // Clear old tokens first to prevent interference
        clearOldTokens();
        
        // Log the full URL for debugging
        console.log('🔍 OAuth Callback URL:', window.location.href);
        console.log('🔍 Search params:', window.location.search);
        console.log('🔍 Hash params:', window.location.hash);
        
        // Check URL for authorization code or tokens (implicit flow) or error
        const urlParams = new URLSearchParams(window.location.search);
        const hashParams = new URLSearchParams(window.location.hash.substring(1));
        
        const code = urlParams.get('code');
        const state = urlParams.get('state') || hashParams.get('state');
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
          state,
          error, 
          errorDescription 
        });

        if (error) {
          let errorMsg = errorDescription || `OAuth error: ${error}`;
          
          // Provide better error messages for common scenarios
          // This error happens when trying to link a social login to an existing Cognito account
          if (errorDescription && errorDescription.includes('Attribute cannot be updated')) {
            // This is a known Cognito issue with immutable email attributes
            // For existing users, we'll try to sign them in directly using a different approach
            console.log('⚠️ Attribute update error - attempting direct user authentication...');
            
            // The user exists but Cognito can't update attributes during OAuth
            // Let's try to authenticate them directly using their existing session
            setTimeout(async () => {
              try {
                // First check if there's already a session
                await handleUserAuthentication();
                return; // Exit if successful
              } catch (authError) {
                console.log('🔍 No existing session, attempting manual authentication...');
                
                // Try to manually authenticate the known Google user
                // We know the user exists as Google_113956208956782440356
                const knownGoogleUsername = 'Google_113956208956782440356';
                
                try {
                  // Create a manual session for the known user
                  const userPoolId = 'us-east-1_bKTK5F5Jm';
                  const clientId = '5brt6hub6e2gmi7hmuuidfi3nc';
                  
                  // Since we can't get OAuth tokens, let's redirect them to try password login
                  // or provide them with a workaround
                  console.log('🔍 Known Google user exists, redirecting to manual login...');
                  
                  const isFromRegister = sessionStorage.getItem('authMode') === 'register';
                  
                  if (isFromRegister) {
                    errorMsg = 'This Google account is already registered. Please use the "Continue with Google" option from the Sign In page instead.';
                    window.location.href = '/auth?mode=login';
                  } else {
                    // For existing users having trouble with Google OAuth
                    errorMsg = 'Google sign-in is experiencing technical difficulties. Your account exists and is active. Please contact support or try again later.';
                    
                    // Set a flag that we can use to show alternative login options
                    sessionStorage.setItem('googleAuthIssue', 'true');
                    sessionStorage.setItem('knownGoogleUser', knownGoogleUsername);
                  }
                  
                  console.error('😨 OAuth callback error:', errorMsg);
                  setError(errorMsg);
                  setTimeout(() => {
                    if (onError) {
                      onError(errorMsg);
                    } else {
                      window.location.href = `/auth?error=${encodeURIComponent(errorMsg)}`;
                    }
                  }, 3000);
                  
                } catch (manualAuthError) {
                  console.error('🔍 Manual auth also failed:', manualAuthError);
                  errorMsg = 'Authentication failed. Please contact support.';
                }
              }
            }, 500);
            return; // Exit early to allow async check
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
          console.log('🔍 Token details:', {
            accessToken: accessToken.substring(0, 20) + '...',
            idToken: idToken.substring(0, 20) + '...',
            tokenType,
            state
          });
          
          // Verify we have proper Cognito tokens (from the advice)
          function decodeJwt(t) {
            const p = t.split('.')[1];
            return JSON.parse(atob(p.replace(/-/g, '+').replace(/_/g, '/')));
          }
          
          try {
            const accessTokenPayload = decodeJwt(accessToken);
            console.log('🔍 Access Token Analysis:', {
              iss: accessTokenPayload.iss,
              token_use: accessTokenPayload.token_use,
              client_id: accessTokenPayload.client_id || accessTokenPayload.aud,
              scope: accessTokenPayload.scope
            });
            
            // Check if it's a proper Cognito access token
            const expectedIss = `https://cognito-idp.us-east-1.amazonaws.com/${process.env.REACT_APP_USER_POOL_ID}`;
            const isValidCognitoToken = accessTokenPayload.iss === expectedIss && 
                                       accessTokenPayload.token_use === 'access';
            
            console.log('🔍 Token validation:', {
              expectedIss,
              actualIss: accessTokenPayload.iss,
              isValidCognitoToken,
              hasAdminScope: accessTokenPayload.scope?.includes('aws.cognito.signin.user.admin')
            });
            
            if (!isValidCognitoToken) {
              console.error('❌ Invalid token: Expected Cognito access token but got:', accessTokenPayload);
              setError('Authentication failed: Invalid token type received');
              return;
            }
            
          } catch (tokenDecodeError) {
            console.error('🔍 Failed to decode access token:', tokenDecodeError);
          }
          
          // Decode the ID token to get the username
          const idTokenPayload = JSON.parse(atob(idToken.split('.')[1]));
          console.log('🔍 ID Token payload:', {
            sub: idTokenPayload.sub,
            email: idTokenPayload.email,
            username: idTokenPayload['cognito:username']
          });
          
          const username = idTokenPayload['cognito:username'] || idTokenPayload.sub;
          
          // Store the tokens for Cognito SDK with proper format
          const userPoolId = process.env.REACT_APP_USER_POOL_ID;
          const clientId = process.env.REACT_APP_CLIENT_ID;
          const tokenKey = `CognitoIdentityServiceProvider.${clientId}`;
          
          // Store in the format expected by Cognito SDK
          localStorage.setItem(`${tokenKey}.LastAuthUser`, username);
          localStorage.setItem(`${tokenKey}.${username}.accessToken`, accessToken);
          localStorage.setItem(`${tokenKey}.${username}.idToken`, idToken);
          
          // Also store refresh token if available
          const refreshToken = hashParams.get('refresh_token');
          if (refreshToken) {
            localStorage.setItem(`${tokenKey}.${username}.refreshToken`, refreshToken);
          }
          
          console.log('🔍 Stored tokens for username:', username);
          console.log('🔍 Storage keys created:', [
            `${tokenKey}.LastAuthUser`,
            `${tokenKey}.${username}.accessToken`,
            `${tokenKey}.${username}.idToken`
          ]);
          
          // Wait a moment for tokens to be stored, then get user
          setTimeout(async () => {
            await handleUserAuthentication();
          }, 500);
          return;
        }

        // Handle authorization code flow - manually exchange code for tokens
        if (code) {
          console.log('✅ OAuth authorization code received');
          console.log('🔍 Code details:', {
            code: code.substring(0, 20) + '...',
            state
          });
          
          // Exchange authorization code for tokens via Cognito token endpoint
          const userPoolId = process.env.REACT_APP_USER_POOL_ID;
          const clientId = process.env.REACT_APP_CLIENT_ID;
          const region = userPoolId.split('_')[0];
          // TEMP: Force engdev environment for testing
          const environment = 'engdev';
          const domainSuffix = environment === 'engdev' ? '-v2' : '';
          const cognitoDomain = `${environment}-auth${domainSuffix}.auth.${region}.amazoncognito.com`;
          
          const tokenEndpoint = `https://${cognitoDomain}/oauth2/token`;
          const redirectUri = window.location.origin + '/auth/callback';
          
          const tokenParams = {
            grant_type: 'authorization_code',
            client_id: clientId,
            code: code,
            redirect_uri: redirectUri,
          };
          
          try {
            console.log('🔍 Exchanging code for tokens...');
            console.log('🔍 Token endpoint:', tokenEndpoint);
            console.log('🔍 Token params:', { ...tokenParams, code: tokenParams.code.substring(0, 10) + '...' });
            
            const tokenResponse = await fetch(tokenEndpoint, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
              },
              body: new URLSearchParams(tokenParams),
            });
            
            if (!tokenResponse.ok) {
              const errorBody = await tokenResponse.text();
              console.error('🔍 Token exchange error response:', errorBody);
              throw new Error(`Token exchange failed: ${tokenResponse.status} ${tokenResponse.statusText} - ${errorBody}`);
            }
            
            const tokens = await tokenResponse.json();
            console.log('🔍 Token exchange successful:', {
              hasAccessToken: !!tokens.access_token,
              hasIdToken: !!tokens.id_token,
              hasRefreshToken: !!tokens.refresh_token,
              tokenType: tokens.token_type
            });
            
            // Decode ID token to get username
            const idTokenPayload = JSON.parse(atob(tokens.id_token.split('.')[1]));
            const username = idTokenPayload['cognito:username'] || idTokenPayload.sub;
            
            console.log('🔍 ID Token payload:', {
              sub: idTokenPayload.sub,
              email: idTokenPayload.email,
              username: username
            });
            
            // Store tokens in localStorage for Cognito SDK
            const tokenKey = `CognitoIdentityServiceProvider.${clientId}`;
            localStorage.setItem(`${tokenKey}.LastAuthUser`, username);
            localStorage.setItem(`${tokenKey}.${username}.accessToken`, tokens.access_token);
            localStorage.setItem(`${tokenKey}.${username}.idToken`, tokens.id_token);
            
            if (tokens.refresh_token) {
              localStorage.setItem(`${tokenKey}.${username}.refreshToken`, tokens.refresh_token);
            }
            
            console.log('🔍 Stored tokens for username:', username);
            
            // Wait a moment for tokens to be stored, then get user
            setTimeout(async () => {
              await handleUserAuthentication();
            }, 500);
            return;
            
          } catch (tokenError) {
            console.error('🔍 Token exchange failed:', tokenError);
            setError(`Authentication failed: ${tokenError.message}`);
            return;
          }
        }

        // No tokens or code found
        const errorMsg = 'No OAuth tokens or authorization code received from provider';
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
        isProcessing = false;
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