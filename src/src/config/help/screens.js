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
 * section they really want is not written yet. Every id here is referenced by
 * a component (helpScreenWiring.test.js), so an id with no screen fails. Nothing
 * here is shown on a screen the room sees (the stage, the room's window, the
 * Build Room's wall): a help button is for the host's or the player's own
 * screen only.
 */
export const HELP_FOR_SCREEN = {
  /* ---- the bars' `?` (each also a menu to report a bug) ---- */
  'host-start': { guide: 'host-quick-start', section: 'start-screen' },         // WelcomeScreen
  'host-session-panel': { guide: 'host-session-panel', section: 'session-panel' }, // SessionSetupPanel, before a tab is known
  'player-page': { guide: 'player-getting-started', section: 'session-looks-like' }, // PlayerShell, with no state of its own
  'admin-console': { guide: 'admin-getting-started', section: 'console-sections' }, // AdminPage header, with no section
  'admin-prompts': { guide: 'admin-ai-prompts', section: 'two-kinds-one-library' }, // AdminPage prompt library cards
  'admin-settings-realtime': { guide: 'admin-settings', section: 'real-time-communication' }, // AdminPage Settings

  /* ---- host: setting up ---- */
  'host-create': { guide: 'host-game-setup', section: 'create-engagement' },    // GameSetupDialog head
  'host-create-advanced': { guide: 'host-game-setup', section: 'advanced' },     // SessionOptions (the Advanced fold, also in EventItemDialog)
  'host-quick-start': { guide: 'host-game-setup', section: 'quick-start' },      // QuickstartMenu header
  'host-question-sets': { guide: 'host-game-setup', section: 'choosing-question-set' }, // HostQuestionSetsDialog header
  'host-sessions': { guide: 'host-game-setup', section: 'sessions-list' },       // SessionHistoryPanel header
  'host-reports': { guide: 'host-reporting', section: 'saving-report' },         // HostReportsDialog header; AdminPage Reports
  'host-room-screen-chooser': { guide: 'host-game-setup', section: 'one-or-two-screens' }, // RoomScreenChooser head

  /* ---- host: running the room (one screen) ----
     No entry for the stage itself: the room sees it. Its help is the dock's,
     the host's own control, and the dock opens What we heard or the survey's
     section while those are up (GameHostPage `dockHelp`). */
  'host-dock': { guide: 'host-running-engagements', section: 'dock-and-keys' },  // Dock (GameHostPage)
  // The Session panel's header `?` opens the tab that is showing.
  'host-session-players': { guide: 'host-player-management', section: 'players-tab' },
  'host-session-questions': { guide: 'host-session-panel', section: 'choosing-ask-next' },
  'host-session-rounds': { guide: 'host-session-panel', section: 'going-back-over-round' },
  'host-session-settings': { guide: 'host-session-panel', section: 'settings-tab' },
  'host-late-items': { guide: 'host-late-items', section: 'late-not-reviewed' }, // LateList head
  'host-what-we-heard': { guide: 'host-what-we-heard', section: 'what-we-heard' }, // dock and console, on the READ moment
  'host-session-report': { guide: 'host-reporting', section: 'session-report' }, // GameReport toolbar
  'host-survey': { guide: 'host-surveys', section: 'while-it-collects' },        // dock, on a survey

  /* ---- host: two screens and the phone ---- */
  'host-console': { guide: 'host-two-screens', section: 'laptop-console' },     // ConsoleTop (GameHostPage)
  'host-remote': { guide: 'host-two-screens', section: 'remote-controls' },     // HostRemote bar

  /* ---- host: events ---- */
  // The builder's add and edit dialogs (EventBuilder, EventItemDialog), the
  // agenda page around it (HostEventAgenda, and the console's Events place),
  // and the event's own stage (EventStage).
  'event-builder': { guide: 'host-event-agenda', section: 'adding-items' },
  'event-agenda': { guide: 'host-event-agenda', section: 'the-agenda-page' },
  'event-stage': { guide: 'host-event-day', section: 'the-board' },

  /* ---- admin console: your space and teams ----
     The console's header `?` opens the section that is showing (AdminPage
     `adminHelpScreen`); the dialogs and panels below carry their own. */
  'admin-overview': { guide: 'admin-getting-started', section: 'overview' },
  'admin-question-sets': { guide: 'admin-question-sets', section: 'the-list' },
  'admin-new-set': { guide: 'admin-question-sets', section: 'new-set' },        // NewSetDialog head
  'admin-set-editor': { guide: 'admin-question-sets', section: 'editor' },
  'admin-set-versions': { guide: 'admin-question-sets', section: 'versions-not-overwrites' }, // QuestionSetEditor Versions
  'admin-public-library': { guide: 'admin-public-library', section: 'using-public-sets' },
  'admin-sessions': { guide: 'admin-game-management', section: 'sessions-list' },
  'admin-events': { guide: 'admin-game-management', section: 'events-list' },
  'admin-prompt-versions': { guide: 'admin-ai-prompts', section: 'versions' },  // PromptVersionsPanel
  'admin-members': { guide: 'admin-members', section: 'who-is-here' },
  'admin-activity': { guide: 'admin-activity', section: 'reading-activity' },
  'admin-plan': { guide: 'admin-plan-usage', section: 'this-month' },
  'admin-data-privacy': { guide: 'admin-data-privacy', section: 'whats-recorded' },
  'admin-settings': { guide: 'admin-settings', section: 'browser-only' },

  /* ---- admin console: Engage staff ---- */
  'staff-overview': { guide: 'admin-staff-console', section: 'needs-engage' },  // AdminPage STAFF_SECTION_HELP overview
  'staff-organisations': { guide: 'admin-staff-organisations', section: 'organisations' },
  'staff-observability': { guide: 'admin-staff-platform', section: 'observability' },
  'staff-plan-requests': { guide: 'admin-staff-organisations', section: 'plan-requests' },
  'staff-discount-codes': { guide: 'admin-staff-organisations', section: 'discount-codes' },
  'staff-shared-library': { guide: 'admin-staff-content', section: 'shared-library' },
  'staff-public-library': { guide: 'admin-staff-content', section: 'staff-public-library' },
  'staff-prompts': { guide: 'admin-ai-prompts', section: 'managing-them' },
  'staff-moderation': { guide: 'admin-staff-content', section: 'moderation' },
  'staff-accounts': { guide: 'admin-staff-accounts', section: 'approving' },
  'staff-archive': { guide: 'admin-staff-platform', section: 'archive' },
  'staff-engage-settings': { guide: 'admin-staff-platform', section: 'engage-settings' },

  /* ---- AI ---- */
  'ai-builders': { guide: 'admin-ai-builders', section: 'what-builders-do' },   // the four AI builders' heads
  'ai-draft-review': { guide: 'ai-drafts', section: 'drafts-bell-review' },     // AdminPage header, on a draft
  'ai-bell': { guide: 'ai-drafts', section: 'the-bell' },                       // NotificationsBell panel head

  /* ---- Build Room (host) ----
     The header `?` opens the screen that is showing (Host, Build, History);
     the Stage's is in its dock, as Call & Answer's is. */
  'build-create': { guide: 'host-build-room', section: 'setting-up' },
  'build-connect': { guide: 'build-room-claude', section: 'connecting-claude' },
  'build-host': { guide: 'build-room-running', section: 'the-host-screen' },
  'build-stage': { guide: 'build-room-running', section: 'room-screens' },
  'build-build': { guide: 'build-room-running', section: 'room-screens' },
  'build-history': { guide: 'build-room-running', section: 'marks-and-history' },
  'build-session-panel': { guide: 'host-build-room', section: 'session-panel' },
  'build-console': { guide: 'build-room-two-screens', section: 'console' },

  /* ---- players ----
     PlayerShell's `?` takes a `help` id per state; a shell given none opens
     `player-join` while joining and `player-page` otherwise. */
  'player-join': { guide: 'player-joining', section: 'getting-in' },
  'player-name-taken': { guide: 'player-joining', section: 'name-taken' },
  'player-join-errors': { guide: 'player-joining', section: 'other-things-join-screen' },
  'player-lobby': { guide: 'player-playing', section: 'between-rounds' },
  'player-answering': { guide: 'player-playing', section: 'answering' },
  'player-voting': { guide: 'player-voting', section: 'voting' },
  'player-results': { guide: 'player-feedback', section: 'results-feedback' },
  'player-end': { guide: 'player-feedback', section: 'after-the-end' },
  'player-survey': { guide: 'player-surveys', section: 'answering' },
  'player-survey-comments': { guide: 'player-surveys', section: 'comments-afterwards' }, // a closed survey's comment round
  'player-event': { guide: 'player-events', section: 'the-agenda' },
  'player-build-room': { guide: 'player-build-room', section: 'joining' },
};

/**
 * Screens whose entry points at a stand-in section until a writer adds the
 * real one. Empty since Phase 3; kept so a future stand-in has a place to go
 * and helpScreens.test.js still reads it.
 */
export const PROVISIONAL_SCREENS = [];

/**
 * The props a HelpButton needs for a screen: `{ guide, section }`.
 * An unknown screen id returns `{}` — the button then opens help's home,
 * never a dead end — and the test above keeps the map itself honest.
 */
export function helpFor(screenId) {
  const entry = HELP_FOR_SCREEN[screenId];
  return entry ? { guide: entry.guide, section: entry.section } : {};
}
