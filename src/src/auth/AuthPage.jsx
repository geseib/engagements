import React, { useState, useEffect } from 'react';
import { useAuth } from './AuthContext';
import LoginForm from './LoginForm';
import RegisterForm from './RegisterForm';
import VerificationForm from './VerificationForm';
import ForgotPasswordForm from './ForgotPasswordForm';
import PendingApproval from './PendingApproval';
import PasswordChangeForm from './PasswordChangeForm';
import './auth.css';
import Icon from '../components/Icon';

const AuthPage = ({ onAuthSuccess, onCancel }) => {
  // Check URL parameters for initial mode and error messages
  const urlParams = new URLSearchParams(window.location.search);
  const statusParam = urlParams.get('status');
  const errorParam = urlParams.get('error');
  const initialMode = statusParam === 'pending' ? 'pending' : 'login';
  console.log('🔍 AuthPage: URL params:', { statusParam, errorParam, initialMode });
  
  const [currentMode, setCurrentMode] = useState(initialMode);
  const [registrationData, setRegistrationData] = useState(null);
  const [urlError, setUrlError] = useState(errorParam);
  const { currentUser, loading, newPasswordRequired } = useAuth();
  
  // Clear URL error after displaying it
  useEffect(() => {
    if (errorParam) {
      // Clean up the URL to remove the error parameter
      const newUrl = window.location.pathname + window.location.search.replace(/[?&]error=[^&]+/, '');
      window.history.replaceState({}, document.title, newUrl);
    }
  }, [errorParam]);

  // Check if user is already authenticated
  useEffect(() => {
    console.log('🔍 AuthPage: useEffect triggered:', { loading, currentUser: !!currentUser, groups: currentUser?.groups, status: currentUser?.status });
    if (!loading && currentUser) {
      const isPending = currentUser.groups?.includes('pending') || currentUser.status === 'pending';
      console.log('🔍 AuthPage: User status check:', { isPending, groups: currentUser.groups, status: currentUser.status });
      
      if (isPending) {
        console.log('🔍 AuthPage: Setting mode to pending...');
        setCurrentMode('pending');
      } else {
        // User is approved, redirect to main app
        console.log('🔍 AuthPage: User approved, redirecting to main app...');
        if (onAuthSuccess) {
          onAuthSuccess(currentUser);
        }
      }
    }
  }, [currentUser, loading, onAuthSuccess]);

  const handleToggleMode = (mode) => {
    setCurrentMode(mode);
  };

  const handleRegistrationSuccess = (data) => {
    setRegistrationData(data);
    if (data.nextStep === 'verify') {
      setCurrentMode('verify');
    } else if (data.nextStep === 'pending') {
      setCurrentMode('pending');
    }
  };

  const handleVerificationSuccess = (data) => {
    setRegistrationData(data);
    setCurrentMode('pending');
  };

  const handleLoginSuccess = (user) => {
    if (user.groups.includes('pending') || user.status === 'pending') {
      setCurrentMode('pending');
    } else {
      // User is approved, redirect to main app
      if (onAuthSuccess) {
        onAuthSuccess(user);
      }
    }
  };

  const handleSignOut = () => {
    setCurrentMode('login');
    setRegistrationData(null);
  };

  // Show password change form if required
  if (newPasswordRequired) {
    return <PasswordChangeForm />;
  }

  // Show loading spinner while checking authentication
  if (loading) {
    return (
      <div className="auth-page">
        <div className="auth-container">
          <div className="auth-loading">
            <div className="loading-spinner large"></div>
            <p>Loading...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-page">
      <div className="auth-background">
        {/* Background pattern or branding */}
        <div className="auth-pattern"></div>
      </div>
      
      <div className="auth-container">
        {/* Header with logo and navigation */}
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
          
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="auth-close"
              aria-label="Close authentication"
            >
              <Icon name="X" weight="bold" size={16} color="currentColor" />
            </button>
          )}
        </div>

        {/* Main authentication content */}
        <div className="auth-content">
          {currentMode === 'login' && (
            <LoginForm 
              onToggleMode={handleToggleMode}
              onSuccess={handleLoginSuccess}
              initialError={urlError}
            />
          )}
          
          {currentMode === 'register' && (
            <RegisterForm 
              onToggleMode={handleToggleMode}
              onSuccess={handleRegistrationSuccess}
            />
          )}
          
          {currentMode === 'verify' && registrationData && (
            <VerificationForm
              email={registrationData.email}
              name={registrationData.name}
              onToggleMode={handleToggleMode}
              onSuccess={handleVerificationSuccess}
            />
          )}

          {currentMode === 'forgot' && (
            <ForgotPasswordForm
              onToggleMode={handleToggleMode}
            />
          )}
          
          {currentMode === 'pending' && (
            <PendingApproval 
              email={registrationData?.email || currentUser?.attributes?.email}
              name={registrationData?.name || currentUser?.attributes?.name}
              onSignOut={handleSignOut}
            />
          )}
        </div>

        {/* Footer */}
        <div className="auth-page-footer">
          <div className="feature-highlights">
            <div className="feature-item">
              <div className="feature-icon"><Icon name="Target" weight="duotone" size={16} color="var(--primary)" /></div>
              <span>Interactive Trivia & Polls</span>
            </div>
            <div className="feature-item">
              <div className="feature-icon"><Icon name="ChartBar" weight="duotone" size={16} color="var(--primary)" /></div>
              <span>Real-time Results</span>
            </div>
            <div className="feature-item">
              <div className="feature-icon"><Icon name="Handshake" weight="duotone" size={16} color="var(--primary)" /></div>
              <span>Team Collaboration</span>
            </div>
          </div>
          
          <div className="auth-legal-links">
            <a href="/privacy" className="legal-link">Privacy Policy</a>
            <span className="legal-separator">•</span>
            <a href="/terms" className="legal-link">Terms of Service</a>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AuthPage;