import React from 'react';
import './documentation.css';
import Icon from '../Icon';

const HostQuickStartDoc = () => {
  return (
    <div className="help-content-doc">
      <div className="help-doc-header">
        <h1><Icon name="RocketLaunch" weight="duotone" size={16} color="var(--primary)" /> Host Quick Start Guide</h1>
        <p>Create and run your first engagement in 5 minutes</p>
      </div>

      <div className="help-doc-section">
        <h2><Icon name="Target" weight="duotone" size={16} color="var(--primary)" /> Overview</h2>
        <p>This guide will walk you through creating and running your first engagement session. You'll learn the essential workflow that every host needs to know.</p>
        
        <div className="help-feature-grid">
          <div className="help-feature-item">
            <span className="help-feature-icon"><Icon name="Lightning" weight="fill" size={16} color="var(--primary)" /></span>
            <h4>5 Minutes</h4>
            <p>From zero to running game</p>
          </div>
          <div className="help-feature-item">
            <span className="help-feature-icon"><Icon name="DeviceMobile" weight="bold" size={16} color="currentColor" /></span>
            <h4>Any Device</h4>
            <p>Works on phones, tablets, laptops</p>
          </div>
          <div className="help-feature-item">
            <span className="help-feature-icon"><Icon name="UsersThree" weight="bold" size={16} color="currentColor" /></span>
            <h4>Real-time</h4>
            <p>Live updates for all players</p>
          </div>
          <div className="help-feature-item">
            <span className="help-feature-icon"><Icon name="Brain" weight="duotone" size={16} color="var(--primary)" /></span>
            <h4>AI-Powered</h4>
            <p>Intelligent analysis and insights</p>
          </div>
        </div>
      </div>

      <div className="help-doc-section">
        <h2><Icon name="Lightning" weight="fill" size={16} color="var(--primary)" /> The Essential Workflow</h2>
        
        <ol className="help-steps">
          <li>
            <strong>Create Game</strong>
            <p>Set up your session with a question set and configure options</p>
          </li>
          <li>
            <strong>Start Game</strong>
            <p>Make it joinable for players and share the QR code</p>
          </li>
          <li>
            <strong>Present Questions</strong>
            <p>Guide players through questions, answers, and voting</p>
          </li>
          <li>
            <strong>View Results</strong>
            <p>See real-time results and AI-powered insights</p>
          </li>
        </ol>
      </div>

      <div className="help-doc-section">
        <h2><Icon name="GameController" weight="bold" size={16} color="currentColor" /> Step 1: Create Your Game</h2>
        
        <h3>Getting Started</h3>
        <ol>
          <li>Click <strong>"Create New Game"</strong> on the welcome screen</li>
          <li>Enter an <strong>Event Title</strong> (e.g., "Team Strategy Session", "Friday Trivia")</li>
          <li>Choose a <strong>Question Set</strong> from the dropdown</li>
          <li>Select <strong>Categories</strong> you want to include (optional)</li>
          <li>Click <strong>"Create Game"</strong></li>
        </ol>

        <div className="help-info-box">
          <h4><Icon name="Lightbulb" weight="duotone" size={16} color="var(--primary)" /> Question Set Types</h4>
          <ul>
            <li><strong>Call & Answer:</strong> Open discussion questions where players submit text responses</li>
            <li><strong>Trivia:</strong> Multiple choice knowledge questions with correct answers</li>
            <li><strong>Polls:</strong> Opinion questions for gathering team preferences</li>
          </ul>
        </div>

        <h3>Game Configuration Options</h3>
        <ul>
          <li><strong>Public/Private:</strong> Public games are discoverable, private require access codes</li>
          <li><strong>Categories:</strong> Filter questions by topic (leadership, strategy, fun facts, etc.)</li>
          <li><strong>Question Sets:</strong> Pre-built collections of questions for specific purposes</li>
        </ul>
      </div>

      <div className="help-doc-section">
        <h2><Icon name="Warning" weight="fill" size={16} color="var(--primary)" /> Step 2: Start Your Game</h2>
        
        <p>After creating, your game is in "CREATED" status - players can't join yet.</p>
        
        <ol>
          <li>Click the <strong>"Start Game"</strong> button</li>
          <li>Game status changes to "STARTED" - now players can join</li>
          <li>Share the <strong>QR code</strong> or <strong>join URL</strong> with players</li>
          <li>Watch players join in real-time in the sidebar</li>
        </ol>

        <div className="help-tip-box">
          <h4><Icon name="Lightbulb" weight="duotone" size={16} color="var(--primary)" /> Pro Tips</h4>
          <ul>
            <li>Click the QR code to expand it for easier scanning</li>
            <li>You can start with just a few players and let others join during the game</li>
            <li>The join URL works great for remote teams in video calls</li>
          </ul>
        </div>
      </div>

      <div className="help-doc-section">
        <h2><Icon name="Question" weight="bold" size={16} color="currentColor" /> Step 3: Present Questions</h2>
        
        <h3>Starting Questions</h3>
        <ol>
          <li>Once players have joined, click <strong>"Begin Questions"</strong></li>
          <li>The first question will appear automatically</li>
          <li>Read the question aloud to your team</li>
          <li>Give players time to submit their responses</li>
        </ol>

        <h3>The Question Flow</h3>
        <p>Each question follows this pattern:</p>
        
        <ol className="phase-flow">
          <li className="phase-flow__step">
            <span className="phase-flow__name">ASK</span>
            <span className="phase-flow__desc">Players respond</span>
          </li>
          <li className="phase-flow__arrow" aria-hidden="true">
            <Icon name="ArrowRight" weight="bold" size={18} color="var(--muted)" />
          </li>
          <li className="phase-flow__step">
            <span className="phase-flow__name">VOTE</span>
            <span className="phase-flow__desc">Players vote on answers</span>
          </li>
          <li className="phase-flow__arrow" aria-hidden="true">
            <Icon name="ArrowRight" weight="bold" size={18} color="var(--muted)" />
          </li>
          <li className="phase-flow__step">
            <span className="phase-flow__name">RESULTS</span>
            <span className="phase-flow__desc">View results &amp; insights</span>
          </li>
        </ol>
        <p className="phase-flow__note">
          Trivia and Wavelength skip the VOTE phase — they go straight from ASK to RESULTS.
        </p>

        <h3>For Call & Answer Questions</h3>
        <ol>
          <li><strong>ASK:</strong> Players submit written responses</li>
          <li><strong>VOTE:</strong> Players rank each other's answers (1st, 2nd, 3rd place)</li>
          <li><strong>RESULTS:</strong> See rankings and AI analysis</li>
        </ol>

        <h3>For Trivia Questions</h3>
        <ol>
          <li><strong>ASK:</strong> Players select from multiple choice options</li>
          <li><strong>VOTE:</strong> Automatic - no voting needed</li>
          <li><strong>RESULTS:</strong> See correct answer, scores, and explanations</li>
        </ol>

        <div className="help-warning-box">
          <h4><Icon name="Warning" weight="fill" size={16} color="var(--primary)" /> Important</h4>
          <p>Don't rush the phases! Give players adequate time to think and respond. You can see their progress in the sidebar.</p>
        </div>
      </div>

      <div className="help-doc-section">
        <h2><Icon name="ChartBar" weight="duotone" size={16} color="var(--primary)" /> Step 4: View Results & Insights</h2>
        
        <h3>Real-time Results</h3>
        <p>After each question, you'll see:</p>
        <ul>
          <li><strong>Player Rankings:</strong> Who scored points this round</li>
          <li><strong>Response Quality:</strong> Best answers and insights</li>
          <li><strong>Leaderboard:</strong> Overall game standings</li>
          <li><strong>AI Analysis:</strong> Intelligent summary and discussion points</li>
        </ul>

        <h3>AI-Powered Insights</h3>
        <p>The AI automatically generates:</p>
        <ul>
          <li><strong>Summary:</strong> Key themes and insights from responses</li>
          <li><strong>Discussion Questions:</strong> Thought-provoking follow-up questions</li>
          <li><strong>Next Steps:</strong> Actionable recommendations for your team</li>
        </ul>

        <h3>Moving Through Questions</h3>
        <ul>
          <li>Click <strong>"Next Question"</strong> to continue</li>
          <li>Previous results remain accessible in the sidebar</li>
          <li>Generate reports at any time during or after the game</li>
        </ul>
      </div>

      <div className="help-doc-section">
        <h2><Icon name="DeviceMobile" weight="bold" size={16} color="currentColor" /> Mobile & Multi-Device Tips</h2>
        
        <h3>Host Remote</h3>
        <p>Use a second device for remote control:</p>
        <ol>
          <li>Open the game URL on your phone/tablet</li>
          <li>Add <code>/remote</code> to the end of the URL</li>
          <li>Control the game from your mobile device</li>
          <li>Perfect for walking around the room while presenting</li>
        </ol>

        <h3>Screen Sharing</h3>
        <ul>
          <li>Great for remote teams on video calls</li>
          <li>Share your browser window showing the game</li>
          <li>Players join on their own devices</li>
          <li>Everyone can see results in real-time</li>
        </ul>
      </div>

      <div className="help-doc-section">
        <h2><Icon name="Target" weight="duotone" size={16} color="var(--primary)" /> Success Tips</h2>
        
        <div className="help-best-practices">
          <div className="help-practice-item">
            <h4><Icon name="Microphone" weight="bold" size={16} color="currentColor" /> Engage Your Audience</h4>
            <p>Read questions aloud, encourage participation, and discuss results with the team.</p>
          </div>
          
          <div className="help-practice-item">
            <h4><Icon name="Timer" weight="bold" size={16} color="var(--primary)" /> Manage Time</h4>
            <p>Allow enough time for thoughtful responses but keep energy high with good pacing.</p>
          </div>
          
          <div className="help-practice-item">
            <h4><Icon name="Handshake" weight="duotone" size={16} color="var(--primary)" /> Encourage Participation</h4>
            <p>Create a safe space for all opinions and celebrate creative thinking.</p>
          </div>
          
          <div className="help-practice-item">
            <h4><Icon name="ChatCircleText" weight="bold" size={16} color="currentColor" /> Use AI Insights</h4>
            <p>Share the AI-generated discussion questions to spark deeper conversations.</p>
          </div>
          
          <div className="help-practice-item">
            <h4><Icon name="ClipboardText" weight="bold" size={16} color="currentColor" /> Follow Up</h4>
            <p>Save reports and use the "Next Steps" recommendations for future action.</p>
          </div>
          
          <div className="help-practice-item">
            <h4><Icon name="Wrench" weight="bold" size={16} color="currentColor" /> Test First</h4>
            <p>Try a quick practice run with a small group before important sessions.</p>
          </div>
        </div>
      </div>

      <div className="help-doc-section">
        <h2><Icon name="Question" weight="bold" size={16} color="currentColor" /> Common Questions</h2>
        
        <dl className="help-faq">
          <dt>What if players join late?</dt>
          <dd>No problem! They can join anytime and will participate in upcoming questions. They won't see previous responses but can catch up on scoring.</dd>
          
          <dt>Can I skip questions or go back?</dt>
          <dd>You control the flow completely. You can advance to the next question anytime or stay on results as long as needed for discussion.</dd>
          
          <dt>What if someone disconnects?</dt>
          <dd>Players can rejoin using the same URL and name. Their previous responses and scores are preserved.</dd>
          
          <dt>How many players can join?</dt>
          <dd>The platform supports large groups (100+ players), but optimal engagement typically happens with 5-50 participants.</dd>
          
          <dt>Can I reuse games?</dt>
          <dd>Each game is a unique session, but you can create new games with the same question sets as many times as you want.</dd>
        </dl>
      </div>

      <div className="help-doc-section">
        <h2><Icon name="RocketLaunch" weight="duotone" size={16} color="var(--primary)" /> Ready to Start?</h2>
        <p>You now have everything you need to run successful engagement sessions! Remember:</p>
        <ul>
          <li>Start simple with a small group</li>
          <li>Focus on creating good discussions</li>
          <li>Use the AI insights to add value</li>
          <li>Have fun and learn together!</li>
        </ul>
        
        <div className="help-tip-box">
          <h4><Icon name="Target" weight="duotone" size={16} color="var(--primary)" /> Next Steps</h4>
          <p>Ready to dive deeper? Check out the complete Host Documentation for advanced features like custom question sets, detailed reporting, and engagement optimization strategies.</p>
        </div>
      </div>
    </div>
  );
};

export default HostQuickStartDoc;