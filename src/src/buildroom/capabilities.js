/**
 * EVERYTHING BUILD ROOM DOES, BY NAME (docs/design/parity/PLAN.md §2.6b;
 * owner, 17 Oct 2026: "just makes sure as we integrate, we dont lose
 * capabilities in the build room").
 *
 * One entry per row of the §2.6b table. Every way into a capability carries
 * `data-capability="<id>"` on the page, and __tests__/buildCapabilities.test.jsx
 * fails when an id here has no entry point. A capability leaves this list only
 * when the owner removes it, in the same commit that removes its id.
 *
 * The History / Build row is two ids, so losing either screen is caught.
 *
 * `twoScreens` is where each one lives on the laptop's console on two screens
 * (B8; docs/design/build-room-console view 4, "Where everything went"). The
 * test walks the console for every id as well as the one-screen page.
 *
 * Pure: no React, no fetch.
 */
export const CAPABILITIES = Object.freeze([
  {
    id: 'ask-moves', name: "The ask's moves (open voting, show results, spin, send, change, reopen, take it down, save for later, the points vote, the run list, hide the codes)", oneScreen: 'Stage dock: the shared bar on buildControls',
    twoScreens: 'Your part now: the main button and the second on buildControls (Spin the wheel on the result), a third move in its third slot',
  },
  {
    id: 'ask-path', name: 'The ask path, the decide panel, the host\'s pick, answering for the room, kept drafts', oneScreen: 'Host screen',
    twoScreens: "The ask's main-area panel; the strip shows Ask, Collect, Settle, Send to Claude; the decide panel open at settle",
  },
  {
    id: 'board-pick', name: 'Picking on the board (an option or a wheel slice opens the send window)', oneScreen: 'Stage',
    twoScreens: "The ask's panel: the options are pressable there, since the wall has no controls",
  },
  {
    id: 'composer', name: 'The Composer: send to Claude, save for later, log it, ask the room', oneScreen: 'Host screen',
    twoScreens: "Main area, under the moment's work",
  },
  {
    // The right column (owner, 28 Oct 2026): Claude now, The brief, History; Decided, Asks,
    // Screenshots and the timeline (Claude) are History's chips, each with its old fold's actions.
    id: 'whats-next', name: "What's next; the right column: Claude now, The brief (the room brief's edits), History's Decided (tick to combine), Asks, Screenshots and Claude (the timeline)", oneScreen: 'Host screen',
    twoScreens: "What's next in the main area between asks; Claude now, The brief and History in the side column, as on one screen",
  },
  {
    id: 'queue', name: "The queue: Claude's asks and the room's ideas", oneScreen: 'Host screen, Waiting for you',
    twoScreens: "Rail: Waiting for you, with the filters and each item's actions; opens into the main area",
  },
  {
    id: 'later', name: 'The Later list', oneScreen: 'Host screen',
    twoScreens: 'Rail: Later; opens into the main area',
  },
  {
    id: 'points', name: 'Talking points, research or ideas requests, the run list', oneScreen: 'Host screen',
    twoScreens: 'Points inside Later in the rail; the point and the run list as main-area panels; their moves in Your part now',
  },
  {
    id: 'opening', name: 'The opening: the brief, its steps, Start building', oneScreen: 'Host screen; Session, Back to the opening',
    twoScreens: 'Main-area panel while the room frames the build, and The brief in the side column; Session slot: Back to the opening',
  },
  {
    id: 'crew', name: 'The crew: builders, early looks, run crew code', oneScreen: 'Host screen and Session',
    twoScreens: 'Session slot: Crew; the crew board in the main area; builders marked in People',
  },
  {
    id: 'share-demo', name: 'Share demo on this Wi-Fi, the codes card, the enlarged QR', oneScreen: 'Header join code, Share demo chip, Session',
    twoScreens: 'Top line: Join (the codes on the wall) and Share demo; Session',
  },
  {
    id: 'claude-status', name: "Claude's status, the doing line, the plugin's update dot, Continue, Connect Claude", oneScreen: 'Header chip, Session',
    twoScreens: "Claude now at the top of the side column; Connect Claude, the plugin and Continue in the Session slot",
  },
  {
    id: 'host-alert', name: 'The Host alert (what waits, Mark all seen)', oneScreen: 'Header tab on Build and History; HOST on the Stage, one press home',
    twoScreens: 'Rail: Waiting for you, its count and Mark all seen',
  },
  {
    id: 'players', name: 'Players: handover requests, remove, Away, Builders; team invitations', oneScreen: 'Session, Players',
    twoScreens: 'Rail: People (who has answered, by name); the request strip in the main area; Session slot: Players',
  },
  {
    id: 'settings', name: 'Settings: codes, list names, Claude, Crew, opening, wrap up, report, end', oneScreen: 'Session',
    twoScreens: 'Session slot: Settings opens the Session panel; the \\ key too',
  },
  {
    id: 'history', name: 'History: filters, the ask window, the mockup viewer', oneScreen: 'History screen',
    twoScreens: 'Session slot: Look here, privately: History; on the wall from The room sees',
  },
  {
    id: 'build-screen', name: 'The Build screen: latest shot, open the build', oneScreen: 'Build screen',
    twoScreens: 'Session slot: Look here, privately: Build; on the wall from The room sees',
  },
  {
    id: 'report', name: 'The report, wrap-up, end', oneScreen: 'Session, This session',
    twoScreens: 'Session slot: Wrap up, Report, End session',
  },
  // The room's window (parity PLAN §2.7, B7 and B9 in part): the Screens group, and the link that opens the wall.
  {
    id: 'screens', name: "Screens: the room's window, its status, the room screen size, a new link", oneScreen: 'Session, Settings, Screens',
    twoScreens: 'Session slot: Screens',
  },
  {
    id: 'room-window', name: "The room's window (/present?type=build), following Stage, Build and History", oneScreen: "The header's Room's window ↗ (Host, Build, History), the Stage dock's ROOM'S WINDOW; Session, Settings, Screens: Room's window",
    twoScreens: "Top line: Room's window ↗ and its status, The room sees: Stage, Build, History, See it here",
  },
  // The release gate (owner, 17 Oct 2026; parity PLAN §2c).
  {
    id: 'release-posts', name: "Releasing Claude's posts and screenshots to the room: release, keep to myself, release all, the check-posts switch", oneScreen: 'Host screen, Waiting for you; Session, Settings, Claude',
    twoScreens: 'Rail: Waiting for you; Session, Settings, Claude',
  },
].map((c) => Object.freeze(c)));

export const CAPABILITY_IDS = Object.freeze(CAPABILITIES.map((c) => c.id));
