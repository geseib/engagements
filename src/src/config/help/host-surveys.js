/*
  Running a survey. Empty until Phase 2 (W5).
  An area with no guides exports an empty list for its role. Do not register a
  placeholder guide: helpContent.test.js forbids "coming soon" text and stubs.
*/

/**
 * The host-surveys area. Assembled into roles by ./index.js (ROLE_AREAS); see
 * docs/help-refresh/STRUCTURE.md for the map and the conventions.
 */
export const AREA = {
  id: 'host-surveys',
  guides: { host: [] },
};
