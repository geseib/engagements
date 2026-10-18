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
 * Pure: no React, no fetch.
 */
export const CAPABILITIES = Object.freeze([
  { id: 'ask-moves', name: "The ask's moves (open voting, show results, spin, send, change, reopen, take it down, save for later, the points vote, the run list, hide the codes)", oneScreen: 'Stage dock: the shared bar on buildControls' },
  { id: 'ask-path', name: 'The ask path, the decide panel, the host\'s pick, answering for the room, kept drafts', oneScreen: 'Host screen' },
  { id: 'board-pick', name: 'Picking on the board (an option or a wheel slice opens the send window)', oneScreen: 'Stage' },
  { id: 'composer', name: 'The Composer: send to Claude, save for later, log it, ask the room', oneScreen: 'Host screen' },
  { id: 'whats-next', name: "What's next, Decided, Timeline, Asks, Screenshots, Room brief", oneScreen: 'Host screen' },
  { id: 'queue', name: "The queue: Claude's asks and the room's ideas", oneScreen: 'Host screen, Waiting for you' },
  { id: 'later', name: 'The Later list', oneScreen: 'Host screen' },
  { id: 'points', name: 'Talking points, research or ideas requests, the run list', oneScreen: 'Host screen' },
  { id: 'opening', name: 'The opening: the brief, its steps, Start building', oneScreen: 'Host screen; Session, Back to the opening' },
  { id: 'crew', name: 'The crew: builders, early looks, run crew code', oneScreen: 'Host screen and Session' },
  { id: 'share-demo', name: 'Share demo on this Wi-Fi, the codes card, the enlarged QR', oneScreen: 'Header join code, Share demo chip, Session' },
  { id: 'claude-status', name: "Claude's status, the doing line, the plugin's update dot, Continue, Connect Claude", oneScreen: 'Header chip, Session' },
  { id: 'host-alert', name: 'The Host alert (what waits, Mark all seen)', oneScreen: 'Header tab on Build and History; HOST on the Stage, one press home' },
  { id: 'players', name: 'Players: handover requests, remove, Away, Builders; team invitations', oneScreen: 'Session, Players' },
  { id: 'settings', name: 'Settings: codes, list names, Claude, Crew, opening, wrap up, report, end', oneScreen: 'Session' },
  { id: 'history', name: 'History: filters, the ask window, the mockup viewer', oneScreen: 'History screen' },
  { id: 'build-screen', name: 'The Build screen: latest shot, open the build', oneScreen: 'Build screen' },
  { id: 'report', name: 'The report, wrap-up, end', oneScreen: 'Session, This session' },
  // The room's window (parity PLAN §2.7, B7 and B9 in part): the Screens group, and the link that opens the wall.
  { id: 'screens', name: "Screens: the room's window, its status, the room screen size, a new link", oneScreen: 'Session, Settings, Screens' },
  { id: 'room-window', name: "The room's window (/present?type=build), following Stage, Build and History", oneScreen: "Session, Settings, Screens: Room's window" },
  // The release gate (owner, 17 Oct 2026; parity PLAN §2c).
  { id: 'release-posts', name: "Releasing Claude's posts and screenshots to the room: release, keep to myself, release all, the check-posts switch", oneScreen: 'Host screen, Waiting for you; Session, Settings, Claude' },
].map((c) => Object.freeze(c)));

export const CAPABILITY_IDS = Object.freeze(CAPABILITIES.map((c) => c.id));
