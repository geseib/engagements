import React from 'react';

const ContentList = ({ 
  type, 
  contentType, 
  questionSets, 
  prompts, 
  selectedItems, 
  onSelectionChange, 
  isLoading 
}) => {
  const toggleSelection = (itemId) => {
    const newSelected = new Set(selectedItems);
    if (newSelected.has(itemId)) {
      newSelected.delete(itemId);
    } else {
      newSelected.add(itemId);
    }
    onSelectionChange(newSelected);
  };

  const selectAll = () => {
    const allItems = contentType === 'question-sets' ? questionSets : prompts;
    const prefix = type === 'archive' ? 
      (contentType === 'question-sets' ? 'archive_set_' : 'archive_prompt_') : 
      (contentType === 'question-sets' ? 'set_' : 'prompt_');
    
    const allIds = allItems.map(item => 
      type === 'archive' ? `${prefix}${item.archiveItemId}` : `${prefix}${item.id}`
    );
    
    if (selectedItems.size === allIds.length) {
      onSelectionChange(new Set());
    } else {
      onSelectionChange(new Set(allIds));
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

  const getItemId = (item) => {
    if (type === 'archive') {
      const prefix = contentType === 'question-sets' ? 'archive_set_' : 'archive_prompt_';
      return `${prefix}${item.archiveItemId}`;
    } else {
      const prefix = contentType === 'question-sets' ? 'set_' : 'prompt_';
      return `${prefix}${item.id}`;
    }
  };

  const currentItems = contentType === 'question-sets' ? questionSets : prompts;

  if (isLoading) {
    return (
      <div className="content-list loading">
        <div className="spinner"></div>
        <p>Loading {contentType.replace('-', ' ')}...</p>
      </div>
    );
  }

  if (currentItems.length === 0) {
    return (
      <div className="content-list empty">
        <div className="empty-state">
          <div className="empty-icon">
            {contentType === 'question-sets' ? '📝' : '🤖'}
          </div>
          <p>No {contentType.replace('-', ' ')} found</p>
          {type === 'local' && (
            <p className="empty-hint">
              Create some {contentType.replace('-', ' ')} to see them here
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="content-list">
      <div className="list-header">
        <div className="select-controls">
          <button className="btn-small select-all-btn" onClick={selectAll}>
            {selectedItems.size === currentItems.length ? '☑️ Deselect All' : '☐ Select All'}
          </button>
          <span className="item-count">
            {currentItems.length} {contentType.replace('-', ' ')}
          </span>
        </div>
      </div>

      <div className="list-content">
        {currentItems.map(item => {
          const itemId = getItemId(item);
          const isSelected = selectedItems.has(itemId);
          
          return (
            <div
              key={itemId}
              className={`content-item ${isSelected ? 'selected' : ''}`}
              onClick={() => toggleSelection(itemId)}
            >
              <div className="item-checkbox">
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => toggleSelection(itemId)}
                />
              </div>
              
              <div className="item-content">
                <div className="item-header">
                  <h4 className="item-title">
                    {contentType === 'question-sets' ? item.title : item.name}
                  </h4>
                  <div className="item-badges">
                    {item.gameType && (
                      <span className="badge game-type">{item.gameType}</span>
                    )}
                    {item.promptType && (
                      <span className="badge prompt-type">{item.promptType}</span>
                    )}
                    {item.difficulty && (
                      <span className="badge difficulty">{item.difficulty}</span>
                    )}
                    {type === 'archive' && item.originalEnvironment && (
                      <span className="badge environment">{item.originalEnvironment}</span>
                    )}
                  </div>
                </div>
                
                <div className="item-details">
                  {item.description && (
                    <p className="item-description">{item.description}</p>
                  )}
                  
                  <div className="item-meta">
                    {contentType === 'question-sets' && item.questionCount && (
                      <span className="meta-item">
                        📝 {item.questionCount} questions
                      </span>
                    )}
                    {item.category && (
                      <span className="meta-item">
                        🏷️ {item.category}
                      </span>
                    )}
                    {item.school && (
                      <span className="meta-item">
                        🏫 {item.school}
                      </span>
                    )}
                    <span className="meta-item">
                      📅 {formatDate(item.createdAt || item.archivedAt)}
                    </span>
                    {type === 'archive' && item.originalId && (
                      <span className="meta-item">
                        🔗 Original: {item.originalId.substring(0, 8)}...
                      </span>
                    )}
                  </div>
                </div>
              </div>
              
              <div className="item-actions">
                {type === 'local' && (
                  <button
                    className="btn-icon"
                    onClick={(e) => {
                      e.stopPropagation();
                      // Could add individual item actions here
                    }}
                    title="View details"
                  >
                    👁️
                  </button>
                )}
                {type === 'archive' && (
                  <div className="archive-info">
                    <span className="archive-date">
                      Archived: {formatDate(item.archivedAt)}
                    </span>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default ContentList;