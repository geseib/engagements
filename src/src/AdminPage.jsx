import React, { useState, useEffect } from 'react';
import AIScenarioBuilder from './components/AIScenarioBuilder';
import TriviaAIBuilder from './components/TriviaAIBuilder';
import PollAIBuilder from './components/PollAIBuilder';
import SurveyAIBuilder from './components/SurveyAIBuilder';
import AIPromptManager from './components/AIPromptManager';
import AIGenerationPromptEditor from './components/AIGenerationPromptEditor';
import ArchivePanel from './components/ArchivePanel';
import UserManagement from './components/UserManagement';
import SessionsPanel from './components/SessionsPanel';
import HelpButton from './components/HelpButton';
import IssueFab from './components/IssueFab';
import { useAuth } from './auth/AuthContext';
import './BuilderPage.css';
import { authFetch } from './auth/authFetch';
import Icon from './components/Icon';
import StatusMessage from './components/StatusMessage';
import SetImageBadge from './components/SetImageBadge';
import PromptShapePreview from './components/PromptShapePreview';
import QuestionSetEditor from './components/QuestionSetEditor';
import AdminShell from './components/AdminShell';
import { describeEnvironment } from './utils/adminEnvironment';
import { gameTypeLabel } from './config/gameTypes';
import { truncate } from './utils/questionSetEditing';
import { tagsToCsvCell } from './utils/tags';

const API_BASE = window.API_BASE;

/**
 * THE SECTIONS, as places rather than tabs.
 *
 * Order and default both changed, for the reason RATIONALE.md §9 gives: every
 * other screen in this console is downstream of a question set, and the console
 * used to open on AI Prompts. "Game Management" is "Sessions" for the same
 * reason the mockups call it that — a tab that can only delete, and only by an
 * id it never shows you, is not management.
 *
 * A subtitle here must be true. Sessions says it has no list, because it has no
 * list: GET /games is deployed and this console has never called it.
 */
const ADMIN_SECTIONS = [
  {
    id: 'questionsets',
    label: 'Question sets',
    icon: 'Books',
    title: 'Question sets',
    subtitle: 'The thing every session is built from.',
  },
  {
    id: 'games',
    label: 'Sessions',
    icon: 'GameController',
    title: 'Sessions',
    subtitle: 'What hosts have run. Data here expires: 90 days from creation, 7 days after last play.',
    contentTheme: 'dark',
  },
  {
    id: 'prompts',
    label: 'Prompts',
    icon: 'Sparkle',
    title: 'Prompts',
    subtitle: 'Generation prompts build questions; analysis prompts are what Workie says afterwards.',
  },
  {
    id: 'archive',
    label: 'Archive',
    icon: 'Package',
    title: 'Archive',
    subtitle: 'A shared, public service. The same store backs all three environments.',
  },
  {
    id: 'users',
    label: 'Users',
    icon: 'UsersThree',
    title: 'Users',
    subtitle: 'Registration lands people in pending. Somebody has to move them.',
    contentTheme: 'dark',
  },
];

const ADMIN_FOOT_SECTIONS = [
  {
    id: 'settings',
    label: 'Settings',
    icon: 'Gear',
    title: 'Settings',
    subtitle: 'Three switches, stored in this browser only.',
  },
];

const ADMIN_SECTION_BY_ID = Object.fromEntries(
  [...ADMIN_SECTIONS, ...ADMIN_FOOT_SECTIONS].map((section) => [section.id, section])
);

function AdminPage() {
  console.log('🔧 AdminPage component loading with AI builders...');

  const { currentUser, signOut } = useAuth();
  const [questionSets, setQuestionSets] = useState([]);
  const [selectedFile, setSelectedFile] = useState(null);
  const [uploadStatus, setUploadStatus] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  /*
    The session-delete state that used to live here — deleteGameId,
    deleteStatus, isDeleting, showDeleteConfirm, deleteMode — moved into
    components/SessionsPanel.jsx along with the screen it drove. Deleting a
    session is now something you do from the row that names it.
  */

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
  
  // Which place is open. Question sets, not AI Prompts: RATIONALE.md §9 —
  // every other screen in this console is downstream of a question set.
  const [activeTab, setActiveTab] = useState('questionsets');
  // The set being edited. Every field of the editor itself now lives in
  // components/QuestionSetEditor.jsx — this page only decides which set is open
  // and shows the confirmation after the editor closes.
  const [editingSetId, setEditingSetId] = useState('');
  const [saveStatus, setSaveStatus] = useState('');
  // Success/failure is explicit state. It used to be inferred by sniffing the
  // status string for a ✅, which silently broke the moment the copy changed.
  const [saveOk, setSaveOk] = useState(null); // true | false | null (in progress)

  // Available prompts for selection
  const [availablePrompts, setAvailablePrompts] = useState([]);
  // The persona library, read from GET /admin/personas. Personas live under
  // SK='PERSONA#' which get-ai-prompts.js hard-filters out, so they need their
  // own endpoint — this is the list that used to be unreachable (D8).
  const [availablePersonas, setAvailablePersonas] = useState([]);

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

  // Fetch the persona library. Unfiltered on purpose: the editor's engagement
  // type is itself editable, so filtering here would make voices appear and
  // disappear mid-edit. The endpoint's gameType filter is for the host's
  // create dialog, where the type is already fixed.
  const fetchAvailablePersonas = async () => {
    try {
      const response = await authFetch(`${API_BASE}admin/personas`);
      if (!response.ok) {
        console.warn(`Persona list unavailable (${response.status})`);
        return;
      }
      const data = await response.json();
      setAvailablePersonas(data.personas || []);
    } catch (error) {
      console.error('Error fetching personas:', error);
    }
  };

  /** Display name for a stored personaId, or a warning when it resolves to nothing. */
  const personaLabel = (personaId) => {
    const match = availablePersonas.find((p) => p.personaId === personaId);
    return match ? match.name : `${personaId} (unknown — Workie will adapt instead)`;
  };

  // Load prompts when component mounts
  useEffect(() => {
    fetchAvailablePrompts();
    fetchAvailablePersonas();
  }, []);

  /**
   * Open a set. It is a PLACE now, not a section further down the same scroll.
   *
   * What used to be here: `setActiveTab('questionsets')` then a 100ms timeout
   * that queried `.edit-section`, scrolled it into view, painted
   * `element.style.background = '#fff3cd'` with a `#ffc107` border — a
   * light-theme yellow on a dark palette — and reverted both three seconds
   * later. It existed because the form was rendered *after* a list of forty-one
   * rows and nothing else identified which row was open. Once the detail
   * replaces the list and carries the set's name as the screen title, there is
   * nothing to scroll to and nothing to flash. See RATIONALE.md §2.
   */
  const handleEditQuestionSet = (questionSet) => {
    setEditMode(true);
    setEditingSetId(questionSet.id);
    setSaveStatus('');
    setSaveOk(null);
    setActiveTab('questionsets');
  };

  /**
   * Leaving for another section leaves the detail place too. A place you can
   * still be inside while looking at Users is not a place.
   */
  const handleNavigate = (sectionId) => {
    if (sectionId !== activeTab) {
      setEditMode(false);
      setEditingSetId('');
    }
    setActiveTab(sectionId);
  };

  const handleCancelEdit = () => {
    setEditMode(false);
    setEditingSetId('');
    setSaveStatus('');
    setSaveOk(null);
  };

  /**
   * A field save landed inside QuestionSetEditor. Close the editor, keep the
   * confirmation on screen and re-read the list so the row shows what the
   * backend actually wrote.
   */
  const handleEditorSaved = async (message) => {
    setSaveOk(true);
    setSaveStatus(message);
    setEditMode(false);
    setEditingSetId('');
    await fetchQuestionSets();
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
        // Was `alert()`, in a console that has imported StatusMessage since it
        // was written. A modal browser dialog on a failed toggle stops the
        // world, cannot be styled, and leaves no trace once dismissed; the
        // banner above the list is where every other outcome on this screen
        // already reports itself.
        console.error('Failed to toggle active status:', result.error);
        setSaveOk(false);
        setSaveStatus(`Failed to toggle active status: ${result.error}`);
      }
    } catch (error) {
      console.error('Toggle active error:', error);
      setSaveOk(false);
      setSaveStatus(`Failed to toggle active status: ${error.message}`);
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
        setSaveOk(false);
        setSaveStatus(`Failed to toggle quickstart status: ${result.error}`);
      }
    } catch (error) {
      console.error('Toggle quickstart error:', error);
      setSaveOk(false);
      setSaveStatus(`Failed to toggle quickstart status: ${error.message}`);
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
    const headers = 'Category,Question#,Title,Detail_lesson,School,CustomInstruction,Tags';

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
        rows.push(`"${category}","${questionNumber}","${scenario.title}","${scenario.detail}","${scenario.school || 'Professional Development'}","${scenario.customInstructions || ''}","${tagsToCsvCell(scenario.tags)}"`);
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
    const headers = 'Category,Question#,Title,QuestionDetail,AnswerDetails,School,OptionA,OptionB,OptionC,OptionD,OptionE,OptionF,CorrectAnswer,Difficulty,Tags';
    
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
        rows.push(`"${category}","${questionNumber}","${trivia.title}","${trivia.questionDetail || trivia.detail || ''}","${trivia.answerDetails || ''}","${trivia.school || 'General'}","${trivia.optionA || ''}","${trivia.optionB || ''}","${trivia.optionC || ''}","${trivia.optionD || ''}","${trivia.optionE || ''}","${trivia.optionF || ''}","${correctAnswer}","${trivia.difficulty}","${tagsToCsvCell(trivia.tags)}"`);
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
    const headers = 'Category,Question#,Title,Detail_lesson,School,CustomInstruction,Option1,Option2,Option3,Option4,Option5,AllowMultiple,Tags';
    
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

        rows.push(`"${category}","${questionNumber}","${poll.title}","${poll.detail || ''}","${poll.school || 'General'}","${poll.customInstructions || ''}","${options[0]}","${options[1]}","${options[2]}","${options[3]}","${options[4]}","${poll.allowMultiple ? 'true' : 'false'}","${tagsToCsvCell(poll.tags)}"`);
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

  /*
    THE SHELL. What used to be here: a `.parallax` section loading three .webp
    layers from cdn.prod.website-files.com — a third-party CDN dependency on an
    authenticated operator console, occupying roughly 250px of the fold — with
    the title, the user's name, a Host link and Sign Out absolutely positioned
    on top of it in inline styles; then a horizontal strip of six tab buttons
    that scrolled away with the document.

    The hero images are NOT rendered. They are also not deleted: AdminShell
    takes a `hero` node, so the owner's open question
    (docs/design/admin-redesign/OPEN-QUESTIONS.md) can be answered either way by
    passing one here. See the header comment in components/AdminShell.jsx.
  */
  const environment = describeEnvironment({ env: window.ENV, apiBase: API_BASE });

  // The set open in the detail place, or null when the list is the place.
  const editingSet =
    editMode && editingSetId
      ? questionSets.find((set) => set.id === editingSetId) || { id: editingSetId }
      : null;

  const section = ADMIN_SECTION_BY_ID[activeTab] || ADMIN_SECTION_BY_ID.questionsets;

  return (
    <>
      <AdminShell
        navItems={ADMIN_SECTIONS.map((item) =>
          item.id === 'questionsets'
            ? // No count until there is one to state. A "0" beside Question
              // sets while the list is still loading is an empty state that
              // lies, and this console has three of those already.
              { ...item, count: questionSets.length || undefined }
            : item
        )}
        footNavItems={ADMIN_FOOT_SECTIONS}
        activeId={activeTab}
        onNavigate={handleNavigate}
        environment={environment}
        currentUser={currentUser}
        onSignOut={handleSignOut}
        breadcrumb={
          editingSet ? { parentLabel: 'Question sets', onBack: handleCancelEdit } : null
        }
        title={editingSet ? editingSet.name || editingSet.id : section.title}
        subtitle={editingSet ? undefined : section.subtitle}
        /*
          Wave D converts the tabs one at a time, so the theme is per-section
          rather than per-console. Users and Sessions are dusk now; the rest are
          still the paper-theme markup AdminShell.css documents, and a section
          that has not been converted must not be dropped onto the dark field —
          #333 body copy on #0F1A2E is 1.4:1.
        */
        contentTheme={editingSet ? 'light' : section.contentTheme || 'light'}
        actions={<HelpButton section="admin" variant="header" size="medium" />}
      >
        {editingSet ? (
          /*
            THE DETAIL PLACE. The editor replaces the work area rather than
            being appended below the list it came from, which is the whole of
            RATIONALE.md §2: no scroll-jump, no three-second yellow flash, and
            the set's name is on screen for as long as you are editing it.
          */
          <QuestionSetEditor
            questionSet={editingSet}
            availablePrompts={availablePrompts}
            availablePersonas={availablePersonas}
            defaultInstructions={defaultInstructions}
            onSaved={handleEditorSaved}
            onChanged={fetchQuestionSets}
            onCancel={handleCancelEdit}
          />
        ) : (
          <>
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

            {/*
              The save confirmation lives here, not only inside the edit form:
              a successful save closes that form, which used to unmount the
              banner in the same tick and leave no evidence the save happened.
            */}
            {saveStatus && !editMode && (
              <StatusMessage
                message={saveStatus}
                tone={saveOk === true ? 'success' : saveOk === false ? 'error' : 'pending'}
              />
            )}

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
                      <h3>{set.name}<SetImageBadge hasImages={set.hasImages} withLabel /></h3>
                      <p>{set.description}</p>
                      {set.customInstruction && (
                        <p className="custom-instructions">
                          <strong>Custom Instructions:</strong> {truncate(set.customInstruction, 140)}
                        </p>
                      )}
                      {/*
                        The row used to show customInstruction and nothing else,
                        so changing a set's prompt, AI context, round label or
                        persona looked exactly the same whether it saved or was
                        silently discarded. Show the effective values.
                      */}
                      {set.aiContextInstruction && (
                        <p className="custom-instructions">
                          <strong>AI Context:</strong> {truncate(set.aiContextInstruction)}
                        </p>
                      )}
                      <p className="custom-instructions">
                        <strong>AI Prompt:</strong>{' '}
                        {set.promptId || <em>default for {gameTypeLabel(set.engagementType)}</em>}
                        {set.roundNoun && <> · <strong>Round label:</strong> {set.roundNoun}</>}
                        {/* Resolve the id to a name, and say so when it resolves
                            to nothing — a dangling personaId silently degrades
                            to the adaptive voice at runtime, which looks
                            identical to "no persona set". */}
                        {set.personaId && <> · <strong>Voice:</strong> {personaLabel(set.personaId)}</>}
                      </p>
                      {set.createdAt && (
                        <p className="creation-date">
                          <small>
                            Created: {new Date(set.createdAt).toLocaleDateString()}
                            {set.updatedAt && ` · Updated: ${new Date(set.updatedAt).toLocaleString()}`}
                          </small>
                        </p>
                      )}
                    </div>
                    <div className="set-stats">
                      <div className="stats-row-1">
                        <span className="stat-badge">{set.totalQuestions} questions</span>
                        <span className="stat-badge">{set.categoryCount} categories</span>
                        <span className="stat-badge">{gameTypeLabel(set.engagementType)}</span>
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

          {/*
            The set editor USED to render here, immediately after the list and
            inside the same scroll — which is what the 100ms scroll-jump and the
            three-second yellow flash existed to paper over. It is now a place
            of its own: see the `editingSet ?` branch at the top of this render.
          */}

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
                      <PromptShapePreview promptId={selectedPromptId} prompts={availablePrompts} />
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
            /*
              THE SESSIONS LIST. What used to be here: one red card with a
              Single/All radio pair, a free-text "Enter Game ID" box and a
              Delete button — no list at all, so removing one session required
              an id this console never displayed. GET /games has been deployed
              the whole time and admin had never called it. See
              components/SessionsPanel.jsx and RATIONALE.md §9.

              The set counts are passed so the empty state can say the likeliest
              reason a host could not start anything, and so delete-all can name
              what survives it. They are undefined until the list has loaded, on
              purpose: SessionsPanel says nothing rather than printing a zero.
            */
            <SessionsPanel
              environment={environment}
              inactiveSetCount={
                questionSets.length
                  ? questionSets.filter((set) => !set.active).length
                  : undefined
              }
              totalSetCount={questionSets.length || undefined}
            />
          )}

          {activeTab === 'archive' && (
            <div className="tab-content">
              <ArchivePanel />
            </div>
          )}

          {/* No .tab-content wrapper: that class carries a 500px min-height and
              a fade-in written for the paper tabs, and the converted screens
              own their own frame. */}
          {activeTab === 'users' && <UserManagement />}

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
          </>
        )}
      </AdminShell>


      {/*
        The session-delete confirmation that used to sit here stated severity
        ("This action cannot be undone!") and no consequence, and reported
        itemsDeleted only afterwards. It now lives in SessionsPanel, states the
        count before the press, names what survives, and names the environment.
        RATIONALE.md §8.
      */}

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
    </>
  );
}

export default AdminPage;