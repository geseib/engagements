import React, { useState, useEffect } from 'react';

const API_BASE = window.API_BASE;

function AdminPage() {
  const [questionSets, setQuestionSets] = useState([]);
  const [selectedFile, setSelectedFile] = useState(null);
  const [uploadStatus, setUploadStatus] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [deleteGameId, setDeleteGameId] = useState('');
  const [deleteStatus, setDeleteStatus] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteMode, setDeleteMode] = useState('single'); // 'single' or 'all'
  
  // Upload form fields
  const [customTitle, setCustomTitle] = useState('');
  const [customDescription, setCustomDescription] = useState('');
  const [customInstructions, setCustomInstructions] = useState('');
  const [aiContextInstructions, setAiContextInstructions] = useState('');
  const [showDefaultInstructions, setShowDefaultInstructions] = useState(false);
  
  // Question set deletion
  const [selectedQuestionSet, setSelectedQuestionSet] = useState('');
  const [questionSetDeleteStatus, setQuestionSetDeleteStatus] = useState('');
  const [isDeletingQuestionSet, setIsDeletingQuestionSet] = useState(false);
  const [showQuestionSetDeleteConfirm, setShowQuestionSetDeleteConfirm] = useState(false);

  // Debug mode
  const [debugMode, setDebugMode] = useState(() => {
    return localStorage.getItem('admin_debug_mode') === 'true';
  });

  // WebSocket mode
  const [webSocketMode, setWebSocketMode] = useState(() => {
    const setting = localStorage.getItem('admin_websocket_mode');
    return setting !== null ? setting === 'true' : true; // Default to true
  });
  
  // Edit mode
  const [editMode, setEditMode] = useState(false);
  const [editingSetId, setEditingSetId] = useState('');
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editInstructions, setEditInstructions] = useState('');
  const [editAiContextInstructions, setEditAiContextInstructions] = useState('');
  const [saveStatus, setSaveStatus] = useState('');

  const defaultInstructions = "How would you apply this concept in your current role or organization? Consider the specific challenges and opportunities in your context.";

  const handleEditQuestionSet = (questionSet) => {
    setEditMode(true);
    setEditingSetId(questionSet.id);
    setEditTitle(questionSet.name || '');
    setEditDescription(questionSet.description || '');
    setEditInstructions(questionSet.customInstruction || '');
    setEditAiContextInstructions(questionSet.aiContextInstruction || '');
    setSaveStatus('');
  };

  const handleCancelEdit = () => {
    setEditMode(false);
    setEditingSetId('');
    setEditTitle('');
    setEditDescription('');
    setEditInstructions('');
    setEditAiContextInstructions('');
    setSaveStatus('');
  };

  const handleSaveEdit = async () => {
    if (!editTitle.trim()) {
      setSaveStatus('❌ Title is required');
      return;
    }

    setSaveStatus('Saving...');
    try {
      const response = await fetch(`${API_BASE}admin/edit-question-set/${editingSetId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: editTitle.trim(),
          description: editDescription.trim() || null,
          customInstruction: editInstructions.trim() || null,
          aiContextInstruction: editAiContextInstructions.trim() || null
        })
      });

      const result = await response.json();

      if (response.ok) {
        setSaveStatus('✅ Question set updated successfully');
        setEditMode(false);
        setEditingSetId('');
        setEditTitle('');
        setEditDescription('');
        setEditInstructions('');
        setEditAiContextInstructions('');
        // Refresh the question sets list
        await fetchQuestionSets();
      } else {
        setSaveStatus(`❌ Save failed: ${result.error || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('Edit save error:', error);
      setSaveStatus(`❌ Save failed: ${error.message}`);
    }
  };

  const handleToggleDebugMode = () => {
    const newDebugMode = !debugMode;
    setDebugMode(newDebugMode);
    localStorage.setItem('admin_debug_mode', newDebugMode.toString());
    
    // Also set a global variable for other components to access
    window.DEBUG_MODE = newDebugMode;
    
    console.log(`🐛 DEBUG MODE ${newDebugMode ? 'ENABLED' : 'DISABLED'}`, { newDebugMode, localStorage: localStorage.getItem('admin_debug_mode'), windowDebugMode: window.DEBUG_MODE });
  };

  const handleToggleWebSocketMode = () => {
    const newWebSocketMode = !webSocketMode;
    setWebSocketMode(newWebSocketMode);
    localStorage.setItem('admin_websocket_mode', newWebSocketMode.toString());
    
    // Also set a global variable for other components to access
    window.WEBSOCKET_MODE = newWebSocketMode;
    
    console.log(`🔌 WEBSOCKET MODE ${newWebSocketMode ? 'ENABLED' : 'DISABLED'}`, { newWebSocketMode, localStorage: localStorage.getItem('admin_websocket_mode'), windowWebSocketMode: window.WEBSOCKET_MODE });
  };

  // Set initial global modes
  useEffect(() => {
    window.DEBUG_MODE = debugMode;
    window.WEBSOCKET_MODE = webSocketMode;
  }, [debugMode, webSocketMode]);

  const handleToggleActive = async (setId, currentActive) => {
    try {
      const newActive = !currentActive;
      const response = await fetch(`${API_BASE}admin/toggle-question-set/${setId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ active: newActive })
      });

      const result = await response.json();

      if (response.ok) {
        // Update the local state immediately for better UX
        setQuestionSets(prevSets => 
          prevSets.map(set => 
            set.id === setId ? { ...set, active: newActive } : set
          )
        );
        console.log(`Question set ${setId} ${newActive ? 'activated' : 'deactivated'}`);
      } else {
        console.error('Failed to toggle active status:', result.error);
        alert(`Failed to toggle active status: ${result.error}`);
      }
    } catch (error) {
      console.error('Toggle active error:', error);
      alert(`Failed to toggle active status: ${error.message}`);
    }
  };

  const handleDeleteQuestionSetFromList = (setId, setName) => {
    setSelectedQuestionSet(setId);
    setQuestionSetDeleteStatus('');
    setShowQuestionSetDeleteConfirm(true);
  };

  useEffect(() => {
    fetchQuestionSets();
  }, []);

  const fetchQuestionSets = async () => {
    try {
      // Use admin endpoint to get all question sets (including inactive)
      const res = await fetch(`${API_BASE}admin/question-sets`);
      const json = await res.json();
      setQuestionSets(json.sets || []);
    } catch (error) {
      console.error('Error fetching question sets:', error);
    }
  };

  const handleDownloadTemplate = async () => {
    try {
      setUploadStatus('Downloading template...');
      const response = await fetch(`${API_BASE}admin/download-template`);
      const result = await response.json();
      
      if (response.ok) {
        // Create and download the CSV file
        const blob = new Blob([result.content], { type: 'text/csv' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = result.filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
        setUploadStatus('✅ Template downloaded successfully');
      } else {
        setUploadStatus(`❌ Failed to download template: ${result.error}`);
      }
    } catch (error) {
      setUploadStatus(`❌ Failed to download template: ${error.message}`);
    }
  };

  const handleFileSelect = (event) => {
    const file = event.target.files[0];
    if (file && file.type === 'text/csv') {
      setSelectedFile(file);
      setUploadStatus('');
      
      // Auto-populate title from filename if not already set
      if (!customTitle) {
        setCustomTitle(file.name.replace(/\.csv$/i, ''));
      }
      
      // Read CSV content to auto-populate other fields
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const content = e.target.result;
          const lines = content.split('\n').filter(line => line.trim());
          
          if (lines.length >= 2) {
            // Parse header and first data row to extract info
            const headers = lines[0].split(',').map(h => h.replace(/"/g, '').trim());
            const firstRow = lines[1].split(',').map(v => v.replace(/"/g, '').trim());
            
            // Look for school/category info to auto-populate description
            const schoolIndex = headers.findIndex(h => h.toLowerCase().includes('school'));
            const categoryIndex = headers.findIndex(h => h.toLowerCase().includes('category'));
            
            let autoDescription = '';
            if (schoolIndex >= 0 && firstRow[schoolIndex]) {
              autoDescription = `Questions from ${firstRow[schoolIndex]}`;
            } else if (categoryIndex >= 0 && firstRow[categoryIndex]) {
              autoDescription = `${firstRow[categoryIndex]} questions and more`;
            } else {
              autoDescription = `Imported from ${file.name}`;
            }
            
            // Auto-populate description if not already set
            if (!customDescription) {
              setCustomDescription(autoDescription);
            }
            
            // Look for custom instruction column to auto-populate
            const customInstructionIndex = headers.findIndex(h => h.toLowerCase().includes('custominstruction'));
            if (customInstructionIndex >= 0 && firstRow[customInstructionIndex] && !customInstructions) {
              setCustomInstructions(firstRow[customInstructionIndex]);
            }
            
            setUploadStatus(`✅ File loaded: ${lines.length - 1} questions detected. Fields auto-populated from CSV.`);
          }
        } catch (error) {
          console.log('Could not auto-populate from CSV:', error);
          setUploadStatus('File selected. Please fill out the form fields.');
        }
      };
      reader.readAsText(file);
    } else {
      setUploadStatus('Please select a valid CSV file');
      setSelectedFile(null);
    }
  };

  const handleUploadQuestionSet = async () => {
    if (!selectedFile) {
      setUploadStatus('Please select a file first');
      return;
    }

    if (!customTitle.trim()) {
      setUploadStatus('Please enter a title for the question set');
      return;
    }

    setIsUploading(true);
    setUploadStatus('Reading file...');

    try {
      // Read the file content
      const fileContent = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target.result);
        reader.onerror = reject;
        reader.readAsText(selectedFile);
      });

      setUploadStatus('Processing question set...');

      // Send to Lambda for processing
      const response = await fetch(`${API_BASE}admin/upload-questions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          fileName: selectedFile.name,
          fileContent: fileContent,
          customTitle: customTitle.trim(),
          customDescription: customDescription.trim(),
          customInstructions: customInstructions.trim(),
          aiContextInstructions: aiContextInstructions.trim()
        })
      });

      const result = await response.json();

      if (response.ok) {
        setUploadStatus(`✅ ${result.message}`);
        fetchQuestionSets(); // Refresh the list
        setSelectedFile(null);
        setCustomTitle('');
        setCustomDescription('');
        setCustomInstructions('');
        // Reset file input
        const fileInput = document.getElementById('file-upload');
        if (fileInput) fileInput.value = '';
      } else {
        setUploadStatus(`❌ Upload failed: ${result.error || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('Upload error:', error);
      setUploadStatus(`❌ Upload failed: ${error.message}`);
    } finally {
      setIsUploading(false);
    }
  };

  const handleDeleteGames = async () => {
    if (deleteMode === 'single' && !deleteGameId.trim()) {
      setDeleteStatus('Please enter a game ID');
      return;
    }

    setShowDeleteConfirm(true);
  };

  const confirmDelete = async () => {
    setShowDeleteConfirm(false);
    setIsDeleting(true);
    setDeleteStatus('Processing...');

    try {
      const endpoint = deleteMode === 'all' 
        ? `${API_BASE}admin/clear-all-games`
        : `${API_BASE}admin/clear-game/${deleteGameId}`;
      
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        }
      });

      const result = await response.json();

      if (response.ok) {
        setDeleteStatus(
          deleteMode === 'all'
            ? `✅ Successfully cleared all games (${result.itemsDeleted || 0} items deleted)`
            : `✅ Successfully cleared game ${deleteGameId} (${result.itemsDeleted || 0} items deleted)`
        );
        setDeleteGameId('');
      } else {
        setDeleteStatus(`❌ Delete failed: ${result.error || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('Delete error:', error);
      setDeleteStatus(`❌ Delete failed: ${error.message}`);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleDeleteQuestionSet = () => {
    if (!selectedQuestionSet) {
      setQuestionSetDeleteStatus('Please select a question set to delete');
      return;
    }
    setShowQuestionSetDeleteConfirm(true);
  };

  const confirmDeleteQuestionSet = async () => {
    setShowQuestionSetDeleteConfirm(false);
    setIsDeletingQuestionSet(true);
    setQuestionSetDeleteStatus('Deleting...');

    try {
      // Extract setId from the selected question set value
      const setId = selectedQuestionSet;
      
      const response = await fetch(`${API_BASE}admin/delete-question-set/${setId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        }
      });

      const result = await response.json();

      if (response.ok) {
        setQuestionSetDeleteStatus(`✅ ${result.message}`);
        setSelectedQuestionSet('');
        fetchQuestionSets(); // Refresh the list
      } else {
        setQuestionSetDeleteStatus(`❌ Delete failed: ${result.error || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('Delete question set error:', error);
      setQuestionSetDeleteStatus(`❌ Delete failed: ${error.message}`);
    } finally {
      setIsDeletingQuestionSet(false);
    }
  };

  return (
    <div className="admin-container">
      <div className="game-host-container">
        <div className="parallax">
          <section className="parallax__header">
            <div className="parallax__visuals">
              <div className="parallax__black-line-overflow"></div>
              <div data-parallax-layers className="parallax__layers">
                <img src="https://cdn.prod.website-files.com/671752cd4027f01b1b8f1c7f/6717795be09b462b2e8ebf71_osmo-parallax-layer-3.webp" loading="eager" width="800" data-parallax-layer="1" alt="" className="parallax__layer-img" />
                <img src="https://cdn.prod.website-files.com/671752cd4027f01b1b8f1c7f/6717795b4d5ac529e7d3a562_osmo-parallax-layer-2.webp" loading="eager" width="800" data-parallax-layer="2" alt="" className="parallax__layer-img" />
                <div data-parallax-layer="3" className="parallax__layer-title">
                  <h2 className="parallax__title">Admin Dashboard</h2>
                </div>
                <img src="https://cdn.prod.website-files.com/671752cd4027f01b1b8f1c7f/6717795bb5aceca85011ad83_osmo-parallax-layer-1.webp" loading="eager" width="800" data-parallax-layer="4" alt="" className="parallax__layer-img" />
              </div>
              <div className="parallax__fade"></div>
            </div>
          </section>
        </div>

        <div className="admin-content">
          {/* CSV Template Download Section */}
          <div className="admin-section">
            <h2>📥 Download CSV Template</h2>
            <p className="section-description">Download a sample CSV template to understand the required format for question sets.</p>
            
            <div className="template-controls">
              <button
                className="btn-secondary"
                onClick={handleDownloadTemplate}
              >
                📄 Download Template CSV
              </button>
            </div>
          </div>

          {/* Upload Question Set Section */}
          <div className="admin-section">
            <h2>📤 Upload Question Set</h2>
            <p className="section-description">Upload a CSV file containing questions to create a new question set with custom title and instructions.</p>
            
            <div className="upload-form">
              <div className="form-row">
                <div className="form-group">
                  <label htmlFor="custom-title">Question Set Title *</label>
                  <input
                    type="text"
                    id="custom-title"
                    value={customTitle}
                    onChange={(e) => setCustomTitle(e.target.value)}
                    placeholder="Enter a descriptive title"
                    className="input-field"
                  />
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label htmlFor="custom-description">Description</label>
                  <input
                    type="text"
                    id="custom-description"
                    value={customDescription}
                    onChange={(e) => setCustomDescription(e.target.value)}
                    placeholder="Brief description of this question set"
                    className="input-field"
                  />
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label htmlFor="custom-instructions">
                    Custom Instructions 
                    <button 
                      type="button" 
                      className="btn-link"
                      onClick={() => setShowDefaultInstructions(!showDefaultInstructions)}
                    >
                      (show default)
                    </button>
                  </label>
                  {showDefaultInstructions && (
                    <div className="default-instructions">
                      <strong>Default instructions:</strong> {defaultInstructions}
                    </div>
                  )}
                  <textarea
                    id="custom-instructions"
                    value={customInstructions}
                    onChange={(e) => setCustomInstructions(e.target.value)}
                    placeholder={defaultInstructions}
                    className="input-field textarea-field"
                    rows="3"
                  />
                </div>
                
                <div className="form-group">
                  <label htmlFor="ai-context-instructions">AI Context Instructions</label>
                  <div className="help-text-container">
                    <small className="help-text">
                      Provide background context about your project, team, or meeting for AI analysis.
                      Examples: "Building a new application to support engineering learning" or 
                      "Supporting engineering teams through developer advocacy in the healthcare sector"
                    </small>
                  </div>
                  <textarea
                    id="ai-context-instructions"
                    value={aiContextInstructions}
                    onChange={(e) => setAiContextInstructions(e.target.value)}
                    placeholder="Describe your project, team context, industry, or specific goals to help AI provide more relevant analysis..."
                    className="input-field textarea-field"
                    rows="4"
                  />
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label htmlFor="file-upload">CSV File *</label>
                  <div className="file-input-wrapper">
                    <input
                      type="file"
                      id="file-upload"
                      accept=".csv"
                      onChange={handleFileSelect}
                      className="file-input"
                    />
                    <label htmlFor="file-upload" className="file-input-label">
                      {selectedFile ? selectedFile.name : 'Choose CSV file...'}
                    </label>
                  </div>
                </div>
              </div>
              
              <div className="form-row">
                <button
                  className="btn-primary btn-large"
                  onClick={handleUploadQuestionSet}
                  disabled={!selectedFile || !customTitle.trim() || isUploading}
                >
                  {isUploading ? '⏳ Uploading...' : '📤 Upload Question Set'}
                </button>
              </div>
            </div>
            
            {uploadStatus && (
              <div className={`status-message ${uploadStatus.includes('✅') ? 'success' : uploadStatus.includes('❌') ? 'error' : ''}`}>
                {uploadStatus}
              </div>
            )}
          </div>

          {/* Current Question Sets */}
          <div className="admin-section">
            <h2>📚 Current Question Sets</h2>
            <div className="question-sets-list">
              {questionSets.length === 0 ? (
                <div className="no-sets-message">
                  <p>No question sets found. Upload your first question set above to get started.</p>
                </div>
              ) : (
                questionSets.map(set => (
                  <div key={set.id} className="question-set-item">
                    <div className="set-info">
                      <h3>{set.name}</h3>
                      <p>{set.description}</p>
                      {set.customInstruction && (
                        <p className="custom-instructions">
                          <strong>Custom Instructions:</strong> {set.customInstruction}
                        </p>
                      )}
                      {set.createdAt && (
                        <p className="creation-date">
                          <small>Created: {new Date(set.createdAt).toLocaleDateString()}</small>
                        </p>
                      )}
                    </div>
                    <div className="set-stats">
                      <span className="stat-badge">{set.totalQuestions} questions</span>
                      <span className="stat-badge">{set.categoryCount} categories</span>
                      <button
                        className={`status-badge clickable ${set.active ? 'active' : 'inactive'}`}
                        onClick={() => handleToggleActive(set.id, set.active)}
                        title={`Click to ${set.active ? 'deactivate' : 'activate'} this question set`}
                      >
                        {set.active ? 'Active' : 'Inactive'}
                      </button>
                    </div>
                    <div className="set-actions">
                      <button
                        className="btn-secondary btn-small"
                        onClick={() => handleEditQuestionSet(set)}
                        title="Edit this question set"
                      >
                        ✏️ Edit
                      </button>
                      <button
                        className="btn-danger btn-small"
                        onClick={() => handleDeleteQuestionSetFromList(set.id, set.name)}
                        title="Delete this question set"
                      >
                        🗑️ Delete
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Edit Question Set Modal/Form */}
          {editMode && (
            <div className="admin-section edit-section">
              <h2>✏️ Edit Question Set</h2>
              <div className="edit-form">
                <div className="form-group">
                  <label htmlFor="edit-title">Title *</label>
                  <input
                    id="edit-title"
                    type="text"
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    placeholder="Question set title"
                    className="form-input"
                  />
                </div>
                
                <div className="form-group">
                  <label htmlFor="edit-description">Description</label>
                  <textarea
                    id="edit-description"
                    value={editDescription}
                    onChange={(e) => setEditDescription(e.target.value)}
                    placeholder="Brief description of this question set"
                    className="form-textarea"
                    rows="3"
                  />
                </div>
                
                <div className="form-group">
                  <label htmlFor="edit-instructions">Custom Instructions</label>
                  <textarea
                    id="edit-instructions"
                    value={editInstructions}
                    onChange={(e) => setEditInstructions(e.target.value)}
                    placeholder={`Custom instruction for players (optional). Default: "${defaultInstructions}"`}
                    className="form-textarea"
                    rows="4"
                  />
                  <small className="help-text">
                    This instruction will be shown to players and used by AI for analysis. 
                    Leave blank to use default instructions.
                  </small>
                </div>
                
                <div className="form-group">
                  <label htmlFor="edit-ai-context-instructions">AI Context Instructions</label>
                  <textarea
                    id="edit-ai-context-instructions"
                    value={editAiContextInstructions}
                    onChange={(e) => setEditAiContextInstructions(e.target.value)}
                    placeholder="Provide background context about your project, team, or meeting for AI analysis..."
                    className="form-textarea"
                    rows="4"
                  />
                  <small className="help-text">
                    This context helps AI provide more relevant analysis based on your specific project, industry, or goals.
                    Leave blank for general analysis.
                  </small>
                </div>
                
                <div className="form-actions">
                  <button
                    className="btn-primary"
                    onClick={handleSaveEdit}
                    disabled={saveStatus === 'Saving...'}
                  >
                    {saveStatus === 'Saving...' ? 'Saving...' : 'Save Changes'}
                  </button>
                  <button
                    className="btn-secondary"
                    onClick={handleCancelEdit}
                  >
                    Cancel
                  </button>
                </div>
                
                {saveStatus && (
                  <div className={`status-message ${saveStatus.includes('✅') ? 'success' : 'error'}`}>
                    {saveStatus}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Delete Question Set Section */}
          <div className="admin-section danger-section">
            <h2>🗑️ Delete Question Set</h2>
            <p className="section-description">Permanently delete a question set and all its questions.</p>
            
            <div className="delete-controls">
              <div className="form-group">
                <label htmlFor="question-set-select">Select Question Set to Delete</label>
                <select
                  id="question-set-select"
                  value={selectedQuestionSet}
                  onChange={(e) => setSelectedQuestionSet(e.target.value)}
                  className="input-field"
                >
                  <option value="">Choose a question set...</option>
                  {questionSets.map(set => (
                    <option key={set.id} value={set.id}>
                      {set.name} ({set.totalQuestions} questions)
                    </option>
                  ))}
                </select>
              </div>
              
              <button
                className="btn-danger"
                onClick={handleDeleteQuestionSet}
                disabled={!selectedQuestionSet || isDeletingQuestionSet}
              >
                {isDeletingQuestionSet ? '⏳ Deleting...' : '🗑️ Delete Question Set'}
              </button>
            </div>
            
            {questionSetDeleteStatus && (
              <div className={`status-message ${questionSetDeleteStatus.includes('✅') ? 'success' : questionSetDeleteStatus.includes('❌') ? 'error' : ''}`}>
                {questionSetDeleteStatus}
              </div>
            )}
          </div>

          {/* Delete Games Section */}
          <div className="admin-section danger-section">
            <h2>🎮 Remove Games</h2>
            <p className="section-description">Delete game data from the database.</p>
            
            <div className="delete-controls">
              <div className="delete-mode-selector">
                <label className="radio-label">
                  <input
                    type="radio"
                    name="deleteMode"
                    value="single"
                    checked={deleteMode === 'single'}
                    onChange={(e) => setDeleteMode(e.target.value)}
                  />
                  <span>Single Game</span>
                </label>
                <label className="radio-label">
                  <input
                    type="radio"
                    name="deleteMode"
                    value="all"
                    checked={deleteMode === 'all'}
                    onChange={(e) => setDeleteMode(e.target.value)}
                  />
                  <span>All Games</span>
                </label>
              </div>
              
              {deleteMode === 'single' && (
                <input
                  type="text"
                  placeholder="Enter Game ID"
                  value={deleteGameId}
                  onChange={(e) => setDeleteGameId(e.target.value)}
                  className="input-field"
                />
              )}
              
              <button
                className="btn-danger"
                onClick={handleDeleteGames}
                disabled={isDeleting}
              >
                {isDeleting ? '⏳ Deleting...' : deleteMode === 'all' ? '🗑️ Delete All Games' : '🗑️ Delete Game'}
              </button>
            </div>
            
            {deleteStatus && (
              <div className={`status-message ${deleteStatus.includes('✅') ? 'success' : deleteStatus.includes('❌') ? 'error' : ''}`}>
                {deleteStatus}
              </div>
            )}
          </div>
        </div>
        
        {/* WebSocket Mode Toggle - Moved to bottom */}
        <div className="admin-section debug-section">
          <h2>🔌 Real-time Communication</h2>
          <p className="section-description">Real-time WebSocket communication is now the default. Toggle off to use HTTP polling instead.</p>
          
          <div className="debug-controls">
            <label className="debug-toggle">
              <input
                type="checkbox"
                checked={webSocketMode}
                onChange={handleToggleWebSocketMode}
              />
              <span className="toggle-label">
                Enable WebSocket Mode (Real-time Updates)
                {webSocketMode && <span className="debug-active">ACTIVE</span>}
              </span>
            </label>
            <p className="debug-description">
              When enabled, the game uses WebSocket connections for real-time state updates. 
              When disabled, uses HTTP polling mode for compatibility with restrictive networks.
              {!webSocketMode && <strong> Currently using HTTP polling mode.</strong>}
            </p>
          </div>
        </div>

        {/* Debug Mode Toggle - Moved to bottom */}
        <div className="admin-section debug-section">
          <h2>🐛 Debug Settings</h2>
          <p className="section-description">Development and debugging tools for AI functionality.</p>
          
          <div className="debug-controls">
            <label className="debug-toggle">
              <input
                type="checkbox"
                checked={debugMode}
                onChange={handleToggleDebugMode}
              />
              <span className="toggle-label">
                Show AI Prompts in Debug Mode
                {debugMode && <span className="debug-active">ACTIVE</span>}
              </span>
            </label>
            <p className="debug-description">
              When enabled, the actual AI prompts sent to the model will be displayed above AI summary outputs in both the AI-ify dialog and results page.
            </p>
          </div>
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="modal-overlay" onClick={() => setShowDeleteConfirm(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h3>⚠️ Confirm Deletion</h3>
            <p>
              {deleteMode === 'all'
                ? 'Are you sure you want to delete ALL games? This action cannot be undone!'
                : `Are you sure you want to delete game ${deleteGameId}? This action cannot be undone!`}
            </p>
            <div className="modal-actions">
              <button className="btn-secondary" onClick={() => setShowDeleteConfirm(false)}>
                Cancel
              </button>
              <button className="btn-danger" onClick={confirmDelete}>
                Yes, Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Question Set Delete Confirmation Modal */}
      {showQuestionSetDeleteConfirm && (
        <div className="modal-overlay" onClick={() => setShowQuestionSetDeleteConfirm(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h3>⚠️ Confirm Question Set Deletion</h3>
            <p>
              Are you sure you want to delete the question set "<strong>{questionSets.find(set => set.id === selectedQuestionSet)?.name || selectedQuestionSet}</strong>"? 
            </p>
            <p>
              This will permanently remove all questions and categories in this set. This action cannot be undone!
            </p>
            <div className="modal-actions">
              <button className="btn-secondary" onClick={() => setShowQuestionSetDeleteConfirm(false)}>
                Cancel
              </button>
              <button className="btn-danger" onClick={confirmDeleteQuestionSet}>
                Yes, Delete Question Set
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default AdminPage;