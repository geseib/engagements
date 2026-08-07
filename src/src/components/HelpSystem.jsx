import React, { useState, useEffect } from 'react';
import AdminAIPromptsDoc from './documentation/AdminAIPromptsDoc';
import HostQuickStartDoc from './documentation/HostQuickStartDoc';
import './HelpSystem.css';
import Icon from './Icon';

const HelpSystem = ({ section, onClose }) => {
  const [currentDoc, setCurrentDoc] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [navigationHistory, setNavigationHistory] = useState([]);

  // Documentation structure
  const documentation = {
    admin: {
      title: "Admin Documentation",
      icon: "Gear",
      sections: [
        {
          id: "getting-started",
          title: "Getting Started",
          content: "admin-getting-started"
        },
        {
          id: "ai-prompts",
          title: "AI Prompts Management", 
          content: "admin-ai-prompts"
        },
        {
          id: "question-sets",
          title: "Question Sets Management",
          content: "admin-question-sets"
        },
        {
          id: "ai-builders",
          title: "AI Builders Guide",
          content: "admin-ai-builders"
        },
        {
          id: "game-management",
          title: "Game Administration",
          content: "admin-game-management"
        }
      ]
    },
    host: {
      title: "Host Documentation",
      icon: "GameController",
      sections: [
        {
          id: "quick-start",
          title: "Quick Start Guide",
          content: "host-quick-start"
        },
        {
          id: "game-setup",
          title: "Game Setup",
          content: "host-game-setup"
        },
        {
          id: "running-engagements",
          title: "Running Engagements",
          content: "host-running-engagements"
        },
        {
          id: "player-management",
          title: "Player Management",
          content: "host-player-management"
        },
        {
          id: "reporting",
          title: "Results & Reporting",
          content: "host-reporting"
        }
      ]
    },
    player: {
      title: "Player Documentation",
      icon: "UsersThree",
      sections: [
        {
          id: "getting-started",
          title: "Getting Started",
          content: "player-getting-started"
        },
        {
          id: "joining-games",
          title: "Joining Games",
          content: "player-joining"
        },
        {
          id: "playing-games",
          title: "Playing Games",
          content: "player-playing"
        },
        {
          id: "scoring",
          title: "Scoring & Rankings",
          content: "player-scoring"
        }
      ]
    },
    builder: {
      title: "Builder Documentation", 
      icon: "Buildings",
      sections: [
        {
          id: "manual-creation",
          title: "Manual Question Creation",
          content: "builder-manual"
        },
        {
          id: "ai-assistance",
          title: "AI Assistant Features",
          content: "builder-ai"
        }
      ]
    },
    technical: {
      title: "Technical Documentation",
      icon: "Wrench",
      sections: [
        {
          id: "troubleshooting",
          title: "Troubleshooting",
          content: "technical-troubleshooting"
        },
        {
          id: "system-requirements",
          title: "System Requirements",
          content: "technical-requirements"
        }
      ]
    }
  };

  useEffect(() => {
    if (section) {
      setCurrentDoc(section);
    } else {
      setCurrentDoc('home');
    }
  }, [section]);

  const navigateToDoc = (docId) => {
    if (currentDoc && currentDoc !== 'home') {
      setNavigationHistory(prev => [currentDoc, ...prev.slice(0, 9)]); // Keep last 10
    }
    setCurrentDoc(docId);
  };

  const navigateBack = () => {
    if (navigationHistory.length > 0) {
      const previousDoc = navigationHistory[0];
      setNavigationHistory(prev => prev.slice(1));
      setCurrentDoc(previousDoc);
    } else {
      setCurrentDoc('home');
    }
  };

  const renderNavigation = () => (
    <div className="help-navigation">
      <div className="help-nav-header">
        <button className="help-back-btn" onClick={navigateBack} disabled={!navigationHistory.length && currentDoc === 'home'}>
          <Icon name="ArrowLeft" weight="bold" size={16} color="currentColor" /> Back
        </button>
        <button className="help-home-btn" onClick={() => setCurrentDoc('home')}>
          <Icon name="House" weight="bold" size={16} color="currentColor" /> Home
        </button>
        <div className="help-search">
          <input
            type="text"
            placeholder="Search documentation..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="help-search-input"
          />
        </div>
      </div>
    </div>
  );

  const renderHome = () => (
    <div className="help-home">
      <div className="help-home-header">
        <h1><Icon name="Books" weight="duotone" size={16} color="var(--primary)" /> Engagements Platform Documentation</h1>
        <p>Welcome to the comprehensive help system for the Engagements real-time engagement platform. 
           Select your role below to get started with role-specific documentation.</p>
      </div>
      
      <div className="help-role-grid">
        {Object.entries(documentation).map(([key, section]) => (
          <div key={key} className="help-role-card" onClick={() => navigateToDoc(key)}>
            <div className="help-role-icon"><Icon name={section.icon} weight="duotone" size={28} color="var(--primary)" /></div>
            <h3>{section.title}</h3>
            <p>{section.sections.length} guides available</p>
            <div className="help-role-sections">
              {section.sections.slice(0, 3).map(subsection => (
                <span key={subsection.id} className="help-role-preview">
                  {subsection.title}
                </span>
              ))}
              {section.sections.length > 3 && <span className="help-role-more">+{section.sections.length - 3} more</span>}
            </div>
          </div>
        ))}
      </div>

      <div className="help-quick-links">
        <h3><Icon name="RocketLaunch" weight="duotone" size={16} color="var(--primary)" /> Quick Start</h3>
        <div className="help-quick-grid">
          <button className="help-quick-btn" onClick={() => navigateToDoc('host-quick-start')}>
            Create Your First Game
          </button>
          <button className="help-quick-btn" onClick={() => navigateToDoc('admin-ai-prompts')}>
            Setup AI Prompts
          </button>
          <button className="help-quick-btn" onClick={() => navigateToDoc('admin-question-sets')}>
            Upload Question Sets
          </button>
          <button className="help-quick-btn" onClick={() => navigateToDoc('player-joining')}>
            Join a Game
          </button>
        </div>
      </div>
    </div>
  );

  const renderRoleSection = (roleKey) => {
    const role = documentation[roleKey];
    if (!role) return null;

    return (
      <div className="help-role-section">
        <div className="help-section-header">
          <h1><Icon name={role.icon} weight="duotone" size={26} color="var(--primary)" /> {role.title}</h1>
          <p>Comprehensive guides for {roleKey} users</p>
        </div>
        
        <div className="help-sections-grid">
          {role.sections.map(section => (
            <div key={section.id} className="help-section-card" onClick={() => navigateToDoc(section.content)}>
              <h3>{section.title}</h3>
              <p>Learn about {section.title.toLowerCase()}</p>
              <span className="help-section-arrow"><Icon name="ArrowRight" weight="bold" size={16} color="currentColor" /></span>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const renderContent = () => {
    if (currentDoc === 'home') {
      return renderHome();
    }

    if (documentation[currentDoc]) {
      return renderRoleSection(currentDoc);
    }

    // Render specific content based on currentDoc ID
    switch (currentDoc) {
      case 'admin-ai-prompts':
        return <AdminAIPromptsDoc />;
      case 'host-quick-start':
        return <HostQuickStartDoc />;
      default:
        return (
          <div className="help-content">
            <div className="help-content-loading">
              <h2><Icon name="FileText" weight="bold" size={16} color="currentColor" /> Loading Documentation</h2>
              <p>Content for "{currentDoc}" is being loaded...</p>
              <p>This documentation section is currently under development.</p>
              <div className="help-tip-box">
                <h4><Icon name="Warning" weight="fill" size={16} color="var(--primary)" /> Coming Soon</h4>
                <p>We're working on expanding our documentation. In the meantime, feel free to explore the available sections or report any issues you encounter.</p>
              </div>
            </div>
          </div>
        );
    }
  };

  return (
    <div className="help-system-modal">
      <div className="help-modal-overlay" onClick={onClose}></div>
      <div className="help-modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="help-modal-header">
          <h2><Icon name="Books" weight="duotone" size={16} color="var(--primary)" /> Help & Documentation</h2>
          <button className="help-close-button" onClick={onClose}><Icon name="X" weight="bold" size={16} color="currentColor" /></button>
        </div>

        {renderNavigation()}
        
        <div className="help-modal-body">
          {renderContent()}
        </div>

        <div className="help-modal-footer">
          <div className="help-footer-links">
            <button className="help-footer-btn" onClick={() => navigateToDoc('technical-troubleshooting')}>
              <Icon name="Wrench" weight="bold" size={16} color="currentColor" /> Troubleshooting
            </button>
            <button className="help-footer-btn" onClick={() => navigateToDoc('technical-requirements')}>
              <Icon name="ClipboardText" weight="bold" size={16} color="currentColor" /> System Requirements
            </button>
            <a href="https://github.com/your-repo/engage2/issues" target="_blank" rel="noopener noreferrer" className="help-footer-btn">
              <Icon name="Bug" weight="bold" size={16} color="currentColor" /> Report Issue
            </a>
          </div>
        </div>
      </div>
    </div>
  );
};

export default HelpSystem;