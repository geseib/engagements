import React, { useState } from 'react';

const API_BASE = window.API_BASE;

function AIScenarioBuilder({ onClose, onScenariosGenerated, engagementType = 'call-and-answer' }) {
  const [step, setStep] = useState(1);
  const [scenarioConfig, setScenarioConfig] = useState({
    type: '',
    context: '',
    audience: '',
    difficulty: 'medium',
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

  // Define scenario types based on engagement type
  const getScenarioTypes = (engagementType) => {
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

  const scenarioTypes = getScenarioTypes(engagementType);

  // Template prefilling based on scenario type
  const getTemplateDefaults = (scenarioType) => {
    const templates = {
      'lessons-learned': {
        customTitle: 'Lessons Learned Workshop',
        context: 'Professional development workshop focusing on real-world challenges and the valuable lessons learned from them',
        audience: 'Team leaders, project managers, and experienced professionals',
        numberOfCategories: 4,
        mustHaveCategories: 'Leadership, Project Management, Team Dynamics, Problem Resolution'
      },
      'problem-solving': {
        customTitle: 'Problem-Solving Challenge Session',
        context: 'Interactive session designed to tackle current workplace challenges through collaborative problem-solving',
        audience: 'Cross-functional teams, managers, and solution-oriented professionals',
        numberOfCategories: 5,
        mustHaveCategories: 'Technical Challenges, Process Improvement, Team Collaboration, Innovation, Risk Management'
      },
      'interview-prep': {
        customTitle: 'Interview Preparation Workshop',
        context: 'Comprehensive practice session for job interviews with scenario-based questions',
        audience: 'Job seekers, career changers, and professionals seeking advancement',
        numberOfCategories: 3,
        mustHaveCategories: 'Behavioral Questions, Technical Skills, Situational Judgment'
      },
      'amazon-principles': {
        customTitle: 'Amazon Leadership Principles Workshop',
        context: 'Deep dive into Amazon\'s 16 Leadership Principles through real-world scenarios and STAR method practice',
        audience: 'Amazon employees, leadership candidates, and professionals interested in Amazon culture',
        numberOfCategories: 4,
        mustHaveCategories: 'Customer Obsession, Ownership, Invent & Simplify, Bias for Action'
      },
      'team-building': {
        customTitle: 'Team Building Workshop',
        context: 'Collaborative exercises designed to strengthen team bonds and improve communication',
        audience: 'Team members, project groups, and departments looking to improve collaboration',
        numberOfCategories: 3,
        mustHaveCategories: 'Communication, Trust Building, Conflict Resolution'
      },
      'custom': {
        customTitle: 'Custom Scenario Workshop',
        context: 'Tailored scenarios based on specific organizational needs and requirements',
        audience: 'Customized based on requirements',
        numberOfCategories: 3,
        mustHaveCategories: ''
      }
    };

    return templates[scenarioType] || templates['custom'];
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
      
      let basePrompt = selectedType.prompt;
      if (scenarioConfig.context) {
        basePrompt += `\n\nContext: ${scenarioConfig.context}`;
      }
      if (scenarioConfig.audience) {
        basePrompt += `\nAudience: ${scenarioConfig.audience}`;
      }
      if (scenarioConfig.customPrompt) {
        basePrompt += `\n\nAdditional Requirements: ${scenarioConfig.customPrompt}`;
      }

      basePrompt += `\n\nDifficulty Level: ${scenarioConfig.difficulty}`;
      basePrompt += `\nNumber of categories needed: ${scenarioConfig.numberOfCategories}`;
      
      if (scenarioConfig.mustHaveCategories) {
        basePrompt += `\nMust include these categories: ${scenarioConfig.mustHaveCategories}`;
      }

      // Break large requests into chunks to avoid timeout
      const CHUNK_SIZE = 10; // Generate max 10 scenarios per request
      const totalCount = scenarioConfig.count;
      const chunks = Math.ceil(totalCount / CHUNK_SIZE);
      
      let allScenarios = [];
      
      for (let i = 0; i < chunks; i++) {
        const remainingCount = totalCount - (i * CHUNK_SIZE);
        const chunkSize = Math.min(CHUNK_SIZE, remainingCount);
        
        setGenerationStatus(`🤖 Generating batch ${i + 1} of ${chunks} (${chunkSize} scenarios)...`);
        
        const chunkPrompt = basePrompt + `\nNumber of scenarios needed: ${chunkSize}`;
        
        const response = await fetch(`${API_BASE}admin/ai-generate-scenarios`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            scenarioType: scenarioConfig.type,
            prompt: chunkPrompt,
            count: chunkSize,
            difficulty: scenarioConfig.difficulty,
            context: scenarioConfig.context,
            audience: scenarioConfig.audience,
            customPrompt: scenarioConfig.customPrompt,
            customTitle: scenarioConfig.customTitle,
            numberOfCategories: scenarioConfig.numberOfCategories,
            mustHaveCategories: scenarioConfig.mustHaveCategories
          })
        });

        const result = await response.json();

        if (response.ok) {
          allScenarios.push(...result.scenarios);
          setGenerationStatus(`✅ Generated ${allScenarios.length} of ${totalCount} scenarios...`);
        } else {
          throw new Error(`Batch ${i + 1} failed: ${result.error || 'Unknown error'}`);
        }
        
        // Small delay between requests to avoid overwhelming the API
        if (i < chunks - 1) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }

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
    a.download = `${scenarioConfig.type}-scenarios-${Date.now()}.csv`;
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

    const typeNames = {
      'amazon-principles': 'Amazon Leadership Principles',
      'interview-prep': 'Interview Preparation',
      'problem-solving': 'Problem-Solving Challenges',
      'lessons-learned': 'Lessons Learned',
      'team-building': 'Team Building Exercises',
      'custom': 'Custom Scenarios'
    };

    const typeName = typeNames[scenarioConfig.type] || 'Professional Development';
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
    const typeInstructions = {
      'amazon-principles': 'Answer using the STAR format (Situation, Task, Action, Results). Focus on demonstrating specific leadership principles through real examples.',
      'interview-prep': 'Practice answering these questions with specific examples from your experience. Be prepared to provide concrete details and measurable results.',
      'problem-solving': 'Work through these challenges systematically. Consider multiple solutions and discuss the pros and cons of each approach.',
      'lessons-learned': 'Share specific experiences and focus on what was learned and how it changed your approach going forward.',
      'team-building': 'Engage in open discussion and listen to different perspectives. Focus on building understanding and collaboration.',
      'custom': 'Follow the specific guidelines provided for your scenario type.'
    };

    return typeInstructions[scenarioConfig.type] || 'Engage thoughtfully with each scenario and share your experiences and insights.';
  };

  // Generate AI context instructions
  const generateAIContextInstructions = () => {
    const audienceContext = scenarioConfig.audience ? ` The target audience is ${scenarioConfig.audience}.` : '';
    const difficultyContext = ` These are ${scenarioConfig.difficulty}-level scenarios.`;
    const typeContext = scenarioConfig.type === 'amazon-principles' ? ' Focus on Amazon Leadership Principles and STAR format responses.' : '';

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

  return (
    <div className="ai-scenario-builder-modal">
      <div className="modal-overlay" onClick={onClose}></div>
      <div className="modal-content scenario-builder" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>🤖 AI {engagementType === 'trivia' ? 'Trivia' : engagementType === 'poll' ? 'Poll' : 'Scenario'} Builder</h2>
          <button className="close-button" onClick={onClose}>✕</button>
        </div>

        <div className="modal-body">
          {step === 1 && (
            <div className="scenario-type-selection">
              <h3>What type of {engagementType === 'trivia' ? 'trivia questions' : engagementType === 'poll' ? 'poll questions' : 'scenarios'} do you want to create?</h3>
              <div className="scenario-types-grid">
                {scenarioTypes.map(type => (
                  <div
                    key={type.id}
                    className="scenario-type-card"
                    onClick={() => handleTypeSelection(type.id)}
                  >
                    <h4>{type.title}</h4>
                    <p>{type.description}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="scenario-configuration">
              <h3>Configure Your Scenarios</h3>
              <div className="config-form">
                <div className="form-group">
                  <label>Workshop Title</label>
                  <input
                    type="text"
                    value={scenarioConfig.customTitle}
                    onChange={(e) => setScenarioConfig(prev => ({ ...prev, customTitle: e.target.value }))}
                    placeholder="Enter a title for your workshop..."
                  />
                </div>

                <div className="form-group">
                  <label>Context/Background</label>
                  <textarea
                    value={scenarioConfig.context}
                    onChange={(e) => setScenarioConfig(prev => ({ ...prev, context: e.target.value }))}
                    placeholder="Describe the context, industry, or specific situation..."
                    rows="3"
                  />
                </div>

                <div className="form-group">
                  <label>Target Audience</label>
                  <input
                    type="text"
                    value={scenarioConfig.audience}
                    onChange={(e) => setScenarioConfig(prev => ({ ...prev, audience: e.target.value }))}
                    placeholder="e.g., Software Engineers, Managers, New Hires..."
                  />
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label>Number of Categories</label>
                    <input
                      type="number"
                      min="1"
                      max="10"
                      value={scenarioConfig.numberOfCategories}
                      onChange={(e) => setScenarioConfig(prev => ({ ...prev, numberOfCategories: Math.min(10, Math.max(1, parseInt(e.target.value) || 1)) }))}
                    />
                  </div>
                  <div className="form-group">
                    <label>Must Have Categories</label>
                    <input
                      type="text"
                      value={scenarioConfig.mustHaveCategories}
                      onChange={(e) => setScenarioConfig(prev => ({ ...prev, mustHaveCategories: e.target.value }))}
                      placeholder="Leadership, Management, Communication..."
                    />
                  </div>
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label>Difficulty Level</label>
                    <select
                      value={scenarioConfig.difficulty}
                      onChange={(e) => setScenarioConfig(prev => ({ ...prev, difficulty: e.target.value }))}
                    >
                      <option value="easy">Easy</option>
                      <option value="medium">Medium</option>
                      <option value="hard">Hard</option>
                    </select>
                  </div>

                  <div className="form-group">
                    <label>Number of Scenarios: <strong>{scenarioConfig.count}</strong></label>
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
                  <label>Additional Requirements (Optional)</label>
                  <textarea
                    value={scenarioConfig.customPrompt}
                    onChange={(e) => setScenarioConfig(prev => ({ ...prev, customPrompt: e.target.value }))}
                    placeholder="Any specific requirements, themes, or constraints..."
                    rows="2"
                  />
                </div>
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
        </div>
      </div>
    </div>
  );
}

export default AIScenarioBuilder;
