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
  'host-session-panel': { guide: 'host-session-panel', section: 'session-panel' }, // SessionSetupPanel (opens the host role today)
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
  'host-stage': { guide: 'host-running-engagements', section: 'the-stage' },
  'host-dock': { guide: 'host-running-engagements', section: 'dock-and-keys' },
  'host-session-players': { guide: 'host-player-management', section: 'players-tab' },
  'host-session-questions': { guide: 'host-session-panel', section: 'choosing-ask-next' },
  'host-session-rounds': { guide: 'host-session-panel', section: 'going-back-over-round' },
  'host-session-settings': { guide: 'host-session-panel', section: 'settings-tab' },
  'host-late-items': { guide: 'host-late-items', section: 'late-not-reviewed' },
  'host-what-we-heard': { guide: 'host-what-we-heard', section: 'what-we-heard' },
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
  'admin-overview': { guide: 'admin-getting-started', section: 'overview' },
  'admin-question-sets': { guide: 'admin-question-sets', section: 'the-list' },
  'admin-new-set': { guide: 'admin-question-sets', section: 'new-set' },
  'admin-set-editor': { guide: 'builder-manual', section: 'trivia-question' },
  'admin-set-versions': { guide: 'admin-question-sets', section: 'versions-not-overwrites' },
  'admin-public-library': { guide: 'glossary', section: 'owner-tags' },
  'admin-sessions': { guide: 'admin-game-management', section: 'sessions-list' },
  'admin-events': { guide: 'glossary', section: 'event' },
  'admin-prompt-versions': { guide: 'admin-ai-prompts', section: 'versions' },
  'admin-members': { guide: 'admin-members', section: 'who-is-here' },
  'admin-activity': { guide: 'admin-activity', section: 'reading-activity' },
  'admin-plan': { guide: 'host-plan', section: 'where-to-see-it' },
  'admin-data-privacy': { guide: 'admin-data-privacy', section: 'whats-recorded' },
  'admin-settings': { guide: 'admin-settings', section: 'browser-only' },

  /* ---- admin console: Engage staff ---- */
  'staff-organisations': { guide: 'admin-getting-started', section: 'console-sections' },
  'staff-observability': { guide: 'admin-getting-started', section: 'console-sections' },
  'staff-plan-requests': { guide: 'admin-getting-started', section: 'console-sections' },
  'staff-discount-codes': { guide: 'admin-getting-started', section: 'console-sections' },
  'staff-shared-library': { guide: 'glossary', section: 'owner-tags' },
  'staff-public-library': { guide: 'glossary', section: 'owner-tags' },
  'staff-prompts': { guide: 'admin-ai-prompts', section: 'managing-them' },         // "Editing prompts (Engage staff)"
  'staff-moderation': { guide: 'admin-getting-started', section: 'console-sections' },
  'staff-accounts': { guide: 'admin-getting-started', section: 'first-thing' },
  'staff-archive': { guide: 'admin-question-sets', section: 'moving-between-environments' },
  'staff-engage-settings': { guide: 'admin-getting-started', section: 'console-sections' },

  /* ---- AI ---- */
  'ai-builders': { guide: 'admin-ai-builders', section: 'what-builders-do' },
  'ai-draft-review': { guide: 'ai-drafts', section: 'drafts-bell-review' },
  'ai-bell': { guide: 'ai-drafts', section: 'the-bell' },

  /* ---- Build Room (host) ---- */
  'build-create': { guide: 'host-build-room', section: 'setting-up' },
  'build-connect': { guide: 'build-room-claude', section: 'connecting-claude' },
  'build-host': { guide: 'build-room-running', section: 'the-host-screen' },
  'build-stage': { guide: 'build-room-running', section: 'room-screens' },
  'build-build': { guide: 'build-room-running', section: 'room-screens' },
  'build-history': { guide: 'build-room-running', section: 'marks-and-history' },
  'build-session-panel': { guide: 'host-build-room', section: 'session-panel' },
  'build-console': { guide: 'build-room-two-screens', section: 'console' },

  /* ---- players ---- */
  'player-join': { guide: 'player-joining', section: 'getting-in' },
  'player-name-taken': { guide: 'player-joining', section: 'name-taken' },
  'player-join-errors': { guide: 'player-joining', section: 'other-things-join-screen' },
  'player-lobby': { guide: 'player-playing', section: 'between-rounds' },
  'player-answering': { guide: 'player-playing', section: 'answering' },
  'player-voting': { guide: 'player-voting', section: 'voting' },
  'player-results': { guide: 'player-feedback', section: 'results-feedback' },
  'player-end': { guide: 'player-feedback', section: 'after-the-end' },
  'player-survey': { guide: 'player-playing', section: 'answering' },
  'player-event': { guide: 'glossary', section: 'event' },
  'player-build-room': { guide: 'player-build-room', section: 'joining' },
};

/**
 * Screens whose entry points at a stand-in section until Phase 2 writes the
 * real one. Phase 3 retargets each and deletes it from this list.
 */
export const PROVISIONAL_SCREENS = [
  'host-create-advanced', 'host-sessions', 'host-room-screen-chooser', 'host-survey',
  'event-builder', 'event-agenda', 'event-stage',
  'admin-public-library', 'admin-events',
  'staff-organisations', 'staff-observability', 'staff-plan-requests', 'staff-discount-codes',
  'staff-shared-library', 'staff-public-library', 'staff-moderation', 'staff-engage-settings',
  'player-survey', 'player-event',
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
