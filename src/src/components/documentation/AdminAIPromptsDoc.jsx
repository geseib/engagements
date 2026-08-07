import React from 'react';
import Icon from '../Icon';

const AdminAIPromptsDoc = () => {
  return (
    <div className="help-content-doc">
      <div className="help-doc-header">
        <h1><Icon name="Sparkle" weight="duotone" size={16} color="var(--primary)" /> AI Prompts Management</h1>
        <p>Learn how to create, manage, and optimize AI prompts for better game analysis</p>
      </div>

      <div className="help-doc-section">
        <h2><Icon name="NotePencil" weight="bold" size={16} color="currentColor" /> Understanding AI Prompts</h2>
        <p>AI prompts are templates that tell the AI how to analyze and summarize game results. They use template variables to insert game data and generate meaningful insights for your team.</p>
        
        <div className="help-info-box">
          <h4><Icon name="Lightbulb" weight="duotone" size={16} color="var(--primary)" /> Key Benefits</h4>
          <ul>
            <li><strong>Consistent Analysis:</strong> Standardized format across all games</li>
            <li><strong>Customizable Insights:</strong> Tailor analysis to your specific needs</li>
            <li><strong>Markdown Formatting:</strong> Beautiful, structured output</li>
            <li><strong>Game-Type Specific:</strong> Different prompts for different engagement types</li>
          </ul>
        </div>
      </div>

      <div className="help-doc-section">
        <h2><Icon name="Wrench" weight="bold" size={16} color="currentColor" /> Creating Custom Prompts</h2>
        
        <h3>Required Structure</h3>
        <p>All AI prompts must use this standardized markdown structure:</p>
        
        <div className="help-code-block">
          <pre>{`## Summary
Your analysis and key insights here

## Discussion Questions
1. First thought-provoking question
2. Second strategic question  
3. Third implementation question

## Next Steps
1. Immediate action for this week
2. Short-term goal for this month
3. Long-term strategic objective`}</pre>
        </div>

        <div className="help-warning-box">
          <h4><Icon name="Warning" weight="fill" size={16} color="var(--primary)" /> Important</h4>
          <p>Always use exactly these headers: <code>## Summary</code>, <code>## Discussion Questions</code>, and <code>## Next Steps</code>. The AI system expects this format.</p>
        </div>
      </div>

      <div className="help-doc-section">
        <h2><Icon name="ChartBar" weight="duotone" size={16} color="var(--primary)" /> Template Variables</h2>
        <p>Use these variables in your prompts to insert game data:</p>

        <h3><Icon name="GameController" weight="bold" size={16} color="currentColor" /> Game Information</h3>
        <div className="help-variables-grid">
          <div className="help-variable-item">
            <code>{'{question}'}</code>
            <span>The question or scenario presented</span>
          </div>
          <div className="help-variable-item">
            <code>{'{gameContext}'}</code>
            <span>Event title and game information</span>
          </div>
          <div className="help-variable-item">
            <code>{'{totalPlayers}'}</code>
            <span>Number of players in the game</span>
          </div>
        </div>

        <h3><Icon name="NotePencil" weight="bold" size={16} color="currentColor" /> Player Responses</h3>
        <div className="help-variables-grid">
          <div className="help-variable-item">
            <code>{'{playerResponses}'}</code>
            <span>All player answers and responses</span>
          </div>
          <div className="help-variable-item">
            <code>{'{correctCount}'}</code>
            <span>Number of players who answered correctly (trivia)</span>
          </div>
        </div>

        <h3><Icon name="Trophy" weight="fill" size={16} color="var(--primary)" /> Scoring & Results</h3>
        <div className="help-variables-grid">
          <div className="help-variable-item">
            <code>{'{totalScores}'}</code>
            <span>Current game leaderboard (Top 5 players)</span>
          </div>
          <div className="help-variable-item">
            <code>{'{cumulativeScores}'}</code>
            <span>Same as totalScores - overall game standings</span>
          </div>
          <div className="help-variable-item">
            <code>{'{roundScores}'}</code>
            <span>Points earned in this question only</span>
          </div>
          <div className="help-variable-item">
            <code>{'{leaderboard}'}</code>
            <span>Full ranking array for custom display</span>
          </div>
        </div>

        <h3><Icon name="Brain" weight="duotone" size={16} color="var(--primary)" /> Trivia-Specific Variables</h3>
        <div className="help-variables-grid">
          <div className="help-variable-item">
            <code>{'{correctAnswer}'}</code>
            <span>The correct answer for trivia questions</span>
          </div>
          <div className="help-variable-item">
            <code>{'{answerDetails}'}</code>
            <span>Educational explanation of the answer</span>
          </div>
          <div className="help-variable-item">
            <code>{'{difficulty}'}</code>
            <span>Question difficulty level (easy/medium/hard)</span>
          </div>
          <div className="help-variable-item">
            <code>{'{questionExplanation}'}</code>
            <span>Detailed explanation for science topics</span>
          </div>
        </div>
      </div>

      <div className="help-doc-section">
        <h2><Icon name="Lightbulb" weight="duotone" size={16} color="var(--primary)" /> Example Prompt</h2>
        <p>Here's a complete example for trivia games:</p>
        
        <div className="help-code-block">
          <pre>{`You are an educational expert analyzing trivia game results.

**Question**: {question}
**Team Performance**: {playerResponses}
**Current Leaderboard**: {totalScores}

## Summary
Great work team! {correctCount} out of {totalPlayers} players got this right. 
The correct answer was "{correctAnswer}". {answerDetails}

Looking at our current standings: {totalScores}

## Discussion Questions
1. **Knowledge Application**: How does this knowledge apply to our work?
2. **Learning Opportunity**: What surprised you about this topic?
3. **Team Strategy**: How can we build on what we learned?

## Next Steps
1. **This Week**: Research one related topic that interests you
2. **This Month**: Share interesting facts with the team
3. **Ongoing**: Keep building our collective knowledge base`}</pre>
        </div>
      </div>

      <div className="help-doc-section">
        <h2><Icon name="Gear" weight="bold" size={16} color="currentColor" /> Managing Prompts</h2>
        
        <h3>Setting Default Prompts</h3>
        <p>Each engagement type (Call & Answer, Trivia, Polls) should have a default prompt:</p>
        <ol>
          <li>Go to the AI Prompts tab in Admin</li>
          <li>Find your prompt in the list</li>
          <li>Click the "Set as Default" button</li>
          <li>Confirm the change</li>
        </ol>

        <h3>Activating/Deactivating Prompts</h3>
        <p>Control which prompts are available for use:</p>
        <ul>
          <li><strong>Active prompts</strong> appear in dropdown lists when creating games</li>
          <li><strong>Inactive prompts</strong> are hidden but preserved for future use</li>
          <li>Use the toggle switch next to each prompt to change status</li>
        </ul>

        <h3>Editing Prompts</h3>
        <p>You can modify existing prompts at any time:</p>
        <ol>
          <li>Click the "Edit" button next to the prompt</li>
          <li>Make your changes in the editor</li>
          <li>Preview with sample data if available</li>
          <li>Save your changes</li>
        </ol>

        <div className="help-tip-box">
          <h4><Icon name="Lightbulb" weight="duotone" size={16} color="var(--primary)" /> Pro Tip</h4>
          <p>Create different prompts for different contexts. For example, have separate prompts for team building vs. training sessions, even if they use the same engagement type.</p>
        </div>
      </div>

      <div className="help-doc-section">
        <h2><Icon name="Target" weight="duotone" size={16} color="var(--primary)" /> Best Practices</h2>
        
        <div className="help-best-practices">
          <div className="help-practice-item">
            <h4><Icon name="NotePencil" weight="bold" size={16} color="currentColor" /> Clear Instructions</h4>
            <p>Start your prompt with clear instructions about the AI's role and what kind of analysis you want.</p>
          </div>
          
          <div className="help-practice-item">
            <h4><Icon name="Palette" weight="duotone" size={16} color="var(--primary)" /> Engaging Tone</h4>
            <p>Use an appropriate tone for your audience - professional for business, encouraging for learning, etc.</p>
          </div>
          
          <div className="help-practice-item">
            <h4><Icon name="MagnifyingGlass" weight="bold" size={16} color="currentColor" /> Specific Questions</h4>
            <p>Make discussion questions specific and actionable rather than generic.</p>
          </div>
          
          <div className="help-practice-item">
            <h4><Icon name="Lightning" weight="fill" size={16} color="var(--primary)" /> Actionable Steps</h4>
            <p>Ensure next steps are concrete and achievable within the suggested timeframes.</p>
          </div>
          
          <div className="help-practice-item">
            <h4><Icon name="ChartBar" weight="duotone" size={16} color="var(--primary)" /> Use Score Data</h4>
            <p>Include {'{totalScores}'} to show overall game standings, not just round results.</p>
          </div>
        </div>
      </div>

      <div className="help-doc-section">
        <h2><Icon name="Wrench" weight="bold" size={16} color="currentColor" /> Troubleshooting</h2>
        
        <h3>Common Issues</h3>
        <dl className="help-faq">
          <dt>My prompt generates weird formatting</dt>
          <dd>Check that you're using the exact headers: <code>## Summary</code>, <code>## Discussion Questions</code>, <code>## Next Steps</code></dd>
          
          <dt>Variables aren't being replaced</dt>
          <dd>Ensure you're using curly braces: <code>{'{variable}'}</code> not <code>[variable]</code> or <code>(variable)</code></dd>
          
          <dt>AI output is too generic</dt>
          <dd>Add more specific instructions and context to guide the AI's analysis</dd>
          
          <dt>Prompt doesn't appear in game setup</dt>
          <dd>Check that the prompt is marked as "Active" and matches the game type you're creating</dd>
        </dl>
      </div>
    </div>
  );
};

export default AdminAIPromptsDoc;