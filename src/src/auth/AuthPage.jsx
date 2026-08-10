import React, { useState, useEffect } from 'react';
import { useAuth } from './AuthContext';
import LoginForm from './LoginForm';
import RegisterForm from './RegisterForm';
import VerificationForm from './VerificationForm';
import ForgotPasswordForm from './ForgotPasswordForm';
import PendingApproval from './PendingApproval';
import PasswordChangeForm from './PasswordChangeForm';
import AuthChrome, { Spinner } from './AuthChrome';
import './auth.css';

/**
 * The authentication surface, and the argument about its shape.
 *
 * THE OWNER ASKED WHETHER THIS SHOULD BE A PANEL ON THE RIGHT. It should not,
 * and the reason is three lines of App.jsx rather than a matter of taste.
 *
 *     function ProtectedRoute({ children }) {
 *       if (!currentUser) return <AuthPage ... />;   // App.jsx:53-55
 *       ...
 *       return children;
 *     }
 *
 * That is an EARLY RETURN. `children` -- the host page, the admin page, the
 * remote -- is never rendered when this component is on screen. A right-hand
 * panel is a thing you slide over something; here there is nothing behind it to
 * slide over, so the panel would be a card floating on an empty field, which is
 * precisely the shape the welcome screen rejected for the same reason.
 *
 * THE SUBTLETY WORTH NAMING. It is true that the URL stays put -- ProtectedRoute
 * renders in place rather than redirecting, so someone bounced off /admin is
 * still at /admin while they sign in. So there IS something behind this screen,
 * but it is a DESTINATION, not a picture. A panel implies you can see past it to
 * where you are going; you cannot, because React returned a different tree. The
 * honest way to honour that intuition is in copy -- name the destination -- not
 * in geometry. That is what `16-blocked.html` specifies and what
 * `returnPath.js` already makes true.
 *
 * Three more things that would break:
 *   - App.jsx has no client-side navigation; it is a `window.location.pathname`
 *     switch. A dismissible panel needs a "behind" to return to, and dismissing
 *     would have to be a full page load anyway.
 *   - `onCancel` -- the close button this component already has -- is passed by
 *     nobody (App.jsx:54, 59 and 230 all omit it). The affordance a panel needs
 *     is dead code today, which is the same finding from the other direction.
 *   - RATIONALE.md §9 rejected a modal or drawer for sign-in explicitly: it
 *     hides the destination behind an interaction on the one screen where a
 *     host's muscle memory is worth most, and it makes the back button lie.
 *
 * So: one full-width column, max 26rem, centred -- the mockups' shape. On a
 * laptop that column sits in a quiet field; on a phone it is the page. What
 * changes between the two is composition, not size.
 *
 * `mode` exists so the root page's "Create a host account" can land on the form
 * it names. `status=pending` still wins -- an account already waiting for
 * approval must not be shown a fresh signup form.
 */
const AuthPage = ({ onAuthSuccess, onCancel }) => {
  const urlParams = new URLSearchParams(window.location.search);
  const statusParam = urlParams.get('status');
  const errorParam = urlParams.get('error');
  const modeParam = urlParams.get('mode');
  const initialMode =
    statusParam === 'pending' ? 'pending' : modeParam === 'register' ? 'register' : 'login';

  const [currentMode, setCurrentMode] = useState(initialMode);
  const [registrationData, setRegistrationData] = useState(null);
  const [urlError] = useState(errorParam);
  const { currentUser, loading, newPasswordRequired } = useAuth();

  // Clear the error parameter once it has been handed to the form.
  useEffect(() => {
    if (errorParam) {
      const newUrl =
        window.location.pathname + window.location.search.replace(/[?&]error=[^&]+/, '');
      window.history.replaceState({}, document.title, newUrl);
    }
  }, [errorParam]);

  useEffect(() => {
    if (!loading && currentUser) {
      const isPending =
        currentUser.groups?.includes('pending') || currentUser.status === 'pending';
      if (isPending) {
        setCurrentMode('pending');
      } else if (onAuthSuccess) {
        onAuthSuccess(currentUser);
      }
    }
  }, [currentUser, loading, onAuthSuccess]);

  const handleToggleMode = (mode) => setCurrentMode(mode);

  const handleRegistrationSuccess = (data) => {
    setRegistrationData(data);
    if (data.nextStep === 'verify') setCurrentMode('verify');
    else if (data.nextStep === 'pending') setCurrentMode('pending');
  };

  const handleVerificationSuccess = (data) => {
    setRegistrationData(data);
    setCurrentMode('pending');
  };

  const handleLoginSuccess = (user) => {
    if (user.groups.includes('pending') || user.status === 'pending') {
      setCurrentMode('pending');
    } else if (onAuthSuccess) {
      onAuthSuccess(user);
    }
  };

  const handleSignOut = () => {
    setCurrentMode('login');
    setRegistrationData(null);
  };

  // A Cognito challenge mid-sign-in, not one of the modes. It brings its own
  // chrome, so it returns before the shell.
  if (newPasswordRequired) {
    return <PasswordChangeForm />;
  }

  if (loading) {
    return (
      <AuthChrome>
        <div className="au-col au-stack au-s24" style={{ paddingBlock: '40px', textAlign: 'center' }}>
          <Spinner />
          <p className="au-muted">Checking your sign-in…</p>
        </div>
      </AuthChrome>
    );
  }

  // The participant escape hatch. It was one dead sentence in the footer of the
  // sign-in form; here it is a real route, at top left, on the screen most
  // likely to be reached by mistake. It is offered only where it is true --
  // someone mid-verification or already waiting on approval is not here by
  // accident, and `onCancel` (when a caller ever passes one) means there is a
  // real "back" that is not the root page.
  const back = onCancel
    ? { label: 'Back', href: '#', onClick: (e) => { e.preventDefault(); onCancel(); } }
    : currentMode === 'login' || currentMode === 'register'
      ? { label: 'Join a session instead', href: '/' }
      : null;

  return (
    <AuthChrome back={back}>
      {currentMode === 'login' && (
        <LoginForm
          onToggleMode={handleToggleMode}
          onSuccess={handleLoginSuccess}
          initialError={urlError}
        />
      )}

      {currentMode === 'register' && (
        <RegisterForm onToggleMode={handleToggleMode} onSuccess={handleRegistrationSuccess} />
      )}

      {currentMode === 'verify' && registrationData && (
        <VerificationForm
          email={registrationData.email}
          name={registrationData.name}
          onToggleMode={handleToggleMode}
          onSuccess={handleVerificationSuccess}
        />
      )}

      {currentMode === 'forgot' && <ForgotPasswordForm onToggleMode={handleToggleMode} />}

      {currentMode === 'pending' && (
        <PendingApproval
          email={registrationData?.email || currentUser?.attributes?.email}
          name={registrationData?.name || currentUser?.attributes?.name}
          onSignOut={handleSignOut}
        />
      )}
    </AuthChrome>
  );
};

export default AuthPage;
