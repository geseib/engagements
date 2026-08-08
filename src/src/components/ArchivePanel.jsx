import React, { useState, useEffect, useMemo } from 'react';
import { authFetch } from '../auth/authFetch';
import Icon from './Icon';
import StatusMessage from './StatusMessage';
import { GAME_TYPE_LIST, gameTypeLabel } from '../config/gameTypes';
import {
  archiveGameType,
  filterArchiveItems,
  tagFilterOptions,
} from '../utils/archiveFiltering';

const ArchivePanel = ({ onQuestionSetImport }) => {
  const [activeTab, setActiveTab] = useState('browse');
  const [archiveItems, setArchiveItems] = useState([]);
  const [localQuestionSets, setLocalQuestionSets] = useState([]);
  const [localPrompts, setLocalPrompts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedType, setSelectedType] = useState('');
  // Game type and tag are filtered in the browser, not by the API: the stored
  // value spells the same type several ways and sometimes lives only in Tags,
  // so an exact-match Category filter on the server drops matching records.
  // See utils/archiveFiltering.js.
  const [selectedGameType, setSelectedGameType] = useState('');
  const [selectedTag, setSelectedTag] = useState('');
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
  }, [selectedType, activeTab]);

  // What the browse/import grids actually render.
  const visibleItems = useMemo(
    () => filterArchiveItems(archiveItems, { gameType: selectedGameType, tag: selectedTag }),
    [archiveItems, selectedGameType, selectedTag]
  );

  const availableTags = useMemo(
    () => tagFilterOptions(archiveItems, selectedTag),
    [archiveItems, selectedTag]
  );

  // An empty grid means two different things, and saying which one saves the
  // owner from re-running a search that was never going to match.
  const emptyMessage = archiveItems.length === 0
    ? 'No archive items found'
    : 'No archive items match the current filters';

  const loadArchiveItems = async () => {
    setLoading(true);
    setError(null);
    
    try {
      // Use archive service directly
      const queryParams = new URLSearchParams();
      if (selectedType) queryParams.append('type', selectedType);

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
      const questionSetsResponse = await authFetch(`${window.API_BASE}admin/question-sets`);
      if (questionSetsResponse.ok) {
        const questionSetsData = await questionSetsResponse.json();
        setLocalQuestionSets(questionSetsData.questionSets || []);
      }

      // Load AI prompts using existing API
      const promptsResponse = await authFetch(`${window.API_BASE}admin/ai-prompts`);
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

      const archiveServiceUrl = 'https://archive.seibtribe.us';
      const response = await fetch(`${archiveServiceUrl}/archive/search`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          query: searchQuery,
          filters: filters
        })
      });

      if (response.ok) {
        const data = await response.json();
        setArchiveItems(data.items || []);
      } else {
        throw new Error(`HTTP ${response.status}`);
      }
    } catch (err) {
      console.error('Search failed:', err);
      setError('Search failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = async (item) => {
    try {
      const archiveServiceUrl = 'https://archive.seibtribe.us';
      const response = await fetch(`${archiveServiceUrl}/archive/items/${item.ArchiveId}`);
      
      if (response.ok) {
        const data = await response.json();
        if (data.downloadUrl) {
          // Open download URL in new tab
          window.open(data.downloadUrl, '_blank');
        }
      } else {
        throw new Error(`HTTP ${response.status}`);
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
      const archiveServiceUrl = 'https://archive.seibtribe.us';
      const response = await fetch(`${archiveServiceUrl}/archive/items/${item.ArchiveId}`);
      
      if (response.ok) {
        const data = await response.json();
        if (data.downloadUrl) {
          // Fetch the content from the download URL
          const contentResponse = await fetch(data.downloadUrl);
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
      } else {
        throw new Error(`HTTP ${response.status}`);
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
      const archiveServiceUrl = 'https://archive.seibtribe.us';
      const response = await fetch(`${archiveServiceUrl}/archive/items`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(uploadData)
      });

      if (response.ok) {
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
      } else {
        throw new Error(`HTTP ${response.status}`);
      }
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
      const archiveServiceUrl = 'https://archive.seibtribe.us';
      const response = await fetch(`${archiveServiceUrl}/archive/items/${item.ArchiveId}`, {
        method: 'DELETE'
      });

      if (response.ok) {
        alert('Item deleted successfully');
        loadArchiveItems();
      } else {
        throw new Error(`HTTP ${response.status}`);
      }
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
      const response = await authFetch(`${window.API_BASE}admin/export-to-archive`, {
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
      const response = await authFetch(`${window.API_BASE}admin/import-from-archive`, {
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
        <h3><Icon name="Books" weight="duotone" size={16} color="var(--primary)" /> Content Archive</h3>
        <div className="archive-tabs">
          <button 
            className={`tab-btn ${activeTab === 'browse' ? 'active' : ''}`}
            onClick={() => setActiveTab('browse')}
          >
            <Icon name="MagnifyingGlass" weight="bold" size={16} color="currentColor" /> Browse Archive
          </button>
          <button 
            className={`tab-btn ${activeTab === 'export' ? 'active' : ''}`}
            onClick={() => setActiveTab('export')}
          >
            <Icon name="UploadSimple" weight="bold" size={16} color="currentColor" /> Export to Archive
          </button>
          <button 
            className={`tab-btn ${activeTab === 'import' ? 'active' : ''}`}
            onClick={() => setActiveTab('import')}
          >
            <Icon name="DownloadSimple" weight="bold" size={16} color="currentColor" /> Import from Archive
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
            aria-label="Content type"
            value={selectedType}
            onChange={(e) => setSelectedType(e.target.value)}
          >
            <option value="">All Content Types</option>
            <option value="questionset">Question Sets</option>
            <option value="prompt">Prompts</option>
          </select>

          <select
            aria-label="Game type"
            value={selectedGameType}
            onChange={(e) => setSelectedGameType(e.target.value)}
          >
            <option value="">All Game Types</option>
            {GAME_TYPE_LIST.map((type) => (
              <option key={type.id} value={type.id}>{type.label}</option>
            ))}
          </select>

          <select
            aria-label="Tag"
            value={selectedTag}
            onChange={(e) => setSelectedTag(e.target.value)}
            disabled={availableTags.length === 0}
          >
            <option value="">All Tags</option>
            {availableTags.map((tag) => (
              <option key={tag} value={tag}>{tag}</option>
            ))}
          </select>
        </div>
      </div>

      <StatusMessage message={error} tone="error" className="error-message" />

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
              {visibleItems.length === 0 ? (
                <div className="no-items">{emptyMessage}</div>
              ) : (
                visibleItems.map((item) => (
              <div key={item.ArchiveId} className="archive-item">
                <div className="item-header">
                  <h4>{item.Title}</h4>
                  <span className="item-type">{item.ContentType}</span>
                </div>

                {item.Description && (
                  <p className="item-description">{item.Description}</p>
                )}

                <div className="item-meta">
                  {archiveGameType(item) && (
                    <span>
                      <Icon name="GameController" weight="bold" size={16} color="currentColor" />
                      {' '}{gameTypeLabel(archiveGameType(item))}
                    </span>
                  )}
                  <span><Icon name="Folder" weight="bold" size={16} color="currentColor" /> {item.Category}</span>
                  <span><Icon name="FileText" weight="bold" size={16} color="currentColor" /> {formatFileSize(item.FileSize)}</span>
                  <span><Icon name="CalendarBlank" weight="bold" size={16} color="currentColor" /> {formatDate(item.CreatedAt)}</span>
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
                    <Icon name="DownloadSimple" weight="bold" size={16} color="currentColor" /> Download
                  </button>
                  {item.ContentType === 'questionset' && onQuestionSetImport && (
                    <button onClick={() => handleImport(item)}>
                      <Icon name="UploadSimple" weight="bold" size={16} color="currentColor" /> Import
                    </button>
                  )}
                  <button 
                    className="delete-btn"
                    onClick={() => handleDelete(item)}
                  >
                    <Icon name="Trash" weight="bold" size={16} color="currentColor" /> Delete
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
          <h4><Icon name="UploadSimple" weight="bold" size={16} color="currentColor" /> Export Local Content to Archive</h4>
          
          {loading ? (
            <div className="loading">Loading local content...</div>
          ) : (
            <>
              {/* Question Sets Section */}
              <div className="export-category">
                <div className="category-header">
                  <h5><Icon name="Books" weight="duotone" size={16} color="var(--primary)" /> Question Sets ({localQuestionSets.length})</h5>
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
                      <Icon name="UploadSimple" weight="bold" size={16} color="currentColor" /> Export Selected ({selectedQuestionSets.size})
                    </button>
                  </div>
                </div>
                
                <div className="archive-grid">
                  {localQuestionSets.map((qs) => (
                    <div key={qs.id} className="archive-item">
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
                      <div className="item-header">
                        <h4>{qs.name}</h4>
                        <span className="item-type">Question Set</span>
                      </div>
                      
                      {qs.description && (
                        <p className="item-description">{qs.description}</p>
                      )}
                      
                      <div className="item-meta">
                        <span><Icon name="GameController" weight="bold" size={16} color="currentColor" /> {qs.engagementType}</span>
                        <span><Icon name="Question" weight="bold" size={16} color="currentColor" /> {qs.totalQuestions} questions</span>
                        <span><Icon name="CalendarBlank" weight="bold" size={16} color="currentColor" /> {qs.createdAt ? formatDate(qs.createdAt) : 'Unknown'}</span>
                      </div>

                      <div className="item-tags">
                        {qs.active && <span className="tag active">Active</span>}
                        {qs.isAIGenerated && <span className="tag ai">AI Generated</span>}
                      </div>

                      <div className="item-actions">
                        <button 
                          className="btn-primary"
                          onClick={() => {
                            if (selectedQuestionSets.has(qs.id)) {
                              const newSet = new Set(selectedQuestionSets);
                              newSet.delete(qs.id);
                              setSelectedQuestionSets(newSet);
                            } else {
                              const newSet = new Set(selectedQuestionSets);
                              newSet.add(qs.id);
                              setSelectedQuestionSets(newSet);
                            }
                          }}
                        >
                          {selectedQuestionSets.has(qs.id) ? 'Selected' : 'Select for Export'}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* AI Prompts Section */}
              <div className="export-category">
                <div className="category-header">
                  <h5><Icon name="Sparkle" weight="duotone" size={16} color="var(--primary)" /> AI Prompts ({localPrompts.length})</h5>
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
                      <Icon name="UploadSimple" weight="bold" size={16} color="currentColor" /> Export Selected ({selectedPrompts.size})
                    </button>
                  </div>
                </div>
                
                <div className="archive-grid">
                  {localPrompts.map((prompt) => (
                    <div key={prompt.promptId || prompt.id} className="archive-item">
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
                      <div className="item-header">
                        <h4>{prompt.name}</h4>
                        <span className="item-type">AI Prompt</span>
                      </div>
                      
                      {prompt.description && (
                        <p className="item-description">{prompt.description}</p>
                      )}
                      
                      <div className="item-meta">
                        <span><Icon name="GameController" weight="bold" size={16} color="currentColor" /> {prompt.gameType}</span>
                        <span><Icon name="Folder" weight="bold" size={16} color="currentColor" /> {prompt.category}</span>
                        <span><Icon name="CalendarBlank" weight="bold" size={16} color="currentColor" /> {prompt.createdAt ? formatDate(prompt.createdAt) : 'Unknown'}</span>
                      </div>

                      <div className="item-tags">
                        <span className={`tag ${prompt.status}`}>{prompt.status}</span>
                        {prompt.isDefault && <span className="tag default">Default</span>}
                      </div>

                      <div className="item-actions">
                        <button 
                          className="btn-primary"
                          onClick={() => {
                            const id = prompt.promptId || prompt.id;
                            if (selectedPrompts.has(id)) {
                              const newSet = new Set(selectedPrompts);
                              newSet.delete(id);
                              setSelectedPrompts(newSet);
                            } else {
                              const newSet = new Set(selectedPrompts);
                              newSet.add(id);
                              setSelectedPrompts(newSet);
                            }
                          }}
                        >
                          {selectedPrompts.has(prompt.promptId || prompt.id) ? 'Selected' : 'Select for Export'}
                        </button>
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
          <h4><Icon name="DownloadSimple" weight="bold" size={16} color="currentColor" /> Import Content from Archive</h4>
          
          <div className="import-header">
            <div className="bulk-actions">
              <button
                className="btn-secondary btn-small"
                onClick={() => {
                  // Select what is on screen, not what the filters hid.
                  const allIds = visibleItems.map(item => item.ArchiveId);
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
                <Icon name="DownloadSimple" weight="bold" size={16} color="currentColor" /> Import Selected ({selectedArchiveItems.size})
              </button>
            </div>
          </div>

          {loading ? (
            <div className="loading">Loading archive items...</div>
          ) : (
            <div className="archive-grid">
              {visibleItems.length === 0 ? (
                <div className="no-items">{emptyMessage}</div>
              ) : (
                visibleItems.map((item) => (
                  <div key={item.ArchiveId} className="archive-item">
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
                    <div className="item-header">
                      <h4>{item.Title}</h4>
                      <span className="item-type">{item.ContentType}</span>
                    </div>
                    
                    {item.Description && (
                      <p className="item-description">{item.Description}</p>
                    )}
                    
                    <div className="item-meta">
                      {archiveGameType(item) && (
                        <span>
                          <Icon name="GameController" weight="bold" size={16} color="currentColor" />
                          {' '}{gameTypeLabel(archiveGameType(item))}
                        </span>
                      )}
                      <span><Icon name="Folder" weight="bold" size={16} color="currentColor" /> {item.Category}</span>
                      <span><Icon name="FileText" weight="bold" size={16} color="currentColor" /> {formatFileSize(item.FileSize)}</span>
                      <span><Icon name="CalendarBlank" weight="bold" size={16} color="currentColor" /> {formatDate(item.CreatedAt)}</span>
                    </div>

                    {item.Tags && item.Tags.length > 0 && (
                      <div className="item-tags">
                        {item.Tags.map((tag, index) => (
                          <span key={index} className="tag">{tag}</span>
                        ))}
                      </div>
                    )}

                    <div className="item-actions">
                      <button 
                        className="btn-primary"
                        onClick={() => {
                          if (selectedArchiveItems.has(item.ArchiveId)) {
                            const newSet = new Set(selectedArchiveItems);
                            newSet.delete(item.ArchiveId);
                            setSelectedArchiveItems(newSet);
                          } else {
                            const newSet = new Set(selectedArchiveItems);
                            newSet.add(item.ArchiveId);
                            setSelectedArchiveItems(newSet);
                          }
                        }}
                      >
                        {selectedArchiveItems.has(item.ArchiveId) ? 'Selected' : 'Select for Import'}
                      </button>
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