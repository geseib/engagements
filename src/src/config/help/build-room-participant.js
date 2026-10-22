/*
  Build Room for the people in the room. Empty until Phase 2 (W7).
  An area with no guides exports an empty list for its role. Do not register a
  placeholder guide: helpContent.test.js forbids "coming soon" text and stubs.
*/

/**
 * The build-room-participant area. Assembled into roles by ./index.js (ROLE_AREAS); see
 * docs/help-refresh/STRUCTURE.md for the map and the conventions.
 */
export const AREA = {
  id: 'build-room-participant',
  guides: { player: [] },
};
