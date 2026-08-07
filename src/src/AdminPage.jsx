import React, { useState, useEffect } from 'react';
import AIScenarioBuilder from './components/AIScenarioBuilder';
import TriviaAIBuilder from './components/TriviaAIBuilder';
import PollAIBuilder from './components/PollAIBuilder';
import SurveyAIBuilder from './components/SurveyAIBuilder';
import AIPromptManager from './components/AIPromptManager';
import AIGenerationPromptEditor from './components/AIGenerationPromptEditor';
import ArchivePanel from './components/ArchivePanel';
import UserManagement from './components/UserManagement';
import HelpButton from './components/HelpButton';
import IssueFab from './components/IssueFab';
import { useAuth } from './auth/AuthContext';
import './BuilderPage.css';
import { authFetch } from './auth/authFetch';
import Icon from './components/Icon';
import StatusMessage from './components/StatusMessage';

const API_BASE = window.API_BASE;

function AdminPage() {
  console.log('🔧 AdminPage component loading with AI builders...');

  const { currentUser, signOut } = useAuth();
  const [questionSets, setQuestionSets] = useState([]);
  const [selectedFile, setSelectedFile] = useState(null);
  const [uploadStatus, setUploadStatus] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [deleteGameId, setDeleteGameId] = useState('');
  const [deleteStatus, setDeleteStatus] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteMode, setDeleteMode] = useState('single'); // 'single' or 'all'
  
  // Question Set filtering states
  const [filteredQuestionSets, setFilteredQuestionSets] = useState([]);
  const [questionSetSearchQuery, setQuestionSetSearchQuery] = useState('');
  const [selectedQuestionSetType, setSelectedQuestionSetType] = useState('all');
  const [selectedQuestionSetStatus, setSelectedQuestionSetStatus] = useState('all');
  const [questionSetSortBy, setQuestionSetSortBy] = useState('newest');
  
  // Upload form fields
  const [customTitle, setCustomTitle] = useState('');
  const [customDescription, setCustomDescription] = useState('');
  const [customInstructions, setCustomInstructions] = useState('');
  const [aiContextInstructions, setAiContextInstructions] = useState('');
  const [selectedPromptId, setSelectedPromptId] = useState(''); // AI prompt selection for upload
  const [showDefaultInstructions, setShowDefaultInstructions] = useState(false);
  const [engagementType, setEngagementType] = useState('call-and-answer'); // 'call-and-answer', 'trivia', 'poll', or 'wavelength'
  
  // Question set deletion
  const [selectedQuestionSet, setSelectedQuestionSet] = useState('');
  const [questionSetDeleteStatus, setQuestionSetDeleteStatus] = useState('');
  const [isDeletingQuestionSet, setIsDeletingQuestionSet] = useState(false);
  const [showQuestionSetDeleteConfirm, setShowQuestionSetDeleteConfirm] = useState(false);

  // Debug mode
  const [debugMode, setDebugMode] = useState(() => {
    return localStorage.getItem('admin_debug_mode') === 'true';
  });

  // Prompt improvement debug mode
  const [promptDebugMode, setPromptDebugMode] = useState(() => {
    return localStorage.getItem('prompt_debug_mode') === 'true';
  });

  // WebSocket mode
  const [webSocketMode, setWebSocketMode] = useState(() => {
    const setting = localStorage.getItem('admin_websocket_mode');
    return setting !== null ? setting === 'true' : true; // Default to true
  });
  
  // Edit mode
  const [editMode, setEditMode] = useState(false);
  
  // Tab management
  const [activeTab, setActiveTab] = useState('prompts');
  const [editingSetId, setEditingSetId] = useState('');
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editInstructions, setEditInstructions] = useState('');
  const [editAiContextInstructions, setEditAiContextInstructions] = useState('');
  const [editEngagementType, setEditEngagementType] = useState('call-and-answer');
  const [editPromptId, setEditPromptId] = useState('');
  const [saveStatus, setSaveStatus] = useState('');
  // Success/failure is explicit state. It used to be inferred by sniffing the
  // status string for a ✅, which silently broke the moment the copy changed.
  const [saveOk, setSaveOk] = useState(null); // true | false | null (in progress)

  // Available prompts for selection
  const [availablePrompts, setAvailablePrompts] = useState([]);

  // AI Scenario Builder
  const [showAIScenarioBuilder, setShowAIScenarioBuilder] = useState(false);

  // AI Trivia Builder
  const [showTriviaAIBuilder, setShowTriviaAIBuilder] = useState(false);

  // AI Poll Builder
  const [showPollAIBuilder, setShowPollAIBuilder] = useState(false);

  // AI Survey Builder
  const [showSurveyAIBuilder, setShowSurveyAIBuilder] = useState(false);

  // Upload section expand/collapse
  const [isUploadSectionExpanded, setIsUploadSectionExpanded] = useState(false);

  // AI Generation Prompt Editor
  const [showGenerationPromptEditor, setShowGenerationPromptEditor] = useState(false);
  
  // AI Analysis Prompts (Workie) - toggle for showing existing AIPromptManager
  const [showAnalysisPrompts, setShowAnalysisPrompts] = useState(false);

  const defaultInstructions = "How would you apply this concept in your current role or organization? Consider the specific challenges and opportunities in your context.";

  // Sign-out handler
  const handleSignOut = () => {
    if (window.confirm('Are you sure you want to sign out?')) {
      signOut();
      window.location.href = '/auth';
    }
  };

  // Fetch available AI prompts for selection
  const fetchAvailablePrompts = async () => {
    try {
      const response = await authFetch(`${API_BASE}admin/ai-prompts`);
      if (response.ok) {
        const data = await response.json();
        // Filter to only active prompts for the dropdown
        const activePrompts = (data.prompts || []).filter(prompt => prompt.status === 'active');
        setAvailablePrompts(activePrompts);
      }
    } catch (error) {
      console.error('Error fetching available prompts:', error);
    }
  };

  // Load prompts when component mounts
  useEffect(() => {
    fetchAvailablePrompts();
  }, []);

  const handleEditQuestionSet = (questionSet) => {
    setEditMode(true);
    setEditingSetId(questionSet.id);
    setEditTitle(questionSet.name || '');
    setEditDescription(questionSet.description || '');
    setEditInstructions(questionSet.customInstruction || '');
    setEditAiContextInstructions(questionSet.aiContextInstruction || '');
    setEditEngagementType(questionSet.engagementType || 'call-and-answer');
    setEditPromptId(questionSet.promptId || '');
    setSaveStatus('');
    
    // Switch to question sets tab and scroll to edit section
    setActiveTab('questionsets');
    setTimeout(() => {
      const editSection = document.querySelector('.edit-section');
      if (editSection) {
        editSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
        editSection.style.background = '#fff3cd';
        editSection.style.border = '2px solid #ffc107';
        setTimeout(() => {
          editSection.style.background = '';
          editSection.style.border = '';
        }, 3000);
      }
    }, 100);
  };

  const handleCancelEdit = () => {
    setEditMode(false);
    setEditingSetId('');
    setEditTitle('');
    setEditDescription('');
    setEditInstructions('');
    setEditAiContextInstructions('');
    setEditEngagementType('call-and-answer');
    setEditPromptId('');
    setSaveStatus('');
  };

  const handleSaveEdit = async () => {
    if (!editTitle.trim()) {
      setSaveOk(false);
      setSaveStatus('Title is required');
      return;
    }

    setSaveOk(null);
    setSaveStatus('Saving...');
    try {
      const response = await authFetch(`${API_BASE}admin/edit-question-set/${editingSetId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: editTitle.trim(),
          description: editDescription.trim() || null,
          customInstruction: editInstructions.trim() || null,
          aiContextInstruction: editAiContextInstructions.trim() || null,
          promptId: editPromptId.trim() || null
        })
      });

      const result = await response.json();

      if (response.ok) {
        setSaveOk(true);
        setSaveStatus('Question set updated successfully');
        setEditMode(false);
        setEditingSetId('');
        setEditTitle('');
        setEditDescription('');
        setEditInstructions('');
        setEditAiContextInstructions('');
        setEditPromptId('');
        // Refresh the question sets list
        await fetchQuestionSets();
      } else {
        setSaveOk(false);
        setSaveStatus(`Save failed: ${result.error || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('Edit save error:', error);
      setSaveOk(false);
      setSaveStatus(`Save failed: ${error.message}`);
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

  const handleTogglePromptDebugMode = () => {
    const newPromptDebugMode = !promptDebugMode;
    setPromptDebugMode(newPromptDebugMode);
    localStorage.setItem('prompt_debug_mode', newPromptDebugMode.toString());
    
    // Also set a global variable for other components to access
    window.PROMPT_DEBUG_MODE = newPromptDebugMode;
    
    console.log(`🔍 PROMPT DEBUG MODE ${newPromptDebugMode ? 'ENABLED' : 'DISABLED'}`, { newPromptDebugMode, localStorage: localStorage.getItem('prompt_debug_mode'), windowPromptDebugMode: window.PROMPT_DEBUG_MODE });
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
    window.PROMPT_DEBUG_MODE = promptDebugMode;
    window.WEBSOCKET_MODE = webSocketMode;
  }, [debugMode, promptDebugMode, webSocketMode]);

  const handleToggleActive = async (setId, currentActive) => {
    try {
      const newActive = !currentActive;
      const response = await authFetch(`${API_BASE}admin/toggle-question-set/${setId}`, {
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

  const handleToggleQuickstart = async (setId, quickstartEnabled) => {
    try {
      const response = await authFetch(`${API_BASE}admin/toggle-quickstart/${setId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ quickstart: quickstartEnabled })
      });

      const result = await response.json();

      if (response.ok) {
        // Update the local state immediately for better UX
        setQuestionSets(prevSets => 
          prevSets.map(set => 
            set.id === setId ? { ...set, quickstart: quickstartEnabled } : set
          )
        );
        console.log(`Question set ${setId} quickstart ${quickstartEnabled ? 'enabled' : 'disabled'}`);
      } else {
        console.error('Failed to toggle quickstart status:', result.error);
        alert(`Failed to toggle quickstart status: ${result.error}`);
      }
    } catch (error) {
      console.error('Toggle quickstart error:', error);
      alert(`Failed to toggle quickstart status: ${error.message}`);
    }
  };

  const handleDeleteQuestionSetFromList = (setId, setName) => {
    console.log('🗑️ Delete button clicked for:', setId, setName);
    setSelectedQuestionSet(setId);
    setQuestionSetDeleteStatus('');
    setShowQuestionSetDeleteConfirm(true);
    console.log('🗑️ Should show confirmation modal now');
  };

  useEffect(() => {
    fetchQuestionSets();
  }, []);
  
  // Filter question sets when filters change
  useEffect(() => {
    filterQuestionSets();
  }, [questionSets, questionSetSearchQuery, selectedQuestionSetType, selectedQuestionSetStatus, questionSetSortBy]);

  const fetchQuestionSets = async () => {
    try {
      // Use admin endpoint to get all question sets (including inactive)
      const res = await authFetch(`${API_BASE}admin/question-sets`);
      const json = await res.json();
      setQuestionSets(json.questionSets || []);
    } catch (error) {
      console.error('Error fetching question sets:', error);
    }
  };
  
  const filterQuestionSets = () => {
    let filtered = [...questionSets];
    
    // Apply search filter
    if (questionSetSearchQuery) {
      const query = questionSetSearchQuery.toLowerCase();
      filtered = filtered.filter(set => 
        set.name?.toLowerCase().includes(query) ||
        set.description?.toLowerCase().includes(query) ||
        set.customInstruction?.toLowerCase().includes(query)
      );
    }
    
    // Apply type filter
    if (selectedQuestionSetType !== 'all') {
      filtered = filtered.filter(set => {
        const setType = set.engagementType || 'call-and-answer';
        return setType === selectedQuestionSetType;
      });
    }
    
    // Apply status filter
    if (selectedQuestionSetStatus !== 'all') {
      const isActive = selectedQuestionSetStatus === 'active';
      filtered = filtered.filter(set => set.active === isActive);
    }
    
    // Apply sorting
    filtered.sort((a, b) => {
      switch (questionSetSortBy) {
        case 'newest':
          return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
        case 'oldest':
          return new Date(a.createdAt || 0) - new Date(b.createdAt || 0);
        case 'name':
          return (a.name || '').localeCompare(b.name || '');
        case 'questions':
          return (b.totalQuestions || 0) - (a.totalQuestions || 0);
        default:
          return 0;
      }
    });
    
    setFilteredQuestionSets(filtered);
  };

  const handleDownloadTemplate = async (templateType = 'call-and-answer') => {
    try {
      setUploadStatus('Downloading template...');
      const response = await authFetch(`${API_BASE}admin/download-template?type=${templateType}`);
      const result = await response.json();

      if (response.ok) {
        // Create and download the file with appropriate MIME type
        const mimeType = result.filename.endsWith('.json') ? 'application/json' : 'text/csv';
        const blob = new Blob([result.content], { type: mimeType });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = result.filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
        setUploadStatus(`${result.filename} downloaded successfully`);
      } else {
        setUploadStatus(`Failed to download template: ${result.error}`);
      }
    } catch (error) {
      setUploadStatus(`Failed to download template: ${error.message}`);
    }
  };

  const handleFileSelect = (event) => {
    const file = event.target.files[0];
    const isCsvFile = file && /\.csv$/i.test(file.name);
    const isJsonFile = file && /\.json$/i.test(file.name);
    if (isCsvFile || (isJsonFile && engagementType === 'survey')) {
      setSelectedFile(file);
      setUploadStatus('');

      // Auto-populate title from filename if not already set
      if (!customTitle) {
        setCustomTitle(file.name.replace(/\.(csv|json)$/i, ''));
      }

      // JSON survey files: no CSV auto-populate, just confirm selection
      if (isJsonFile) {
        if (!customDescription) {
          setCustomDescription(`Imported from ${file.name}`);
        }
        setUploadStatus(`File loaded: ${file.name}. Note: survey JSON upload is not yet supported by the server.`);
        return;
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
            
            setUploadStatus(`File loaded: ${lines.length - 1} questions detected. Fields auto-populated from CSV.`);
          }
        } catch (error) {
          console.log('Could not auto-populate from CSV:', error);
          setUploadStatus('File selected. Please fill out the form fields.');
        }
      };
      reader.readAsText(file);
    } else {
      setUploadStatus(engagementType === 'survey'
        ? 'Please select a valid CSV or JSON file'
        : 'Please select a valid CSV file');
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
      const response = await authFetch(`${API_BASE}admin/upload-questions`, {
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
          aiContextInstructions: aiContextInstructions.trim(),
          promptId: selectedPromptId.trim(),
          engagementType: engagementType
        })
      });

      const result = await response.json();

      if (response.ok) {
        setUploadStatus(`${result.message}`);
        fetchQuestionSets(); // Refresh the list
        setSelectedFile(null);
        setCustomTitle('');
        setCustomDescription('');
        setCustomInstructions('');
        setAiContextInstructions('');
        setSelectedPromptId('');
        // Reset file input
        const fileInput = document.getElementById('file-upload');
        if (fileInput) fileInput.value = '';
      } else {
        setUploadStatus(`Upload failed: ${result.error || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('Upload error:', error);
      setUploadStatus(`Upload failed: ${error.message}`);
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

  // Handle AI-generated scenarios
  const handleScenariosGenerated = async (scenarioData) => {
    setShowAIScenarioBuilder(false);

    // scenarioData now includes both scenarios and metadata
    const { scenarios, metadata } = scenarioData;

    // Convert scenarios to CSV format and upload
    const csvContent = generateScenariosCSV(scenarios);
    const timestamp = Date.now();

    try {
      setUploadStatus('Processing AI-generated scenarios...');

      const response = await authFetch(`${API_BASE}admin/upload-questions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          fileName: `${metadata.title.replace(/[^a-zA-Z0-9]/g, '_')}-${timestamp}.csv`,
          fileContent: csvContent,
          customTitle: metadata.title,
          customDescription: metadata.description,
          customInstructions: metadata.customInstructions,
          aiContextInstructions: metadata.aiContextInstructions,
          engagementType: engagementType,
          isAIGenerated: true
        })
      });

      const result = await response.json();

      if (response.ok) {
        setUploadStatus(`${result.message} - Question set created successfully! You can edit it in the Question Sets list below.`);
        await fetchQuestionSets(); // Refresh the list
      } else {
        setUploadStatus(`Upload failed: ${result.error || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('Upload error:', error);
      setUploadStatus(`Upload failed: ${error.message}`);
    }
  };

  const generateScenariosCSV = (scenarios) => {
    const headers = 'Category,Question#,Title,Detail_lesson,School,CustomInstruction';
    
    // First, group scenarios by category
    const scenariosByCategory = {};
    scenarios.forEach(scenario => {
      const category = scenario.category || 'AI Generated';
      if (!scenariosByCategory[category]) {
        scenariosByCategory[category] = [];
      }
      scenariosByCategory[category].push(scenario);
    });
    
    // Generate CSV rows with proper category-relative numbering
    const rows = [];
    Object.keys(scenariosByCategory).forEach(category => {
      scenariosByCategory[category].forEach((scenario, index) => {
        const questionNumber = index + 1; // Category-relative numbering (1, 2, 3 for each category)
        rows.push(`"${category}","${questionNumber}","${scenario.title}","${scenario.detail}","${scenario.school || 'Professional Development'}","${scenario.customInstructions || ''}"`);
      });
    });
    
    return headers + '\n' + rows.join('\n');
  };

  // Handle AI-generated trivia
  const handleTriviaGenerated = async (triviaData) => {
    setShowTriviaAIBuilder(false);

    // triviaData includes both questions and metadata
    const { questions, metadata } = triviaData;

    // Convert trivia to CSV format and upload
    const csvContent = generateTriviaCSV(questions);
    const timestamp = Date.now();

    try {
      setUploadStatus('Processing AI-generated trivia questions...');

      const response = await authFetch(`${API_BASE}admin/upload-questions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          fileName: `${metadata.title.replace(/[^a-zA-Z0-9]/g, '_')}-${timestamp}.csv`,
          fileContent: csvContent,
          customTitle: metadata.title,
          customDescription: metadata.description,
          customInstructions: metadata.customInstructions,
          aiContextInstructions: metadata.aiContextInstructions,
          engagementType: 'trivia',
          isAIGenerated: true
        })
      });

      const result = await response.json();

      if (response.ok) {
        setUploadStatus(`${result.message} - Trivia question set created successfully! You can edit it in the Question Sets list below.`);
        await fetchQuestionSets(); // Refresh the list
      } else {
        setUploadStatus(`Upload failed: ${result.error || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('Upload error:', error);
      setUploadStatus(`Upload failed: ${error.message}`);
    }
  };

  const generateTriviaCSV = (questions) => {
    // Use the new CSV format that matches upload-questions.js expectations
    const headers = 'Category,Question#,Title,QuestionDetail,AnswerDetails,School,OptionA,OptionB,OptionC,OptionD,OptionE,OptionF,CorrectAnswer,Difficulty';
    
    // First, group questions by category
    const questionsByCategory = {};
    questions.forEach(trivia => {
      const category = trivia.category || 'General';
      if (!questionsByCategory[category]) {
        questionsByCategory[category] = [];
      }
      questionsByCategory[category].push(trivia);
    });
    
    // Generate CSV rows with proper category-relative numbering
    const rows = [];
    Object.keys(questionsByCategory).forEach(category => {
      questionsByCategory[category].forEach((trivia, index) => {
        const questionNumber = index + 1; // Category-relative numbering (1, 2, 3 for each category)
        
        // Get the correct answer - keep as OptionA format for backend processing
        const correctAnswer = Array.isArray(trivia.correctAnswer) ? trivia.correctAnswer.join(',') : trivia.correctAnswer;
        
        // Build the row with new format that matches what upload-questions.js expects
        rows.push(`"${category}","${questionNumber}","${trivia.title}","${trivia.questionDetail || trivia.detail || ''}","${trivia.answerDetails || ''}","${trivia.school || 'General'}","${trivia.optionA || ''}","${trivia.optionB || ''}","${trivia.optionC || ''}","${trivia.optionD || ''}","${trivia.optionE || ''}","${trivia.optionF || ''}","${correctAnswer}","${trivia.difficulty}"`);
      });
    });
    
    return headers + '\n' + rows.join('\n');
  };

  // Handle AI-generated polls
  const handlePollGenerated = async (pollData) => {
    setShowPollAIBuilder(false);

    // pollData includes both questions and metadata
    const { questions, metadata } = pollData;

    // Convert polls to CSV format and upload
    const csvContent = generatePollCSV(questions);
    const timestamp = Date.now();

    try {
      setUploadStatus('Processing AI-generated poll questions...');

      const response = await authFetch(`${API_BASE}admin/upload-questions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          fileName: `${metadata.title.replace(/[^a-zA-Z0-9]/g, '_')}-${timestamp}.csv`,
          fileContent: csvContent,
          customTitle: metadata.title,
          customDescription: metadata.description,
          customInstructions: metadata.customInstructions,
          aiContextInstructions: metadata.aiContextInstructions,
          engagementType: 'poll',
          isAIGenerated: true
        })
      });

      const result = await response.json();

      if (response.ok) {
        setUploadStatus(`${result.message} - Poll question set created successfully! You can edit it in the Question Sets list below.`);
        await fetchQuestionSets(); // Refresh the list
      } else {
        setUploadStatus(`Upload failed: ${result.error || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('Upload error:', error);
      setUploadStatus(`Upload failed: ${error.message}`);
    }
  };

  const generatePollCSV = (questions) => {
    const headers = 'Category,Question#,Title,Detail_lesson,School,CustomInstruction,Option1,Option2,Option3,Option4,Option5,AllowMultiple';
    
    // First, group questions by category
    const questionsByCategory = {};
    questions.forEach(poll => {
      const category = poll.category || 'General';
      if (!questionsByCategory[category]) {
        questionsByCategory[category] = [];
      }
      questionsByCategory[category].push(poll);
    });
    
    // Generate CSV rows with proper category-relative numbering
    const rows = [];
    Object.keys(questionsByCategory).forEach(category => {
      questionsByCategory[category].forEach((poll, index) => {
        const questionNumber = index + 1; // Category-relative numbering (1, 2, 3 for each category)
        
        const options = [...poll.options];
        while (options.length < 5) {
          options.push('');
        }

        rows.push(`"${category}","${questionNumber}","${poll.title}","${poll.detail || ''}","${poll.school || 'General'}","${poll.customInstructions || ''}","${options[0]}","${options[1]}","${options[2]}","${options[3]}","${options[4]}","${poll.allowMultiple ? 'true' : 'false'}"`);
      });
    });
    
    return headers + '\n' + rows.join('\n');
  };

  // Handle AI-generated surveys
  const handleSurveyGenerated = async (surveyData) => {
    setShowSurveyAIBuilder(false);

    // surveyData includes survey and metadata
    const { survey, metadata } = surveyData;

    // Export survey as JSON file
    const jsonContent = JSON.stringify(survey, null, 2);
    const timestamp = Date.now();
    const fileName = `survey-${survey.title.replace(/[^a-zA-Z0-9]/g, '_')}-${timestamp}.json`;

    try {
      setUploadStatus('Processing AI-generated survey...');

      // Create download link for JSON
      const blob = new Blob([jsonContent], { type: 'application/json' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);

      setUploadStatus(`Survey "${survey.title}" exported as JSON file with ${survey.questions.length} questions`);

    } catch (error) {
      console.error('Survey export error:', error);
      setUploadStatus(`Survey export failed: ${error.message}`);
    }
  };


  const confirmDelete = async () => {
    setShowDeleteConfirm(false);
    setIsDeleting(true);
    setDeleteStatus('Processing...');

    try {
      const endpoint = deleteMode === 'all' 
        ? `${API_BASE}admin/clear-all-games`
        : `${API_BASE}admin/clear-game/${deleteGameId}`;
      
      const response = await authFetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        }
      });

      const result = await response.json();

      if (response.ok) {
        setDeleteStatus(
          deleteMode === 'all'
            ? `Successfully cleared all games (${result.itemsDeleted || 0} items deleted)`
            : `Successfully cleared game ${deleteGameId} (${result.itemsDeleted || 0} items deleted)`
        );
        setDeleteGameId('');
      } else {
        setDeleteStatus(`Delete failed: ${result.error || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('Delete error:', error);
      setDeleteStatus(`Delete failed: ${error.message}`);
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
      
      const response = await authFetch(`${API_BASE}admin/question-sets/${setId}`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
        }
      });

      const result = await response.json();

      if (response.ok) {
        setQuestionSetDeleteStatus(`${result.message}`);
        setSelectedQuestionSet('');
        fetchQuestionSets(); // Refresh the list
      } else {
        setQuestionSetDeleteStatus(`Delete failed: ${result.error || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('Delete question set error:', error);
      setQuestionSetDeleteStatus(`Delete failed: ${error.message}`);
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
                  <div className="admin-title-row">
                    <div className="admin-title-left">
                      <h2 className="parallax__title">Admin Dashboard</h2>
                      <HelpButton section="admin" variant="header" size="medium" />
                    </div>
                    
                    {/* User Info and Sign Out */}
                    {currentUser && (
                      <div className="admin-user-info" style={{
                        position: 'absolute',
                        top: '10px',
                        right: '20px',
                        color: 'white',
                        fontSize: '14px',
                        textAlign: 'right',
                        background: 'rgba(0,0,0,0.3)',
                        padding: '8px 12px',
                        borderRadius: '6px',
                        backdropFilter: 'blur(4px)'
                      }}>
                        <div style={{ marginBottom: '4px' }}>
                          <strong>{currentUser.attributes?.name || 'User'}</strong>
                        </div>
                        {currentUser.groups?.includes('admins') && (
                          <div style={{ color: '#ffd700', fontWeight: '500', fontSize: '12px', marginBottom: '6px' }}>
                            Administrator
                          </div>
                        )}
                        <button 
                          onClick={handleSignOut}
                          style={{
                            padding: '4px 8px',
                            backgroundColor: 'rgba(255,255,255,0.2)',
                            border: '1px solid rgba(255,255,255,0.3)',
                            borderRadius: '4px',
                            color: 'white',
                            fontSize: '12px',
                            cursor: 'pointer',
                            transition: 'background-color 0.2s'
                          }}
                          onMouseOver={(e) => e.target.style.backgroundColor = 'rgba(255,255,255,0.3)'}
                          onMouseOut={(e) => e.target.style.backgroundColor = 'rgba(255,255,255,0.2)'}
                        >
                          Sign Out
                        </button>
                      </div>
                    )}
                  </div>
                </div>
                <img src="https://cdn.prod.website-files.com/671752cd4027f01b1b8f1c7f/6717795bb5aceca85011ad83_osmo-parallax-layer-1.webp" loading="eager" width="800" data-parallax-layer="4" alt="" className="parallax__layer-img" />
              </div>
              <div className="parallax__fade"></div>
            </div>
          </section>
        </div>

        <div className="admin-content">
          {/* Tab Navigation */}
          <div className="admin-tabs">
            <div className="tab-nav">
              <button 
                className={`tab-btn ${activeTab === 'prompts' ? 'active' : ''}`}
                onClick={() => setActiveTab('prompts')}
              >
                <Icon name="Sparkle" weight="duotone" size={16} color="var(--primary)" /> AI Prompts
              </button>
              <button 
                className={`tab-btn ${activeTab === 'questionsets' ? 'active' : ''}`}
                onClick={() => setActiveTab('questionsets')}
              >
                <Icon name="Books" weight="duotone" size={16} color="var(--primary)" /> Question Sets
              </button>
              <button 
                className={`tab-btn ${activeTab === 'games' ? 'active' : ''}`}
                onClick={() => setActiveTab('games')}
              >
                <Icon name="GameController" weight="bold" size={16} color="currentColor" /> Game Management
              </button>
              <button 
                className={`tab-btn ${activeTab === 'archive' ? 'active' : ''}`}
                onClick={() => setActiveTab('archive')}
              >
                <Icon name="Package" weight="bold" size={16} color="currentColor" /> Archive
              </button>
              <button 
                className={`tab-btn ${activeTab === 'users' ? 'active' : ''}`}
                onClick={() => setActiveTab('users')}
              >
                <Icon name="UsersThree" weight="bold" size={16} color="currentColor" /> Users
              </button>
              <button 
                className={`tab-btn ${activeTab === 'settings' ? 'active' : ''}`}
                onClick={() => setActiveTab('settings')}
              >
                <Icon name="Gear" weight="bold" size={16} color="currentColor" /> Settings
              </button>
            </div>
          </div>

          {/* Tab Content */}
          {activeTab === 'prompts' && (
            <div className="tab-content">
              {/* AI Prompt Management Section */}
              <div className="admin-section">
                <h2><Icon name="Sparkle" weight="duotone" size={16} color="var(--primary)" /> AI Prompt Management</h2>
                
                {/* Two distinct sections for different prompt types */}
                <div className="prompt-type-sections">
                  {/* Question Set Generator Prompts */}
                  <div className="prompt-section generation-prompts">
                    <div className="section-header">
                      <h3><Icon name="NotePencil" weight="bold" size={16} color="currentColor" /> Question Set Generator AI Prompts</h3>
                      <div className="section-header-right">
                        <HelpButton section="ai-prompts" variant="inline" size="small" tooltip="Help: AI Prompts Management" />
                        <span className="section-icon"><Icon name="Buildings" weight="bold" size={16} color="currentColor" /></span>
                      </div>
                    </div>
                    <p className="section-description">
                      These prompts control how AI generates new content for your engagement sessions.
                      They define templates for creating scenarios, trivia questions, polls, and wavelength topics.
                    </p>
                    <button
                      className="btn-primary"
                      onClick={() => setShowGenerationPromptEditor(true)}
                    >
                      <Icon name="Gear" weight="bold" size={16} color="currentColor" /> Manage Generation Prompts
                    </button>
                    <div className="prompt-examples">
                      <small>Examples: Lessons Learned, Interview Prep, General Knowledge Trivia, Opinion Polls</small>
                    </div>
                  </div>

                  {/* Results Analysis Prompts (Workie) */}
                  <div className="prompt-section analysis-prompts">
                    <div className="section-header">
                      <h3><Icon name="Sparkle" weight="duotone" size={16} color="var(--primary)" /> Engagement Results AI Analysis (Workie)</h3>
                      <div className="section-header-right">
                        <HelpButton section="ai-prompts" variant="inline" size="small" tooltip="Help: AI Prompts Management" />
                        <span className="section-icon">
                          <img src="/workie.png" alt="Workie" className="workie-icon-small" />
                        </span>
                      </div>
                    </div>
                    <p className="section-description">
                      These prompts control how Workie analyzes player responses during sessions.
                      They help generate strategic insights, identify patterns, and provide recommendations.
                    </p>
                    <button
                      className="btn-secondary"
                      onClick={() => setShowAnalysisPrompts(!showAnalysisPrompts)}
                    >
                      <Icon name="MagnifyingGlass" weight="bold" size={16} color="currentColor" /> {showAnalysisPrompts ? 'Hide' : 'Manage'} Analysis Prompts
                    </button>
                    <div className="prompt-examples">
                      <small>Examples: Team Dynamics Analysis, Innovation Insights, Consensus Patterns</small>
                    </div>
                  </div>
                </div>
                
                {/* Show Analysis Prompts (AIPromptManager) when toggled */}
                {showAnalysisPrompts && (
                  <div className="analysis-prompts-section">
                    <h3><Icon name="MagnifyingGlass" weight="bold" size={16} color="currentColor" /> Engagement Results Analysis Prompts (Workie)</h3>
                    <p className="section-description">
                      These prompts control how Workie analyzes and summarizes player responses to generate strategic insights.
                    </p>
                    <AIPromptManager />
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'questionsets' && (
            <div className="tab-content">

          {/* Current Question Sets - Moved to top */}
          <div className="admin-section">
            <div className="section-title-with-help">
              <h2><Icon name="Books" weight="duotone" size={16} color="var(--primary)" /> Current Question Sets</h2>
              <HelpButton section="question-sets" variant="inline" size="small" tooltip="Help: Managing Question Sets" />
            </div>
            
            {/* Horizontal Filtering Controls */}
            <div className="filters-section">
              <div className="filter-row">
                <label>
                  Search:
                  <input
                    type="text"
                    placeholder="Search by name or description..."
                    value={questionSetSearchQuery}
                    onChange={(e) => setQuestionSetSearchQuery(e.target.value)}
                  />
                </label>
                
                <label>
                  Type:
                  <select 
                    value={selectedQuestionSetType} 
                    onChange={(e) => setSelectedQuestionSetType(e.target.value)}
                  >
                    <option value="all">All Types</option>
                    <option value="call-and-answer">Call and Answer</option>
                    <option value="trivia">Trivia</option>
                    <option value="poll">Poll</option>
                    <option value="wavelength">Wavelength</option>
                  </select>
                </label>
                  
                <label>
                  Status:
                  <select 
                    value={selectedQuestionSetStatus} 
                    onChange={(e) => setSelectedQuestionSetStatus(e.target.value)}
                  >
                    <option value="all">All Status</option>
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                  </select>
                </label>
                
                <label>
                  Sort by:
                  <select 
                    value={questionSetSortBy} 
                    onChange={(e) => setQuestionSetSortBy(e.target.value)}
                  >
                    <option value="newest">Newest First</option>
                    <option value="oldest">Oldest First</option>
                    <option value="name">Name (A-Z)</option>
                    <option value="questions">Most Questions</option>
                  </select>
                </label>
              </div>
            </div>
            
            <div className="question-sets-list-container">
              <div className="question-sets-list">
                {filteredQuestionSets.length === 0 ? (
                  <div className="no-sets-message">
                    <p>{questionSets.length === 0 
                      ? 'No question sets found. Upload your first question set above to get started.'
                      : 'No question sets found matching your filters.'}</p>
                  </div>
                ) : (
                  filteredQuestionSets.map(set => (
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
                      <div className="stats-row-1">
                        <span className="stat-badge">{set.totalQuestions} questions</span>
                        <span className="stat-badge">{set.categoryCount} categories</span>
                        <span className="stat-badge">
                          {set.engagementType === 'trivia' ? 'Trivia' :
                           set.engagementType === 'poll' ? 'Poll' :
                           set.engagementType === 'wavelength' ? 'Wavelength' : 'Call and Answer'}
                        </span>
                      </div>
                      <div className="stats-row-2">
                        <button
                          className={`status-badge clickable ${set.active ? 'active' : 'inactive'}`}
                          onClick={() => handleToggleActive(set.id, set.active)}
                          title={`Click to ${set.active ? 'deactivate' : 'activate'} this question set`}
                        >
                          {set.active ? 'Active' : 'Inactive'}
                        </button>
                        <label className="quickstart-checkbox" title="Enable for quickstart menu">
                          <input
                            type="checkbox"
                            checked={set.quickstart || false}
                            onChange={(e) => handleToggleQuickstart(set.id, e.target.checked)}
                          />
                          <span className="quickstart-label"><Icon name="Lightning" weight="fill" size={16} color="var(--primary)" /> Quickstart</span>
                        </label>
                        {set.isAIGenerated && (
                          <span className="stat-badge ai-generated" title="AI-generated content">
                            <Icon name="Sparkle" weight="duotone" size={16} color="var(--primary)" /> AI
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="set-actions">
                      <button
                        className="btn-secondary btn-small"
                        onClick={() => handleEditQuestionSet(set)}
                        title="Edit this question set"
                      >
                        <Icon name="PencilSimple" weight="bold" size={16} color="currentColor" /> Edit
                      </button>
                      <button
                        className="btn-danger btn-small"
                        onClick={() => handleDeleteQuestionSetFromList(set.id, set.name)}
                        title="Delete this question set"
                      >
                        <Icon name="Trash" weight="bold" size={16} color="currentColor" /> Delete
                      </button>
                    </div>
                  </div>
                  ))
                )}
              </div>
            </div>
          </div>

          {/* Edit Question Set Modal/Form */}
          {editMode && (
            <div className="admin-section edit-section">
              <h2><Icon name="PencilSimple" weight="bold" size={16} color="currentColor" /> Edit Question Set</h2>
              {/* AI-Generated Content Warning */}
              {(() => {
                const currentSet = questionSets.find(set => set.id === editingSetId);
                return currentSet?.isAIGenerated && (
                  <div className="ai-review-banner">
                    <div className="ai-review-content">
                      <span className="ai-review-icon"><Icon name="Sparkle" weight="duotone" size={16} color="var(--primary)" /></span>
                      <div className="ai-review-text">
                        <strong>AI-Generated Content - Review Required</strong>
                        <p>This question set was created by AI and is currently inactive. Please review and edit the content, then activate it when ready.</p>
                      </div>
                    </div>
                  </div>
                );
              })()}
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

                <div className="form-group">
                  <label htmlFor="edit-prompt-id">AI Summary Prompt</label>
                  <select
                    id="edit-prompt-id"
                    value={editPromptId}
                    onChange={(e) => setEditPromptId(e.target.value)}
                    className="form-select"
                  >
                    <option value="">Use default prompt for game type</option>
                    {availablePrompts.map(prompt => (
                      <option key={prompt.promptId} value={prompt.promptId}>
                        {prompt.name} ({prompt.gameType} - {prompt.category})
                      </option>
                    ))}
                  </select>
                  <small className="help-text">
                    Choose a specific AI prompt for generating summaries, or leave blank to use the default prompt based on game type.
                    Only active prompts are shown.
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
                  <div
                    className={`status-message ${saveOk === true ? 'success' : saveOk === false ? 'error' : 'pending'}`}
                    role="status"
                  >
                    {saveOk === true && <Icon name="CheckCircle" weight="fill" size={16} color="var(--success)" />}
                    {saveOk === false && <Icon name="XCircle" weight="fill" size={16} color="var(--danger)" />}
                    {saveOk === null && <Icon name="Timer" weight="bold" size={16} color="var(--muted)" />}
                    {' '}{saveStatus}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Upload Question Set Section */}
          <div className="admin-section">
            <div 
              className="section-header expandable-header"
              onClick={() => setIsUploadSectionExpanded(!isUploadSectionExpanded)}
            >
              <div className="expandable-title-with-help">
                <h2><Icon name="UploadSimple" weight="bold" size={16} color="currentColor" /> Upload Question Set</h2>
                <HelpButton section="upload-csv" variant="inline" size="small" tooltip="Help: Uploading CSV Files" 
                  onClick={(e) => e.stopPropagation()} />
              </div>
              <button className={`expand-arrow ${isUploadSectionExpanded ? 'expanded' : ''}`}>
                <Icon name="CaretDown" weight="bold" size={16} color="currentColor" />
              </button>
            </div>
            {isUploadSectionExpanded && (
              <>
                <p className="section-description">Upload a CSV file containing questions to create a new question set with custom title and instructions. Surveys use JSON templates (survey upload is not yet supported in game sessions).</p>
            
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
                      <label htmlFor="engagement-type">Engagement Type *</label>
                      <select
                        id="engagement-type"
                        value={engagementType}
                        onChange={(e) => setEngagementType(e.target.value)}
                        className="input-field"
                      >
                        <option value="call-and-answer">Call and Answer</option>
                        <option value="trivia">Trivia</option>
                        <option value="poll">Poll</option>
                        <option value="wavelength">Wavelength</option>
                        <option value="survey">Survey</option>
                      </select>
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

                    <div className="form-group">
                      <label htmlFor="selected-prompt">AI Summary Prompt (Optional)</label>
                      <div className="help-text-container">
                        <small className="help-text">
                          Select a custom AI prompt for analysis summaries. Leave blank to use the default prompt for this engagement type.
                        </small>
                      </div>
                      <select
                        id="selected-prompt"
                        value={selectedPromptId}
                        onChange={(e) => setSelectedPromptId(e.target.value)}
                        className="input-field select-field"
                      >
                        <option value="">Use default prompt for {engagementType === 'call-and-answer' ? 'call & answer' : engagementType}</option>
                        {availablePrompts
                          .filter(prompt => prompt.gameType === (engagementType === 'call-and-answer' ? 'callandanswer' : engagementType))
                          .map(prompt => (
                            <option key={prompt.promptId} value={prompt.promptId}>
                              {prompt.name} {prompt.isDefault ? '(Default)' : ''}
                            </option>
                          ))}
                      </select>
                    </div>
                  </div>

                  <div className="form-row">
                    <div className="form-group">
                      <label htmlFor="file-upload">{engagementType === 'survey' ? 'CSV or JSON File *' : 'CSV File *'}</label>
                      <div className="file-input-wrapper">
                        <input
                          type="file"
                          id="file-upload"
                          accept={engagementType === 'survey' ? '.csv,.json' : '.csv'}
                          onChange={handleFileSelect}
                          className="file-input"
                        />
                        <label htmlFor="file-upload" className="file-input-label">
                          {selectedFile ? selectedFile.name : (engagementType === 'survey' ? 'Choose CSV or JSON file...' : 'Choose CSV file...')}
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
                      {isUploading ? 'Uploading...' : 'Upload Question Set'}
                    </button>
                  </div>
                </div>
                
                {uploadStatus && <StatusMessage message={uploadStatus} />}
              </>
            )}
          </div>

          {/* Add New Set Section */}
          <div className="admin-section">
            <div className="section-title-with-help">
              <h2><Icon name="Plus" weight="bold" size={16} color="currentColor" /> Add New Question Set</h2>
              <HelpButton section="ai-builders" variant="inline" size="small" tooltip="Help: AI Builders & Question Creation" />
            </div>
            <p className="section-description">Create new question sets using different methods based on your engagement type.</p>

            <div className="add-set-controls">
              <div className="engagement-type-selector">
                <label htmlFor="new-set-engagement-type">Engagement Type:</label>
                <select
                  id="new-set-engagement-type"
                  value={engagementType}
                  onChange={(e) => setEngagementType(e.target.value)}
                  className="input-field"
                >
                  <option value="call-and-answer">Call and Answer</option>
                  <option value="trivia">Trivia</option>
                  <option value="poll">Poll</option>
                  <option value="wavelength">Wavelength</option>
                  <option value="survey">Survey</option>
                </select>
              </div>

              <div className="add-set-buttons">
                <button
                  className="btn-primary"
                  onClick={() => {
                    console.log('🤖 AI Builder button clicked for', engagementType);
                    if (engagementType === 'poll') {
                      setShowPollAIBuilder(true);
                    } else if (engagementType === 'trivia') {
                      setShowTriviaAIBuilder(true);
                    } else if (engagementType === 'survey') {
                      setShowSurveyAIBuilder(true);
                    } else {
                      setShowAIScenarioBuilder(true);
                    }
                  }}
                >
                  <Icon name="Sparkle" weight="duotone" size={16} color="var(--primary)" /> AI {engagementType === 'trivia' ? 'Trivia' : 
                           engagementType === 'poll' ? 'Poll' : 
                           engagementType === 'survey' ? 'Survey' :
                           engagementType === 'wavelength' ? 'Wavelength' : 'Scenario'} Builder
                </button>
                <button
                  className="btn-secondary"
                  onClick={() => window.open('/builder', '_blank')}
                >
                  <Icon name="Palette" weight="duotone" size={16} color="var(--primary)" /> Manual Builder Interface
                </button>
                <button
                  className="btn-secondary"
                  onClick={() => handleDownloadTemplate(engagementType)}
                >
                  <Icon name="FileText" weight="bold" size={16} color="currentColor" /> Download {engagementType === 'call-and-answer' ? 'Call & Answer' :
                              engagementType === 'trivia' ? 'Trivia' :
                              engagementType === 'poll' ? 'Poll' :
                              engagementType === 'wavelength' ? 'Wavelength' :
                              engagementType === 'survey' ? 'Survey' : 'Template'} Template
                </button>
                {/* Art Title is a Call and Answer set with an extra Image column, not its own
                    engagement type -- the host filters sets by engagementType, so the upload
                    must stay 'call-and-answer' for the set to appear in the game picker. */}
                {engagementType === 'call-and-answer' && (
                  <button
                    className="btn-secondary"
                    onClick={() => handleDownloadTemplate('art-title')}
                    title="Call and Answer template with an Image column: players title a famous artwork, then vote"
                  >
                    <Icon name="Image" weight="bold" size={16} /> Download Art Title Template
                  </button>
                )}
              </div>
            </div>
          </div>

            </div>
          )}

          {activeTab === 'games' && (
            <div className="tab-content">
              {/* Delete Games Section */}
              <div className="admin-section danger-section">
                <div className="section-title-with-help">
                  <h2><Icon name="GameController" weight="bold" size={16} color="currentColor" /> Remove Games</h2>
                  <HelpButton section="game-management" variant="inline" size="small" tooltip="Help: Game Management & Cleanup" />
                </div>
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
                    {isDeleting ? 'Deleting...' : deleteMode === 'all' ? 'Delete All Games' : 'Delete Game'}
                  </button>
                </div>
                
                {deleteStatus && <StatusMessage message={deleteStatus} />}
              </div>
            </div>
          )}

          {activeTab === 'archive' && (
            <div className="tab-content">
              <ArchivePanel />
            </div>
          )}

          {activeTab === 'users' && (
            <div className="tab-content">
              <UserManagement />
            </div>
          )}

          {activeTab === 'settings' && (
            <div className="tab-content">
              {/* WebSocket Mode Toggle */}
              <div className="admin-section debug-section">
                <div className="section-title-with-help">
                  <h2><Icon name="Broadcast" weight="bold" size={16} color="var(--success)" /> Real-time Communication</h2>
                  <HelpButton section="websocket-settings" variant="inline" size="small" tooltip="Help: WebSocket & Real-time Settings" />
                </div>
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

              {/* Debug Mode Toggle */}
              <div className="admin-section debug-section">
                <h2><Icon name="Bug" weight="bold" size={16} color="currentColor" /> Debug Settings</h2>
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
                  
                  <label className="debug-toggle">
                    <input
                      type="checkbox"
                      checked={promptDebugMode}
                      onChange={handleTogglePromptDebugMode}
                    />
                    <span className="toggle-label">
                      Prompt Improvement Debug Mode
                      {promptDebugMode && <span className="debug-active">ACTIVE</span>}
                    </span>
                  </label>
                  <p className="debug-description">
                    When enabled, shows all prompt variables and their actual data values in a side panel during gameplay on the host screen results page. Useful for debugging and improving AI prompts.
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="modal-overlay" onClick={() => setShowDeleteConfirm(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h3><Icon name="Warning" weight="fill" size={16} color="var(--primary)" /> Confirm Deletion</h3>
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
            <h3><Icon name="Warning" weight="fill" size={16} color="var(--primary)" /> Confirm Question Set Deletion</h3>
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

      {/* AI Scenario Builder Modal */}
      {showAIScenarioBuilder && (
        <AIScenarioBuilder
          onClose={() => setShowAIScenarioBuilder(false)}
          onScenariosGenerated={handleScenariosGenerated}
          engagementType={engagementType}
        />
      )}

      {/* AI Trivia Builder Modal */}
      {showTriviaAIBuilder && (
        <TriviaAIBuilder
          onClose={() => setShowTriviaAIBuilder(false)}
          onTriviaGenerated={handleTriviaGenerated}
        />
      )}

      {/* AI Poll Builder Modal */}
      {showPollAIBuilder && (
        <PollAIBuilder
          onClose={() => setShowPollAIBuilder(false)}
          onPollGenerated={handlePollGenerated}
        />
      )}

      {/* AI Survey Builder Modal */}
      {showSurveyAIBuilder && (
        <SurveyAIBuilder
          onClose={() => setShowSurveyAIBuilder(false)}
          onSurveyGenerated={handleSurveyGenerated}
        />
      )}

      {/* AI Generation Prompt Editor Modal */}
      {showGenerationPromptEditor && (
        <AIGenerationPromptEditor
          onClose={() => setShowGenerationPromptEditor(false)}
        />
      )}

      {/* GitHub Issue Reporting FAB */}
      <IssueFab context="admin" />
    </div>
  );
}

export default AdminPage;