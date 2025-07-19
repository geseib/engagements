import React, { useState, useEffect } from 'react';
import AIScenarioBuilder from './components/AIScenarioBuilder';
import TriviaAIBuilder from './components/TriviaAIBuilder';
import PollAIBuilder from './components/PollAIBuilder';
import SurveyAIBuilder from './components/SurveyAIBuilder';
import AIPromptManager from './components/AIPromptManager';
import './BuilderPage.css';

const API_BASE = window.API_BASE;

function AdminPage() {
  console.log('🔧 AdminPage component loading with AI builders...');

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
  const [engagementType, setEngagementType] = useState('call-and-answer'); // 'call-and-answer', 'trivia', or 'poll'
  
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
  const [editEngagementType, setEditEngagementType] = useState('call-and-answer');
  const [editPromptId, setEditPromptId] = useState('');
  const [saveStatus, setSaveStatus] = useState('');

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

  // Test API endpoints
  const [testStatus, setTestStatus] = useState('');

  const defaultInstructions = "How would you apply this concept in your current role or organization? Consider the specific challenges and opportunities in your context.";

  // Fetch available AI prompts for selection
  const fetchAvailablePrompts = async () => {
    try {
      const response = await fetch(`${API_BASE}admin/ai-prompts`);
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
      setSaveStatus('❌ Title is required');
      return;
    }

    setSaveStatus('Saving...');
    try {
      const response = await fetch(`${API_BASE}admin/edit-question-set/${editingSetId}`, {
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
        setSaveStatus('✅ Question set updated successfully');
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
    console.log('🗑️ Delete button clicked for:', setId, setName);
    setSelectedQuestionSet(setId);
    setQuestionSetDeleteStatus('');
    setShowQuestionSetDeleteConfirm(true);
    console.log('🗑️ Should show confirmation modal now');
  };

  useEffect(() => {
    fetchQuestionSets();
  }, []);

  const fetchQuestionSets = async () => {
    try {
      // Use admin endpoint to get all question sets (including inactive)
      const res = await fetch(`${API_BASE}admin/question-sets`);
      const json = await res.json();
      setQuestionSets(json.questionSets || []);
    } catch (error) {
      console.error('Error fetching question sets:', error);
    }
  };

  const handleDownloadTemplate = async (templateType = 'call-and-answer') => {
    try {
      setUploadStatus('Downloading template...');
      const response = await fetch(`${API_BASE}admin/download-template?type=${templateType}`);
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
        setUploadStatus(`✅ ${result.filename} downloaded successfully`);
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
          aiContextInstructions: aiContextInstructions.trim(),
          engagementType: engagementType
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

      const response = await fetch(`${API_BASE}admin/upload-questions`, {
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
          engagementType: 'call-and-answer'
        })
      });

      const result = await response.json();

      if (response.ok) {
        setUploadStatus(`✅ ${result.message}`);
        fetchQuestionSets(); // Refresh the list
      } else {
        setUploadStatus(`❌ Upload failed: ${result.error || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('Upload error:', error);
      setUploadStatus(`❌ Upload failed: ${error.message}`);
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

      const response = await fetch(`${API_BASE}admin/upload-questions`, {
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
          engagementType: 'trivia'
        })
      });

      const result = await response.json();

      if (response.ok) {
        setUploadStatus(`✅ ${result.message}`);
        fetchQuestionSets(); // Refresh the list
      } else {
        setUploadStatus(`❌ Upload failed: ${result.error || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('Upload error:', error);
      setUploadStatus(`❌ Upload failed: ${error.message}`);
    }
  };

  const generateTriviaCSV = (questions) => {
    const headers = 'Category,Question#,Title,Detail_lesson,School,CustomInstruction,CorrectAnswer,WrongAnswer1,WrongAnswer2,WrongAnswer3,WrongAnswer4,WrongAnswer5,Difficulty';
    
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
        
        const wrongAnswers = [
          trivia.optionA !== trivia.correctAnswer ? trivia.optionA : '',
          trivia.optionB !== trivia.correctAnswer ? trivia.optionB : '',
          trivia.optionC !== trivia.correctAnswer ? trivia.optionC : '',
          trivia.optionD !== trivia.correctAnswer ? trivia.optionD : '',
          trivia.optionE !== trivia.correctAnswer ? trivia.optionE : '',
          trivia.optionF !== trivia.correctAnswer ? trivia.optionF : ''
        ].filter(answer => answer && answer.trim()).slice(0, 5);

        // Pad with empty strings if needed
        while (wrongAnswers.length < 5) {
          wrongAnswers.push('');
        }

        rows.push(`"${category}","${questionNumber}","${trivia.title}","${trivia.detail || ''}","${trivia.school || 'General'}","${trivia.customInstructions || ''}","${trivia.correctAnswer}","${wrongAnswers[0]}","${wrongAnswers[1]}","${wrongAnswers[2]}","${wrongAnswers[3]}","${wrongAnswers[4]}","${trivia.difficulty}"`);
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

      const response = await fetch(`${API_BASE}admin/upload-questions`, {
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
          engagementType: 'poll'
        })
      });

      const result = await response.json();

      if (response.ok) {
        setUploadStatus(`✅ ${result.message}`);
        fetchQuestionSets(); // Refresh the list
      } else {
        setUploadStatus(`❌ Upload failed: ${result.error || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('Upload error:', error);
      setUploadStatus(`❌ Upload failed: ${error.message}`);
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

      setUploadStatus(`✅ Survey "${survey.title}" exported as JSON file with ${survey.questions.length} questions`);

    } catch (error) {
      console.error('Survey export error:', error);
      setUploadStatus(`❌ Survey export failed: ${error.message}`);
    }
  };

  // Test API endpoints
  const testAPIEndpoints = async () => {
    setTestStatus('Testing API endpoints...');

    try {
      // Test the simple endpoint first
      console.log('🧪 Testing API endpoint:', `${API_BASE}admin/test-ai`);
      const testResponse = await fetch(`${API_BASE}admin/test-ai`);
      const testResult = await testResponse.json();

      if (testResponse.ok) {
        setTestStatus(`✅ API Test Success: ${testResult.message}`);

        // Test AI generation endpoint
        setTimeout(async () => {
          try {
            const aiResponse = await fetch(`${API_BASE}admin/ai-generate-questions`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                engagementType: 'call-and-answer',
                userInput: 'Test prompt for leadership scenarios',
                questionCount: 1,
                context: { title: 'Test' }
              })
            });

            if (aiResponse.ok) {
              setTestStatus(prev => prev + ' | ✅ AI Generation API Working');
            } else {
              const errorResult = await aiResponse.json();
              setTestStatus(prev => prev + ` | ❌ AI Generation Failed: ${errorResult.error}`);
            }
          } catch (aiError) {
            setTestStatus(prev => prev + ` | ❌ AI Generation Error: ${aiError.message}`);
          }
        }, 1000);

      } else {
        setTestStatus(`❌ API Test Failed: ${testResult.error || 'Unknown error'}`);
      }
    } catch (error) {
      setTestStatus(`❌ API Test Error: ${error.message}`);
      console.error('API Test Error:', error);
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
      
      const response = await fetch(`${API_BASE}admin/question-sets/${setId}`, {
        method: 'DELETE',
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
          {/* AI Prompt Management Section */}
          <AIPromptManager />

          {/* API Test Section */}
          <div className="admin-section">
            <h2>🧪 API Endpoint Test</h2>
            <p className="section-description">Test if the AI generation API endpoints are working properly. Use this to verify that all AI builders are functioning correctly.</p>

            <div className="test-controls">
              <button
                className="btn-secondary"
                onClick={testAPIEndpoints}
              >
                🧪 Test AI API Endpoints
              </button>
              {testStatus && (
                <div className="test-status" style={{ marginTop: '10px', padding: '10px', background: '#f8f9fa', borderRadius: '4px' }}>
                  {testStatus}
                </div>
              )}
            </div>
          </div>

          {/* CSV Template Download Section */}
          <div className="admin-section">
            <h2>📥 Download CSV Templates</h2>
            <p className="section-description">Download engagement-specific CSV templates to understand the required format for each type of question set.</p>

            <div className="template-controls">
              <div className="template-buttons">
                <button
                  className="btn-secondary"
                  onClick={() => handleDownloadTemplate('call-and-answer')}
                >
                  📞 Call & Answer Template
                </button>
                <button
                  className="btn-secondary"
                  onClick={() => handleDownloadTemplate('trivia')}
                >
                  🧠 Trivia Template
                </button>
                <button
                  className="btn-secondary"
                  onClick={() => handleDownloadTemplate('poll')}
                >
                  📊 Poll Template
                </button>
                <button
                  className="btn-secondary"
                  onClick={() => handleDownloadTemplate('survey')}
                >
                  📋 Survey Template
                </button>
              </div>
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
                      <span className="stat-badge">
                        {set.engagementType === 'trivia' ? 'Trivia' :
                         set.engagementType === 'poll' ? 'Poll' : 'Call and Answer'}
                      </span>
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

          {/* Add New Set Section */}
          <div className="admin-section">
            <h2>➕ Add New Question Set</h2>
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
                </select>
              </div>

              <div className="add-set-buttons">
                <button
                  className="btn-primary"
                  onClick={() => {
                    console.log('🤖 AI Scenario Builder button clicked for', engagementType);
                    setShowAIScenarioBuilder(true);
                  }}
                >
                  🤖 AI {engagementType === 'trivia' ? 'Trivia' : engagementType === 'poll' ? 'Poll' : 'Scenario'} Builder
                </button>
                {engagementType === 'trivia' && (
                  <button
                    className="btn-primary"
                    onClick={() => {
                      console.log('🧠 AI Trivia Builder button clicked');
                      setShowTriviaAIBuilder(true);
                    }}
                  >
                    🧠 Advanced Trivia Builder
                  </button>
                )}
                {engagementType === 'poll' && (
                  <button
                    className="btn-primary"
                    onClick={() => {
                      console.log('📊 AI Poll Builder button clicked');
                      setShowPollAIBuilder(true);
                    }}
                  >
                    📊 Advanced Poll Builder
                  </button>
                )}
                <button
                  className="btn-primary"
                  onClick={() => {
                    console.log('📋 AI Survey Builder button clicked');
                    setShowSurveyAIBuilder(true);
                  }}
                >
                  📋 AI Survey Builder
                </button>
                <button
                  className="btn-secondary"
                  onClick={() => window.open('/builder', '_blank')}
                >
                  🎨 Manual Builder Interface
                </button>
                <button
                  className="btn-secondary"
                  onClick={() => handleDownloadTemplate(engagementType)}
                >
                  📄 Download {engagementType === 'call-and-answer' ? 'Call & Answer' :
                              engagementType === 'trivia' ? 'Trivia' : 'Poll'} Template
                </button>
              </div>
            </div>
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
    </div>
  );
}

export default AdminPage;