import React, { useCallback, useEffect, useRef, useState } from 'react';
import Icon from './Icon';
import './OrgSwitcher.css';

/**
 * WHICH ORGANISATION THE CONSOLE IS LOOKING AT.
 *
 * Drawn from docs/design/tenancy-redesign/01-org-switcher.html (open) and
 * 02-org-single.html (one org, no menu). It belongs in the topbar beside the
 * environment chip and NOT in the left nav — the nav lists places inside one
 * organisation, and this changes which organisation those places belong to
 * (RATIONALE §3).
 *
 * ── WHY THIS IS NOT `<Modal>` ──────────────────────────────────────────────
 *
 * `Modal.jsx` is a dialog shell and this is a menu. It renders
 * `role="dialog" aria-modal="true"`, which for a menu button is simply untrue —
 * a screen-reader user is told a dialog opened when what opened is a list of
 * three organisations. It also reference-counts a body scroll lock, which for a
 * transient popup under a chip means the page loses its scrollbar every time
 * somebody glances at which org they are in. What Modal owns that this needs —
 * Escape, a Tab boundary, focus restore — is thirty lines here and correct for
 * the role, so this owns them rather than borrowing a shell that would lie
 * about what it is. The house rule is "never build a second modal shell"; this
 * is not a second modal shell, and `.orgsw-menu` carries no scrim at all.
 *
 * ── THE MENU IS A SIBLING OF THE CHIP ──────────────────────────────────────
 *
 * A <button> may not contain a <button>. The mockup's first cut authored the
 * menu inside the chip; the parser hoisted every item out and the menu
 * unwrapped itself across the whole topbar, pushing the environment chip off
 * the row. `.orgsw` is a positioned wrapper and the two are siblings in it.
 *
 * ── ONE ORGANISATION, NO MENU ──────────────────────────────────────────────
 *
 * Same chip, no caret, nothing to open, and it is a <span> rather than a
 * disabled button so it is not in the tab order at all. A control whose menu
 * has one item teaches people to ignore the control, and then they miss it on
 * the day they have two. Zero organisations renders NOTHING: an account that
 * has not joined one has no world to name (mockup 09).
 *
 * ── THE PERSONAL ORGANISATION ──────────────────────────────────────────────
 *
 * `type: 'personal'` is the home `GET /orgs` provisions on first call. Its row
 * says "Personal" where the others say a role, because there is no role to have
 * in a space with one person in it, and it cannot be left or deleted — so this
 * component never offers either.
 */

/** "Northwind Learning" → NW. One word → its first two letters. */
export function initialsOf(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '??';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** What the right-hand column of a row says. */
export function roleLabelOf(org) {
  if (!org) return '';
  if (org.type === 'personal') return 'Personal';
  const role = String(org.role || '');
  return role ? role[0].toUpperCase() + role.slice(1) : '';
}

const FOCUSABLE = 'button:not([disabled])';

export default function OrgSwitcher({
  organisations = [],
  activeOrgId = '',
  onSelect,
  onCreate,
  /* The platform console's chip (mockups 10/11). "Engage staff" is not an
     organisation and cannot be switched into a section inside one, so it is
     the single, inert chip with a lock rather than a menu with a fourth row. */
  platform = false,
  platformLabel = 'Engage staff',
}) {
  const [open, setOpen] = useState(false);
  const chipRef = useRef(null);
  const menuRef = useRef(null);
  const wrapRef = useRef(null);

  const close = useCallback((restoreFocus = true) => {
    setOpen(false);
    /* Focus goes back to the chip, always. A menu that closes and drops focus
       on <body> costs a keyboard user their place in the topbar entirely. */
    if (restoreFocus && chipRef.current) chipRef.current.focus();
  }, []);

  /* Escape, on `document` — the convention every other keyboard surface in this
     app already follows (Modal, SessionSetupPanel, QuickstartMenu) and the one
     the tests fire against. */
  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        close();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, close]);

  /* A click anywhere else closes it. `mousedown` rather than `click` so the
     menu is gone before whatever was clicked reacts. */
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (event) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  /* Focus the first item on open. Unlike Modal — which deliberately does not
     move focus, because it may open over something the host is typing in — a
     menu is opened BY a deliberate press, so leaving focus behind would mean
     the keyboard user who opened it has nothing to arrow through. */
  useEffect(() => {
    if (!open || !menuRef.current) return;
    const first = menuRef.current.querySelector(FOCUSABLE);
    if (first) first.focus();
  }, [open]);

  const items = () => (menuRef.current
    ? Array.from(menuRef.current.querySelectorAll(FOCUSABLE))
    : []);

  const moveFocus = (delta) => {
    const all = items();
    if (!all.length) return;
    const at = all.indexOf(document.activeElement);
    const next = all[(at + delta + all.length) % all.length];
    if (next) next.focus();
  };

  const onMenuKeyDown = (event) => {
    if (event.key === 'ArrowDown') { event.preventDefault(); moveFocus(1); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); moveFocus(-1); }
    else if (event.key === 'Home') { event.preventDefault(); (items()[0] || {}).focus?.(); }
    else if (event.key === 'End') {
      event.preventDefault();
      const all = items();
      all[all.length - 1]?.focus();
    } else if (event.key === 'Tab') {
      /* TAB DOES NOT ESCAPE INTO THE PAGE BEHIND. It cycles inside the menu
         while the menu is open, for the same reason Modal traps it: the thing
         under an open overlay is not operable, and tabbing into it leaves a
         keyboard user driving a screen they cannot see they are on. */
      event.preventDefault();
      moveFocus(event.shiftKey ? -1 : 1);
    }
  };

  const onChipKeyDown = (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setOpen(true);
    }
  };

  const choose = (org) => {
    setOpen(false);
    if (chipRef.current) chipRef.current.focus();
    if (onSelect && org.orgId !== activeOrgId) onSelect(org.orgId, org);
  };

  const create = () => {
    setOpen(false);
    if (chipRef.current) chipRef.current.focus();
    if (onCreate) onCreate();
  };

  if (platform) {
    return (
      <div className="orgsw" data-theme="dark">
        <span className="orgsw-chip orgsw-chip--single" title={platformLabel}>
          <span className="orgsw-tile" aria-hidden="true">
            <Icon name="Lock" size={12} weight="bold" color="var(--secondary)" />
          </span>
          <span className="orgsw-name">{platformLabel}</span>
        </span>
      </div>
    );
  }

  const list = Array.isArray(organisations) ? organisations : [];
  /* No organisation at all: nothing to name, so nothing is drawn. An empty chip
     saying "—" is an empty state that lies. */
  if (!list.length) return null;

  const active = list.find((org) => org.orgId === activeOrgId) || list[0];
  const single = list.length === 1;

  if (single) {
    return (
      <div className="orgsw" data-theme="dark">
        <span
          className="orgsw-chip orgsw-chip--single"
          data-testid="orgsw-chip"
          title={active.name}
        >
          <span className="orgsw-tile" aria-hidden="true">{initialsOf(active.name)}</span>
          <span className="orgsw-name">{active.name}</span>
        </span>
      </div>
    );
  }

  return (
    /* data-theme declared, not inherited: public/index.html carries
       data-theme="light" on <html>. */
    <div className="orgsw" data-theme="dark" ref={wrapRef}>
      <button
        type="button"
        className="orgsw-chip"
        data-testid="orgsw-chip"
        ref={chipRef}
        title={active.name}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((was) => !was)}
        onKeyDown={onChipKeyDown}
      >
        <span className="orgsw-tile" aria-hidden="true">{initialsOf(active.name)}</span>
        <span className="orgsw-name">{active.name}</span>
        <Icon name="CaretDown" size={12} weight="bold" className="orgsw-caret" />
      </button>

      {open && (
        /* Sibling of the chip, never a child of it. */
        <div
          className="orgsw-menu"
          role="menu"
          aria-label="Your organisations"
          ref={menuRef}
          onKeyDown={onMenuKeyDown}
        >
          <div className="orgsw-heading" aria-hidden="true">Your organisations</div>

          {list.map((org) => {
            const current = org.orgId === active.orgId;
            return (
              <button
                key={org.orgId}
                type="button"
                role="menuitem"
                className="orgsw-item"
                aria-current={current ? 'true' : undefined}
                title={org.name}
                onClick={() => choose(org)}
              >
                <span className="orgsw-tile" aria-hidden="true">{initialsOf(org.name)}</span>
                <span className="orgsw-label">{org.name}</span>
                {current && (
                  <Icon name="Check" size={13} weight="bold" className="orgsw-check" />
                )}
                <span className="orgsw-role">{roleLabelOf(org)}</span>
              </button>
            );
          })}

          {onCreate && (
            <>
              <div className="orgsw-sep" />
              <button
                type="button"
                role="menuitem"
                className="orgsw-item orgsw-item--add"
                onClick={create}
              >
                <Icon name="Plus" size={13} weight="bold" />
                <span className="orgsw-label">Create an organisation</span>
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
