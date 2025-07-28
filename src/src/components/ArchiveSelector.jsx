import React, { useState } from 'react';

const ArchiveSelector = ({ archives, activeArchive, onArchiveSelect, onCreateArchive }) => {
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newArchiveName, setNewArchiveName] = useState('');
  const [newArchiveDescription, setNewArchiveDescription] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  const handleCreateArchive = async (e) => {
    e.preventDefault();
    
    if (!newArchiveName.trim()) {
      alert('Please enter an archive name');
      return;
    }

    setIsCreating(true);
    try {
      const created = await onCreateArchive(newArchiveName.trim(), newArchiveDescription.trim());
      if (created) {
        setNewArchiveName('');
        setNewArchiveDescription('');
        setShowCreateForm(false);
      }
    } finally {
      setIsCreating(false);
    }
  };

  const formatDate = (dateString) => {
    if (!dateString) return 'Unknown';
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  return (
    <div className="archive-selector">
      <div className="selector-header">
        <h3>📦 Select Archive</h3>
        <button
          className="btn-small create-archive-btn"
          onClick={() => setShowCreateForm(!showCreateForm)}
        >
          {showCreateForm ? '❌ Cancel' : '➕ New Archive'}
        </button>
      </div>

      {showCreateForm && (
        <div className="create-archive-form">
          <form onSubmit={handleCreateArchive}>
            <div className="form-group">
              <label>Archive Name *</label>
              <input
                type="text"
                value={newArchiveName}
                onChange={(e) => setNewArchiveName(e.target.value)}
                placeholder="e.g., Q1 2024 Content, Production Backup..."
                required
                disabled={isCreating}
              />
            </div>
            
            <div className="form-group">
              <label>Description</label>
              <textarea
                value={newArchiveDescription}
                onChange={(e) => setNewArchiveDescription(e.target.value)}
                placeholder="Optional description of this archive's purpose..."
                rows="2"
                disabled={isCreating}
              />
            </div>
            
            <div className="form-actions">
              <button
                type="submit"
                className="btn-primary"
                disabled={isCreating || !newArchiveName.trim()}
              >
                {isCreating ? '⏳ Creating...' : '✅ Create Archive'}
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setShowCreateForm(false)}
                disabled={isCreating}
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="archive-list">
        {archives.length === 0 ? (
          <div className="no-archives">
            <p>No archives found. Create your first archive to get started.</p>
          </div>
        ) : (
          <>
            <div className="archive-item no-archive" onClick={() => onArchiveSelect(null)}>
              <div className="archive-radio">
                <input
                  type="radio"
                  name="archive"
                  checked={!activeArchive}
                  readOnly
                />
              </div>
              <div className="archive-info">
                <div className="archive-name">No Archive Selected</div>
                <div className="archive-description">Select an archive to view its contents</div>
              </div>
            </div>
            
            {archives.map(archive => (
              <div
                key={archive.id}
                className={`archive-item ${activeArchive?.id === archive.id ? 'selected' : ''}`}
                onClick={() => onArchiveSelect(archive)}
              >
                <div className="archive-radio">
                  <input
                    type="radio"
                    name="archive"
                    checked={activeArchive?.id === archive.id}
                    readOnly
                  />
                </div>
                
                <div className="archive-info">
                  <div className="archive-header">
                    <div className="archive-name">{archive.name}</div>
                    <div className="archive-stats">
                      <span className="item-count">
                        {archive.itemCount || 0} items
                      </span>
                      <span className="archive-date">
                        {formatDate(archive.createdAt)}
                      </span>
                    </div>
                  </div>
                  
                  {archive.description && (
                    <div className="archive-description">{archive.description}</div>
                  )}
                  
                  <div className="archive-meta">
                    <span className="meta-item">
                      📝 {archive.questionSetsCount || 0} question sets
                    </span>
                    <span className="meta-item">
                      🤖 {archive.promptsCount || 0} prompts
                    </span>
                    {archive.lastModified && (
                      <span className="meta-item">
                        📅 Modified: {formatDate(archive.lastModified)}
                      </span>
                    )}
                  </div>
                </div>
                
                <div className="archive-actions">
                  <button
                    className="btn-icon"
                    onClick={(e) => {
                      e.stopPropagation();
                      // Could add archive management actions here
                    }}
                    title="Archive options"
                  >
                    ⚙️
                  </button>
                </div>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
};

export default ArchiveSelector;