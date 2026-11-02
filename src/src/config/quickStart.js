/**
 * QUICK START, THE FAST LANE INSIDE NEW ENGAGEMENT (experience plan §3.1,
 * Phase 4 step 4c; audit E N1, N3, row 5 of its recommendations).
 *
 * Quick start used to be its own door on Home and its own shell (a bare
 * overlay that created AND started a session in one press, straight into a
 * live room). The other door, New engagement, created and landed in the
 * Sessions list. Two doors, two landings. Now there is one door, and Quick
 * start is a lane inside it: one press that fills every decision with a
 * sensible default and creates, landing on the session's Setup like any other
 * create, with Start there.
 *
 * WHAT IT PICKS, AND IT SAYS SO BEFORE THE PRESS (nothing hidden):
 *   format  the one chosen in the dialog; else the host's last format; else
 *           Call & Answer. Never Build Room or Event: both need their own
 *           setup (audit E row 37, "E").
 *   set     the one picked in the dialog; else the set this host used most
 *           recently in that format; else a set marked for Quick start (the
 *           set editor's own switch, which the old menu listed); else the
 *           first ready-made (Engage) set; else the first set of the format.
 *           Never an unreadable set.
 *   title   the one typed; else "Quick <format>: <set>", the old menu's shape.
 *   the rest every default: all topics, shuffled, names hidden until the vote.
 *
 * Pure: the dialog renders the line and creates through its own payload.
 */
import { ENGAGE, setOwnerTag } from '../utils/setOwnerTag';

export const QUICK_DEFAULT_FORMAT = 'call-and-answer';

/** The words, in one place (the drift guard reads config files too). */
export const QUICK_WORDS = Object.freeze({
  button: 'Quick start',
  lead: 'In a hurry?',
  every: 'every default',
  lands: 'You land on its Setup, ready to start.',
  none: (label) => `No ${label} set to start from yet. Pick or make one below.`,
  announce: (label, set) => `Quick start: ${label} with “${set}”. Creating it now.`,
});

/** The format Quick start would use, of those offered. */
export function quickFormat({ chosen = '', lastFormat = '', offered = [], isHandoff = () => false } = {}) {
  if (chosen && !isHandoff(chosen) && offered.includes(chosen)) return chosen;
  if (lastFormat && !isHandoff(lastFormat) && offered.includes(lastFormat)) return lastFormat;
  return offered.includes(QUICK_DEFAULT_FORMAT) ? QUICK_DEFAULT_FORMAT : (offered.find((id) => !isHandoff(id)) || '');
}

/**
 * The set Quick start would use for `format`, or null.
 * `recent` is the chooser's Map of set key -> last used time.
 */
export function quickSet({
  sets = [], format = '', chosenKey = '', recent = new Map(), keyOf, isUnreadable = () => false,
} = {}) {
  if (!format) return null;
  const usable = (sets || []).filter((s) => s && s.engagementType === format && !isUnreadable(s));
  if (usable.length === 0) return null;
  if (chosenKey) {
    const chosen = usable.find((s) => keyOf(s) === chosenKey);
    if (chosen) return chosen;
  }
  let newest = null;
  let newestAt = 0;
  for (const s of usable) {
    const at = (recent && recent.get && recent.get(keyOf(s))) || 0;
    if (at > newestAt) { newest = s; newestAt = at; }
  }
  if (newest) return newest;
  return usable.find((s) => s.quickstart)
    || usable.find((s) => setOwnerTag(s) === ENGAGE)
    || usable[0];
}

/** The title Quick start gives a session the host has not named. */
export function quickTitle(typed, formatLabel, setName) {
  const t = String(typed || '').trim();
  if (t) return t;
  return `Quick ${formatLabel}: ${setName}`;
}
