import React from 'react';
import { AuthProvider, useAuth } from './auth/AuthContext';
import AuthPage from './auth/AuthPage';
import OAuthCallback from './auth/OAuthCallback';
import PrivacyPolicyPage from './PrivacyPolicyPage';
import TermsOfServicePage from './TermsOfServicePage';
import GameHostPage from './GameHostPage';
import PlayerPage from './PlayerPage';
import AdminPage from './AdminPage';
import BuilderPage from './BuilderPage';
import HostRemote from './HostRemote';
import WordCloudTest from './WordCloudTest';

// Protected route component that requires authentication
function ProtectedRoute({ children, requireAdmin = false }) {
  const { currentUser, loading } = useAuth();

  if (loading) {
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
              const { signOut } = useAuth();
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

  // OAuth callback route
  if (path === '/auth/callback') {
    console.log('🔐 OAuth callback route hit');
    return (
      <OAuthCallback 
        onSuccess={() => {
          console.log('✅ OAuth success - redirecting to home');
          window.location.href = '/';
        }} 
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

  // Admin routes (require admin authentication)
  if (path.startsWith('/admin')) {
    return (
      <ProtectedRoute requireAdmin={true}>
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