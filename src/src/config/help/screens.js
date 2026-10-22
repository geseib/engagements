/**
 * WHICH SCREEN OPENS WHICH HELP SECTION — the one list call sites read.
 *
 * Help refresh Phase 0 (docs/help-refresh/README.md, "Help opens where you
 * are"). A screen's help button spreads `helpFor('<screen id>')` instead of
 * naming a guide itself, so retargeting a screen's help is a one-line change
 * here and a guide that is split or renamed is fixed in one place.
 *
 *   <HelpButton {...helpFor('admin-prompts')} variant="inline" size="small" />
 *
 * Every entry must resolve to a real guide AND a real section
 * (__tests__/helpScreens.test.js). Ids are kebab-case: `<surface>-<screen>`.
 *
 * PROVISIONAL entries point at the best section that exists today, because the
 * section they really want is written in Phase 2. Phase 3 retargets them and
 * removes them from `PROVISIONAL_SCREENS`; it also adds the buttons. Nothing
 * here is shown on a screen the room sees (the stage, the room's window, the
 * Build Room's wall): a help button is for the host's or the player's own
 * screen only.
 */
export const HELP_FOR_SCREEN = {
  /* ---- screens that already have a help button ---- */
  'host-start': { guide: 'host-quick-start', section: 'start-screen' },         // WelcomeScreen (opens the host role today)
  'host-session-panel': { guide: 'host-running-engagements', section: 'session-panel' }, // SessionSetupPanel (opens the host role today)
  'player-page': { guide: 'player-getting-started', section: 'session-looks-like' }, // PlayerShell (opens the player role today)
  'admin-console': { guide: 'admin-getting-started', section: 'console-sections' }, // AdminPage header (opens the admin role today)
  'admin-prompts': { guide: 'admin-ai-prompts', section: 'two-kinds-one-library' }, // AdminPage prompt library cards
  'admin-settings-realtime': { guide: 'admin-settings', section: 'real-time-communication' }, // AdminPage Settings

  /* ---- host: setting up ---- */
  'host-create': { guide: 'host-game-setup', section: 'create-engagement' },
  'host-create-advanced': { guide: 'host-game-setup', section: 'advanced' },
  'host-quick-start': { guide: 'host-game-setup', section: 'quick-start' },
  'host-question-sets': { guide: 'host-game-setup', section: 'choosing-question-set' },
  'host-sessions': { guide: 'host-game-setup', section: 'sessions-list' },
  'host-reports': { guide: 'host-reporting', section: 'session-report' },
  'host-room-screen-chooser': { guide: 'host-game-setup', section: 'one-or-two-screens' },

  /* ---- host: running the room (one screen) ---- */
  'host-stage': { guide: 'host-quick-start', section: 'step-3-run-rounds' },
  'host-dock': { guide: 'host-quick-start', section: 'step-3-run-rounds' },
  'host-session-players': { guide: 'host-player-management', section: 'players-tab' },
  'host-session-questions': { guide: 'host-running-engagements', section: 'choosing-ask-next' },
  'host-session-rounds': { guide: 'host-running-engagements', section: 'going-back-over-round' },
  'host-session-settings': { guide: 'host-game-setup', section: 'settings-before-you-start' },
  'host-late-items': { guide: 'host-late-items', section: 'late-not-reviewed' },
  'host-what-we-heard': { guide: 'host-reporting', section: 'what-we-heard' },
  'host-session-report': { guide: 'host-reporting', section: 'session-report' },
  'host-survey': { guide: 'host-quick-start', section: 'step-3-run-rounds' },

  /* ---- host: two screens and the phone ---- */
  'host-console': { guide: 'host-two-screens', section: 'laptop-console' },
  'host-remote': { guide: 'host-two-screens', section: 'phone-remote' },

  /* ---- host: events ---- */
  'event-builder': { guide: 'glossary', section: 'event' },
  'event-agenda': { guide: 'glossary', section: 'event' },
  'event-stage': { guide: 'glossary', section: 'event' },

  /* ---- admin console: your space and teams ---- */
  'admin-overview': { guide: 'admin-getting-started', section: 'console-sections' },
  'admin-question-sets': { guide: 'admin-question-sets', section: 'what-a-set-is' },
  'admin-new-set': { guide: 'admin-question-sets', section: 'what-a-set-is' },
  'admin-set-editor': { guide: 'builder-manual', section: 'trivia-question' },
  'admin-set-versions': { guide: 'admin-question-sets', section: 'versions-not-overwrites' },
  'admin-public-library': { guide: 'glossary', section: 'owner-tags' },
  'admin-sessions': { guide: 'admin-game-management', section: 'sessions-list' },
  'admin-events': { guide: 'glossary', section: 'event' },
  'admin-prompt-versions': { guide: 'admin-ai-prompts', section: 'versions' },
  'admin-members': { guide: 'admin-getting-started', section: 'console-sections' },
  'admin-activity': { guide: 'admin-getting-started', section: 'console-sections' },
  'admin-plan': { guide: 'host-plan', section: 'where-to-see-it' },
  'admin-data-privacy': { guide: 'admin-getting-started', section: 'console-sections' },
  'admin-settings': { guide: 'admin-settings', section: 'browser-only' },

  /* ---- admin console: Engage staff ---- */
  'staff-organisations': { guide: 'admin-getting-started', section: 'console-sections' },
  'staff-observability': { guide: 'admin-getting-started', section: 'console-sections' },
  'staff-plan-requests': { guide: 'admin-getting-started', section: 'console-sections' },
  'staff-discount-codes': { guide: 'admin-getting-started', section: 'console-sections' },
  'staff-shared-library': { guide: 'glossary', section: 'owner-tags' },
  'staff-public-library': { guide: 'glossary', section: 'owner-tags' },
  'staff-prompts': { guide: 'admin-ai-prompts', section: 'managing-them' },
  'staff-moderation': { guide: 'admin-getting-started', section: 'console-sections' },
  'staff-accounts': { guide: 'admin-getting-started', section: 'first-thing' },
  'staff-archive': { guide: 'admin-question-sets', section: 'moving-between-environments' },
  'staff-engage-settings': { guide: 'admin-getting-started', section: 'console-sections' },

  /* ---- AI ---- */
  'ai-builders': { guide: 'admin-ai-builders', section: 'what-builders-do' },
  'ai-draft-review': { guide: 'admin-ai-builders', section: 'drafts-bell-review' },
  'ai-bell': { guide: 'glossary', section: 'the-bell' },

  /* ---- Build Room (host) ---- */
  'build-create': { guide: 'host-build-room', section: 'before-start' },
  'build-connect': { guide: 'host-build-room', section: 'connecting-claude' },
  'build-host': { guide: 'host-build-room', section: 'during-after' },
  'build-stage': { guide: 'host-build-room', section: 'during-after' },
  'build-build': { guide: 'host-build-room', section: 'during-after' },
  'build-history': { guide: 'host-build-room', section: 'during-after' },
  'build-session-panel': { guide: 'host-build-room', section: 'during-after' },
  'build-console': { guide: 'host-build-room', section: 'during-after' },

  /* ---- players ---- */
  'player-join': { guide: 'player-joining', section: 'getting-in' },
  'player-name-taken': { guide: 'player-joining', section: 'name-taken' },
  'player-join-errors': { guide: 'player-joining', section: 'other-things-join-screen' },
  'player-lobby': { guide: 'player-getting-started', section: 'session-looks-like' },
  'player-answering': { guide: 'player-playing', section: 'answering' },
  'player-voting': { guide: 'player-playing', section: 'voting' },
  'player-results': { guide: 'player-scoring', section: 'points-earned' },
  'player-end': { guide: 'player-scoring', section: 'scoreboard' },
  'player-survey': { guide: 'player-playing', section: 'answering' },
  'player-event': { guide: 'glossary', section: 'event' },
  'player-build-room': { guide: 'player-playing', section: 'answering' },
};

/**
 * Screens whose entry points at a stand-in section until Phase 2 writes the
 * real one. Phase 3 retargets each and deletes it from this list.
 */
export const PROVISIONAL_SCREENS = [
  'host-create-advanced', 'host-sessions', 'host-room-screen-chooser', 'host-dock', 'host-survey',
  'event-builder', 'event-agenda', 'event-stage',
  'admin-new-set', 'admin-public-library', 'admin-events', 'admin-members', 'admin-activity',
  'admin-data-privacy',
  'staff-organisations', 'staff-observability', 'staff-plan-requests', 'staff-discount-codes',
  'staff-shared-library', 'staff-public-library', 'staff-moderation', 'staff-engage-settings',
  'build-host', 'build-stage', 'build-build', 'build-history', 'build-session-panel', 'build-console',
  'player-survey', 'player-event', 'player-build-room',
];

/**
 * The props a HelpButton needs for a screen: `{ guide, section }`.
 * An unknown screen id returns `{}` — the button then opens help's home,
 * never a dead end — and the test above keeps the map itself honest.
 */
export function helpFor(screenId) {
  const entry = HELP_FOR_SCREEN[screenId];
  return entry ? { guide: entry.guide, section: entry.section } : {};
}
