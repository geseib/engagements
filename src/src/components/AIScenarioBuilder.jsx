import React, { useState } from 'react';

const API_BASE = window.API_BASE;

function AIScenarioBuilder({ onClose, onScenariosGenerated }) {
  const [step, setStep] = useState(1);
  const [scenarioConfig, setScenarioConfig] = useState({
    type: '',
    context: '',
    audience: '',
    difficulty: 'medium',
    count: 5,
    customPrompt: ''
  });
  const [generatedScenarios, setGeneratedScenarios] = useState([]);
  const [currentScenarioIndex, setCurrentScenarioIndex] = useState(0);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationStatus, setGenerationStatus] = useState('');

  const scenarioTypes = [
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

  const handleTypeSelection = (type) => {
    setScenarioConfig(prev => ({ ...prev, type }));
    setStep(2);
  };

  const handleConfigSubmit = async () => {
    console.log('🤖 Starting AI scenario generation...', scenarioConfig);
    setIsGenerating(true);
    setGenerationStatus('🤖 Generating scenarios with AI...');
    setStep(3);

    try {
      const selectedType = scenarioTypes.find(t => t.id === scenarioConfig.type);
      
      let prompt = selectedType.prompt;
      if (scenarioConfig.context) {
        prompt += `\n\nContext: ${scenarioConfig.context}`;
      }
      if (scenarioConfig.audience) {
        prompt += `\nAudience: ${scenarioConfig.audience}`;
      }
      if (scenarioConfig.customPrompt) {
        prompt += `\n\nAdditional Requirements: ${scenarioConfig.customPrompt}`;
      }

      prompt += `\n\nDifficulty Level: ${scenarioConfig.difficulty}`;
      prompt += `\nNumber of scenarios needed: ${scenarioConfig.count}`;

      const response = await fetch(`${API_BASE}admin/ai-generate-scenarios`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          scenarioType: scenarioConfig.type,
          prompt: prompt,
          count: scenarioConfig.count,
          difficulty: scenarioConfig.difficulty
        })
      });

      const result = await response.json();

      if (response.ok) {
        setGeneratedScenarios(result.scenarios);
        setGenerationStatus(`✅ Generated ${result.scenarios.length} scenarios successfully`);
        setCurrentScenarioIndex(0);
      } else {
        setGenerationStatus(`❌ Generation failed: ${result.error || 'Unknown error'}`);
      }
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
    const rows = generatedScenarios.map((scenario, index) => {
      return `"${scenario.category}","${index + 1}","${scenario.title}","${scenario.detail}","${scenario.school || 'Professional Development'}","${scenario.customInstructions || ''}"`;
    });
    return headers + '\n' + rows.join('\n');
  };

  const handleLoadIntoSystem = () => {
    onScenariosGenerated(generatedScenarios);
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
          <h2>🤖 AI Scenario Builder</h2>
          <button className="close-button" onClick={onClose}>✕</button>
        </div>

        <div className="modal-body">
          {step === 1 && (
            <div className="scenario-type-selection">
              <h3>What type of scenarios do you want to create?</h3>
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
