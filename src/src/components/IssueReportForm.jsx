import React, { useState, useEffect } from 'react';
import './IssueReportForm.css';

const IssueReportForm = ({ 
  isOpen, 
  onClose, 
  initialType = 'bug', 
  initialContext = 'host',
  gameId = null 
}) => {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [issueType, setIssueType] = useState(initialType);
  const [context, setContext] = useState(initialContext);
  const [additionalInfo, setAdditionalInfo] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitSuccess, setSubmitSuccess] = useState(false);
  const [error, setError] = useState('');

  // Reset form when opened
  useEffect(() => {
    if (isOpen) {
      setTitle('');
      setDescription('');
      setIssueType(initialType);
      setContext(initialContext);
      setAdditionalInfo('');
      setError('');
      setSubmitSuccess(false);
    }
  }, [isOpen, initialType, initialContext]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!title.trim() || !description.trim()) {
      setError('Please fill in both title and description');
      return;
    }

    setIsSubmitting(true);
    setError('');

    try {
      const issueData = {
        title: title.trim(),
        description: description.trim(),
        issueType,
        context,
        gameId,
        url: window.location.href,
        userAgent: navigator.userAgent,
        additionalInfo: additionalInfo.trim() || null
      };

      const API_BASE = window.API_BASE;
      
      const response = await fetch(`${API_BASE}admin/create-github-issue`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(issueData)
      });

      const result = await response.json();

      if (response.ok) {
        setSubmitSuccess(true);
        setTimeout(() => {
          onClose();
        }, 2000);
      } else {
        setError(result.error || 'Failed to create issue');
      }
    } catch (err) {
      console.error('Error creating issue:', err);
      setError('Network error. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="issue-form-overlay">
      <div className="issue-form-modal">
        <div className="issue-form-header">
          <h2>
            {issueType === 'bug' && '🐛 Report a Bug'}
            {issueType === 'feature' && '💡 Request a Feature'}
            {issueType === 'help' && '❓ Get Help'}
          </h2>
          <button className="close-button" onClick={onClose}>×</button>
        </div>

        {submitSuccess ? (
          <div className="success-message">
            <div className="success-icon">✅</div>
            <h3>Issue Created Successfully!</h3>
            <p>Your {issueType} report has been submitted to GitHub.</p>
            <p>You can track progress in the repository issues.</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="issue-form">
            <div className="form-row">
              <div className="form-group">
                <label htmlFor="issueType">Issue Type:</label>
                <select 
                  id="issueType"
                  value={issueType} 
                  onChange={(e) => setIssueType(e.target.value)}
                  className="form-select"
                >
                  <option value="bug">🐛 Bug Report</option>
                  <option value="feature">💡 Feature Request</option>
                  <option value="help">❓ Help/Question</option>
                </select>
              </div>

              <div className="form-group">
                <label htmlFor="context">Screen/Area:</label>
                <select 
                  id="context"
                  value={context} 
                  onChange={(e) => setContext(e.target.value)}
                  className="form-select"
                >
                  <option value="host">🎯 Host Screen</option>
                  <option value="player">📱 Player Screen</option>
                  <option value="admin">⚙️ Admin Panel</option>
                </select>
              </div>
            </div>

            <div className="form-group">
              <label htmlFor="title">Title: *</label>
              <input
                type="text"
                id="title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={
                  issueType === 'bug' ? 'Brief description of the bug...' :
                  issueType === 'feature' ? 'Brief description of the feature...' :
                  'What do you need help with?'
                }
                className="form-input"
                maxLength={100}
                required
              />
              <div className="char-count">{title.length}/100</div>
            </div>

            <div className="form-group">
              <label htmlFor="description">
                {issueType === 'bug' && 'Bug Description: *'}
                {issueType === 'feature' && 'Feature Description: *'}
                {issueType === 'help' && 'Question Details: *'}
              </label>
              <textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={
                  issueType === 'bug' ? 
                    'Please describe:\n• What you were trying to do\n• What happened instead\n• Steps to reproduce the issue' :
                  issueType === 'feature' ? 
                    'Please describe:\n• What feature you would like\n• How it would be useful\n• Any specific requirements' :
                    'Please describe your question or what you need help with in detail...'
                }
                className="form-textarea"
                rows={6}
                maxLength={1000}
                required
              />
              <div className="char-count">{description.length}/1000</div>
            </div>

            <div className="form-group">
              <label htmlFor="additionalInfo">Additional Information:</label>
              <textarea
                id="additionalInfo"
                value={additionalInfo}
                onChange={(e) => setAdditionalInfo(e.target.value)}
                placeholder="Any additional context, error messages, or details..."
                className="form-textarea"
                rows={3}
                maxLength={500}
              />
              <div className="char-count">{additionalInfo.length}/500</div>
            </div>

            {gameId && (
              <div className="form-info">
                <strong>Game ID:</strong> {gameId}
              </div>
            )}

            {error && (
              <div className="error-message">
                ❌ {error}
              </div>
            )}

            <div className="form-actions">
              <button type="button" onClick={onClose} className="btn-secondary">
                Cancel
              </button>
              <button 
                type="submit" 
                className="btn-primary"
                disabled={isSubmitting || !title.trim() || !description.trim()}
              >
                {isSubmitting ? 'Creating Issue...' : 'Create Issue'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};

export default IssueReportForm;