import React, {
  useCallback, useEffect, useLayoutEffect, useRef, useState,
} from 'react';
import Icon from './Icon';
import Modal from './Modal';
import { useKeepOnScreen } from '../buildroom/keepOnScreen';
import {
  scopeList, tabCounts, splitTeams, initialsOf, roleWord, PLATFORM_KEY,
} from '../config/overviewAlerts';
import './ScopeTabs.css';

/**
 * WHERE YOU WORK — one row of tabs under the console's top bar.
 *
 * docs/design/admin-landing (SPEC §4, index.html "The switcher with 1, 3 and
 * 8 teams" and the 660/375 frames). It REPLACES the organisation chip in the
 * console and is still the only switcher: two controls for "who am I right
 * now" is the doubling the tenancy work removed twice.
 *
 *   - Fixed order: Personal, teams A to Z, a rule, Engage (staff only). Never
 *     reordered by activity or count (owner, ruling 10).
 *   - Each tab: a tile, the name, the role on the ACTIVE tab only, and the
 *     number of things waiting there when it is more than zero. Neutral pill,
 *     never orange: the page below has the one orange.
 *   - The active tab is text colour plus a 2px --secondary underline. Not
 *     amber: amber in the nav already means "the section you are in".
 *   - When teams do not fit, the last slot becomes "N more" with the sum of
 *     their counts; the active team always keeps a visible tab, and Engage is
 *     never folded.
 *   - "+ New team" is today's Create an organisation (CreateOrgDialog).
 *   - On a phone (480px and below) the row is one button naming where you are,
 *     with "n elsewhere", opening a sheet that lists every scope.
 *
 * NAVIGATION, NOT AN ARIA TABLIST: every choice reloads the page (the tenancy
 * guarantee: no panel keeps another team's rows), so this is a <nav> of links
 * with aria-current, and the More menu reuses OrgSwitcher's keyboard rules.
 */

const FOCUSABLE = 'button:not([disabled]), a[href]';
const PHONE = '(max-width: 480px)';

function usePhone(forced) {
  const query = () => (typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(PHONE).matches : false);
  const [phone, setPhone] = useState(() => (typeof forced === 'boolean' ? forced : query()));
  useEffect(() => {
    if (typeof forced === 'boolean') { setPhone(forced); return undefined; }
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const mq = window.matchMedia(PHONE);
    const on = () => setPhone(mq.matches);
    if (mq.addEventListener) mq.addEventListener('change', on); else if (mq.addListener) mq.addListener(on);
    return () => {
      if (mq.removeEventListener) mq.removeEventListener('change', on); else if (mq.removeListener) mq.removeListener(on);
    };
  }, [forced]);
  return phone;
}

function Tile({ scope }) {
  if (scope.kind === 'platform') {
    return (
      <span className="scp-ti scp-ti--eng" aria-hidden="true">
        <Icon name="Lock" size={12} weight="bold" />
      </span>
    );
  }
  return (
    <span className={`scp-ti${scope.kind === 'personal' ? ' scp-ti--me' : ''}`} aria-hidden="true">
      {initialsOf(scope.fullName)}
    </span>
  );
}

const Count = ({ n }) => (n > 0 ? <span className="scp-n" aria-label={`${n} waiting`}>{n}</span> : null);

function TabBody({ scope, count, active }) {
  return (
    <>
      <Tile scope={scope} />
      <span className="scp-nm">{scope.name}</span>
      {active && scope.kind !== 'personal' && scope.role && <span className="scp-rl">{roleWord(scope.role)}</span>}
      <Count n={count} />
    </>
  );
}

export default function ScopeTabs({
  orgs = [],
  activeKey = '',
  staff = false,
  attention = null,
  activeTotal = null,
  onSelect,
  onCreateTeam,
  onCreatePersonal,
  /* Tests: jsdom has no layout, so the number of team tabs that fit is given. */
  maxTeamTabs,
  /* Tests: force the phone layout on or off. */
  phone: forcedPhone,
}) {
  const scopes = scopeList(orgs, { staff });
  const counts = tabCounts(scopes, attention, { activeKey, activeTotal });
  const personal = scopes.find((s) => s.kind === 'personal') || null;
  const teams = scopes.filter((s) => s.kind === 'team');
  const engage = scopes.find((s) => s.kind === 'platform') || null;
  const phone = usePhone(forcedPhone);

  const [measuredSlots, setMeasuredSlots] = useState(Infinity);
  /* When even one team tab will not fit beside Personal, More and Engage, the
     row's "+ New team" steps aside: it is the last item of the More menu too. */
  const [dropAdd, setDropAdd] = useState(false);
  const slots = typeof maxTeamTabs === 'number' ? maxTeamTabs : measuredSlots;
  const { visible, hidden } = splitTeams(teams, activeKey, slots);
  const moreCount = hidden.reduce((sum, s) => sum + (counts[s.key] || 0), 0);

  const rowRef = useRef(null);
  const measureRef = useRef(null);

  /* HOW MANY TEAM TABS FIT. Every tab is rendered once, invisibly, at its
     natural width (up to 280px); the row's own width decides how many teams
     can stand beside Personal, + New team and Engage, reserving room for
     "N more" whenever anything is folded. */
  const measure = useCallback(() => {
    if (typeof maxTeamTabs === 'number') return;
    const row = rowRef.current;
    const box = measureRef.current;
    if (!row || !box) return;
    const width = (key) => {
      const el = box.querySelector(`[data-measure="${key}"]`);
      return el ? el.getBoundingClientRect().width : 0;
    };
    const avail = row.clientWidth;
    if (!avail) { setMeasuredSlots(Infinity); setDropAdd(false); return; }
    const style = window.getComputedStyle ? window.getComputedStyle(row) : null;
    const pad = style ? (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0) : 0;
    const gap = 2;
    const base = (personal ? width(personal.key) + gap : 0)
      + (onCreatePersonal ? width('addpersonal') + gap : 0)
      + (engage ? width(engage.key) + 14 : 0)
      + pad + 16;
    const fits = (k, withAdd) => {
      const split = splitTeams(teams, activeKey, k);
      const used = split.visible.reduce((sum, t) => sum + width(t.key) + gap, 0)
        + (split.hidden.length ? width('more') + gap : 0)
        + (withAdd ? width('add') + gap : 0);
      return base + used <= avail;
    };
    if (fits(Infinity, true)) { setMeasuredSlots(Infinity); setDropAdd(false); return; }
    for (let k = teams.length - 1; k >= 1; k -= 1) {
      if (fits(k, true)) { setMeasuredSlots(k); setDropAdd(false); return; }
    }
    setMeasuredSlots(1);
    setDropAdd(teams.length > 1 && !fits(1, true));
  }, [maxTeamTabs, personal, engage, teams, activeKey, onCreatePersonal]);

  useLayoutEffect(() => { measure(); });
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    if (typeof window.ResizeObserver === 'function' && rowRef.current) {
      const ro = new window.ResizeObserver(() => measure());
      ro.observe(rowRef.current);
      return () => ro.disconnect();
    }
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [measure]);

  /* ── the More menu (OrgSwitcher's keyboard rules) ──────────────────── */
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef(null);
  const menuRef = useRef(null);
  const wrapRef = useRef(null);
  useKeepOnScreen(menuRef, moreOpen);
  const closeMore = useCallback((restore = true) => {
    setMoreOpen(false);
    if (restore && moreRef.current) moreRef.current.focus();
  }, []);
  useEffect(() => {
    if (!moreOpen) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); closeMore(); } };
    const onDown = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setMoreOpen(false); };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    const first = menuRef.current && menuRef.current.querySelector(FOCUSABLE);
    if (first) first.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, [moreOpen, closeMore]);
  const onMenuKeyDown = (e) => {
    const all = menuRef.current ? Array.from(menuRef.current.querySelectorAll(FOCUSABLE)) : [];
    if (!all.length) return;
    const at = all.indexOf(document.activeElement);
    const go = (i) => { e.preventDefault(); all[(i + all.length) % all.length].focus(); };
    if (e.key === 'ArrowDown') go(at + 1);
    else if (e.key === 'ArrowUp') go(at - 1);
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(all.length - 1);
    else if (e.key === 'Tab') go(at + (e.shiftKey ? -1 : 1));
  };

  const choose = (scope) => {
    setMoreOpen(false);
    setSheetOpen(false);
    if (onSelect) onSelect(scope.key, scope);
  };
  const [sheetOpen, setSheetOpen] = useState(false);

  const href = '/admin?section=overview';
  const tab = (scope, extra = '') => {
    const active = scope.key === activeKey;
    return (
      <a
        key={scope.key}
        href={href}
        className={`scp-tab${active ? ' is-on' : ''}${extra}`}
        aria-current={active ? 'page' : undefined}
        title={scope.kind === 'personal' ? `Personal · ${scope.fullName}` : scope.fullName}
        data-testid={`scp-tab-${scope.kind}`}
        data-key={scope.key}
        onClick={(e) => { e.preventDefault(); choose(scope); }}
      >
        <TabBody scope={scope} count={counts[scope.key] || 0} active={active} />
      </a>
    );
  };

  const elsewhere = scopes.filter((s) => s.key !== activeKey).reduce((sum, s) => sum + (counts[s.key] || 0), 0);
  const current = scopes.find((s) => s.key === activeKey) || personal || teams[0] || engage;

  if (phone) {
    return (
      <nav className="scp scp--phone" data-theme="dark" aria-label="Where you work">
        <button
          type="button"
          className="scp-current"
          aria-haspopup="dialog"
          aria-expanded={sheetOpen}
          onClick={() => setSheetOpen(true)}
          data-testid="scp-current"
        >
          {current && <Tile scope={current} />}
          <span className="scp-cur-nm">
            {current ? current.name : 'Choose where you work'}
            {current && current.kind !== 'personal' && current.role && <small>{roleWord(current.role)}</small>}
          </span>
          {elsewhere > 0 && <span className="scp-else">{elsewhere} elsewhere</span>}
          <Icon name="CaretDown" size={13} weight="bold" className="scp-cv" />
        </button>
        {sheetOpen && (
          <Modal
            overlayClassName="scp-sheet-scrim"
            contentClassName="scp-sheet"
            label="Where you work"
            onClose={() => setSheetOpen(false)}
          >
            <div className="scp-sheet-in" data-theme="dark">
              <div className="scp-grab" aria-hidden="true" />
              <div className="scp-mh">Where you work</div>
              {[personal, ...teams].filter(Boolean).map((s) => (
                <button key={s.key} type="button" className={`scp-it${s.key === activeKey ? ' is-on' : ''}`} aria-current={s.key === activeKey ? 'page' : undefined} onClick={() => choose(s)}>
                  <Tile scope={s} />
                  <span className="scp-it-nm">{s.name}</span>
                  {s.kind === 'team' && <span className="scp-it-rl">{roleWord(s.role)}</span>}
                  <Count n={counts[s.key] || 0} />
                </button>
              ))}
              {engage && (
                <>
                  <div className="scp-msep" />
                  <button type="button" className={`scp-it${engage.key === activeKey ? ' is-on' : ''}`} aria-current={engage.key === activeKey ? 'page' : undefined} onClick={() => choose(engage)}>
                    <Tile scope={engage} />
                    <span className="scp-it-nm">Engage</span>
                    <span className="scp-it-rl">Staff</span>
                    <Count n={counts[engage.key] || 0} />
                  </button>
                </>
              )}
              <div className="scp-msep" />
              {onCreateTeam && (
                <button type="button" className="scp-it scp-it--add" onClick={() => { setSheetOpen(false); onCreateTeam(); }}>+ New team</button>
              )}
              {onCreatePersonal && (
                <button type="button" className="scp-it scp-it--add" onClick={() => { setSheetOpen(false); onCreatePersonal(); }}>+ Personal space</button>
              )}
              <button type="button" className="scp-close" onClick={() => setSheetOpen(false)}>Close</button>
            </div>
          </Modal>
        )}
      </nav>
    );
  }

  return (
    <nav className="scp" data-theme="dark" aria-label="Where you work">
      <div className="scp-row" ref={rowRef}>
        {personal && tab(personal)}
        {visible.map((s) => tab(s))}
        {hidden.length > 0 && (
          <span className="scp-morewrap" ref={wrapRef}>
            <button
              type="button"
              className="scp-tab scp-tab--more"
              ref={moreRef}
              aria-haspopup="menu"
              aria-expanded={moreOpen}
              onClick={() => setMoreOpen((was) => !was)}
              onKeyDown={(e) => { if (e.key === 'ArrowDown') { e.preventDefault(); setMoreOpen(true); } }}
              data-testid="scp-more"
            >
              <span className="scp-nm">{hidden.length} more</span>
              <Count n={moreCount} />
              <Icon name="CaretDown" size={12} weight="bold" />
            </button>
            {moreOpen && (
              <div className="scp-menu" role="menu" aria-label="More teams" ref={menuRef} onKeyDown={onMenuKeyDown}>
                <div className="scp-mh" aria-hidden="true">More teams</div>
                {hidden.map((s) => (
                  <button key={s.key} type="button" role="menuitem" className="scp-it" title={s.fullName} onClick={() => choose(s)}>
                    <Tile scope={s} />
                    <span className="scp-it-nm">{s.name}</span>
                    <span className="scp-it-rl">{roleWord(s.role)}</span>
                    <Count n={counts[s.key] || 0} />
                  </button>
                ))}
                {onCreateTeam && (
                  <>
                    <div className="scp-msep" />
                    <button type="button" role="menuitem" className="scp-it scp-it--add" onClick={() => { closeMore(false); onCreateTeam(); }}>+ New team</button>
                  </>
                )}
              </div>
            )}
          </span>
        )}
        <span className="scp-grow" />
        {onCreateTeam && !(dropAdd && hidden.length > 0) && (
          <button type="button" className="scp-tab scp-tab--add" onClick={onCreateTeam} data-testid="scp-add">+ New team</button>
        )}
        {onCreatePersonal && (
          <button type="button" className="scp-tab scp-tab--quiet" onClick={onCreatePersonal} data-testid="scp-add-personal">+ Personal space</button>
        )}
        {engage && (
          <>
            <span className="scp-sep" aria-hidden="true" />
            {tab(engage)}
          </>
        )}
      </div>

      {/* The measuring layer: every tab at its natural width, never seen. */}
      <div className="scp-measure" ref={measureRef} aria-hidden="true">
        {scopes.map((s) => (
          <span key={s.key} className="scp-tab" data-measure={s.key}>
            <TabBody scope={s} count={counts[s.key] || 0} active={s.key === activeKey} />
          </span>
        ))}
        <span className="scp-tab scp-tab--more" data-measure="more"><span className="scp-nm">{Math.max(2, teams.length)} more</span><span className="scp-n">99</span><Icon name="CaretDown" size={12} weight="bold" /></span>
        <span className="scp-tab scp-tab--add" data-measure="add">+ New team</span>
        <span className="scp-tab scp-tab--quiet" data-measure="addpersonal">+ Personal space</span>
      </div>
    </nav>
  );
}

export { PLATFORM_KEY };
