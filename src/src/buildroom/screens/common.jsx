/**
 * SMALL PIECES THE ROOM'S SCREENS AND THE HOST SCREEN BOTH DRAW (parity PLAN
 * §2.5, B6): ask numbers, times, the timeline's labels, safe links, the live
 * build's address, the room comment on the wall.
 *
 * Moved out of BuildRoomPage.jsx so the screens in this folder, which the
 * room's window will be built on, never import the page (and with it the
 * signed-in fetch). __tests__/buildWallImports.test.js walks every import.
 */
import React from 'react';
import Icon from '../../components/Icon';
import { safeHref } from '../links';
import { pluginSlash } from '../pluginTier';
import { wifiState } from '../wifiShare';
import { wifiLink } from '../BuildWifiShare';
import { latestBuild } from '../buildScreens';
import { W } from '../words';

export const KIND_LABEL = { suggest: 'Ideas', choice: 'Choose', rating: 'Rate' };

/** With the Engage plugin the same prompts are the plugin's own commands. */
export const pluginCommand = (name) => pluginSlash(name);

export const askNumber = (askId) => Number(askId) || askId;

export const askById = (room, askId) => ((room && room.asks) || []).find((a) => a.askId === askId) || null;

export function clockTime(iso) {
  const t = Date.parse(iso || '');
  if (!Number.isFinite(t)) return '';
  return new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function agoText(iso, now) {
  const t = Date.parse(iso || '');
  if (!Number.isFinite(t)) return '';
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  return `${Math.round(m / 60)} h ago`;
}

/** Who wrote a timeline entry, in the wall's words. */
export function byLabel(entry) {
  if (entry.kind === 'base') return 'Base moved';
  if (entry.by === 'builder') return entry.kind === 'help' ? 'Help' : 'Crew';
  if (entry.by === 'agent') return entry.kind === 'showing' ? 'Showing' : 'Claude';
  if (entry.by === 'system') return 'System';
  if (entry.by === 'room' || entry.kind === 'idea') return 'Idea';
  switch (entry.kind) {
    case 'verbal': return 'Room said';
    case 'decision': return 'Decided';
    case 'direction': return 'To Claude';
    case 'note': return 'Host note';
    case 'milestone': return 'Milestone';
    case 'step': return 'Step';
    case 'outcome': return 'Wrap-up';
    default: return 'Host';
  }
}

/** One dot colour per family on the timeline. */
export const entryTone = (entry) => {
  if (entry.by === 'agent') return 'claude';
  if (entry.kind === 'decision' || entry.kind === 'direction') return 'decision';
  if (entry.kind === 'verbal' || entry.kind === 'idea') return 'verbal';
  if (entry.kind === 'note') return 'note';
  if (entry.by === 'system') return 'ask';
  return 'host';
};

/** A link only when it is http(s); otherwise the text, inert. */
export function SafeLink({ href, children, className }) {
  const url = safeHref(href);
  if (!url) return children ? <span className={className}>{children}</span> : null;
  return <a className={className} href={url} target="_blank" rel="noopener noreferrer">{children || url}</a>;
}

/**
 * A link the HOST opens on this laptop — a mockup, the demo, something Claude
 * is showing. Local addresses work here because Claude runs on this laptop;
 * that is the point, so the button says where it goes.
 */
export function OpenLink({ href, label, primary = false }) {
  if (!safeHref(href)) return null;
  return (
    <a className={`brm-btn brm-openbtn${primary ? ' brm-btn--primary' : ''}`} href={href} target="_blank" rel="noopener noreferrer" title={href}>
      <Icon name="ArrowSquareOut" size={16} /> {label}
    </a>
  );
}

/** What the host does when Claude Code has gone quiet (owner, 2026-10-05). */
/** Worked out when used: the site's tier names the plugin (window.ENV). */
export const continueCommand = () => pluginCommand('continue');

/**
 * THE LIVE BUILD (owner, 2026-10-08: "no obvious link to the live demo"): the
 * address of what Claude is running. The Wi-Fi share's address when sharing is
 * on (it works on every phone and laptop in the room), else the newest link
 * Claude posted, else the wrap-up's demo.
 */
export function liveBuildLink(room, now) {
  const sharing = ['on', 'quiet'].includes(wifiState(room.lan, now).state);
  return (sharing && wifiLink(room)) || latestBuild(room).link || '';
}

/**
 * THE ROOM COMMENT ON THE WALL: one at a time, no name, for WALL_COMMENT_MS
 * from when the host put it up (owner, 2026-10-05). Shown on the screens the
 * room sees (Stage, Build); the host can take it down early from the Host.
 */
export const WALL_COMMENT_MS = 20 * 1000;

export function freshWallComment(room, now) {
  const w = room && room.wallComment;
  if (!w || !w.text) return null;
  const at = Date.parse(w.at || '');
  return Number.isFinite(at) && now - at < WALL_COMMENT_MS ? w : null;
}

export function WallComment({ comment }) {
  if (!comment) return null;
  return (
    <div className="brm-wallcomment" role="status" key={comment.at}>
      <span className="brm-wallcomment-k">{W.fromTheRoom}</span>
      <q className="brm-wallcomment-t">{comment.text}</q>
    </div>
  );
}
