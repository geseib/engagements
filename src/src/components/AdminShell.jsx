import React from 'react';
import Icon from './Icon';
import './AdminShell.css';

/**
 * THE ADMIN CONSOLE'S SHELL.
 *
 * Grounded in docs/design/admin-redesign/ (22 mockups + RATIONALE.md). It is a
 * component rather than markup inside AdminPage.jsx for the same reason
 * GameSetupDialog, SessionSetupPanel, Podium and WelcomeScreen are components:
 * AdminPage is 1,805 lines and cannot be mounted in jsdom at all — it dies on
 * `useAuth must be used within an AuthProvider`, which is why its own test file
 * has failed 8/8 since it was written. Nothing about this chrome was testable
 * until it could be rendered on its own.
 *
 * THE ONE DECISION IT EXISTS TO SERVE (RATIONALE.md §2):
 *
 *   > The list and the thing it lists occupy the same scroll.
 *
 * Pressing Edit on row 34 of 41 flipped `editMode`, scroll-jumped the page down
 * to a form rendered *after* the list, and flashed that form #fff3cd yellow by
 * direct DOM mutation for three seconds (AdminPage.jsx:183-194) — a light-theme
 * colour on a dark palette, and the only cue as to which of forty-one rows was
 * open. **A list and its detail are two places, not two sections.** A place
 * gets the whole work area, its own title, and a breadcrumb back to its parent.
 *
 * The second-order consequence is this shell. Two axes now exist — which kind
 * of object, and which object — and a horizontal tab strip already owned the
 * top edge. The sections move into a left nav, which frees the top edge for
 * "where am I inside this object" and gives the pending-user count a permanent
 * home.
 *
 * WHAT THE TOP BAR DOES NOT DO: restate the h1 sitting 30px below it. On a root
 * list the breadcrumb region is empty; on a detail place it is a back link to
 * the parent and never the object's own name.
 *
 * THE ENVIRONMENT CHIP is new. The console has never said which of the three
 * tiers it is talking to — `API_BASE` was read at AdminPage.jsx:24 and rendered
 * nowhere — while the archive service, including DELETE, is shared by all
 * three. See utils/adminEnvironment.js.
 *
 * THE HERO SLOT is deliberately empty and deliberately still a slot. The
 * shipped header loaded three parallax .webp images from
 * cdn.prod.website-files.com — a third-party CDN dependency on an authenticated
 * operator console, occupying ~250px of the fold. The designers cut it; the
 * owner has an open question on it, because host and admin losing the product's
 * visual signature in the same week is a real cost. So: no hero is rendered,
 * and a hero passed in is rendered. The owner rules, not this file.
 *
 * CONTENT THEME. `contentTheme` defaults to 'light' because that is what the
 * tab internals ARE today — white cards with #333 body copy (styles.css:4635).
 * Wave D converts them; flipping this prop to 'dark' is the whole change here.
 */
export default function AdminShell({
  brand = 'Engage',
  navItems = [],
  footNavItems = [],
  activeId,
  onNavigate,
  environment,
  currentUser,
  onSignOut,
  hostHref = '/',
  breadcrumb = null,
  title,
  subtitle,
  actions = null,
  hero = null,
  contentTheme = 'light',
  children,
}) {
  const renderNavItem = (item) => {
    const current = item.id === activeId;
    return (
      <button
        key={item.id}
        type="button"
        className="adm-nav-item"
        /* Below 1180px the rail collapses to icons, so the name has to survive
           somewhere. It is on every item, not only the collapsed ones, because
           a title that appears at one width and not another is worse than
           either. */
        title={item.label}
        /* aria-current, not a bare `.active` class. The shipped tab strip told
           assistive tech nothing about which of six sections was open. */
        aria-current={current ? 'page' : undefined}
        onClick={() => onNavigate && onNavigate(item.id)}
      >
        {item.icon && <Icon name={item.icon} size={16} weight="bold" className="adm-nav-ico" />}
        <span className="adm-nav-label">{item.label}</span>
        {/* A badge and a count are different things. The count is a size; the
            badge is the one number in this console that decays if nobody looks
            at it (RATIONALE §7). Neither is rendered from a default, because a
            count the page does not have is an empty state that lies. */}
        {item.badge != null && <span className="adm-nav-badge">{item.badge}</span>}
        {item.badge == null && item.count != null && (
          <span className="adm-nav-count">{item.count}</span>
        )}
      </button>
    );
  };

  const name = currentUser?.attributes?.name || currentUser?.attributes?.email || 'Signed in';
  const initials = String(name)
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();

  return (
    /* data-theme is declared, not inherited: public/index.html carries
       data-theme="light" on <html>, so without this every --text and --surface
       in the chrome resolves to the paper set. Same move as WelcomeScreen. */
    <div className="adm-shell" data-theme="dark">
      <header className="adm-brand">
        <span className="adm-mark" aria-hidden="true" />
        <span className="adm-word">{brand}</span>
      </header>

      <div className="adm-top" data-testid="adm-topbar">
        <nav className="adm-crumbs" aria-label="Breadcrumb">
          {breadcrumb && (
            <button type="button" className="adm-back" onClick={breadcrumb.onBack}>
              <Icon name="CaretLeft" size={13} weight="bold" className="adm-back-ico" />
              <span>{breadcrumb.parentLabel}</span>
            </button>
          )}
        </nav>

        <span className="adm-spacer" />

        {environment && (
          <span
            className={`adm-envchip adm-envchip--${environment.id}`}
            data-testid="adm-envchip"
            title={environment.detail}
          >
            {environment.label}
          </span>
        )}

        {currentUser && (
          <div className="adm-who">
            <span className="adm-avatar" aria-hidden="true">{initials}</span>
            <span className="adm-name">{name}</span>
            {/*
              THE WAY BACK, AND IT OPENS A NEW TAB ON PURPOSE — carried over
              verbatim in intent from AdminPage.jsx:946. App.jsx is a pathname
              switch with no client-side navigation, so an in-place link is a
              full page load; if the host page is live in another tab with a
              room in front of it, a second copy is a second host WebSocket
              connection. rel="noopener" so the opened tab gets no handle here.
            */}
            <a
              className="adm-linkbtn"
              href={hostHref}
              target="_blank"
              rel="noopener noreferrer"
            >
              Host ↗
            </a>
            <button type="button" className="adm-linkbtn" onClick={onSignOut}>
              Sign out
            </button>
          </div>
        )}
      </div>

      <nav className="adm-nav" aria-label="Sections">
        {navItems.map(renderNavItem)}
        {footNavItems.length > 0 && (
          <div className="adm-nav-foot">{footNavItems.map(renderNavItem)}</div>
        )}
      </nav>

      <main className="adm-work">
        {hero && <div className="adm-hero">{hero}</div>}

        <div className="adm-work-head">
          <div className="adm-work-heading">
            {/* title= so a clipped set name is still readable. The h1 is a
                single nowrap node so text-overflow can render at all (host
                §5.1); a reduction with no recovery is a deletion (host §7.10). */}
            <h1 title={typeof title === 'string' ? title : undefined}>{title}</h1>
            {subtitle && <p className="adm-sub">{subtitle}</p>}
          </div>
          <span className="adm-grow" />
          {actions && <div className="adm-head-actions">{actions}</div>}
        </div>

        {/* The ONE scrolling region. The shell itself never scrolls, which is
            what keeps the nav and the title on screen — the shipped console
            scrolled the whole document, so the tab bar left the viewport. */}
        <div className="adm-work-body" data-theme={contentTheme}>
          {children}
        </div>
      </main>
    </div>
  );
}
