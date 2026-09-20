import React, { useState } from 'react';
import MarketingShell from './MarketingShell';
import DocRenderer from '../components/documentation/DocRenderer';
import {
  HELP_ROLES, ROLE_BY_ID, GUIDE_BY_ID, ROLE_ID_BY_GUIDE_ID, resolveHelpTarget, searchHelp,
} from '../config/help';
import { HELP_PAGE } from './content/help';
import './HelpPage.css';

/**
 * THE HELP CORPUS AT A URL. The modal (`HelpSystem`) stays exactly as it is --
 * this is a second reader of the same data (`config/help/`), through the same
 * resolver and the same `DocRenderer`, so a guide can be linked from a
 * marketing page, an email, or a support reply, and land on the same words
 * the in-app help button shows.
 *
 * Resolution walks the path from the most specific segment outward, so an
 * alias (`/help/ai-prompts`) or a bare guide id (`/help/host-quick-start`)
 * both work, and a link nobody recognises degrades to the nearest real place
 * rather than a blank page.
 */
export function helpTargetFromPath(pathname) {
  const segments = String(pathname || '')
    .replace(/^\/help\/?/, '')
    .split('/')
    .filter(Boolean)
    .map(decodeURIComponent);
  for (let i = segments.length - 1; i >= 0; i -= 1) {
    const target = resolveHelpTarget(segments[i]);
    if (target.kind !== 'home') return target;
  }
  return { kind: 'home', id: 'home' };
}

export function helpHref(target) {
  if (target.kind === 'guide') return `/help/${ROLE_ID_BY_GUIDE_ID[target.id]}/${target.id}`;
  if (target.kind === 'role') return `/help/${target.id}`;
  return '/help';
}

/**
 * Help › role › guide. Never a heading -- on a guide view `DocRenderer`
 * supplies the page's one `<h1>` (the guide's own title), and on a role view
 * the role's own title is the `<h1>` (see `HelpPage` below), so this is a
 * plain paragraph in both cases.
 */
function Breadcrumb({ target }) {
  if (target.kind === 'home') return null;
  const guide = target.kind === 'guide' ? GUIDE_BY_ID[target.id] : null;
  const role = ROLE_BY_ID[guide ? ROLE_ID_BY_GUIDE_ID[guide.id] : target.id];
  if (!role) return null;
  return (
    <p className="mk-help-crumb">
      <a href={helpHref({ kind: 'home', id: 'home' })}>{HELP_PAGE.kicker}</a>
      {' › '}
      {guide ? (
        <a href={helpHref({ kind: 'role', id: role.id })}>{role.title}</a>
      ) : (
        <span aria-current="page">{role.title}</span>
      )}
      {guide && (
        <>
          {' › '}
          <span aria-current="page">{guide.title}</span>
        </>
      )}
    </p>
  );
}

/**
 * The corpus, always in full, on every view -- so a click from a role or a
 * guide reaches any other guide in one step. Role names are not headings:
 * they sit ahead of the article's own `<h1>` in DOM order, and a heading
 * there would come before it, reversing the page's outline. Each group's
 * list is labelled by its (non-heading) role name via `aria-labelledby`
 * instead.
 */
function Sidebar({ activeGuide, term, onTermChange }) {
  return (
    <nav className="mk-help-side" aria-label="Guides">
      <form className="mk-help-search" role="search" onSubmit={(e) => e.preventDefault()}>
        <label className="mk-help-search-label" htmlFor="help-search-input">
          {HELP_PAGE.searchLabel}
        </label>
        <input
          id="help-search-input"
          className="mk-help-search-input"
          type="search"
          value={term}
          placeholder={HELP_PAGE.searchLabel}
          onChange={(e) => onTermChange(e.target.value)}
        />
      </form>

      {HELP_ROLES.map((role) => {
        const headingId = `help-role-${role.id}`;
        return (
          <div key={role.id} className="mk-help-role">
            <a className="mk-help-role-name" id={headingId} href={helpHref({ kind: 'role', id: role.id })}>
              {role.title}
            </a>
            <ul className="mk-help-guides" aria-labelledby={headingId}>
              {role.guides.map((g) => (
                <li key={g.id}>
                  <a
                    href={helpHref({ kind: 'guide', id: g.id })}
                    aria-current={g.id === activeGuide ? 'page' : undefined}
                  >
                    {g.title}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}

/**
 * A REAL SEARCH, over the same corpus the sidebar lists -- not the mockup's
 * drawn, unwired box. Filters through `searchHelp`, which already sorts
 * title matches first. State lives here, not in the URL: what somebody types
 * is never a shareable link.
 */
function SearchResults({ term }) {
  const hits = searchHelp(term);
  return (
    <div className="mk-help-results" aria-live="polite">
      {hits.length === 0 ? (
        <p className="mk-muted">{HELP_PAGE.searchEmpty}</p>
      ) : (
        <ul className="mk-help-results-list">
          {hits.map(({ role, guide }) => (
            <li key={guide.id}>
              <a href={helpHref({ kind: 'guide', id: guide.id })}>{guide.title}</a>
              <span className="mk-muted mk-help-results-role">{role.title}</span>
              <p className="mk-muted">{guide.summary}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function HelpPage() {
  const [term, setTerm] = useState('');
  const target = helpTargetFromPath(window.location.pathname);
  const guide = target.kind === 'guide' ? GUIDE_BY_ID[target.id] : null;
  const role = target.kind === 'role'
    ? ROLE_BY_ID[target.id]
    : (guide ? ROLE_BY_ID[ROLE_ID_BY_GUIDE_ID[guide.id]] : null);
  const pageTitle = guide ? guide.title : (role ? `${role.title} help` : HELP_PAGE.title);
  const searching = term.trim().length > 0;

  return (
    <MarketingShell title={pageTitle} current="help">
      <div className="mk-shell mk-help">
        <Sidebar activeGuide={guide ? guide.id : null} term={term} onTermChange={setTerm} />
        <article className="mk-help-body">
          {searching ? (
            <SearchResults term={term} />
          ) : (
            <>
              <Breadcrumb target={target} />

              {target.kind === 'home' && (
                <>
                  <p className="mk-kicker">{HELP_PAGE.kicker}</p>
                  <h1 className="mk-title">{HELP_PAGE.title}</h1>
                  <p className="mk-lead">{HELP_PAGE.lead}</p>
                </>
              )}

              {target.kind === 'role' && role && (
                <>
                  <h1 className="mk-title">{`${role.title} help`}</h1>
                  {role.blurb && <p className="mk-lead">{role.blurb}</p>}
                  <ul className="mk-help-index">
                    {role.guides.map((g) => (
                      <li key={g.id}>
                        <a className="mk-link" href={helpHref({ kind: 'guide', id: g.id })}>{g.title}</a>
                        <p className="mk-muted">{g.summary}</p>
                      </li>
                    ))}
                  </ul>
                </>
              )}

              {target.kind === 'guide' && guide && (
                <>
                  <DocRenderer guide={guide} />
                  <p className="mk-muted mk-help-doc-footer">{HELP_PAGE.guideFooter}</p>
                </>
              )}
            </>
          )}
        </article>
      </div>
    </MarketingShell>
  );
}
