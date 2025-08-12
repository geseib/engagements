import React from 'react';
import './auth/auth.css';

const TermsOfServicePage = () => {
  const getEnvironmentTag = () => {
    const hostname = window.location.hostname;
    if (hostname.includes('dev.')) return 'dev';
    if (hostname.includes('test.')) return 'test';
    return null;
  };

  const environmentTag = getEnvironmentTag();

  return (
    <div className="auth-page">
      <div className="auth-container">
        <div className="auth-form-container" style={{ maxWidth: '800px' }}>
          <div className="auth-header">
            <h1>Engagements</h1>
            {environmentTag && (
              <p className="environment-tag">{environmentTag}</p>
            )}
            <h2 style={{ marginTop: '32px', marginBottom: '24px' }}>Terms of Service</h2>
          </div>
          
          <div style={{ textAlign: 'left', lineHeight: '1.6', color: '#4a5568' }}>
            <div style={{ marginBottom: '24px' }}>
              <p><strong>Effective Date:</strong> {new Date().toLocaleDateString()}</p>
            </div>

            <div style={{ marginBottom: '32px' }}>
              <h3 style={{ color: '#2d3748', marginBottom: '16px' }}>1. Acceptance of Terms</h3>
              <p>By accessing and using the Engagements platform, you accept and agree to be bound by the terms and provision of this agreement. If you do not agree to abide by the above, please do not use this service.</p>
            </div>

            <div style={{ marginBottom: '32px' }}>
              <h3 style={{ color: '#2d3748', marginBottom: '16px' }}>2. Description of Service</h3>
              <p>Engagements is a platform for conducting real-time engagement sessions, including interactive activities, surveys, and collaborative exercises for organizations and their teams.</p>
            </div>

            <div style={{ marginBottom: '32px' }}>
              <h3 style={{ color: '#2d3748', marginBottom: '16px' }}>3. Intellectual Property and Content Restrictions</h3>
              <div style={{ backgroundColor: '#fff5f5', border: '2px solid #fed7d7', borderRadius: '8px', padding: '20px', marginBottom: '16px' }}>
                <h4 style={{ color: '#c53030', marginBottom: '12px', marginTop: '0' }}>Important Content Usage Restrictions</h4>
                <p style={{ margin: '0', fontWeight: '500' }}>
                  <strong>You may NOT copy, reproduce, distribute, or use any content from this site except for:</strong>
                </p>
                <ul style={{ marginLeft: '24px', marginTop: '12px', marginBottom: '0' }}>
                  <li><strong>Your own reports and data</strong> - You may download and use reports generated from your own engagement sessions</li>
                  <li><strong>Internal organizational use only</strong> - Such data may only be used within your internal organization</li>
                  <li><strong>No external sale or marketing</strong> - You may not sell, market, or distribute this data outside your organization</li>
                </ul>
              </div>
              <p>All other content, including but not limited to text, graphics, logos, button icons, images, audio clips, digital downloads, data compilations, and software, is the property of Engagements or its content suppliers and is protected by intellectual property laws.</p>
            </div>

            <div style={{ marginBottom: '32px' }}>
              <h3 style={{ color: '#2d3748', marginBottom: '16px' }}>4. Permitted Use</h3>
              <p>You may use the Engagements platform for:</p>
              <ul style={{ marginLeft: '24px', marginTop: '8px' }}>
                <li>Conducting authorized engagement sessions within your organization</li>
                <li>Participating in sessions as an invited participant</li>
                <li>Downloading and using reports from your own sessions for internal purposes</li>
                <li>Accessing administrative features if you have been granted such permissions</li>
              </ul>
            </div>

            <div style={{ marginBottom: '32px' }}>
              <h3 style={{ color: '#2d3748', marginBottom: '16px' }}>5. Prohibited Activities</h3>
              <p>You agree not to:</p>
              <ul style={{ marginLeft: '24px', marginTop: '8px' }}>
                <li>Copy, reproduce, or distribute platform content beyond your authorized use</li>
                <li>Reverse engineer, decompile, or disassemble any part of the platform</li>
                <li>Use the platform for any unlawful or unauthorized purpose</li>
                <li>Interfere with or disrupt the platform or servers</li>
                <li>Attempt to gain unauthorized access to any part of the platform</li>
                <li>Share your account credentials with unauthorized persons</li>
                <li>Sell, market, or distribute session data outside your organization</li>
              </ul>
            </div>

            <div style={{ marginBottom: '32px' }}>
              <h3 style={{ color: '#2d3748', marginBottom: '16px' }}>6. User Account</h3>
              <p>You are responsible for maintaining the confidentiality of your account and password and for restricting access to your account. You agree to accept responsibility for all activities that occur under your account.</p>
            </div>

            <div style={{ marginBottom: '32px' }}>
              <h3 style={{ color: '#2d3748', marginBottom: '16px' }}>7. Data and Privacy</h3>
              <p>Your use of the platform is subject to our Privacy Policy, which is incorporated by reference into these Terms of Service. We are committed to protecting your privacy and will not share your personal data with third parties.</p>
            </div>

            <div style={{ marginBottom: '32px' }}>
              <h3 style={{ color: '#2d3748', marginBottom: '16px' }}>8. Limitation of Liability</h3>
              <p>In no event shall Engagements be liable for any indirect, incidental, special, consequential, or punitive damages, including without limitation, loss of profits, data, use, goodwill, or other intangible losses resulting from your use of the platform.</p>
            </div>

            <div style={{ marginBottom: '32px' }}>
              <h3 style={{ color: '#2d3748', marginBottom: '16px' }}>9. Termination</h3>
              <p>We may terminate or suspend your account and bar access to the platform immediately, without prior notice or liability, under our sole discretion, for any reason whatsoever including without limitation if you breach the Terms.</p>
            </div>

            <div style={{ marginBottom: '32px' }}>
              <h3 style={{ color: '#2d3748', marginBottom: '16px' }}>10. Changes to Terms</h3>
              <p>We reserve the right to modify or replace these Terms at any time. If a revision is material, we will provide at least 30 days notice prior to any new terms taking effect.</p>
            </div>

            <div style={{ marginBottom: '32px' }}>
              <h3 style={{ color: '#2d3748', marginBottom: '16px' }}>11. Contact Information</h3>
              <p>If you have any questions about these Terms of Service, please contact us through our support channels or administrator.</p>
            </div>
          </div>
          
          <div style={{ marginTop: '32px', textAlign: 'center' }}>
            <button
              onClick={() => window.history.back()}
              className="auth-button secondary"
              style={{ marginRight: '12px' }}
            >
              Go Back
            </button>
            <button
              onClick={() => window.location.href = '/auth'}
              className="auth-button primary"
            >
              Return to Login
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default TermsOfServicePage;