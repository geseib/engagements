import React from 'react';
import { AuthProvider, useAuth } from './auth/AuthContext';
import AuthPage from './auth/AuthPage';
import OAuthCallback from './auth/OAuthCallback';
import PrivacyPolicyPage from './PrivacyPolicyPage';
import TermsOfServicePage from './TermsOfServicePage';
import GameHostPage from './GameHostPage';
import InviteAcceptPage from './components/InviteAcceptPage';
import PlayerPage from './PlayerPage';
import AdminPage from './AdminPage';
import BuilderPage from './BuilderPage';
import HostRemote from './HostRemote';
import WordCloudTest from './WordCloudTest';
import RootPage from './components/RootPage';

// The one spinner. RootGate has to decide before ProtectedRoute runs (that is
// the whole point of it), so both need this and neither should own it.
function AuthLoading() {
  return (
    <div style={{
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      height: '100vh',
      flexDirection: 'column',
      gap: '16px'
    }}>
      <div style={{
        width: '32px',
        height: '32px',
        border: '3px solid #e2e8f0',
        borderTop: '3px solid var(--primary)',
        borderRadius: '50%',
        animation: 'spin 1s linear infinite'
      }}></div>
      <p>Loading...</p>
    </div>
  );
}

// Protected route component that requires authentication
function ProtectedRoute({ children, requireAdmin = false }) {
  // `signOut` is read here, in the component body, and NOT inside the Access
  // Pending branch's onClick below. A hook called from an event handler has no
  // dispatcher and throws -- that Sign Out button was dead for as long as the
  // branch existed, and it is the only way off that screen.
  const { currentUser, loading, signOut } = useAuth();

  if (loading) {
    return <AuthLoading />;
  }

  // Check if user is authenticated
  if (!currentUser) {
    return <AuthPage onAuthSuccess={() => window.location.reload()} />;
  }

  // Check if user is pending approval
  if (currentUser.groups?.includes('pending') || currentUser.status === 'pending') {
    return <AuthPage />;
  }

  // Check admin requirements
  if (requireAdmin && !currentUser.groups?.includes('admins')) {
    return (
      <div style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        height: '100vh',
        flexDirection: 'column',
        gap: '16px',
        textAlign: 'center',
        padding: '20px'
      }}>
        <h2>Access Denied</h2>
        <p>You do not have permission to access this page.</p>
        <p>Admin privileges are required.</p>
        <button 
          onClick={() => window.location.href = '/'}
          style={{
            padding: '12px 24px',
            background: 'var(--primary)',
            color: 'white',
            border: 'none',
            borderRadius: '8px',
            cursor: 'pointer',
            marginTop: '16px'
          }}
        >
          Return to Home
        </button>
      </div>
    );
  }

  // Check if user needs host privileges (but not admin)
  if (!requireAdmin && !currentUser.groups?.includes('hosts') && !currentUser.groups?.includes('admins')) {
    return (
      <div style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        height: '100vh',
        flexDirection: 'column',
        gap: '16px',
        textAlign: 'center',
        padding: '20px'
      }}>
        <h2>Access Pending</h2>
        <p>Your account is awaiting approval to host sessions.</p>
        <p>You can still join sessions as a player using game codes.</p>
        <div style={{ display: 'flex', gap: '12px', marginTop: '16px' }}>
          <button 
            onClick={() => window.location.href = '/play'}
            style={{
              padding: '12px 24px',
              background: 'var(--primary)',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              cursor: 'pointer'
            }}
          >
            Join a Session
          </button>
          <button 
            onClick={() => {
              signOut();
              window.location.reload();
            }}
            style={{
              padding: '12px 24px',
              background: 'transparent',
              color: 'var(--primary)',
              border: '2px solid var(--primary)',
              borderRadius: '8px',
              cursor: 'pointer'
            }}
          >
            Sign Out
          </button>
        </div>
      </div>
    );
  }

  return children;
}

/**
 * What `/` renders, which until now was a sign-in wall.
 *
 * | loading    | the same inline spinner ProtectedRoute shows |
 * | signed in  | the host page, exactly as before             |
 * | signed out | the join/host landing page                   |
 *
 * The signed-in case is deliberate: making the only repeat users click through
 * a landing page on every visit would be a real cost paid for a hypothetical.
 *
 * The loading case matters as much as the other two -- gating on `!currentUser`
 * alone would flash the participant landing page at a signed-in host on every
 * reload, before the token resolves.
 */
function RootGate() {
  const { currentUser, loading } = useAuth();

  if (loading) {
    return <AuthLoading />;
  }

  if (!currentUser) {
    return <RootPage />;
  }

  return (
    <ProtectedRoute>
      <GameHostPage />
    </ProtectedRoute>
  );
}

// Main app router component
function AppRouter() {
  // Simple routing based on URL path
  const path = window.location.pathname;

  // Player routes (no authentication required)
  if (path.startsWith('/play')) {
    return <PlayerPage />;
  }

  // Test routes (no authentication required for development)
  if (path === '/test/wordcloud') {
    return <WordCloudTest />;
  }

  /* AN INVITATION LINK. Behind ProtectedRoute on purpose: this page exists for
     somebody who has no account yet, so being bounced to sign in or register
     and returned here afterwards IS the flow, not an obstacle. Everybody who
     already has an account accepts from their landing screen instead and never
     sees this. */
  if (path.startsWith('/invite/')) {
    return (
      <ProtectedRoute>
        <InviteAcceptPage />
      </ProtectedRoute>
    );
  }

  // OAuth callback route
  if (path === '/auth/callback') {
    console.log('🔐 OAuth callback route hit');
    // No onSuccess: OAuthCallback sends the host back to wherever they were
    // headed (auth/returnPath.js). This route used to override that with a
    // hardcoded '/', so a host who scanned the panel's remote QR and signed in
    // with Google opened a SECOND host page on their phone — and a second host
    // socket, which evicts the projector.
    return (
      <OAuthCallback
        onError={(error) => {
          console.error('❌ OAuth error - redirecting to auth:', error);
          // Add delay to see error
          setTimeout(() => {
            window.location.href = '/auth';
          }, 3000);
        }} 
      />
    );
  }

  // Privacy Policy route
  if (path === '/privacy') {
    return <PrivacyPolicyPage />;
  }

  // Terms of Service route
  if (path === '/terms') {
    return <TermsOfServicePage />;
  }

  // Authentication route
  if (path.startsWith('/auth')) {
    return <AuthPage onAuthSuccess={() => window.location.href = '/'} />;
  }

  /*
    THE CONSOLE IS FOR CUSTOMERS TOO, and requiring `admins` here meant it never
    was.

    `admins` is PLATFORM_GROUP — "the group that means 'works on Engage', not
    'runs an organisation'" (config/consoleSections.js). A customer is approved
    into `hosts`, and their organisation role is a DynamoDB fact delivered on
    `GET /orgs` as `yourRole`. So `requireAdmin` refused a team OWNER, a team
    ADMIN, a team MEMBER and every personal space with a bare "Access Denied ·
    Admin privileges are required" page. Three of the four consoles
    `sectionsFor` computes had never been seen by anybody they were computed
    for.

    Every test in this repo mounts `AdminPage` DIRECTLY, so nothing exercised
    the router in front of it and the guard was invisible to jsdom and to a
    green build alike. __tests__/adminRouteAccess.test.jsx goes through App.

    OPENING THE DOOR GRANTS NOTHING. The nav is computed per person, the
    platform sections are separately gated on `onPlatform && isStaff`, and every
    platform route re-checks the group server-side. The door was never the
    permission.
  */
  if (path.startsWith('/admin')) {
    return (
      <ProtectedRoute>
        <AdminPage />
      </ProtectedRoute>
    );
  }

  // Builder routes (require host authentication)
  if (path.startsWith('/builder')) {
    return (
      <ProtectedRoute>
        <BuilderPage />
      </ProtectedRoute>
    );
  }

  // Remote routes (require host authentication)
  if (path.startsWith('/remote')) {
    return (
      <ProtectedRoute>
        <HostRemote />
      </ProtectedRoute>
    );
  }

  // The root, and ONLY the root -- an exact match, not a prefix. Every
  // unrecognised path keeps falling through to the host page exactly as before;
  // a 404 route is a separate question.
  if (path === '/') {
    return <RootGate />;
  }

  // Home/host page (require host authentication)
  return (
    <ProtectedRoute>
      <GameHostPage />
    </ProtectedRoute>
  );
}

// Main App component with AuthProvider
function App() {
  return (
    <AuthProvider>
      <AppRouter />
    </AuthProvider>
  );
}

export default App;