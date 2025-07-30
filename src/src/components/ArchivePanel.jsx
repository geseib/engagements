import React, { useState, useEffect } from 'react';
import { archiveService, ARCHIVE_SERVICE_CONFIG } from '../config/archive-config';

const ArchivePanel = ({ onQuestionSetImport }) => {
  const [activeTab, setActiveTab] = useState('browse');
  const [archiveItems, setArchiveItems] = useState([]);
  const [localQuestionSets, setLocalQuestionSets] = useState([]);
  const [localPrompts, setLocalPrompts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedType, setSelectedType] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('');
  const [showUploadModal, setShowUploadModal] = useState(false);
  
  // Selection states for export/import
  const [selectedArchiveItems, setSelectedArchiveItems] = useState(new Set());
  const [selectedQuestionSets, setSelectedQuestionSets] = useState(new Set());
  const [selectedPrompts, setSelectedPrompts] = useState(new Set());
  const [uploadData, setUploadData] = useState({
    title: '',
    description: '',
    content: '',
    contentType: 'questionset',
    category: 'general',
    tags: []
  });

  // Load archive items and local content on component mount
  useEffect(() => {
    loadArchiveItems();
    if (activeTab === 'export') {
      loadLocalContent();
    }
  }, [selectedType, selectedCategory, activeTab]);

  const loadArchiveItems = async () => {
    setLoading(true);
    setError(null);
    
    try {
      // Use archive service directly
      const queryParams = new URLSearchParams();
      if (selectedType) queryParams.append('type', selectedType);
      if (selectedCategory) queryParams.append('category', selectedCategory);
      
      const archiveServiceUrl = 'https://archive.seibtribe.us'; // Archive service URL
      const url = `${archiveServiceUrl}/archive/items${queryParams.toString() ? `?${queryParams.toString()}` : ''}`;
      
      console.log(`📡 Calling archive service: ${url}`);
      
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json'
        }
      });
      
      if (!response.ok) {
        throw new Error(`Failed to list archive items: ${response.status}`);
      }
      
      const data = await response.json();
      console.log(`📋 Archive service returned:`, data);
      setArchiveItems(data.items || []);
    } catch (err) {
      console.error('Failed to load archive items:', err);
      setError('Failed to load archive items. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const loadLocalContent = async () => {
    setLoading(true);
    setError(null);
    
    try {
      // Load question sets using existing API
      const questionSetsResponse = await fetch(`${window.API_BASE}admin/question-sets`);
      if (questionSetsResponse.ok) {
        const questionSetsData = await questionSetsResponse.json();
        setLocalQuestionSets(questionSetsData.questionSets || []);
      }

      // Load AI prompts using existing API
      const promptsResponse = await fetch(`${window.API_BASE}admin/ai-prompts`);
      if (promptsResponse.ok) {
        const promptsData = await promptsResponse.json();
        setLocalPrompts(promptsData.prompts || []);
      }
    } catch (err) {
      console.error('Failed to load local content:', err);
      setError('Failed to load local content. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = async () => {
    if (!searchQuery.trim()) {
      loadArchiveItems();
      return;
    }

    setLoading(true);
    setError(null);
    
    try {
      const filters = {};
      if (selectedType) filters.contentType = selectedType;
      if (selectedCategory) filters.category = selectedCategory;
      
      const response = await archiveService.search(searchQuery, filters);
      setArchiveItems(response.items || []);
    } catch (err) {
      console.error('Search failed:', err);
      setError('Search failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = async (item) => {
    try {
      const response = await archiveService.getItem(item.ArchiveId);
      
      if (response.downloadUrl) {
        // Open download URL in new tab
        window.open(response.downloadUrl, '_blank');
      }
    } catch (err) {
      console.error('Download failed:', err);
      alert('Failed to download item. Please try again.');
    }
  };

  const handleImport = async (item) => {
    if (item.ContentType !== 'questionset') {
      alert('Only question sets can be imported');
      return;
    }

    try {
      const response = await archiveService.getItem(item.ArchiveId);
      
      if (response.downloadUrl) {
        // Fetch the content from the download URL
        const contentResponse = await fetch(response.downloadUrl);
        const content = await contentResponse.text();
        
        // Pass to parent component for import
        if (onQuestionSetImport) {
          onQuestionSetImport({
            content: content,
            fileName: item.FileName,
            title: item.Title
          });
        }
      }
    } catch (err) {
      console.error('Import failed:', err);
      alert('Failed to import question set. Please try again.');
    }
  };

  const handleUpload = async () => {
    if (!uploadData.title || !uploadData.content) {
      alert('Please provide a title and content');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      await archiveService.uploadItem(uploadData);
      alert('Item uploaded successfully!');
      setShowUploadModal(false);
      setUploadData({
        title: '',
        description: '',
        content: '',
        contentType: 'questionset',
        category: 'general',
        tags: []
      });
      loadArchiveItems();
    } catch (err) {
      console.error('Upload failed:', err);
      alert('Failed to upload item. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (item) => {
    if (!window.confirm(`Are you sure you want to delete "${item.Title}"?`)) {
      return;
    }

    try {
      await archiveService.deleteItem(item.ArchiveId);
      alert('Item deleted successfully');
      loadArchiveItems();
    } catch (err) {
      console.error('Delete failed:', err);
      alert('Failed to delete item. Please try again.');
    }
  };

  const handleExportSelected = async (exportType) => {
    const selectedItems = exportType === 'questionsets' ? 
      Array.from(selectedQuestionSets) : 
      Array.from(selectedPrompts);

    if (selectedItems.length === 0) {
      alert('Please select items to export');
      return;
    }

    setLoading(true);
    try {
      const response = await fetch(`${window.API_BASE}admin/export-to-archive`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          selectedItems,
          exportType
        })
      });

      const result = await response.json();
      
      if (response.ok) {
        alert(`Export completed! ${result.results.successful.length} items exported successfully.`);
        // Clear selections
        if (exportType === 'questionsets') {
          setSelectedQuestionSets(new Set());
        } else {
          setSelectedPrompts(new Set());
        }
        // Refresh archive items
        loadArchiveItems();
      } else {
        alert(`Export failed: ${result.error}`);
      }
    } catch (err) {
      console.error('Export failed:', err);
      alert('Export failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleImportSelected = async () => {
    const selectedItems = Array.from(selectedArchiveItems);
    
    if (selectedItems.length === 0) {
      alert('Please select items to import');
      return;
    }

    // Determine import type based on selected items
    const archiveItem = archiveItems.find(item => selectedItems.includes(item.ArchiveId));
    const importType = archiveItem?.ContentType === 'prompt' ? 'prompts' : 'questionsets';

    setLoading(true);
    try {
      const response = await fetch(`${window.API_BASE}admin/import-from-archive`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          selectedItems,
          importType,
          conflictResolution: 'rename'
        })
      });

      const result = await response.json();
      
      if (response.ok) {
        alert(`Import completed! ${result.results.successful.length} items imported successfully.`);
        // Clear selections
        setSelectedArchiveItems(new Set());
        // Refresh local content
        if (activeTab === 'export') {
          loadLocalContent();
        }
      } else {
        alert(`Import failed: ${result.error}`);
      }
    } catch (err) {
      console.error('Import failed:', err);
      alert('Import failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const formatFileSize = (bytes) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleString();
  };

  return (
    <div className="archive-panel">
      <div className="archive-header">
        <h3>📚 Content Archive</h3>
        <div className="archive-tabs">
          <button 
            className={`tab-btn ${activeTab === 'browse' ? 'active' : ''}`}
            onClick={() => setActiveTab('browse')}
          >
            🔍 Browse Archive
          </button>
          <button 
            className={`tab-btn ${activeTab === 'export' ? 'active' : ''}`}
            onClick={() => setActiveTab('export')}
          >
            📤 Export to Archive
          </button>
          <button 
            className={`tab-btn ${activeTab === 'import' ? 'active' : ''}`}
            onClick={() => setActiveTab('import')}
          >
            📥 Import from Archive
          </button>
        </div>
      </div>

      <div className="archive-filters">
        <div className="filter-group">
          <input
            type="text"
            placeholder="Search archive..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
          />
          <button onClick={handleSearch}>Search</button>
        </div>

        <div className="filter-group">
          <select
            value={selectedType}
            onChange={(e) => setSelectedType(e.target.value)}
          >
            <option value="">All Types</option>
            <option value="questionset">Question Sets</option>
            <option value="document">Documents</option>
            <option value="template">Templates</option>
            <option value="report">Reports</option>
          </select>

          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
          >
            <option value="">All Categories</option>
            <option value="general">General</option>
            <option value="business">Business</option>
            <option value="education">Education</option>
            <option value="entertainment">Entertainment</option>
            <option value="technology">Technology</option>
          </select>
        </div>
      </div>

      {error && (
        <div className="error-message">{error}</div>
      )}

      {/* Browse Archive Tab */}
      {activeTab === 'browse' && (
        <>
          <button 
            className="btn-primary upload-btn"
            onClick={() => setShowUploadModal(true)}
          >
            Upload New Item
          </button>
          
          {loading ? (
            <div className="loading">Loading archive items...</div>
          ) : (
            <div className="archive-grid">
              {archiveItems.length === 0 ? (
                <div className="no-items">No archive items found</div>
              ) : (
                archiveItems.map((item) => (
              <div key={item.ArchiveId} className="archive-item">
                <div className="item-header">
                  <h4>{item.Title}</h4>
                  <span className="item-type">{item.ContentType}</span>
                </div>
                
                {item.Description && (
                  <p className="item-description">{item.Description}</p>
                )}
                
                <div className="item-meta">
                  <span>📁 {item.Category}</span>
                  <span>📄 {formatFileSize(item.FileSize)}</span>
                  <span>📅 {formatDate(item.CreatedAt)}</span>
                </div>

                {item.Tags && item.Tags.length > 0 && (
                  <div className="item-tags">
                    {item.Tags.map((tag, index) => (
                      <span key={index} className="tag">{tag}</span>
                    ))}
                  </div>
                )}

                <div className="item-actions">
                  <button onClick={() => handleDownload(item)}>
                    📥 Download
                  </button>
                  {item.ContentType === 'questionset' && onQuestionSetImport && (
                    <button onClick={() => handleImport(item)}>
                      📤 Import
                    </button>
                  )}
                  <button 
                    className="delete-btn"
                    onClick={() => handleDelete(item)}
                  >
                    🗑️ Delete
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      )}
        </>
      )}

      {/* Export to Archive Tab */}
      {activeTab === 'export' && (
        <div className="export-section">
          <h4>📤 Export Local Content to Archive</h4>
          
          {loading ? (
            <div className="loading">Loading local content...</div>
          ) : (
            <>
              {/* Question Sets Section */}
              <div className="export-category">
                <div className="category-header">
                  <h5>📚 Question Sets ({localQuestionSets.length})</h5>
                  <div className="bulk-actions">
                    <button
                      className="btn-secondary btn-small"
                      onClick={() => {
                        const allIds = localQuestionSets.map(qs => qs.id);
                        setSelectedQuestionSets(new Set(allIds));
                      }}
                    >
                      Select All
                    </button>
                    <button
                      className="btn-secondary btn-small"
                      onClick={() => setSelectedQuestionSets(new Set())}
                    >
                      Clear
                    </button>
                    <button
                      className="btn-primary"
                      onClick={() => handleExportSelected('questionsets')}
                      disabled={selectedQuestionSets.size === 0}
                    >
                      Export Selected ({selectedQuestionSets.size})
                    </button>
                  </div>
                </div>
                
                <div className="export-grid">
                  {localQuestionSets.map((qs) => (
                    <div key={qs.id} className="export-item">
                      <div className="item-checkbox">
                        <input
                          type="checkbox"
                          checked={selectedQuestionSets.has(qs.id)}
                          onChange={(e) => {
                            const newSet = new Set(selectedQuestionSets);
                            if (e.target.checked) {
                              newSet.add(qs.id);
                            } else {
                              newSet.delete(qs.id);
                            }
                            setSelectedQuestionSets(newSet);
                          }}
                        />
                      </div>
                      <div className="item-info">
                        <h6>{qs.name}</h6>
                        <p>{qs.description}</p>
                        <div className="item-tags">
                          <span className="tag">{qs.engagementType}</span>
                          <span className="tag">{qs.totalQuestions} questions</span>
                          {qs.active && <span className="tag active">Active</span>}
                          {qs.isAIGenerated && <span className="tag ai">AI Generated</span>}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* AI Prompts Section */}
              <div className="export-category">
                <div className="category-header">
                  <h5>🤖 AI Prompts ({localPrompts.length})</h5>
                  <div className="bulk-actions">
                    <button
                      className="btn-secondary btn-small"
                      onClick={() => {
                        const allIds = localPrompts.map(p => p.promptId || p.id);
                        setSelectedPrompts(new Set(allIds));
                      }}
                    >
                      Select All
                    </button>
                    <button
                      className="btn-secondary btn-small"
                      onClick={() => setSelectedPrompts(new Set())}
                    >
                      Clear
                    </button>
                    <button
                      className="btn-primary"
                      onClick={() => handleExportSelected('prompts')}
                      disabled={selectedPrompts.size === 0}
                    >
                      Export Selected ({selectedPrompts.size})
                    </button>
                  </div>
                </div>
                
                <div className="export-grid">
                  {localPrompts.map((prompt) => (
                    <div key={prompt.promptId || prompt.id} className="export-item">
                      <div className="item-checkbox">
                        <input
                          type="checkbox"
                          checked={selectedPrompts.has(prompt.promptId || prompt.id)}
                          onChange={(e) => {
                            const newSet = new Set(selectedPrompts);
                            const id = prompt.promptId || prompt.id;
                            if (e.target.checked) {
                              newSet.add(id);
                            } else {
                              newSet.delete(id);
                            }
                            setSelectedPrompts(newSet);
                          }}
                        />
                      </div>
                      <div className="item-info">
                        <h6>{prompt.name}</h6>
                        <p>{prompt.description}</p>
                        <div className="item-tags">
                          <span className="tag">{prompt.gameType}</span>
                          <span className="tag">{prompt.category}</span>
                          <span className={`tag ${prompt.status}`}>{prompt.status}</span>
                          {prompt.isDefault && <span className="tag default">Default</span>}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* Import from Archive Tab */}
      {activeTab === 'import' && (
        <div className="import-section">
          <h4>📥 Import Content from Archive</h4>
          
          <div className="import-header">
            <div className="bulk-actions">
              <button
                className="btn-secondary btn-small"
                onClick={() => {
                  const allIds = archiveItems.map(item => item.ArchiveId);
                  setSelectedArchiveItems(new Set(allIds));
                }}
              >
                Select All
              </button>
              <button
                className="btn-secondary btn-small"
                onClick={() => setSelectedArchiveItems(new Set())}
              >
                Clear
              </button>
              <button
                className="btn-primary"
                onClick={handleImportSelected}
                disabled={selectedArchiveItems.size === 0}
              >
                Import Selected ({selectedArchiveItems.size})
              </button>
            </div>
          </div>

          {loading ? (
            <div className="loading">Loading archive items...</div>
          ) : (
            <div className="import-grid">
              {archiveItems.length === 0 ? (
                <div className="no-items">No archive items found</div>
              ) : (
                archiveItems.map((item) => (
                  <div key={item.ArchiveId} className="import-item">
                    <div className="item-checkbox">
                      <input
                        type="checkbox"
                        checked={selectedArchiveItems.has(item.ArchiveId)}
                        onChange={(e) => {
                          const newSet = new Set(selectedArchiveItems);
                          if (e.target.checked) {
                            newSet.add(item.ArchiveId);
                          } else {
                            newSet.delete(item.ArchiveId);
                          }
                          setSelectedArchiveItems(newSet);
                        }}
                      />
                    </div>
                    <div className="item-info">
                      <div className="item-header">
                        <h6>{item.Title}</h6>
                        <span className="item-type">{item.ContentType}</span>
                      </div>
                      {item.Description && (
                        <p className="item-description">{item.Description}</p>
                      )}
                      <div className="item-meta">
                        <span>📁 {item.Category}</span>
                        <span>📄 {formatFileSize(item.FileSize)}</span>
                        <span>📅 {formatDate(item.CreatedAt)}</span>
                      </div>
                      {item.Tags && item.Tags.length > 0 && (
                        <div className="item-tags">
                          {item.Tags.map((tag, index) => (
                            <span key={index} className="tag">{tag}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      )}

      {/* Upload Modal */}
      {showUploadModal && (
        <div className="modal-backdrop" onClick={() => setShowUploadModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h3>Upload to Archive</h3>
            
            <div className="form-group">
              <label>Title*</label>
              <input
                type="text"
                value={uploadData.title}
                onChange={(e) => setUploadData({...uploadData, title: e.target.value})}
                placeholder="Enter item title"
              />
            </div>

            <div className="form-group">
              <label>Description</label>
              <textarea
                value={uploadData.description}
                onChange={(e) => setUploadData({...uploadData, description: e.target.value})}
                placeholder="Enter description (optional)"
                rows="3"
              />
            </div>

            <div className="form-group">
              <label>Type*</label>
              <select
                value={uploadData.contentType}
                onChange={(e) => setUploadData({...uploadData, contentType: e.target.value})}
              >
                <option value="questionset">Question Set</option>
                <option value="document">Document</option>
                <option value="template">Template</option>
                <option value="report">Report</option>
              </select>
            </div>

            <div className="form-group">
              <label>Category</label>
              <select
                value={uploadData.category}
                onChange={(e) => setUploadData({...uploadData, category: e.target.value})}
              >
                <option value="general">General</option>
                <option value="business">Business</option>
                <option value="education">Education</option>
                <option value="entertainment">Entertainment</option>
                <option value="technology">Technology</option>
              </select>
            </div>

            <div className="form-group">
              <label>Content*</label>
              <textarea
                value={uploadData.content}
                onChange={(e) => setUploadData({...uploadData, content: e.target.value})}
                placeholder="Paste or type content here"
                rows="10"
              />
            </div>

            <div className="modal-actions">
              <button onClick={() => setShowUploadModal(false)}>Cancel</button>
              <button 
                className="btn-primary"
                onClick={handleUpload}
                disabled={loading}
              >
                {loading ? 'Uploading...' : 'Upload'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ArchivePanel;