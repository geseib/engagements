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
import QuestionSetEditor from './components/QuestionSetEditor';
import QuestionSetsPanel from './components/QuestionSetsPanel';
import QuestionSetDeleteDialog from './components/QuestionSetDeleteDialog';
import QuestionSetUploadPanel from './components/QuestionSetUploadPanel';
import AdminShell from './components/AdminShell';
import { describeEnvironment } from './utils/adminEnvironment';
import { tagsToCsvCell } from './utils/tags';
import { csvRow, buildCsv, optionsToCsvCell, allowMultipleToCsvCell } from './utils/csv';

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
    // Converted to dusk in the same change that converted its markup. A panel
    // moved onto the dark work field while still carrying the paper theme's
    // #333 body copy measures 1.4:1 against #0F1A2E — see the header of
    // components/QuestionSetsPanel.css and __tests__/questionSetsPalette.test.js.
    contentTheme: 'dark',
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
  const [questionSetsLoading, setQuestionSetsLoading] = useState(true);
  /*
    The session-delete state that used to live here — deleteGameId,
    deleteStatus, isDeleting, showDeleteConfirm, deleteMode — moved into
    components/SessionsPanel.jsx along with the screen it drove. Deleting a
    session is now something you do from the row that names it.

    The same has now happened to the question-set screen, and for the same
    reason: this file cannot be mounted in jsdom (useAuth hard-throws), so
    anything that stays here is untestable. Gone with it:

      - the four filter states and filterQuestionSets(), into
        components/QuestionSetsPanel.jsx, which owns the list, the filters and
        both empty states;
      - every upload-form field, handleFileSelect and handleUploadQuestionSet,
        into components/QuestionSetUploadPanel.jsx;
      - questionSetDeleteStatus / isDeletingQuestionSet /
        showQuestionSetDeleteConfirm, into
        components/QuestionSetDeleteDialog.jsx, which owns its own busy and
        outcome state and stays open until the server answers.

    `engagementType` stays here because the AI builder modals below read it —
    but it is now RENDERED as exactly one <select>, inside the upload panel.
    Two controls over one state was Q6.
  */
  const [engagementType, setEngagementType] = useState('call-and-answer');

  // The set whose delete dialog is open, or null.
  const [deletingSet, setDeletingSet] = useState(null);
  // Whether the creation panel under the list is open.
  const [isCreateOpen, setIsCreateOpen] = useState(false);

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
  /*
    ONE BANNER for everything this page does on the question-set screen's
    behalf: a save that landed, a toggle that failed, an AI-generated set that
    uploaded, a delete that finished. Tone is explicit state — it used to be
    inferred by sniffing the status string for a ✅, which silently broke the
    moment the copy changed.
  */
  const [notice, setNotice] = useState(null); // { text, tone } | null

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
    setNotice(null);
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
    setNotice(null);
  };

  /**
   * A field save landed inside QuestionSetEditor. Close the editor, keep the
   * confirmation on screen and re-read the list so the row shows what the
   * backend actually wrote.
   */
  const handleEditorSaved = async (message) => {
    setNotice({ text: message, tone: 'success' });
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
        setNotice({ text: `Failed to toggle active status: ${result.error}`, tone: 'error' });
      }
    } catch (error) {
      console.error('Toggle active error:', error);
      setNotice({ text: `Failed to toggle active status: ${error.message}`, tone: 'error' });
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
        setNotice({ text: `Failed to toggle quickstart status: ${result.error}`, tone: 'error' });
      }
    } catch (error) {
      console.error('Toggle quickstart error:', error);
      setNotice({ text: `Failed to toggle quickstart status: ${error.message}`, tone: 'error' });
    }
  };

  useEffect(() => {
    fetchQuestionSets();
  }, []);

  const fetchQuestionSets = async () => {
    try {
      // Use admin endpoint to get all question sets (including inactive)
      const res = await authFetch(`${API_BASE}admin/question-sets`);
      const json = await res.json();
      setQuestionSets(json.questionSets || []);
    } catch (error) {
      console.error('Error fetching question sets:', error);
    } finally {
      // So the list can tell "still loading" from "there are none" — the two
      // states the shipped screen printed the same sentence for.
      setQuestionSetsLoading(false);
    }
  };

  /*
    Filtering, sorting and both empty states moved into QuestionSetsPanel. What
    was here was a second useEffect writing a second copy of the list into
    `filteredQuestionSets`, plus a hand-written type filter listing four of the
    five engagement types — the drift config/gameTypes.js exists to prevent.
  */

  /*
    handleDownloadTemplate, handleFileSelect and handleUploadQuestionSet moved
    into components/QuestionSetUploadPanel.jsx with the form they drove.

    handleFileSelect is the one worth naming. It read the file and then did

        const headers = lines[0].split(',').map(h => h.replace(/"/g, '').trim());

    — a naive split that mis-parses any quoted comma, i.e. most real files — and
    used the result only to guess a description. Everything else about the file
    was discovered by the server, after the write. The panel runs
    utils/csvPreflight.js over the same quote-aware parser the replace preview
    already used, and reports what will happen BEFORE anything is sent.
  */

  // Handle AI-generated scenarios
  const handleScenariosGenerated = async (scenarioData) => {
    setShowAIScenarioBuilder(false);

    // scenarioData carries the scenarios, the set-level metadata, and the round
    // DIRECTION the builder was steered with. The direction has to reach the
    // SETS row or it steers one generation and is then forgotten — a set that
    // was generated as Apply would read back as Produce for the editor, the
    // library and every later regeneration.
    const { scenarios, metadata, roundKind, roundKindBrief, createdSet } = scenarioData;

    // THE WORKER ALREADY MADE IT. Uploading again would be refused — the
    // importer will not write over a set that exists — and would report that
    // refusal as a failure over a set that is sitting there. So this path
    // writes NOTHING: it re-reads the list and opens the draft.
    if (createdSet?.setId) {
      await fetchQuestionSets();
      handleEditQuestionSet({ id: createdSet.setId });
      setNotice({
        text: `"${createdSet.setName}" was created while the generator ran. It is switched off `
          + 'until you review it and turn it on.',
        tone: 'success',
      });
      return;
    }

    // Convert scenarios to CSV format and upload
    const csvContent = generateScenariosCSV(scenarios);
    const timestamp = Date.now();

    try {
      setNotice({ text: 'Processing AI-generated scenarios…', tone: 'pending' });

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
          ...(roundKind ? { roundKind } : {}),
          ...(roundKindBrief ? { roundKindBrief } : {}),
          isAIGenerated: true
        })
      });

      const result = await response.json();

      if (response.ok) {
        setNotice({ text: `${result.message} — question set created. Open it from the list to review it.`, tone: 'success' });
        await fetchQuestionSets(); // Refresh the list
      } else {
        setNotice({ text: `Upload failed: ${result.error || 'Unknown error'}`, tone: 'error' });
      }
    } catch (error) {
      console.error('Upload error:', error);
      setNotice({ text: `Upload failed: ${error.message}`, tone: 'error' });
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
        rows.push(csvRow([
          category,
          questionNumber,
          scenario.title,
          scenario.detail,
          scenario.school || 'Professional Development',
          scenario.customInstructions || '',
          tagsToCsvCell(scenario.tags)
        ]));
      });
    });

    return buildCsv(headers, rows);
  };

  // Handle AI-generated trivia
  const handleTriviaGenerated = async (triviaData) => {
    setShowTriviaAIBuilder(false);

    // triviaData includes both questions and metadata
    const { questions, metadata, createdSet } = triviaData;

    // THE WORKER ALREADY MADE IT — same rule as handleScenariosGenerated.
    // Uploading again would be refused and the refusal would be reported as a
    // failure over a set that exists.
    if (createdSet?.setId) {
      await fetchQuestionSets();
      handleEditQuestionSet({ id: createdSet.setId });
      setNotice({
        text: `"${createdSet.setName}" was created while the generator ran. It is switched off `
          + 'until you review it and turn it on.',
        tone: 'success',
      });
      return;
    }

    // Convert trivia to CSV format and upload
    const csvContent = generateTriviaCSV(questions);
    const timestamp = Date.now();

    try {
      setNotice({ text: 'Processing AI-generated trivia questions…', tone: 'pending' });

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
        setNotice({ text: `${result.message} — trivia set created. Open it from the list to review it.`, tone: 'success' });
        await fetchQuestionSets(); // Refresh the list
      } else {
        setNotice({ text: `Upload failed: ${result.error || 'Unknown error'}`, tone: 'error' });
      }
    } catch (error) {
      console.error('Upload error:', error);
      setNotice({ text: `Upload failed: ${error.message}`, tone: 'error' });
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
        rows.push(csvRow([
          category,
          questionNumber,
          trivia.title,
          trivia.questionDetail || trivia.detail || '',
          trivia.answerDetails || '',
          trivia.school || 'General',
          trivia.optionA || '',
          trivia.optionB || '',
          trivia.optionC || '',
          trivia.optionD || '',
          trivia.optionE || '',
          trivia.optionF || '',
          correctAnswer,
          trivia.difficulty,
          tagsToCsvCell(trivia.tags)
        ]));
      });
    });

    return buildCsv(headers, rows);
  };

  // Handle AI-generated polls
  const handlePollGenerated = async (pollData) => {
    setShowPollAIBuilder(false);

    // pollData carries the questions, the set-level metadata, and the round
    // DIRECTION the builder was steered with. Same reasoning as
    // handleScenariosGenerated: a direction that does not reach the SETS row
    // steers one generation and is then forgotten.
    const { questions, metadata, roundKind, roundKindBrief, createdSet } = pollData;

    // THE WORKER ALREADY MADE IT — same rule as handleScenariosGenerated.
    if (createdSet?.setId) {
      await fetchQuestionSets();
      handleEditQuestionSet({ id: createdSet.setId });
      setNotice({
        text: `"${createdSet.setName}" was created while the generator ran. It is switched off `
          + 'until you review it and turn it on.',
        tone: 'success',
      });
      return;
    }

    // Convert polls to CSV format and upload
    const csvContent = generatePollCSV(questions);
    const timestamp = Date.now();

    try {
      setNotice({ text: 'Processing AI-generated poll questions…', tone: 'pending' });

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
          ...(roundKind ? { roundKind } : {}),
          ...(roundKindBrief ? { roundKindBrief } : {}),
          isAIGenerated: true
        })
      });

      const result = await response.json();

      if (response.ok) {
        setNotice({ text: `${result.message} — poll set created. Open it from the list to review it.`, tone: 'success' });
        await fetchQuestionSets(); // Refresh the list
      } else {
        setNotice({ text: `Upload failed: ${result.error || 'Unknown error'}`, tone: 'error' });
      }
    } catch (error) {
      console.error('Upload error:', error);
      setNotice({ text: `Upload failed: ${error.message}`, tone: 'error' });
    }
  };

  const generatePollCSV = (questions) => {
    // ONE `Options` column, pipe-separated — see optionsToCsvCell(). This used
    // to emit Option1..Option5, which upload-questions.js does not read and has
    // no fallback for, so every AI-generated poll set imported with zero
    // options. Do not "restore" the numbered columns.
    const headers = 'Category,Question#,Title,Detail_lesson,School,CustomInstruction,Options,AllowMultiple,Tags';

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

        rows.push(csvRow([
          category,
          questionNumber,
          poll.title,
          poll.detail || '',
          poll.school || 'General',
          poll.customInstructions || '',
          optionsToCsvCell(poll.options),
          allowMultipleToCsvCell(poll.allowMultiple),
          tagsToCsvCell(poll.tags)
        ]));
      });
    });

    return buildCsv(headers, rows);
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
      setNotice({ text: 'Exporting AI-generated survey…', tone: 'pending' });

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

      setNotice({ text: `Survey "${survey.title}" exported as a JSON file with ${survey.questions.length} questions. It is NOT a question set: the importer rejects survey uploads and no session plays one.`, tone: 'success' });

    } catch (error) {
      console.error('Survey export error:', error);
      setNotice({ text: `Survey export failed: ${error.message}`, tone: 'error' });
    }
  };


  /*
    DELETING A SET now lives in components/QuestionSetDeleteDialog.jsx, which
    owns its own busy and outcome state, sends the request BEFORE closing
    anything, and closes only on acknowledgement.

    Two things were here and are gone. `handleDeleteQuestionSet` was DEAD — the
    only wired path was the row button, and its 'Please select a question set to
    delete' branch belonged to a selector this screen has not had for months, so
    it is deleted rather than wired. And `confirmDeleteQuestionSet` wrote
    `questionSetDeleteStatus` on all four outcomes into a variable rendered
    nowhere, while `isDeletingQuestionSet` was never read at all.
  */

  /** The dialog reports the outcome; the page re-reads the list and keeps it. */
  const handleSetDeleted = async (message) => {
    setDeletingSet(null);
    setNotice({ text: message, tone: 'success' });
    await fetchQuestionSets();
  };

  /** The reversible neighbour offered inside the delete dialog. */
  const handleDeactivateInstead = async (set) => {
    setDeletingSet(null);
    await handleToggleActive(set.id, set.active);
    setNotice({
      text: `“${set.name || set.id}” is deactivated. It no longer appears in the host's picker, and nothing was deleted.`,
      tone: 'success',
    });
  };

  /** One place decides which builder a type opens. It used to be inline in a
   *  button that sat beside a second copy of the engagement-type select. */
  const handleOpenBuilder = (type) => {
    if (type === 'poll') setShowPollAIBuilder(true);
    else if (type === 'trivia') setShowTriviaAIBuilder(true);
    else if (type === 'survey') setShowSurveyAIBuilder(true);
    else setShowAIScenarioBuilder(true);
  };

  /** The three ranked paths from mockup 02, and the header's New set button. */
  const handleCreatePath = (path) => {
    setIsCreateOpen((open) => (path === 'new' ? !open : true));
    if (path === 'ai') handleOpenBuilder(engagementType);
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
            // Every set the caller can see, for the Questions panel's
            // "pull from another set" picker. Already loaded for the list, so
            // the picker costs no request of its own.
            availableSets={questionSets}
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
            /*
              THE LIST AND THE CREATION PANEL. No `.tab-content` wrapper: that
              class carries a 500px min-height and a fade-in written for the
              paper tabs, and this screen owns its own frame now (same reason
              the Users tab dropped it in Wave D part one).

              The creation panel is passed as a CHILD so it renders inside the
              same `.qs` scope and below the list — which is where it has always
              been. What changed is that the empty state no longer tells you to
              upload "above": clicking a creation path opens this panel, and
              when the list is empty there are no rows between the two.
            */
            <QuestionSetsPanel
              questionSets={questionSets}
              loading={questionSetsLoading}
              notice={notice}
              onDismissNotice={() => setNotice(null)}
              onEdit={handleEditQuestionSet}
              onDelete={(set) => setDeletingSet(set)}
              onToggleActive={(set) => handleToggleActive(set.id, set.active)}
              onToggleQuickstart={(set, next) => handleToggleQuickstart(set.id, next)}
              onCreate={handleCreatePath}
              createOpen={isCreateOpen}
            >
              {(isCreateOpen || questionSets.length === 0) && (
                <QuestionSetUploadPanel
                  engagementType={engagementType}
                  onEngagementTypeChange={setEngagementType}
                  availablePrompts={availablePrompts}
                  defaultInstructions={defaultInstructions}
                  onOpenBuilder={handleOpenBuilder}
                  onUploaded={fetchQuestionSets}
                />
              )}
            </QuestionSetsPanel>
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

      {/*
        THE SET-DELETE DIALOG. See components/QuestionSetDeleteDialog.jsx: it
        stays open until the server answers, renders the outcome, offers the
        reversible neighbour, and closes only on acknowledgement.
      */}
      {deletingSet && (
        <QuestionSetDeleteDialog
          questionSet={deletingSet}
          onCancel={() => setDeletingSet(null)}
          onDeleted={handleSetDeleted}
          onDeactivate={handleDeactivateInstead}
        />
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