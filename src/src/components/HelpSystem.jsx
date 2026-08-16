import React, { useState, useEffect, useMemo } from 'react';
import DocRenderer from './documentation/DocRenderer';
import './HelpSystem.css';
import Icon from './Icon';
import {
  HELP_ROLES,
  ROLE_BY_ID,
  GUIDE_BY_ID,
  ROLE_ID_BY_GUIDE_ID,
  ISSUES_URL,
  resolveHelpTarget,
  searchHelp,
} from '../config/help';

/**
 * THE HELP MODAL. Its contents are now derived, not declared.
 *
 * What was here: a hand-written `documentation` object naming 18 guides across
 * 5 roles, and a `switch` under it with two cases. Sixteen of the eighteen tiles
 * on the home screen opened onto a box that said "Content for X is being
 * loaded… This documentation section is currently under development." The two
 * that worked were reachable only by knowing their exact ids — and the buttons
 * that were supposed to pass those ids passed different ones (see HELP_ALIASES).
 *
 * Everything on this screen now comes from `config/help`: the role cards count
 * `role.guides.length`, the tiles are `role.guides`, and the renderer looks up
 * the same id the tile linked to. A guide is advertised because it exists.
 *
 * THE SEARCH FIELD IS WIRED. It was rendered, it set `searchTerm`, and no other
 * line in the file read that variable — a search box that silently discarded
 * every query, sitting at the top of a documentation set where most of the
 * documentation was missing. It filters the corpus now.
 */
const HelpSystem = ({ section, onClose }) => {
  const [currentDoc, setCurrentDoc] = useState('home');
  const [searchTerm, setSearchTerm] = useState('');
  const [navigationHistory, setNavigationHistory] = useState([]);

  /*
    An unknown `section` lands on home rather than on an apology. The old
    default branch rendered "Coming Soon" for any id it did not recognise,
    which made a mistyped link indistinguishable from a missing feature.
  */
  useEffect(() => {
    setCurrentDoc(resolveHelpTarget(section).id);
  }, [section]);

  const results = useMemo(() => searchHelp(searchTerm), [searchTerm]);

  const navigateToDoc = (docId) => {
    setNavigationHistory((prev) => [currentDoc, ...prev.slice(0, 9)]);
    setSearchTerm('');
    setCurrentDoc(docId);
  };

  const navigateBack = () => {
    if (!navigationHistory.length) {
      setCurrentDoc('home');
      return;
    }
    setCurrentDoc(navigationHistory[0]);
    setNavigationHistory((prev) => prev.slice(1));
  };

  const goHome = () => {
    setSearchTerm('');
    setNavigationHistory([]);
    setCurrentDoc('home');
  };

  const renderNavigation = () => (
    <div className="help-navigation">
      <div className="help-nav-header">
        <button
          className="help-back-btn"
          onClick={navigateBack}
          disabled={!navigationHistory.length && currentDoc === 'home'}
        >
          <Icon name="ArrowLeft" weight="bold" size={16} color="currentColor" /> Back
        </button>
        <button className="help-home-btn" onClick={goHome}>
          <Icon name="House" weight="bold" size={16} color="currentColor" /> Home
        </button>
        <div className="help-search">
          <label className="help-sr-only" htmlFor="help-search-input">
            Search documentation
          </label>
          <input
            id="help-search-input"
            type="search"
            placeholder="Search documentation…"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="help-search-input"
          />
        </div>
      </div>
    </div>
  );

  /*
    RESULTS REPLACE THE PAGE while there is a query, rather than sitting
    alongside it. Typing is an explicit "show me something else", and a filtered
    list rendered underneath the guide you were reading is two answers to one
    question.
  */
  const renderSearch = () => (
    <div className="help-search-results">
      <h2>
        {results.length === 0
          ? `Nothing matches “${searchTerm}”`
          : `${results.length} ${results.length === 1 ? 'guide' : 'guides'} matching “${searchTerm}”`}
      </h2>
      {results.length === 0 ? (
        <p className="help-search-empty">
          Try a shorter word — the guides are indexed by their whole text, so
          “vote”, “name”, “qr” or “reveal” all land somewhere.
        </p>
      ) : (
        <ul className="help-search-list">
          {results.map(({ role, guide }) => (
            <li key={guide.id}>
              <button type="button" onClick={() => navigateToDoc(guide.id)}>
                <span className="help-search-role">{role.title}</span>
                <span className="help-search-title">{guide.title}</span>
                <span className="help-search-summary">{guide.summary}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );

  const renderHome = () => (
    <div className="help-home">
      <div className="help-home-header">
        <h1>
          <Icon name="Books" weight="duotone" size={16} color="var(--primary)" /> Help
        </h1>
        <p>
          Pick the one that sounds like you. Everything here is about this
          platform — how to join a session, how to run one, and how to build the
          questions.
        </p>
      </div>

      <div className="help-role-grid">
        {HELP_ROLES.map((role) => (
          <button
            type="button"
            key={role.id}
            className="help-role-card"
            onClick={() => navigateToDoc(role.id)}
          >
            <div className="help-role-icon">
              <Icon name={role.icon} weight="duotone" size={28} color="var(--primary)" />
            </div>
            <h3>{role.title}</h3>
            <p>{role.blurb}</p>
            <div className="help-role-sections">
              {role.guides.map((guide) => (
                <span key={guide.id} className="help-role-preview">{guide.title}</span>
              ))}
            </div>
          </button>
        ))}
      </div>

      <div className="help-quick-links">
        <h3>
          <Icon name="RocketLaunch" weight="duotone" size={16} color="var(--primary)" /> Straight to it
        </h3>
        <div className="help-quick-grid">
          <button className="help-quick-btn" onClick={() => navigateToDoc('player-joining')}>
            Join a session
          </button>
          <button className="help-quick-btn" onClick={() => navigateToDoc('host-quick-start')}>
            Run your first session
          </button>
          <button className="help-quick-btn" onClick={() => navigateToDoc('host-player-management')}>
            My name is taken
          </button>
          <button className="help-quick-btn" onClick={() => navigateToDoc('builder-manual')}>
            Write questions
          </button>
        </div>
      </div>
    </div>
  );

  const renderRoleSection = (roleId) => {
    const role = ROLE_BY_ID[roleId];
    return (
      <div className="help-role-section">
        <div className="help-section-header">
          <h1>
            <Icon name={role.icon} weight="duotone" size={26} color="var(--primary)" /> {role.title}
          </h1>
          <p>{role.blurb}</p>
        </div>

        <div className="help-sections-grid">
          {role.guides.map((guide) => (
            <button
              type="button"
              key={guide.id}
              className="help-section-card"
              onClick={() => navigateToDoc(guide.id)}
            >
              <h3>{guide.title}</h3>
              <p>{guide.summary}</p>
              <span className="help-section-arrow">
                <Icon name="ArrowRight" weight="bold" size={16} color="currentColor" />
              </span>
            </button>
          ))}
        </div>
      </div>
    );
  };

  const renderContent = () => {
    if (searchTerm.trim()) return renderSearch();
    if (currentDoc === 'home') return renderHome();
    if (ROLE_BY_ID[currentDoc]) return renderRoleSection(currentDoc);
    const guide = GUIDE_BY_ID[currentDoc];
    /*
      There is no "coming soon" branch any more, and that is the point of the
      change. `currentDoc` is only ever set from `resolveHelpTarget` or from a
      tile built out of the corpus, so a miss here is not a content gap — it is
      a bug, and going home is the honest response to one.
    */
    if (!guide) return renderHome();
    const roleId = ROLE_ID_BY_GUIDE_ID[guide.id];
    return (
      <>
        <p className="help-breadcrumb">
          <button type="button" onClick={() => navigateToDoc(roleId)}>
            {ROLE_BY_ID[roleId].title}
          </button>
        </p>
        <DocRenderer guide={guide} />
      </>
    );
  };

  return (
    <div className="help-system-modal">
      <div className="help-modal-overlay" onClick={onClose}></div>
      <div className="help-modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="help-modal-header">
          <h2>
            <Icon name="Books" weight="duotone" size={16} color="var(--primary)" /> Help
          </h2>
          <button className="help-close-button" onClick={onClose} aria-label="Close help">
            <Icon name="X" weight="bold" size={16} color="currentColor" />
          </button>
        </div>

        {renderNavigation()}

        <div className="help-modal-body">
          {renderContent()}
        </div>

        <div className="help-modal-footer">
          <div className="help-footer-links">
            <button
              className="help-footer-btn"
              onClick={() => navigateToDoc('technical-troubleshooting')}
            >
              <Icon name="Wrench" weight="bold" size={16} color="currentColor" /> Troubleshooting
            </button>
            <button
              className="help-footer-btn"
              onClick={() => navigateToDoc('technical-requirements')}
            >
              <Icon name="ClipboardText" weight="bold" size={16} color="currentColor" /> What you need
            </button>
            {/* The shipped link was `github.com/your-repo/engage2/issues`, which
                is a placeholder nobody replaced — it 404s from every screen. */}
            <a
              href={ISSUES_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="help-footer-btn"
            >
              <Icon name="Bug" weight="bold" size={16} color="currentColor" /> Report an issue
            </a>
          </div>
        </div>
      </div>
    </div>
  );
};

export default HelpSystem;
