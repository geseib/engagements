/**
 * Which display the stage is being shown on.
 *
 * There are four profiles and they are four LITERAL ladders, not one ladder
 * times a scalar. Revision 1 of the design tried the scalar and it failed three
 * separate ways; the third is the one that matters — a multiplier can only
 * honour one floor, and the four contexts have four different ones, each
 * derived from the same ~8.3 arcminute label target through a different
 * viewing distance and pixel density:
 *
 *   Room   projected >=90in, <=30ft, ~20ppi   -> 20px
 *   TV     ~65in panel,      <=20ft, ~30ppi   -> 26px
 *   Call   screen-share; the ENCODER is the constraint, not the eye, so it
 *          keeps Room's ladder and changes treatment only  -> 20px
 *   Table  laptop, 2-4ft, ~120ppi             -> 16px
 *
 * Table's 16px is not a violation of the 20px rule. At ~120ppi and three feet
 * it subtends 9.0 arcminutes — MORE than the 20px Room floor buys at 25 feet.
 * Holding 20px there would spend space to over-serve an eye eight times closer.
 */

export const PROFILES = ['room', 'tv', 'call', 'table'];
export const DEFAULT_PROFILE = 'room';

/** Angular floors, expressed in pixels for the display each was derived for. */
export const FLOORS = { room: 20, tv: 26, call: 20, table: 16 };

const STORAGE_KEY = 'engage.displayProfile';

/** Width below which a browser is assumed to be a laptop panel, not a stage. */
const TABLE_MAX_WIDTH = 1600;

function isProfile(value) {
  return PROFILES.indexOf(value) !== -1;
}

/** The root class carrying this profile's ladder. */
export function profileClass(profile) {
  return `d-${isProfile(profile) ? profile : DEFAULT_PROFILE}`;
}

/**
 * The only profile a browser can infer.
 *
 * TV and Call are undetectable in principle — nothing in the platform reports a
 * panel's physical size, and nothing reports that the surface is being
 * re-encoded into a video call. Both are explicit choices in the Console.
 */
export function autoProfile(viewportWidth) {
  if (typeof viewportWidth !== 'number' || !isFinite(viewportWidth)) return DEFAULT_PROFILE;
  return viewportWidth < TABLE_MAX_WIDTH ? 'table' : DEFAULT_PROFILE;
}

/**
 * The profile to mount with.
 *
 * A stored choice always wins: a host on a 1366px laptop who picked TV meant
 * it, and "never lose the presentation state on reload" is a hard requirement —
 * a projector browser that reloads must come back exactly as it was. This is
 * why `useEffect(() => setBigScreenMode(false), [])` has to be deleted rather
 * than adapted.
 */
export function loadProfile(storage, viewportWidth) {
  let stored = null;
  try {
    stored = storage && storage.getItem(STORAGE_KEY);
  } catch (e) {
    // Private-mode Safari throws on access. Losing the preference is
    // survivable; a blank stage in front of a room is not.
    stored = null;
  }
  return isProfile(stored) ? stored : autoProfile(viewportWidth);
}

export function saveProfile(storage, profile) {
  if (!isProfile(profile)) return;
  try {
    storage && storage.setItem(STORAGE_KEY, profile);
  } catch (e) {
    /* see loadProfile */
  }
}
