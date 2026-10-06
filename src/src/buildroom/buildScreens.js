/**
 * THE BUILD ROOM'S FOUR SCREENS (docs/design/build-room-host-redesign, the
 * second pass the owner approved on 2026-10-05: "yes to the shape").
 *
 * One header carries four screens. Host is where the host works; Stage,
 * Build and History are made to be shown to the room. Choosing what the room
 * looks at replaces the old Present toggle, which only hid controls. P still
 * means "show the room": it flips between Host and the last screen the room
 * saw.
 *
 * Pure: no React, no fetch. The page and its tests share these.
 */
import { safeHref } from './buildHostApi';

export const SCREENS = Object.freeze([
  Object.freeze({ key: 'host', label: 'Host', shortcut: '1' }),
  Object.freeze({ key: 'stage', label: 'Stage', shortcut: '2' }),
  Object.freeze({ key: 'build', label: 'Build', shortcut: '3' }),
  Object.freeze({ key: 'history', label: 'History', shortcut: '4' }),
]);

/** The screens made to be seen by the room. Nothing host-only renders on them. */
export const PROJECTED = Object.freeze(['stage', 'build', 'history']);

export const isProjected = (screen) => PROJECTED.includes(screen);

/** The screen a number key selects, or null. */
export function screenForKey(key) {
  const hit = SCREENS.find((s) => s.shortcut === key);
  return hit ? hit.key : null;
}

/** P: from Host to the last screen the room saw (Stage the first time), and back. */
export function togglePresent(current, lastProjected) {
  if (isProjected(current)) return 'host';
  return isProjected(lastProjected) ? lastProjected : 'stage';
}

/**
 * How many things are waiting on the host: Claude's proposed asks and the
 * room's new ideas (preview feedback is an idea too). A number only: on a
 * projected screen the room sees the count, never the content.
 */
export function waitingCount(room) {
  if (!room) return 0;
  const proposed = (room.asks || []).filter((a) => a.status === 'proposed').length;
  const ideas = (room.ideas || []).filter((i) => i.status === 'new').length;
  return proposed + ideas;
}

/** The open ask the header pill names, or null: "Ask 3 · 5 of 18" / "Ask 3 · results". */
export function askPill(room) {
  if (!room || !room.currentAskId) return null;
  const ask = (room.asks || []).find((a) => a.askId === room.currentAskId);
  if (!ask || !['live', 'voting', 'results'].includes(ask.status)) return null;
  const n = Number(ask.askId) || ask.askId;
  if (ask.status === 'results') return { text: `Ask ${n} · results`, results: true };
  const count = ask.kind === 'suggest' && ask.status === 'voting' ? ask.voteCount : ask.answerCount;
  return { text: `Ask ${n} · ${count || 0} of ${room.playerCount || 0}`, results: false };
}

const BUILD_LOG_KINDS = ['showing', 'progress', 'milestone'];

/**
 * What the Build screen shows: the newest link to the running work and the
 * newest screenshot of it. The link is the newest one Claude posted with a
 * showing, progress or milestone entry, or the wrap-up's demo; the picture is
 * the newest screenshot that is not an option's mockup.
 */
export function latestBuild(room) {
  const log = (room && room.log) || [];
  let link = '';
  for (let i = log.length - 1; i >= 0; i -= 1) {
    const l = log[i];
    if (l.by === 'agent' && BUILD_LOG_KINDS.includes(l.kind) && safeHref(l.link)) { link = l.link; break; }
  }
  if (!link) {
    const demo = ((room && room.outcome && room.outcome.links) || []).find((l) => safeHref(l.url));
    if (demo) link = demo.url;
  }
  const shots = ((room && room.images) || []).filter((im) => im.kind !== 'mockup');
  const shot = shots.length ? shots[shots.length - 1] : null;
  return { link, shot };
}
