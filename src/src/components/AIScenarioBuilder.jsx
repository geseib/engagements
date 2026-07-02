import React, { useState, useEffect } from 'react';
import FileUploadPrompt from './FileUploadPrompt';
import { authFetch } from '../auth/authFetch';
import { postGenerationBatch, runWithConcurrency } from '../utils/aiBatchClient';

const API_BASE = window.API_BASE;

function AIScenarioBuilder({ onClose, onScenariosGenerated, engagementType = 'call-and-answer' }) {
  const [step, setStep] = useState(1);
  const [scenarioConfig, setScenarioConfig] = useState({
    type: '',
    context: '',
    audience: '',
    difficulty: engagementType === 'trivia' ? 'medium' : 'detailed',
    count: 5,
    customPrompt: '',
    customTitle: '',
    numberOfCategories: 3,
    mustHaveCategories: ''
  });
  const [generatedScenarios, setGeneratedScenarios] = useState([]);
  const [generatedMetadata, setGeneratedMetadata] = useState(null);
  const [currentScenarioIndex, setCurrentScenarioIndex] = useState(0);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationStatus, setGenerationStatus] = useState('');
  const [availablePrompts, setAvailablePrompts] = useState([]);
  const [loadingPrompts, setLoadingPrompts] = useState(true);
  const [promptsError, setPromptsError] = useState(null);

  // Fetch available prompts from database
  useEffect(() => {
    fetchAvailablePrompts();
  }, [engagementType]);

  const fetchAvailablePrompts = async () => {
    try {
      setLoadingPrompts(true);
      const params = new URLSearchParams({
        promptType: 'generation',
        gameType: engagementType,
        status: 'active'
      });
      
      const response = await authFetch(`${API_BASE}admin/ai-prompts?${params}`);
      const data = await response.json();
      
      if (response.ok) {
        setAvailablePrompts(data.prompts || []);
        setPromptsError(null);
      } else {
        console.error('Failed to fetch prompts:', data.error);
        setPromptsError(data.error || 'Failed to load prompts');
        setAvailablePrompts([]);
      }
    } catch (error) {
      console.error('Error fetching prompts:', error);
      setPromptsError('Failed to load prompts');
      setAvailablePrompts([]);
    } finally {
      setLoadingPrompts(false);
    }
  };

  // Define hardcoded scenario types based on engagement type (fallback if database empty)
  const getHardcodedScenarioTypes = (engagementType) => {
    switch (engagementType) {
      case 'trivia':
        return [
          {
            id: 'general-knowledge',
            title: 'General Knowledge Trivia',
            description: 'Broad knowledge questions across various topics',
            prompt: 'Create general knowledge trivia questions covering history, science, geography, and culture'
          },
          {
            id: 'subject-specific',
            title: 'Subject-Specific Trivia',
            description: 'Deep dive into a specific subject or field',
            prompt: 'Generate trivia questions focused on a specific subject area with varying difficulty levels'
          },
          {
            id: 'workplace-trivia',
            title: 'Workplace & Business Trivia',
            description: 'Business knowledge and workplace concepts',
            prompt: 'Create trivia questions about business concepts, workplace skills, and professional knowledge'
          },
          {
            id: 'fun-facts',
            title: 'Fun Facts & Interesting Trivia',
            description: 'Entertaining and surprising facts',
            prompt: 'Generate fun and interesting trivia questions with surprising facts and entertaining knowledge'
          },
          {
            id: 'custom-trivia',
            title: 'Custom Trivia Topics',
            description: 'Define your own trivia topic and requirements',
            prompt: 'Create trivia questions based on the specific topic and requirements provided'
          },
          {
            id: 'custom',
            title: 'Custom Scenarios',
            description: 'Define your own specific scenario requirements with minimal pre-prompt info',
            prompt: 'Create scenarios based on the custom requirements provided'
          }
        ];

      case 'poll':
        return [
          {
            id: 'opinion-polls',
            title: 'Opinion & Preference Polls',
            description: 'Gather opinions and preferences from participants',
            prompt: 'Create poll questions that gather opinions, preferences, and viewpoints on various topics'
          },
          {
            id: 'decision-making',
            title: 'Decision-Making Polls',
            description: 'Help teams make decisions through voting',
            prompt: 'Generate poll questions that help teams make decisions and choose between options'
          },
          {
            id: 'feedback-polls',
            title: 'Feedback & Assessment Polls',
            description: 'Collect feedback and assess understanding',
            prompt: 'Create poll questions to gather feedback, assess understanding, and measure satisfaction'
          },
          {
            id: 'icebreaker-polls',
            title: 'Icebreaker & Team Polls',
            description: 'Fun polls to break the ice and learn about team members',
            prompt: 'Generate fun and engaging poll questions that help team members get to know each other'
          },
          {
            id: 'custom-polls',
            title: 'Custom Poll Topics',
            description: 'Define your own poll topic and requirements',
            prompt: 'Create poll questions based on the specific topic and requirements provided'
          },
          {
            id: 'custom',
            title: 'Custom Scenarios',
            description: 'Define your own specific scenario requirements with minimal pre-prompt info',
            prompt: 'Create scenarios based on the custom requirements provided'
          }
        ];

      case 'wavelength':
        return [
          {
            id: 'tech-terms',
            title: 'Technology Terms',
            description: 'Technical terms and concepts for word association',
            prompt: 'Create wavelength questions using technology and software development terms that teams can associate words with'
          },
          {
            id: 'business-concepts',
            title: 'Business Concepts',
            description: 'Business and management terms for exploration',
            prompt: 'Generate wavelength questions using business, strategy, and management concepts'
          },
          {
            id: 'industry-specific',
            title: 'Industry-Specific Terms',
            description: 'Terms specific to your industry or domain',
            prompt: 'Create wavelength questions using terms specific to the target industry or professional domain'
          },
          {
            id: 'leadership-themes',
            title: 'Leadership & Culture',
            description: 'Leadership principles and cultural concepts',
            prompt: 'Generate wavelength questions around leadership themes, company culture, and team dynamics'
          },
          {
            id: 'abstract-concepts',
            title: 'Abstract Concepts',
            description: 'Ideas and concepts that spark creativity',
            prompt: 'Create wavelength questions using abstract concepts that encourage creative thinking and diverse associations'
          },
          {
            id: 'lists-favorites',
            title: 'Lists & Favorites',
            description: 'Personal preferences and recommendations',
            prompt: 'Create wavelength prompts asking people to list their favorites: books, movies, songs, restaurants, vacation spots, tools, resources, mentors, etc. Format: "List 10 of your favorite [category]"'
          },
          {
            id: 'brainstorming',
            title: 'Brainstorming Sessions',
            description: 'Ideas and solutions for team challenges',
            prompt: 'Generate wavelength prompts for brainstorming: ways to improve products, potential solutions, feature ideas, process improvements. Format: "List 10 ways to [improve/solve/enhance something]"'
          },
          {
            id: 'team-building',
            title: 'Team Building & Culture',
            description: 'Shared experiences and team connections',
            prompt: 'Create wavelength prompts for team building: memorable moments, things to appreciate, team values, shared goals. Format: "List 10 [experiences/values/goals] related to our team"'
          },
          {
            id: 'reflection-retrospective',
            title: 'Reflection & Learning',
            description: 'Lessons learned and growth opportunities',
            prompt: 'Generate wavelength prompts for reflection: lessons learned, achievements, challenges overcome, areas for improvement. Format: "List 10 things you learned/achieved/improved"'
          },
          {
            id: 'icebreakers-fun',
            title: 'Icebreakers & Fun',
            description: 'Getting to know each other better',
            prompt: 'Create fun wavelength prompts: hidden talents, dream jobs, bucket list items, interesting facts about yourself. Format: "List 10 [fun/interesting/surprising] things about you"'
          },
          {
            id: 'custom',
            title: 'Custom Lists',
            description: 'Define your own list-based prompts',
            prompt: 'Create wavelength questions based on the custom list topics provided'
          }
        ];
      case 'call-and-answer':
      default:
        return [
          {
            id: 'lessons-learned',
            title: 'Lessons Learned Scenarios',
            description: 'Real-world situations where teams learned valuable lessons',
            prompt: 'Create scenarios based on common workplace challenges and the lessons learned from them'
          },
          {
            id: 'problem-solving',
            title: 'Problem-Solving Challenges',
            description: 'Current problems your team is tackling that need solutions',
            prompt: 'Generate problem scenarios that require creative thinking and collaborative solutions'
          },
          {
            id: 'interview-prep',
            title: 'Interview Preparation',
            description: 'Practice questions for job interviews and assessments',
            prompt: 'Create interview-style questions that help candidates prepare and practice their responses'
          },
          {
            id: 'amazon-principles',
            title: 'Amazon Leadership Principles',
            description: 'Scenarios based on Amazon\'s 16 Leadership Principles',
            prompt: 'Generate scenarios that explore Amazon Leadership Principles through real-world situations'
          },
          {
            id: 'team-building',
            title: 'Team Building Exercises',
            description: 'Scenarios that promote team collaboration and communication',
            prompt: 'Create team-building scenarios that encourage discussion and collaboration'
          },
          {
            id: 'custom',
            title: 'Custom Scenarios',
            description: 'Define your own specific scenario requirements',
            prompt: 'Create scenarios based on the custom requirements provided'
          }
        ];
    }
  };

  // Combine database prompts with hardcoded types (additive, not replacement)
  const getScenarioTypes = (engagementType) => {
    const hardcodedTypes = getHardcodedScenarioTypes(engagementType);
    
    // Each database prompt gets its own card with unique ID
    const databaseTypes = availablePrompts.map(prompt => ({
      id: `db-${prompt.SK}`, // Use unique database ID
      title: prompt.name,
      description: prompt.description,
      prompt: prompt.basePrompt,
      source: 'database',
      dbPrompt: prompt // Store full prompt data for pre-filling form
    }));
    
    // Start with database prompts (each gets its own card)
    const combined = [...databaseTypes];
    
    // Add hardcoded types, but skip any that would duplicate database functionality
    hardcodedTypes.forEach(hardcoded => {
      // Always add the generic "custom" option for starting from scratch
      if (hardcoded.id === 'custom') {
        combined.push({ ...hardcoded, source: 'hardcoded' });
      } else {
        // Add other hardcoded types only if they don't have database equivalents
        const hasDbEquivalent = databaseTypes.some(db => db.dbPrompt.scenarioType === hardcoded.id);
        if (!hasDbEquivalent) {
          combined.push({ ...hardcoded, source: 'hardcoded' });
        }
      }
    });
    
    return combined;
  };

  const scenarioTypes = getScenarioTypes(engagementType);

  // Get template defaults from selected scenario type (database prompt or hardcoded)
  const getTemplateDefaults = (scenarioTypeId) => {
    // Find the selected scenario type
    const selectedType = scenarioTypes.find(t => t.id === scenarioTypeId);
    
    if (selectedType && selectedType.source === 'database' && selectedType.dbPrompt) {
      // Pre-fill with database prompt information
      const prompt = selectedType.dbPrompt;
      return {
        customTitle: prompt.name,
        context: prompt.description || '', // Use the prompt's description as context
        audience: '', // Leave blank for admin to specify
        numberOfCategories: prompt.defaultSettings?.numberOfCategories || 3,
        mustHaveCategories: prompt.defaultSettings?.mustHaveCategories || '',
        difficulty: prompt.defaultSettings?.difficulty || (engagementType === 'trivia' ? 'medium' : 'detailed'),
        customPrompt: prompt.basePrompt || '' // Pre-fill with the base prompt so admin can see and edit
      };
    }
    
    // Fallback for hardcoded types or when no database prompt found
    return {
      customTitle: selectedType?.title || 'Custom Session',
      context: '',
      audience: '',
      numberOfCategories: 3,
      mustHaveCategories: '',
      difficulty: engagementType === 'trivia' ? 'medium' : 'detailed',
      customPrompt: ''
    };
  };

  const handleTypeSelection = (type) => {
    const templateDefaults = getTemplateDefaults(type);
    setScenarioConfig(prev => ({ 
      ...prev, 
      type,
      ...templateDefaults
    }));
    setStep(2);
  };

  const handleConfigSubmit = async () => {
    console.log('🤖 Starting AI scenario generation...', scenarioConfig);
    setIsGenerating(true);
    setGenerationStatus('🤖 Generating scenarios with AI...');
    setStep(3);

    try {
      const selectedType = scenarioTypes.find(t => t.id === scenarioConfig.type);
      let basePrompt;
      
      if (selectedType && selectedType.source === 'database' && selectedType.dbPrompt) {
        // Use database prompt with templates
        const selectedPrompt = selectedType.dbPrompt;
        basePrompt = selectedPrompt.basePrompt;
        
        // Apply templates if provided (custom prompts may have empty templates)
        if (scenarioConfig.context && selectedPrompt.contextTemplate) {
          basePrompt += selectedPrompt.contextTemplate.replace('{context}', scenarioConfig.context);
        } else if (scenarioConfig.context && !selectedPrompt.contextTemplate) {
          // For minimal custom prompts, add context directly
          basePrompt += `\n\nContext: ${scenarioConfig.context}`;
        }
        
        if (scenarioConfig.audience && selectedPrompt.audienceTemplate) {
          basePrompt += selectedPrompt.audienceTemplate.replace('{audience}', scenarioConfig.audience);
        } else if (scenarioConfig.audience && !selectedPrompt.audienceTemplate) {
          // For minimal custom prompts, add audience directly
          basePrompt += `\nAudience: ${scenarioConfig.audience}`;
        }
        
        if (selectedPrompt.categoryTemplate) {
          let categoryText = selectedPrompt.categoryTemplate;
          categoryText = categoryText.replace('{numberOfCategories}', scenarioConfig.numberOfCategories);
          if (scenarioConfig.mustHaveCategories) {
            categoryText = categoryText.replace('{mustHaveCategories}', scenarioConfig.mustHaveCategories);
          }
          basePrompt += categoryText;
        } else {
          // For minimal custom prompts, add category info directly if needed
          if (scenarioConfig.numberOfCategories > 1) {
            basePrompt += `\nNumber of categories needed: ${scenarioConfig.numberOfCategories}`;
          }
          if (scenarioConfig.mustHaveCategories) {
            basePrompt += `\nMust include these categories: ${scenarioConfig.mustHaveCategories}`;
          }
        }
        
        // Add difficulty/detail level
        const levelLabel = engagementType === 'trivia' ? 'Difficulty Level' : 'Level of Detail';
        basePrompt += `\n\n${levelLabel}: ${scenarioConfig.difficulty}`;
        
      } else {
        // Fallback to hardcoded prompt structure
        basePrompt = selectedType.prompt;
        if (scenarioConfig.context) {
          basePrompt += `\n\nContext: ${scenarioConfig.context}`;
        }
        if (scenarioConfig.audience) {
          basePrompt += `\nAudience: ${scenarioConfig.audience}`;
        }
        
        const levelLabel = engagementType === 'trivia' ? 'Difficulty Level' : 'Level of Detail';
        basePrompt += `\n\n${levelLabel}: ${scenarioConfig.difficulty}`;
        basePrompt += `\nNumber of categories needed: ${scenarioConfig.numberOfCategories}`;
        
        if (scenarioConfig.mustHaveCategories) {
          basePrompt += `\nMust include these categories: ${scenarioConfig.mustHaveCategories}`;
        }
      }

      if (scenarioConfig.customPrompt) {
        basePrompt += `\n\nAdditional Requirements: ${scenarioConfig.customPrompt}`;
      }

      // Break large requests into small parallel batches. API Gateway HTTP
      // APIs have a hard ~30s integration timeout, and generation runs at
      // roughly 7.5s per scenario, so 2 per call keeps each request ~15s.
      const CHUNK_SIZE = 2;
      const MAX_PARALLEL = 3; // cap concurrency to respect Bedrock rate limits
      const totalCount = scenarioConfig.count;
      const chunks = Math.ceil(totalCount / CHUNK_SIZE);

      // Determine the correct scenarioType for the backend
      const backendScenarioType = selectedType?.source === 'database' && selectedType.dbPrompt
        ? selectedType.dbPrompt.scenarioType
        : scenarioConfig.type;

      // Since batches run in parallel, differentiate them up-front so we
      // don't get duplicate/near-identical scenarios across batches.
      const batchAngles = [
        'everyday, day-to-day situations',
        'high-pressure or time-critical situations',
        'interpersonal and communication-focused situations',
        'strategic or long-term planning situations',
        'unexpected situations that require creative thinking',
        'cross-team or organizational situations'
      ];
      const requiredCategories = (scenarioConfig.mustHaveCategories || '')
        .split(',')
        .map(c => c.trim())
        .filter(Boolean);

      let completedScenarios = 0;
      setGenerationStatus(`🤖 Generating ${totalCount} scenario${totalCount > 1 ? 's' : ''} in ${chunks} batch${chunks > 1 ? 'es' : ''}...`);

      const batchTasks = Array.from({ length: chunks }, (_, i) => async () => {
        const chunkSize = Math.min(CHUNK_SIZE, totalCount - (i * CHUNK_SIZE));

        let chunkPrompt = basePrompt + `\nNumber of scenarios needed: ${chunkSize}`;
        if (chunks > 1) {
          chunkPrompt += `\n\nThis request is part ${i + 1} of ${chunks} of a larger set generated in parallel. To avoid duplicating other parts, emphasize ${batchAngles[i % batchAngles.length]} and avoid the most obvious or commonly used examples.`;
          if (requiredCategories.length > 0) {
            chunkPrompt += ` Where it fits, favor the category "${requiredCategories[i % requiredCategories.length]}" for this part.`;
          }
        }

        const result = await postGenerationBatch(`${API_BASE}admin/ai-generate-scenarios`, {
          scenarioType: backendScenarioType,
          engagementType: engagementType,
          prompt: chunkPrompt,
          count: chunkSize,
          difficulty: scenarioConfig.difficulty,
          context: scenarioConfig.context,
          audience: scenarioConfig.audience,
          customPrompt: scenarioConfig.customPrompt,
          customTitle: scenarioConfig.customTitle,
          numberOfCategories: scenarioConfig.numberOfCategories,
          mustHaveCategories: scenarioConfig.mustHaveCategories
        }, {
          label: `Batch ${i + 1} of ${chunks}`,
          onStatus: setGenerationStatus
        });

        completedScenarios += result.scenarios.length;
        setGenerationStatus(`✅ Generated ${completedScenarios} of ${totalCount} scenarios...`);
        return result.scenarios;
      });

      const batchResults = await runWithConcurrency(batchTasks, MAX_PARALLEL);
      const allScenarios = batchResults.flat();

      setGeneratedScenarios(allScenarios);
      setGeneratedMetadata(null); // Will be generated later
      setGenerationStatus(`✅ Generated ${allScenarios.length} scenarios successfully`);
      setCurrentScenarioIndex(0);
      
    } catch (error) {
      console.error('AI generation error:', error);
      setGenerationStatus(`❌ Generation failed: ${error.message}`);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleScenarioEdit = (index, field, value) => {
    const updatedScenarios = [...generatedScenarios];
    updatedScenarios[index] = { ...updatedScenarios[index], [field]: value };
    setGeneratedScenarios(updatedScenarios);
  };

  const handleExportCSV = () => {
    const csvContent = generateCSVContent();
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    
    // Use a meaningful filename based on the selected type
    const selectedType = scenarioTypes.find(t => t.id === scenarioConfig.type);
    const typeName = selectedType?.title?.replace(/[^a-zA-Z0-9]/g, '-') || 'scenarios';
    a.download = `${typeName}-scenarios-${Date.now()}.csv`;
    
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  };

  const generateCSVContent = () => {
    const headers = 'Category,Question#,Title,Detail_lesson,School,CustomInstruction';
    
    // First, group scenarios by category
    const scenariosByCategory = {};
    generatedScenarios.forEach(scenario => {
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
        const questionNumber = index + 1; // Category-relative numbering
        rows.push(`"${category}","${questionNumber}","${scenario.title}","${scenario.detail}","${scenario.school || 'Professional Development'}","${scenario.customInstructions || ''}"`);
      });
    });
    
    return headers + '\n' + rows.join('\n');
  };

  const handleLoadIntoSystem = () => {
    // Use AI-generated metadata if available, otherwise generate from configuration
    const metadata = generatedMetadata || {
      title: generateTitle(),
      description: generateDescription(),
      customInstructions: generateCustomInstructions(),
      aiContextInstructions: generateAIContextInstructions()
    };

    onScenariosGenerated({
      scenarios: generatedScenarios,
      metadata: metadata
    });
  };

  // Generate contextual title based on scenario type and content
  const generateTitle = () => {
    // Use custom title if provided, otherwise generate from scenario type
    if (scenarioConfig.customTitle && scenarioConfig.customTitle.trim()) {
      return scenarioConfig.customTitle.trim();
    }

    // Find the selected type and use its title
    const selectedType = scenarioTypes.find(t => t.id === scenarioConfig.type);
    const typeName = selectedType?.title || 'Professional Development';
    const audienceText = scenarioConfig.audience ? ` for ${scenarioConfig.audience}` : '';

    return `${typeName}${audienceText}`;
  };

  // Generate contextual description
  const generateDescription = () => {
    const contextText = scenarioConfig.context ? ` Context: ${scenarioConfig.context.substring(0, 100)}${scenarioConfig.context.length > 100 ? '...' : ''}` : '';
    const audienceText = scenarioConfig.audience ? ` Target audience: ${scenarioConfig.audience}.` : '';

    return `${generatedScenarios.length} AI-generated scenarios for ${scenarioConfig.difficulty} difficulty level.${audienceText}${contextText}`;
  };

  // Generate custom instructions based on scenario type
  const generateCustomInstructions = () => {
    // Check if it's a database prompt with specific scenario type
    const selectedType = scenarioTypes.find(t => t.id === scenarioConfig.type);
    const actualScenarioType = selectedType?.source === 'database' && selectedType.dbPrompt 
      ? selectedType.dbPrompt.scenarioType 
      : scenarioConfig.type;

    const typeInstructions = {
      'amazon-principles': 'Answer using the STAR format (Situation, Task, Action, Results). Focus on demonstrating specific leadership principles through real examples.',
      'interview-prep': 'Practice answering these questions with specific examples from your experience. Be prepared to provide concrete details and measurable results.',
      'problem-solving': 'Work through these challenges systematically. Consider multiple solutions and discuss the pros and cons of each approach.',
      'lessons-learned': 'Share specific experiences and focus on what was learned and how it changed your approach going forward.',
      'team-building': 'Engage in open discussion and listen to different perspectives. Focus on building understanding and collaboration.',
      'custom': 'Follow the specific guidelines provided for your scenario type.'
    };

    return typeInstructions[actualScenarioType] || 'Engage thoughtfully with each scenario and share your experiences and insights.';
  };

  // Generate AI context instructions
  const generateAIContextInstructions = () => {
    const audienceContext = scenarioConfig.audience ? ` The target audience is ${scenarioConfig.audience}.` : '';
    const difficultyContext = ` These are ${scenarioConfig.difficulty}-level scenarios.`;
    
    // Check if it's Amazon Leadership Principles for special context
    const selectedType = scenarioTypes.find(t => t.id === scenarioConfig.type);
    const actualScenarioType = selectedType?.source === 'database' && selectedType.dbPrompt 
      ? selectedType.dbPrompt.scenarioType 
      : scenarioConfig.type;
    const typeContext = actualScenarioType === 'amazon-principles' ? ' Focus on Amazon Leadership Principles and STAR format responses.' : '';

    return `These scenarios are designed for professional development and learning.${audienceContext}${difficultyContext}${typeContext} Provide constructive feedback and encourage specific, detailed responses.`;
  };

  const navigateScenario = (direction) => {
    if (direction === 'prev' && currentScenarioIndex > 0) {
      setCurrentScenarioIndex(currentScenarioIndex - 1);
    } else if (direction === 'next' && currentScenarioIndex < generatedScenarios.length - 1) {
      setCurrentScenarioIndex(currentScenarioIndex + 1);
    }
  };

  const currentScenario = generatedScenarios[currentScenarioIndex];

  // Helper functions for context-aware placeholders
  const getContextPlaceholder = () => {
    const selectedType = scenarioTypes.find(t => t.id === scenarioConfig.type);
    if (selectedType && selectedType.source === 'database' && selectedType.dbPrompt) {
      const prompt = selectedType.dbPrompt;
      // Use database-stored context placeholder if available
      if (prompt.defaultSettings?.contextPlaceholder) {
        return prompt.defaultSettings.contextPlaceholder;
      }
      // Fallback to prompt-specific defaults
      if (prompt.scenarioType === 'amazon-principles') {
        return 'e.g., Startup environment, large enterprise, remote team...';
      } else if (prompt.scenarioType === 'interview-prep') {
        return 'e.g., Software engineering roles, management positions, entry-level...';
      }
    }
    return 'Describe the context, industry, or specific situation...';
  };

  const getAudiencePlaceholder = () => {
    const selectedType = scenarioTypes.find(t => t.id === scenarioConfig.type);
    if (selectedType && selectedType.source === 'database' && selectedType.dbPrompt) {
      const prompt = selectedType.dbPrompt;
      // Use database-stored audience placeholder if available
      if (prompt.defaultSettings?.audiencePlaceholder) {
        return prompt.defaultSettings.audiencePlaceholder;
      }
      // Fallback to prompt-specific defaults
      if (prompt.scenarioType === 'amazon-principles') {
        return 'e.g., Engineering managers, senior engineers, leadership team...';
      } else if (prompt.scenarioType === 'interview-prep') {
        return 'e.g., Job candidates, hiring managers, recent graduates...';
      }
    }
    return 'e.g., Software Engineers, Managers, New Hires...';
  };

  const getMustHaveCategoriesPlaceholder = () => {
    const selectedType = scenarioTypes.find(t => t.id === scenarioConfig.type);
    if (selectedType && selectedType.source === 'database' && selectedType.dbPrompt) {
      const prompt = selectedType.dbPrompt;
      // Use database-stored sample categories if available
      if (prompt.defaultSettings?.sampleCategories) {
        return prompt.defaultSettings.sampleCategories;
      }
      // Fallback to prompt-specific defaults
      if (prompt.scenarioType === 'amazon-principles') {
        return 'Customer Obsession, Ownership, Invent and Simplify...';
      }
    }
    return 'Leadership, Management, Communication...';
  };

  return (
    <div className="ai-scenario-builder-modal">
      <div className="modal-overlay" onClick={onClose}></div>
      <div className="modal-content scenario-builder" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>🤖 AI {engagementType === 'trivia' ? 'Trivia' : engagementType === 'poll' ? 'Poll' : engagementType === 'wavelength' ? 'Wavelength' : 'Scenario'} Builder</h2>
          <button className="close-button" onClick={onClose}>✕</button>
        </div>

        <div className="modal-body">
          {step === 1 && (
            <div className="scenario-type-selection">
              <h3>What type of {engagementType === 'trivia' ? 'trivia questions' : engagementType === 'poll' ? 'poll questions' : engagementType === 'wavelength' ? 'wavelength topics' : 'scenarios'} do you want to create?</h3>
              
              {loadingPrompts ? (
                <div className="loading-prompts">
                  <div className="spinner"></div>
                  <p>Loading available prompt templates...</p>
                </div>
              ) : promptsError ? (
                <div className="prompts-error">
                  <p>⚠️ {promptsError}</p>
                  <p>Using default templates as fallback.</p>
                  <button onClick={fetchAvailablePrompts} className="btn-secondary">
                    Retry Loading
                  </button>
                </div>
              ) : availablePrompts.length === 0 ? (
                <div className="no-prompts">
                  <p>ℹ️ No database prompts found for {engagementType}. Using default templates.</p>
                </div>
              ) : null}
              
              <div className="scenario-types-grid">
                {scenarioTypes.map(type => (
                  <div
                    key={type.id}
                    className="scenario-type-card"
                    onClick={() => handleTypeSelection(type.id)}
                  >
                    <h4>{type.title}</h4>
                    <p>{type.description}</p>
                    {type.source === 'database' && (
                      <span className="prompt-source">📊 Database Template</span>
                    )}
                    {type.source === 'hardcoded' && (
                      <span className="prompt-source">🏗️ Built-in Template</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="scenario-configuration">
              <h3>Configure Your {engagementType === 'trivia' ? 'Trivia Questions' : engagementType === 'poll' ? 'Poll Questions' : engagementType === 'wavelength' ? 'Wavelength Prompts' : 'Scenarios'}</h3>
              <div className="config-form">
                <div className="form-group">
                  <label>Question Set Title</label>
                  <input
                    type="text"
                    value={scenarioConfig.customTitle}
                    onChange={(e) => setScenarioConfig(prev => ({ ...prev, customTitle: e.target.value }))}
                    placeholder={`Enter a title for your ${engagementType === 'trivia' ? 'trivia set' : engagementType === 'poll' ? 'poll set' : engagementType === 'wavelength' ? 'wavelength set' : 'question set'}...`}
                  />
                </div>

                <div className="form-group">
                  <label>Context/Background</label>
                  <textarea
                    value={scenarioConfig.context}
                    onChange={(e) => setScenarioConfig(prev => ({ ...prev, context: e.target.value }))}
                    placeholder={getContextPlaceholder()}
                    rows="3"
                  />
                </div>

                <div className="form-group">
                  <label>Target Audience</label>
                  <input
                    type="text"
                    value={scenarioConfig.audience}
                    onChange={(e) => setScenarioConfig(prev => ({ ...prev, audience: e.target.value }))}
                    placeholder={getAudiencePlaceholder()}
                  />
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label>Number of Categories (Max: 24)</label>
                    <input
                      type="number"
                      min="1"
                      max="24"
                      value={scenarioConfig.numberOfCategories}
                      onChange={(e) => setScenarioConfig(prev => ({ ...prev, numberOfCategories: Math.min(24, Math.max(1, parseInt(e.target.value) || 1)) }))}
                    />
                    <small style={{color: '#666', fontSize: '12px'}}>
                      System supports maximum 24 categories due to bitmask limitations
                    </small>
                  </div>
                  <div className="form-group">
                    <label>Must Have Categories</label>
                    <input
                      type="text"
                      value={scenarioConfig.mustHaveCategories}
                      onChange={(e) => setScenarioConfig(prev => ({ ...prev, mustHaveCategories: e.target.value }))}
                      placeholder={getMustHaveCategoriesPlaceholder()}
                    />
                  </div>
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label>
                      {engagementType === 'trivia' ? 'Difficulty Level' : 'Level of Detail'}
                    </label>
                    <select
                      value={scenarioConfig.difficulty}
                      onChange={(e) => setScenarioConfig(prev => ({ ...prev, difficulty: e.target.value }))}
                    >
                      {engagementType === 'trivia' ? (
                        <>
                          <option value="easy">Easy</option>
                          <option value="medium">Medium</option>
                          <option value="hard">Hard</option>
                        </>
                      ) : (
                        <>
                          <option value="brief">Brief</option>
                          <option value="detailed">Detailed</option>
                          <option value="comprehensive">Comprehensive</option>
                        </>
                      )}
                    </select>
                  </div>

                  <div className="form-group">
                    <label>Number of {engagementType === 'trivia' ? 'Questions' : engagementType === 'poll' ? 'Polls' : engagementType === 'wavelength' ? 'Prompts' : 'Scenarios'}: <strong>{scenarioConfig.count}</strong></label>
                    <div className="quantity-controls">
                      <input
                        type="range"
                        min="1"
                        max="100"
                        value={scenarioConfig.count}
                        onChange={(e) => setScenarioConfig(prev => ({ ...prev, count: parseInt(e.target.value) }))}
                        className="quantity-slider"
                      />
                      <input
                        type="number"
                        min="1"
                        max="100"
                        value={scenarioConfig.count}
                        onChange={(e) => setScenarioConfig(prev => ({ ...prev, count: Math.min(100, Math.max(1, parseInt(e.target.value) || 1)) }))}
                        className="quantity-input"
                      />
                    </div>
                    <div className="quantity-presets">
                      <button type="button" className="preset-btn" onClick={() => setScenarioConfig(prev => ({ ...prev, count: 5 }))}>5</button>
                      <button type="button" className="preset-btn" onClick={() => setScenarioConfig(prev => ({ ...prev, count: 10 }))}>10</button>
                      <button type="button" className="preset-btn" onClick={() => setScenarioConfig(prev => ({ ...prev, count: 20 }))}>20</button>
                      <button type="button" className="preset-btn" onClick={() => setScenarioConfig(prev => ({ ...prev, count: 50 }))}>50</button>
                    </div>
                  </div>
                </div>

                <div className="form-group">
                  <label>Base Prompt & Additional Requirements</label>
                  <textarea
                    value={scenarioConfig.customPrompt}
                    onChange={(e) => setScenarioConfig(prev => ({ ...prev, customPrompt: e.target.value }))}
                    placeholder="Edit the base generation prompt or add specific requirements, themes, or constraints..."
                    rows="4"
                  />
                  <small style={{color: '#666', fontSize: '12px'}}>
                    This shows the base prompt from your selected template. You can edit it or add additional requirements.
                  </small>
                </div>

                <FileUploadPrompt
                  onContentExtracted={(content) => {
                    setScenarioConfig(prev => ({
                      ...prev,
                      customPrompt: prev.customPrompt + '\n\n' + content
                    }));
                  }}
                  acceptedFormats={['.txt', '.pdf', '.md', '.docx']}
                  label="Or upload a document with context/examples"
                />
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="scenario-generation">
              {isGenerating ? (
                <div className="generation-progress">
                  <div className="spinner"></div>
                  <p>{generationStatus}</p>
                </div>
              ) : generatedScenarios.length > 0 ? (
                <div className="scenario-review">
                  <div className="scenario-navigation">
                    <button
                      className="nav-button prev"
                      onClick={() => navigateScenario('prev')}
                      disabled={currentScenarioIndex === 0}
                    >
                      ← Previous
                    </button>
                    
                    <div className="scenario-counter">
                      <span>Scenario {currentScenarioIndex + 1} of {generatedScenarios.length}</span>
                      <h3>{currentScenario?.title}</h3>
                    </div>
                    
                    <button
                      className="nav-button next"
                      onClick={() => navigateScenario('next')}
                      disabled={currentScenarioIndex === generatedScenarios.length - 1}
                    >
                      Next →
                    </button>
                  </div>

                  <div className="scenario-editor">
                    <div className="form-group">
                      <label>Title</label>
                      <input
                        type="text"
                        value={currentScenario?.title || ''}
                        onChange={(e) => handleScenarioEdit(currentScenarioIndex, 'title', e.target.value)}
                      />
                    </div>

                    <div className="form-group">
                      <label>Category</label>
                      <input
                        type="text"
                        value={currentScenario?.category || ''}
                        onChange={(e) => handleScenarioEdit(currentScenarioIndex, 'category', e.target.value)}
                      />
                    </div>

                    <div className="form-group">
                      <label>Scenario Details</label>
                      <textarea
                        value={currentScenario?.detail || ''}
                        onChange={(e) => handleScenarioEdit(currentScenarioIndex, 'detail', e.target.value)}
                        rows="6"
                      />
                    </div>

                    <div className="form-group">
                      <label>Custom Instructions</label>
                      <textarea
                        value={currentScenario?.customInstructions || ''}
                        onChange={(e) => handleScenarioEdit(currentScenarioIndex, 'customInstructions', e.target.value)}
                        rows="2"
                        placeholder="Specific instructions for participants..."
                      />
                    </div>
                  </div>

                  <div className="scenario-actions">
                    <button className="btn-secondary" onClick={handleExportCSV}>
                      📄 Export CSV
                    </button>
                    <button className="btn-primary" onClick={handleLoadIntoSystem}>
                      📥 Load into System
                    </button>
                  </div>
                </div>
              ) : (
                <div className="generation-error">
                  <p>{generationStatus}</p>
                  <button className="btn-secondary" onClick={() => setStep(2)}>
                    ← Back to Configuration
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="modal-footer">
          {step === 1 && (
            <>
              <button className="btn-secondary" onClick={onClose}>
                Cancel
              </button>
            </>
          )}
          {step === 2 && (
            <>
              <button className="btn-secondary" onClick={() => setStep(1)}>
                ← Back
              </button>
              <button className="btn-primary" onClick={handleConfigSubmit}>
                🤖 Generate Scenarios
              </button>
            </>
          )}
          {step === 3 && !isGenerating && generatedScenarios.length > 0 && (
            <>
              <button className="btn-secondary" onClick={() => setStep(2)}>
                ← Back to Configuration
              </button>
              <button className="btn-secondary" onClick={onClose}>
                Cancel
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default AIScenarioBuilder;
