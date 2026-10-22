import React, { useState, useEffect, useMemo, useRef, useId } from 'react';
import { createPortal } from 'react-dom';
import DocRenderer, { scrollToHelpSection } from './documentation/DocRenderer';
import Modal from './Modal';
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

/** Same set as Modal.jsx, so the trap below agrees with it about what is reachable. */
const FOCUSABLE = [
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'a[href]',
  '[tabindex="0"]',
].join(', ');

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
 *
 * IT OPENS WHERE YOU ARE (help refresh Phase 0). `section` is what it always
 * was — a role, a guide, an alias — and may also be `guide#section`; or pass
 * `guide` (a guide id or alias) with `section` as a section id inside it. A
 * section that exists is scrolled into view and its heading takes focus.
 *
 * IT IS A REAL DIALOG. `Modal` gives it role="dialog", aria-modal, the
 * backdrop click and the scroll lock; it is labelled by its own heading.
 * Escape and Tab are answered HERE, on `document` in the capture phase, and
 * stopped: this modal is opened from inside the host's Session panel, whose
 * own document listener closes the panel on Escape and whose own Tab trap
 * walks the panel. Without the stop, one Escape would close help and the
 * panel under it, and Tab would wander into the panel behind the dialog.
 * Focus moves in on open (the section heading, or the close button) and goes
 * back to the opener on close (Modal, and HelpButton for the menu case).
 *
 * IT IS PORTALLED TO <body>. HelpButton sits inside other surfaces — the
 * Session panel, the player's `.plr` scope — and the modal used to render
 * there, so their stylesheets reached into it: styles.css repaints every
 * `.setup-panel button` it does not exempt (a navy panel button), which made
 * Back, Home, every card and the footer inside help look like the panel's
 * controls. Out of their DOM, only this sheet paints it. React still bubbles
 * a portal's events through the tree it was rendered from, so every keydown
 * that starts inside the dialog is stopped at the dialog: the panel's `\`
 * toggle must not fire while somebody types a backslash into help's search.
 */
const HelpSystem = ({ section, guide, onClose }) => {
  const initial = guide ? resolveHelpTarget(guide, section) : resolveHelpTarget(section);
  const [currentDoc, setCurrentDoc] = useState(initial.id);
  const [currentSection, setCurrentSection] = useState(initial.section || null);
  const [searchTerm, setSearchTerm] = useState('');
  const [navigationHistory, setNavigationHistory] = useState([]);
  const contentRef = useRef(null);
  const bodyRef = useRef(null);
  const closeRef = useRef(null);
  const titleId = `help-title-${useId().replace(/:/g, '')}`;

  /*
    An unknown `section` lands on home rather than on an apology. The old
    default branch rendered "Coming Soon" for any id it did not recognise,
    which made a mistyped link indistinguishable from a missing feature.
  */
  useEffect(() => {
    const target = guide ? resolveHelpTarget(guide, section) : resolveHelpTarget(section);
    setCurrentDoc(target.id);
    setCurrentSection(target.section || null);
  }, [section, guide]);

  // Focus in on open. The section's heading when there is one (the effect
  // below), otherwise the close button: the one control every view has.
  useEffect(() => {
    if (!initial.section && closeRef.current) closeRef.current.focus();
    // Only on mount: later navigation is the reader's own.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Scroll to the section once the guide holding it has rendered; otherwise
  // a newly opened guide starts at its top.
  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    if (currentSection && scrollToHelpSection(body, currentDoc, currentSection)) return;
    body.scrollTop = 0;
  }, [currentDoc, currentSection]);

  useEffect(() => {
    const onKeyDown = (event) => {
      const content = contentRef.current;
      if (!content) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        if (onClose) onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      event.stopPropagation();
      const focusables = Array.from(content.querySelectorAll(FOCUSABLE));
      if (!focusables.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      if (!content.contains(active)) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [onClose]);

  // Keys typed inside help belong to help (see the portal note above).
  useEffect(() => {
    const el = contentRef.current;
    if (!el) return undefined;
    const stop = (event) => event.stopPropagation();
    el.addEventListener('keydown', stop);
    return () => el.removeEventListener('keydown', stop);
  }, []);

  const results = useMemo(() => searchHelp(searchTerm), [searchTerm]);

  const navigateToDoc = (docId, sectionId = null) => {
    setNavigationHistory((prev) => [{ doc: currentDoc, section: currentSection }, ...prev.slice(0, 9)]);
    setSearchTerm('');
    setCurrentDoc(docId);
    setCurrentSection(sectionId);
  };

  const navigateBack = () => {
    if (!navigationHistory.length) {
      setCurrentDoc('home');
      setCurrentSection(null);
      return;
    }
    setCurrentDoc(navigationHistory[0].doc);
    setCurrentSection(navigationHistory[0].section);
    setNavigationHistory((prev) => prev.slice(1));
  };

  const goHome = () => {
    setSearchTerm('');
    setNavigationHistory([]);
    setCurrentDoc('home');
    setCurrentSection(null);
  };

  const renderNavigation = () => (
    <div className="help-navigation">
      <div className="help-nav-header">
        <button
          type="button"
          className="help-back-btn"
          onClick={navigateBack}
          disabled={!navigationHistory.length && currentDoc === 'home'}
        >
          <Icon name="ArrowLeft" weight="bold" size={16} color="currentColor" /> Back
        </button>
        <button type="button" className="help-home-btn" onClick={goHome}>
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
          {results.map(({ role, guide: hit }) => (
            <li key={hit.id}>
              <button type="button" onClick={() => navigateToDoc(hit.id)}>
                <span className="help-search-role">{role.title}</span>
                <span className="help-search-title">{hit.title}</span>
                <span className="help-search-summary">{hit.summary}</span>
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
          <Icon name="Books" weight="duotone" size={16} color="var(--accent)" /> Help
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
              <Icon name={role.icon} weight="duotone" size={28} color="var(--accent)" />
            </div>
            <h3>{role.title}</h3>
            <p>{role.blurb}</p>
            <div className="help-role-sections">
              {role.guides.map((g) => (
                <span key={g.id} className="help-role-preview">{g.title}</span>
              ))}
            </div>
          </button>
        ))}
      </div>

      <div className="help-quick-links">
        <h3>
          <Icon name="RocketLaunch" weight="duotone" size={16} color="var(--accent)" /> Straight to it
        </h3>
        <div className="help-quick-grid">
          <button type="button" className="help-quick-btn" onClick={() => navigateToDoc('player-joining')}>
            Join a session
          </button>
          <button type="button" className="help-quick-btn" onClick={() => navigateToDoc('host-quick-start')}>
            Run your first session
          </button>
          {/* Was the HOST guide (host-player-management): a player who sees
              "That name is taken" wants their own way forward, which is this
              section of the player guide. */}
          <button type="button" className="help-quick-btn" onClick={() => navigateToDoc('player-joining', 'name-taken')}>
            My name is taken
          </button>
          <button type="button" className="help-quick-btn" onClick={() => navigateToDoc('builder-manual')}>
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
            <Icon name={role.icon} weight="duotone" size={26} color="var(--accent)" /> {role.title}
          </h1>
          <p>{role.blurb}</p>
        </div>

        <div className="help-sections-grid">
          {role.guides.map((g) => (
            <button
              type="button"
              key={g.id}
              className="help-section-card"
              onClick={() => navigateToDoc(g.id)}
            >
              <h3>{g.title}</h3>
              <p>{g.summary}</p>
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
    const doc = GUIDE_BY_ID[currentDoc];
    /*
      There is no "coming soon" branch any more, and that is the point of the
      change. `currentDoc` is only ever set from `resolveHelpTarget` or from a
      tile built out of the corpus, so a miss here is not a content gap — it is
      a bug, and going home is the honest response to one.
    */
    if (!doc) return renderHome();
    const roleId = ROLE_ID_BY_GUIDE_ID[doc.id];
    return (
      <>
        <p className="help-breadcrumb">
          <button type="button" onClick={() => navigateToDoc(roleId)}>
            {ROLE_BY_ID[roleId].title}
          </button>
        </p>
        <DocRenderer guide={doc} activeSection={currentSection} />
      </>
    );
  };

  return createPortal(
    <Modal
      overlayClassName="help-system-modal"
      contentClassName="help-modal-content"
      onClose={onClose}
      labelledBy={titleId}
      theme="dark"
      // Escape is answered by the capture listener above, which also stops
      // it reaching the panels underneath; Modal's own would never see it.
      closeOnEscape={false}
    >
      <div className="help-modal-root" ref={contentRef}>
        <div className="help-modal-header">
          <h2 id={titleId}>
            <Icon name="Books" weight="duotone" size={16} color="var(--accent)" /> Help
          </h2>
          <button
            ref={closeRef}
            type="button"
            className="help-close-button"
            onClick={onClose}
            aria-label="Close help"
          >
            <Icon name="X" weight="bold" size={16} color="currentColor" />
          </button>
        </div>

        {renderNavigation()}

        <div className="help-modal-body" ref={bodyRef}>
          {renderContent()}
        </div>

        <div className="help-modal-footer">
          <div className="help-footer-links">
            <button
              type="button"
              className="help-footer-btn"
              onClick={() => navigateToDoc('technical-troubleshooting')}
            >
              <Icon name="Wrench" weight="bold" size={16} color="currentColor" /> Troubleshooting
            </button>
            <button
              type="button"
              className="help-footer-btn"
              onClick={() => navigateToDoc('technical-requirements')}
            >
              <Icon name="ClipboardText" weight="bold" size={16} color="currentColor" /> What you need
            </button>
            <button
              type="button"
              className="help-footer-btn"
              onClick={() => navigateToDoc('glossary')}
            >
              <Icon name="Books" weight="bold" size={16} color="currentColor" /> Words we use
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
    </Modal>,
    document.body,
  );
};

export default HelpSystem;
