import React, { useState, useEffect } from 'react';
import ContentList from './ContentList';
import ArchiveSelector from './ArchiveSelector';
import './ArchivePanel.css';

const API_BASE = window.API_BASE;

const ArchivePanel = ({ onClose }) => {
  const [activeArchive, setActiveArchive] = useState(null);
  const [archives, setArchives] = useState([]);
  const [localContent, setLocalContent] = useState({ questionSets: [], prompts: [] });
  const [archiveContent, setArchiveContent] = useState({ questionSets: [], prompts: [] });
  const [selectedLocal, setSelectedLocal] = useState(new Set());
  const [selectedArchive, setSelectedArchive] = useState(new Set());
  const [isLoading, setIsLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('question-sets');

  // Load initial data
  useEffect(() => {
    loadArchives();
    loadLocalContent();
  }, []);

  // Load archive content when active archive changes
  useEffect(() => {
    if (activeArchive) {
      loadArchiveContent(activeArchive.id);
    } else {
      setArchiveContent({ questionSets: [], prompts: [] });
    }
  }, [activeArchive]);

  const loadArchives = async () => {
    try {
      const response = await fetch(`${API_BASE}admin/get-archives`);
      if (response.ok) {
        const data = await response.json();
        setArchives(data.archives || []);
      }
    } catch (error) {
      console.error('Failed to load archives:', error);
    }
  };

  const loadLocalContent = async () => {
    setIsLoading(true);
    try {
      // Load question sets
      const questionSetsResponse = await fetch(`${API_BASE}admin/get-question-sets`);
      const questionSetsData = questionSetsResponse.ok ? await questionSetsResponse.json() : { questionSets: [] };

      // Load AI prompts
      const promptsResponse = await fetch(`${API_BASE}admin/get-ai-prompts`);
      const promptsData = promptsResponse.ok ? await promptsResponse.json() : { prompts: [] };

      setLocalContent({
        questionSets: questionSetsData.questionSets || [],
        prompts: promptsData.prompts || []
      });
    } catch (error) {
      console.error('Failed to load local content:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const loadArchiveContent = async (archiveId) => {
    setIsLoading(true);
    try {
      const response = await fetch(`${API_BASE}admin/get-archive-content?archiveId=${archiveId}`);
      if (response.ok) {
        const data = await response.json();
        setArchiveContent({
          questionSets: data.questionSets || [],
          prompts: data.prompts || []
        });
      }
    } catch (error) {
      console.error('Failed to load archive content:', error);
      setArchiveContent({ questionSets: [], prompts: [] });
    } finally {
      setIsLoading(false);
    }
  };

  const createArchive = async (name, description) => {
    try {
      const response = await fetch(`${API_BASE}admin/create-archive`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description })
      });

      if (response.ok) {
        const data = await response.json();
        await loadArchives();
        setActiveArchive(data.archive);
        return data.archive;
      } else {
        const error = await response.json();
        throw new Error(error.error || 'Failed to create archive');
      }
    } catch (error) {
      console.error('Failed to create archive:', error);
      alert(`Failed to create archive: ${error.message}`);
      return null;
    }
  };

  const archiveSelected = async () => {
    if (!activeArchive) {
      alert('Please select or create an archive first');
      return;
    }

    if (selectedLocal.size === 0) {
      alert('Please select items to archive');
      return;
    }

    const confirmation = confirm(
      `Archive ${selectedLocal.size} items to "${activeArchive.name}"?\n\n` +
      'This will move the selected items from your local system to the archive.'
    );

    if (!confirmation) return;

    setIsLoading(true);
    try {
      const itemsToArchive = [];
      
      // Collect selected question sets
      localContent.questionSets.forEach(set => {
        if (selectedLocal.has(`set_${set.id}`)) {
          itemsToArchive.push({ type: 'question-set', id: set.id, data: set });
        }
      });

      // Collect selected prompts
      localContent.prompts.forEach(prompt => {
        if (selectedLocal.has(`prompt_${prompt.id}`)) {
          itemsToArchive.push({ type: 'prompt', id: prompt.id, data: prompt });
        }
      });

      const response = await fetch(`${API_BASE}admin/archive-items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          archiveId: activeArchive.id,
          items: itemsToArchive
        })
      });

      if (response.ok) {
        const result = await response.json();
        alert(`Successfully archived ${result.archivedCount} items`);
        
        // Reload data
        await loadLocalContent();
        await loadArchiveContent(activeArchive.id);
        setSelectedLocal(new Set());
      } else {
        const error = await response.json();
        throw new Error(error.error || 'Failed to archive items');
      }
    } catch (error) {
      console.error('Failed to archive items:', error);
      alert(`Failed to archive items: ${error.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const downloadSelected = async () => {
    if (selectedArchive.size === 0) {
      alert('Please select items to download');
      return;
    }

    const confirmation = confirm(
      `Download ${selectedArchive.size} items from "${activeArchive.name}" to your local system?\n\n` +
      'This will copy the selected items from the archive to your local system.'
    );

    if (!confirmation) return;

    setIsLoading(true);
    try {
      const itemsToDownload = [];
      
      // Collect selected archived question sets
      archiveContent.questionSets.forEach(set => {
        if (selectedArchive.has(`archive_set_${set.archiveItemId}`)) {
          itemsToDownload.push({ type: 'question-set', archiveItemId: set.archiveItemId });
        }
      });

      // Collect selected archived prompts
      archiveContent.prompts.forEach(prompt => {
        if (selectedArchive.has(`archive_prompt_${prompt.archiveItemId}`)) {
          itemsToDownload.push({ type: 'prompt', archiveItemId: prompt.archiveItemId });
        }
      });

      const response = await fetch(`${API_BASE}admin/download-items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          archiveId: activeArchive.id,
          items: itemsToDownload
        })
      });

      if (response.ok) {
        const result = await response.json();
        alert(`Successfully downloaded ${result.downloadedCount} items`);
        
        // Reload local content
        await loadLocalContent();
        setSelectedArchive(new Set());
      } else {
        const error = await response.json();
        throw new Error(error.error || 'Failed to download items');
      }
    } catch (error) {
      console.error('Failed to download items:', error);
      alert(`Failed to download items: ${error.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const deleteFromArchive = async () => {
    if (selectedArchive.size === 0) {
      alert('Please select items to delete');
      return;
    }

    const confirmation = confirm(
      `Permanently delete ${selectedArchive.size} items from "${activeArchive.name}"?\n\n` +
      'This action cannot be undone.'
    );

    if (!confirmation) return;

    setIsLoading(true);
    try {
      const itemsToDelete = Array.from(selectedArchive).map(id => {
        if (id.startsWith('archive_set_')) {
          return { type: 'question-set', archiveItemId: id.replace('archive_set_', '') };
        } else if (id.startsWith('archive_prompt_')) {
          return { type: 'prompt', archiveItemId: id.replace('archive_prompt_', '') };
        }
      }).filter(Boolean);

      const response = await fetch(`${API_BASE}admin/delete-archive-items`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          archiveId: activeArchive.id,
          items: itemsToDelete
        })
      });

      if (response.ok) {
        const result = await response.json();
        alert(`Successfully deleted ${result.deletedCount} items`);
        
        // Reload archive content
        await loadArchiveContent(activeArchive.id);
        setSelectedArchive(new Set());
      } else {
        const error = await response.json();
        throw new Error(error.error || 'Failed to delete items');
      }
    } catch (error) {
      console.error('Failed to delete items:', error);
      alert(`Failed to delete items: ${error.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="archive-panel-modal">
      <div className="modal-overlay" onClick={onClose}></div>
      <div className="modal-content archive-panel" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>🗄️ Archive Management Panel</h2>
          <button className="close-button" onClick={onClose}>✕</button>
        </div>

        <div className="archive-controls">
          <ArchiveSelector
            archives={archives}
            activeArchive={activeArchive}
            onArchiveSelect={setActiveArchive}
            onCreateArchive={createArchive}
          />
          
          <div className="content-type-tabs">
            <button
              className={`tab-button ${activeTab === 'question-sets' ? 'active' : ''}`}
              onClick={() => setActiveTab('question-sets')}
            >
              📝 Question Sets
            </button>
            <button
              className={`tab-button ${activeTab === 'prompts' ? 'active' : ''}`}
              onClick={() => setActiveTab('prompts')}
            >
              🤖 AI Prompts
            </button>
          </div>
        </div>

        <div className="modal-body">
          <div className="archive-content-panels">
            {/* Local Content Panel */}
            <div className="content-panel local-panel">
              <div className="panel-header">
                <h3>💻 Local System</h3>
                <div className="selection-info">
                  {selectedLocal.size > 0 && (
                    <span className="selection-count">{selectedLocal.size} selected</span>
                  )}
                </div>
              </div>
              
              <ContentList
                type="local"
                contentType={activeTab}
                questionSets={localContent.questionSets}
                prompts={localContent.prompts}
                selectedItems={selectedLocal}
                onSelectionChange={setSelectedLocal}
                isLoading={isLoading}
              />
              
              <div className="panel-actions">
                <button
                  className="btn-primary"
                  onClick={archiveSelected}
                  disabled={selectedLocal.size === 0 || !activeArchive || isLoading}
                >
                  📤 Archive Selected ({selectedLocal.size})
                </button>
              </div>
            </div>

            {/* Transfer Controls */}
            <div className="transfer-controls">
              <div className="transfer-arrows">
                <button
                  className="transfer-button archive-btn"
                  onClick={archiveSelected}
                  disabled={selectedLocal.size === 0 || !activeArchive || isLoading}
                  title="Archive selected local items"
                >
                  📤
                </button>
                <button
                  className="transfer-button download-btn"
                  onClick={downloadSelected}
                  disabled={selectedArchive.size === 0 || !activeArchive || isLoading}
                  title="Download selected archive items"
                >
                  📥
                </button>
              </div>
              
              {activeArchive && (
                <div className="active-archive-info">
                  <div className="archive-name">{activeArchive.name}</div>
                  <div className="archive-stats">
                    {activeArchive.itemCount || 0} items
                  </div>
                </div>
              )}
            </div>

            {/* Archive Content Panel */}
            <div className="content-panel archive-panel-content">
              <div className="panel-header">
                <h3>🗄️ Archive {activeArchive ? `- ${activeArchive.name}` : '(Select Archive)'}</h3>
                <div className="selection-info">
                  {selectedArchive.size > 0 && (
                    <span className="selection-count">{selectedArchive.size} selected</span>
                  )}
                </div>
              </div>
              
              {activeArchive ? (
                <ContentList
                  type="archive"
                  contentType={activeTab}
                  questionSets={archiveContent.questionSets}
                  prompts={archiveContent.prompts}
                  selectedItems={selectedArchive}
                  onSelectionChange={setSelectedArchive}
                  isLoading={isLoading}
                />
              ) : (
                <div className="no-archive-selected">
                  <p>Select an archive above to view its contents</p>
                </div>
              )}
              
              <div className="panel-actions">
                <button
                  className="btn-primary"
                  onClick={downloadSelected}
                  disabled={selectedArchive.size === 0 || !activeArchive || isLoading}
                >
                  📥 Download Selected ({selectedArchive.size})
                </button>
                <button
                  className="btn-danger"
                  onClick={deleteFromArchive}
                  disabled={selectedArchive.size === 0 || !activeArchive || isLoading}
                >
                  🗑️ Delete Selected
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="modal-footer">
          <div className="footer-info">
            <span>Local: {localContent.questionSets.length + localContent.prompts.length} items</span>
            {activeArchive && (
              <span>Archive: {archiveContent.questionSets.length + archiveContent.prompts.length} items</span>
            )}
          </div>
          <button className="btn-secondary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default ArchivePanel;