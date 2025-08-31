import React from 'react';
import './auth/auth.css';

const PrivacyPolicyPage = () => {
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
            <h2 style={{ marginTop: '32px', marginBottom: '24px' }}>Privacy Policy</h2>
          </div>
          
          <div style={{ textAlign: 'left', lineHeight: '1.6', color: '#4a5568' }}>
            <div style={{ marginBottom: '24px' }}>
              <p><strong>Effective Date:</strong> {new Date().toLocaleDateString()}</p>
            </div>

            <div style={{ marginBottom: '32px' }}>
              <h3 style={{ color: '#2d3748', marginBottom: '16px' }}>1. Information We Collect</h3>
              <p>We collect information you provide directly to us, including:</p>
              <ul style={{ marginLeft: '24px', marginTop: '8px' }}>
                <li>Account information (name, email address)</li>
                <li>Session data and responses during engagement activities</li>
                <li>Usage information and analytics data</li>
              </ul>
            </div>

            <div style={{ marginBottom: '32px' }}>
              <h3 style={{ color: '#2d3748', marginBottom: '16px' }}>2. How We Use Your Information</h3>
              <p>We use your information to:</p>
              <ul style={{ marginLeft: '24px', marginTop: '8px' }}>
                <li>Provide and maintain our service</li>
                <li>Process your participation in engagement sessions</li>
                <li>Generate reports and analytics for your organization</li>
                <li>Communicate with you about your account and our services</li>
                <li>Improve our platform and user experience</li>
              </ul>
            </div>

            <div style={{ marginBottom: '32px' }}>
              <h3 style={{ color: '#2d3748', marginBottom: '16px' }}>3. Information Sharing</h3>
              <p><strong>We do not share your personal data with anyone.</strong> Your information is kept strictly confidential and is only used internally to provide our services to you and your organization.</p>
              <p style={{ marginTop: '12px' }}>We may share anonymized, aggregated data that cannot be used to identify individuals for research and improvement purposes.</p>
            </div>

            <div style={{ marginBottom: '32px' }}>
              <h3 style={{ color: '#2d3748', marginBottom: '16px' }}>4. Data Security</h3>
              <p>We implement appropriate technical and organizational security measures to protect your personal information against unauthorized access, alteration, disclosure, or destruction. Your data is stored on secure servers with encryption and access controls.</p>
            </div>

            <div style={{ marginBottom: '32px' }}>
              <h3 style={{ color: '#2d3748', marginBottom: '16px' }}>5. Data Retention</h3>
              <p>We retain your personal information for as long as necessary to provide our services and fulfill the purposes outlined in this Privacy Policy. Session data and reports are typically retained for 90 days unless deleted earlier.</p>
            </div>

            <div style={{ marginBottom: '32px' }}>
              <h3 style={{ color: '#2d3748', marginBottom: '16px' }}>6. Your Rights</h3>
              <p>You have the right to:</p>
              <ul style={{ marginLeft: '24px', marginTop: '8px' }}>
                <li>Access your personal information</li>
                <li>Correct or update your information</li>
                <li>Request deletion of your data</li>
                <li>Withdraw consent where applicable</li>
              </ul>
            </div>

            <div style={{ marginBottom: '32px' }}>
              <h3 style={{ color: '#2d3748', marginBottom: '16px' }}>7. Cookies and Tracking</h3>
              <p>We use essential cookies and similar technologies to provide functionality, maintain your session, and improve our services. We do not use tracking cookies for advertising or marketing purposes.</p>
            </div>

            <div style={{ marginBottom: '32px' }}>
              <h3 style={{ color: '#2d3748', marginBottom: '16px' }}>8. Contact Us</h3>
              <p>If you have questions about this Privacy Policy or our privacy practices, please contact us through our support channels or administrator.</p>
            </div>

            <div style={{ marginBottom: '32px' }}>
              <p><em>This Privacy Policy may be updated from time to time. We will notify users of any material changes.</em></p>
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

export default PrivacyPolicyPage;