/*
  THE BUILD ROOM. Claims are taken from the code, not the plan:
  WelcomeScreen.jsx (the door and its one line), buildroom/words.js (needLine,
  installNote, shareWho, wrapUpSaved), buildroom/pluginTier.js (one plugin per
  tier) and buildroom/buildHostApi.js (the two commands the Connect window
  shows). Words the room sees on its own screens live in words.js, not here.
  17 Oct: what the share opens (build-lan.js lanScopes, the plugin's gateway,
  .engage/share.json, plugin 1.20.0), the room's window (BuildSessionPanel's
  Screens group, present/buildwall/), the still dock (buildControls.js), and
  History's marks (buildScreens.js contributionsOf, askOutcome).
  17 Oct: releasing Claude's posts (build-store.js reviewAgentPosts, the
  queue's BuildHeldPosts.jsx, BuildSessionPanel's Claude group, plugin 1.21.0).
  19 Oct: Consider and the sent marks (buildroom/BuildConsider.jsx, sentMarks.js,
  build-room.js considerItem, build-store.js inboxText adds the why).
  19 Oct: the console on two screens (BuildConsole.jsx, buildConsole.js,
  BuildConsoleAsk.jsx; buildControls' decideInline; build-store's answeredBy).
  22 Oct (help Phase 1, docs/help-refresh/inventory/build-room.md §4): codes
  come down with J everywhere (BuildRoomPage toggleCodesRef), the one-screen
  header Join (toggleCodes) and Esc on the Stage only (BuildStageScreen
  onHideCodes); enlarging is the Stage's, and only the join code copies
  (screens/QrZoom.jsx). Remote share says on this network / elsewhere per
  person, Remove only beside more than one device (BuildWifiShare RemotePeople,
  words.js remoteWhere*). Consider's fourth door, Add to the open Ideas ask
  (BuildConsider canIdeas). The window names people with List names on
  (present/buildwall/wallRoom.js). Console: the bell (ConsoleTop), Copy the
  Continue prompt and Back to the opening (BuildRoomPage SessionSlot).
*/
const buildRoom = {
  id: 'host-build-room',
  title: 'Build Room',
  icon: 'Wrench',
  summary: 'Build something with your Claude Code while the room suggests and votes. You decide.',
  sections: [
    {
      id: 'what-it-is',
      title: 'What it is',
      icon: 'Wrench',
      blocks: [
        {
          t: 'p',
          text: 'Claude Code runs on your laptop and joins the room. People join with the four-digit code on laptops, tablets and phones. Claude asks the room for ideas, choices and ratings; the room answers; you decide what Claude builds next.',
        },
      ],
    },
    {
      id: 'before-start',
      title: 'Before you start',
      icon: 'ListChecks',
      blocks: [
        {
          t: 'list',
          items: [
            'Claude Code, on the laptop you will host from.',
            'Node 18 or later, and git, on that laptop.',
            'The Engage plugin for Claude Code. Each site has its own: engage on engage.seibtribe.us, engage-test on the test site, engage-dev on the dev site.',
          ],
        },
      ],
    },
    {
      id: 'connecting-claude',
      title: 'Connecting Claude',
      icon: 'Terminal',
      blocks: [
        {
          t: 'steps',
          items: [
            { title: 'Open Build Room', text: 'From the welcome screen. Name the build, and say who sets the goal: the room, or you.' },
            { title: 'Install the plugin', text: 'The Connect window shows one command. Run it in a terminal, once per laptop. Run it again when the room says the plugin is out of date.' },
            { title: 'Start Claude Code', text: 'Mint a key, and the start command is copied. Paste it into a terminal: it makes a new folder under ~/build-room, with git, starts Claude Code there and kicks off. Claude reads the room, says what it plans, and starts.' },
            { title: 'Coming back', text: 'Closed Claude Code, or restarted the laptop? Open Connect Claude Code: it shows one paste that opens Claude Code in the same folder and picks up where it left off, with no new key. Out of date, the same paste updates the plugin first. On another laptop, press Show all the steps.' },
          ],
        },
      ],
    },
    {
      id: 'during-after',
      title: 'During and after',
      icon: 'FlagCheckered',
      blocks: [
        {
          t: 'list',
          items: [
            { title: 'Share demo', text: 'When Claude first shows the app, the Build Room asks once whether to share it. Share demo lets people on this Wi-Fi open this laptop\'s app on their own devices; no one else can. Nothing is shared until you press it. Guest Wi-Fi often blocks this; test it from another device first. Anyone who cannot reach it still sees the screenshots. Only one Claude Code window shares a room at a time; if the count jumps, update the plugin from Connect.' },
            { title: 'What the share opens', text: 'Open the build and the QR go to the page Claude showed. The room can open only the pages Claude linked and what those pages load; a folder\'s file list is never shown. The share panel names each server: Demo, Mockups, or App 1 and 2 when nothing says. To name them yourself, put a file .engage/share.json in the project folder with "demo", "mockups" and a "label"; it wins over Claude\'s guess. Every page a session serves names it, so two rooms on one laptop are easy to tell apart. These need plugin 1.20.0: update it from Connect and restart Claude Code.' },
            { title: 'People who are not in the room', text: 'In the Share demo panel, Also open it to people who are not here lets everyone in the session open the demo from anywhere with the same Open the demo button. It is off until you turn it on. Each person\'s button carries their own key; the panel lists who opened it, on how many devices, and whether on this network or elsewhere; Remove, beside anyone on more than one device, ends that person\'s link. It goes through Cloudflare, who can see the demo, and closes when you turn it off or the session ends. The first time, the laptop downloads a small tool, and some company networks block it. Update the plugin from Connect first (Settings, then Claude, says which plugin is running).' },
            { title: 'The room\'s window', text: 'Room\'s window ↗ on the header or the console\'s top line (and PRESENT in the Stage\'s dock) opens Stage, Build or History in a window of its own for the projector, on the second display in Chrome; beside it, whether that window is open and full screen. Click the room\'s window once to fill the screen (or press F). It needs no sign-in and shows no names unless List names on the room meter is on. With no second display, Open as a tab opens it in a tab you can share on a call. The first time, the Host screen asks Where will the room watch? (Help me pick answers three questions); Two screens opens the window there and then. Session, Settings, Screens shows the choice and changes it, and has New link (press it twice) for a link shared by mistake: it cuts off every window opened with the old one.' },
            { title: 'Two screens: your laptop console', text: 'When you chose Two screens, or the room\'s window is open, the laptop is yours alone and shows the console, as Call & Answer\'s. The top line has the session, Join (it shows the join code), Share demo, Room\'s window ↗ and whether it is on, the bell, and The room sees: Stage, Build, History, which, like 2, 3, 4 and P, change only the room\'s window; See it here shows that screen on the laptop, and 1 comes back. Under it the strip shows where the ask is: Opening, then Ask, Collect, Settle, Send to Claude, then Wrap up; between asks it stays, dimmed, and says what is happening instead (Between asks, The run list · 2 of 4 done). Your part now, top centre, says what to do next and holds the main button: Space presses it, and a move made early asks you to press again. Between asks it says No main move now, and What\'s next below has the likely moves. On a result the decide panel is already open beside the board: change the words or pick another option there; Send in Your part now sends it; the second button is Spin the wheel. On the left, four sections: Waiting for you (Claude\'s questions and the room\'s ideas; open it in the middle for more room), People (who has answered, by name, while the room answers or votes, never what they chose), Later with Points inside, and Session (Connect Claude, the plugin, the Continue prompt while Claude is away, the crew, Build and History, privately, the Session panel, Back to the opening, wrap up, the report, end). On the right: Now, then Decided, Timeline, Asks, Screenshots and Room brief. ← All sessions leaves; the session keeps running. One screen is unchanged.' },
            { title: 'Showing the join code', text: 'Join at the top of the Host screen, the code on the Stage\'s left rail, or J puts the join QR in a panel beside what is on the Stage, on this screen and on the room\'s window, without covering it. While the demo is shared on the Wi-Fi its code sits under the join code. J takes them down again, and so do Join on one screen and Esc on the Stage. On the Stage, click a code in the panel to enlarge it on your own screen; the enlarged join code copies its link.' },
            { title: 'The Stage\'s buttons', text: 'The buttons along the bottom stay where they are. Space presses the main one; a move made early asks you to press again. Host takes you back to the Host screen in one press; its number says how many things wait for you.' },
            { title: 'Consider', text: 'Consider sits on every idea in an open Ideas ask as it arrives, on the reasons people give with a pick or a rating, on every option once a vote has closed, and on each idea in Waiting for you. It opens one panel; the ask carries on. Queue for the room keeps the room\'s words and waits in Waiting for you: as a yes or no question, as a feedback question, or marked Queued for the room until you put it to a vote with others; an idea can also join an Ideas ask that is open. Send to Claude starts from the room\'s words; change them if you like, and say why in the Why line. Claude reads the why with the direction, and History keeps it for the room to see. Send to Claude now, or Later to keep it on your Later list. Esc closes the panel and keeps what you typed. Sending a decided ask has the same Why line, in Direction for Claude on the Host screen and in Change before sending on the Stage.' },
            { title: 'Sent to Claude marks', text: 'Anything that reached Claude says so where you see it: in the ideas, in Waiting for you, on a vote\'s options, in Asks and in Decided. The mark reads Sent to Claude, Sent to Claude, reworded, or Sent to Claude, for later; Queued for the room means it waits to be put to the room. Click a mark to open History at that entry, highlighted: in the side column on the Host screen, or on the History screen.' },
            { title: 'History', text: 'History shows every idea from the room that was used, and every ask the room saw. Each says what happened: chosen by the room or not, sent to Claude as written, reworded by the host, kept for later, or not sent. When you changed the room\'s words, the entry shows them struck through, then what Claude got, then your why, with how many people liked it. It never shows who sent an idea; a phone marks its own ideas as yours. Made so far counts the ideas used by the same rule.' },
            { title: 'Releasing Claude\'s posts', text: 'Claude\'s updates, answers and screenshots wait in Waiting for you before the room sees them: Release to the room puts one on the phones and the room\'s screens at the time it happened, Keep to myself keeps it off them for good, and Release all lets several through at once. Your Timeline marks what the room has not been shown. Claude\'s mockups appear when their ask opens, and its live "Claude is" line always shows. To let posts straight through, turn off Check Claude\'s posts before the room sees them in Session, Settings, Claude. Claude learns of this with plugin 1.21.0.' },
            { title: 'Wrap up', text: 'A summary, what was built, links and next steps, written by Claude or by you, saved into the report. Check the report, then end the session.' },
            { title: 'Save report', text: 'Keeps the report as a PDF, as for any session. The code stays in the project folder on your laptop.' },
          ],
        },
      ],
    },
  ],
};

/**
 * The build-room area. Assembled into roles by ./index.js (ROLE_AREAS); see
 * docs/help-refresh/STRUCTURE.md for the map and the conventions.
 * Build Room for the host. Participants: ./build-room-participant.js; the Claude Code plugin: ./build-room-claude.js.
 */
export const AREA = {
  id: 'build-room',
  guides: { host: [buildRoom] },
};
