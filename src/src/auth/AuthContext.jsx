import React, { createContext, useContext, useEffect, useState } from 'react';
import { 
  CognitoUserPool, 
  CognitoUser, 
  AuthenticationDetails,
  CognitoUserAttribute 
} from 'amazon-cognito-identity-js';

// Configure Cognito User Pool - Lazy load to ensure config.js has loaded  
const getUserPool = () => {
  const userPoolId = window.USER_POOL_ID || process.env.REACT_APP_USER_POOL_ID || 'us-east-1_PLACEHOLDER';
  const clientId = window.USER_POOL_CLIENT_ID || process.env.REACT_APP_CLIENT_ID || 'PLACEHOLDER_CLIENT_ID';
  
  console.log('🔧 AUTH: Initializing user pool with:', { userPoolId, clientId });
  
  const poolData = {
    UserPoolId: userPoolId,
    ClientId: clientId,
  };

  return new CognitoUserPool(poolData);
};

const AuthContext = createContext();

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

export const AuthProvider = ({ children }) => {
  const [currentUser, setCurrentUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [newPasswordRequired, setNewPasswordRequired] = useState(null);
  const [tempUser, setTempUser] = useState(null);

  // Get current user from session
  const getCurrentUser = async () => {
    try {
      const userPool = getUserPool();
      const cognitoUser = userPool.getCurrentUser();
      if (cognitoUser) {
        return new Promise((resolve, reject) => {
          cognitoUser.getSession((err, session) => {
            if (err) {
              console.error('Failed to get user session:', err);
              reject(err);
              return;
            }
            
            if (session.isValid()) {
              cognitoUser.getUserAttributes((err, attributes) => {
                if (err) {
                  console.error('Failed to get user attributes:', err);
                  reject(err);
                  return;
                }

                // Parse user attributes
                const userInfo = {
                  username: cognitoUser.username,
                  attributes: {},
                  groups: [], // Will be populated from JWT token
                  session,
                  cognitoUser
                };

                attributes.forEach(attr => {
                  userInfo.attributes[attr.getName()] = attr.getValue();
                });

                // Extract groups from JWT token
                const payload = session.getIdToken().payload;
                userInfo.groups = payload['cognito:groups'] || [];
                userInfo.role = payload['custom:role'] || 'host';
                
                // Determine status: approved if in admin/hosts groups, otherwise check custom status or default to pending
                const groups = userInfo.groups;
                if (groups.includes('admins') || groups.includes('hosts')) {
                  userInfo.status = 'approved';
                } else {
                  userInfo.status = payload['custom:status'] || 'pending';
                }

                resolve(userInfo);
              });
            } else {
              reject(new Error('Session is not valid'));
            }
          });
        });
      }
      return null;
    } catch (error) {
      console.error('Error getting current user:', error);
      throw error;
    }
  };

  // Sign up new user
  const signUp = async (email, password, name) => {
    try {
      setLoading(true);
      setError(null);

      const attributeList = [
        new CognitoUserAttribute({
          Name: 'email',
          Value: email,
        }),
        new CognitoUserAttribute({
          Name: 'name',
          Value: name,
        }),
      ];

      return new Promise((resolve, reject) => {
        const userPool = getUserPool();
        userPool.signUp(email, password, attributeList, null, (err, result) => {
          if (err) {
            console.error('Sign up error:', err);
            
            // Provide better error messages for common scenarios
            let errorMessage = err.message;
            if (err.code === 'UsernameExistsException') {
              errorMessage = 'An account with this email address already exists. Please sign in instead.';
            } else if (err.code === 'InvalidParameterException') {
              errorMessage = 'Please check your input. Email and password must meet the requirements.';
            } else if (err.code === 'InvalidPasswordException') {
              errorMessage = 'Password must be at least 8 characters with uppercase, lowercase, number, and special character.';
            }
            
            setError(errorMessage);
            reject(err);
            return;
          }
          resolve(result);
        });
      });
    } catch (error) {
      setError(error.message);
      throw error;
    } finally {
      setLoading(false);
    }
  };

  // Confirm sign up with verification code
  const confirmSignUp = async (email, code) => {
    try {
      setLoading(true);
      setError(null);

      const cognitoUser = new CognitoUser({
        Username: email,
        Pool: getUserPool(),
      });

      return new Promise((resolve, reject) => {
        cognitoUser.confirmRegistration(code, true, (err, result) => {
          if (err) {
            console.error('Confirmation error:', err);
            setError(err.message);
            reject(err);
            return;
          }
          resolve(result);
        });
      });
    } catch (error) {
      setError(error.message);
      throw error;
    } finally {
      setLoading(false);
    }
  };

  // Sign in user
  const signIn = async (email, password) => {
    try {
      setLoading(true);
      setError(null);

      const authenticationDetails = new AuthenticationDetails({
        Username: email,
        Password: password,
      });

      const cognitoUser = new CognitoUser({
        Username: email,
        Pool: getUserPool(),
      });

      return new Promise((resolve, reject) => {
        cognitoUser.authenticateUser(authenticationDetails, {
          onSuccess: async (session) => {
            try {
              const user = await getCurrentUser();
              setCurrentUser(user);
              resolve(user);
            } catch (error) {
              reject(error);
            }
          },
          onFailure: (err) => {
            console.error('Sign in error:', err);
            setError(err.message);
            reject(err);
          },
          newPasswordRequired: (userAttributes, requiredAttributes) => {
            // Store the temp user and trigger password change flow
            setTempUser(cognitoUser);
            setNewPasswordRequired({
              userAttributes,
              requiredAttributes
            });
            reject(new Error('New password required'));
          }
        });
      });
    } catch (error) {
      setError(error.message);
      throw error;
    } finally {
      setLoading(false);
    }
  };

  // Complete new password challenge
  const completeNewPassword = async (newPassword, userAttributes = {}) => {
    if (!tempUser) {
      throw new Error('No temporary user found');
    }

    return new Promise((resolve, reject) => {
      tempUser.completeNewPasswordChallenge(newPassword, userAttributes, {
        onSuccess: async (session) => {
          try {
            const user = await getCurrentUser();
            setCurrentUser(user);
            setNewPasswordRequired(null);
            setTempUser(null);
            resolve(user);
          } catch (error) {
            reject(error);
          }
        },
        onFailure: (err) => {
          console.error('Password change error:', err);
          setError(err.message);
          reject(err);
        }
      });
    });
  };

  // Sign out user
  const signOut = () => {
    const userPool = getUserPool();
    const cognitoUser = userPool.getCurrentUser();
    if (cognitoUser) {
      cognitoUser.signOut();
    }
    setCurrentUser(null);
    setError(null);
    setNewPasswordRequired(null);
    setTempUser(null);
  };

  // Resend verification code
  const resendConfirmationCode = async (email) => {
    try {
      setLoading(true);
      setError(null);

      const cognitoUser = new CognitoUser({
        Username: email,
        Pool: getUserPool(),
      });

      return new Promise((resolve, reject) => {
        cognitoUser.resendConfirmationCode((err, result) => {
          if (err) {
            console.error('Resend code error:', err);
            setError(err.message);
            reject(err);
            return;
          }
          resolve(result);
        });
      });
    } catch (error) {
      setError(error.message);
      throw error;
    } finally {
      setLoading(false);
    }
  };

  // Initiate a password reset: emails a verification code to the user
  const forgotPassword = async (email) => {
    try {
      setLoading(true);
      setError(null);

      const cognitoUser = new CognitoUser({
        Username: email,
        Pool: getUserPool(),
      });

      return new Promise((resolve, reject) => {
        cognitoUser.forgotPassword({
          onSuccess: (data) => resolve(data),
          onFailure: (err) => {
            console.error('Forgot password error:', err);
            let errorMessage = err.message;
            if (err.code === 'UserNotFoundException') {
              errorMessage = 'No account found with this email address.';
            } else if (err.code === 'LimitExceededException') {
              errorMessage = 'Too many attempts. Please wait a while before trying again.';
            } else if (err.code === 'InvalidParameterException') {
              errorMessage = 'This account can’t be reset by email. If you signed up with Google, use "Continue with Google" instead.';
            }
            setError(errorMessage);
            reject(err);
          },
        });
      });
    } catch (error) {
      setError(error.message);
      throw error;
    } finally {
      setLoading(false);
    }
  };

  // Complete a password reset using the emailed code and a new password
  const confirmPassword = async (email, code, newPassword) => {
    try {
      setLoading(true);
      setError(null);

      const cognitoUser = new CognitoUser({
        Username: email,
        Pool: getUserPool(),
      });

      return new Promise((resolve, reject) => {
        cognitoUser.confirmPassword(code, newPassword, {
          onSuccess: () => resolve(true),
          onFailure: (err) => {
            console.error('Confirm password error:', err);
            let errorMessage = err.message;
            if (err.code === 'CodeMismatchException') {
              errorMessage = 'Incorrect code. Double-check the code from your email or request a new one.';
            } else if (err.code === 'ExpiredCodeException') {
              errorMessage = 'This code has expired. Please request a new one.';
            } else if (err.code === 'InvalidPasswordException') {
              errorMessage = 'Password must be at least 8 characters with uppercase, lowercase, number, and special character.';
            }
            setError(errorMessage);
            reject(err);
          },
        });
      });
    } catch (error) {
      setError(error.message);
      throw error;
    } finally {
      setLoading(false);
    }
  };

  // Check if user has specific role
  const hasRole = (role) => {
    return currentUser?.role === role;
  };

  // Check if user is in specific group
  const hasGroup = (group) => {
    return currentUser?.groups?.includes(group) || false;
  };

  // Check if user is admin
  const isAdmin = () => {
    return hasGroup('admins');
  };

  // Check if user is approved host
  const isHost = () => {
    return hasGroup('hosts') || hasGroup('admins');
  };

  // Check if user is pending approval
  const isPending = () => {
    return hasGroup('pending') || currentUser?.status === 'pending';
  };

  // Get JWT token for API calls
  const getAuthToken = async () => {
    try {
      const userPool = getUserPool();
      const cognitoUser = userPool.getCurrentUser();
      if (!cognitoUser) return null;

      return new Promise((resolve, reject) => {
        cognitoUser.getSession((err, session) => {
          if (err) {
            reject(err);
            return;
          }
          
          if (session.isValid()) {
            resolve(session.getIdToken().getJwtToken());
          } else {
            reject(new Error('Session is not valid'));
          }
        });
      });
    } catch (error) {
      console.error('Error getting auth token:', error);
      return null;
    }
  };

  // Initialize auth state
  useEffect(() => {
    const initializeAuth = async () => {
      try {
        const user = await getCurrentUser();
        setCurrentUser(user);
      } catch (error) {
        console.log('No authenticated user found');
        setCurrentUser(null);
      } finally {
        setLoading(false);
      }
    };

    initializeAuth();
  }, []);

  const value = {
    currentUser,
    loading,
    error,
    newPasswordRequired,
    signUp,
    confirmSignUp,
    signIn,
    completeNewPassword,
    signOut,
    resendConfirmationCode,
    forgotPassword,
    confirmPassword,
    getCurrentUser,
    hasRole,
    hasGroup,
    isAdmin,
    isHost,
    isPending,
    getAuthToken,
    setError
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};

export default AuthContext;