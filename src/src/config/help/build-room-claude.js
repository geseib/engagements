/*
  CONNECTING CLAUDE CODE (help refresh Phase 2, W7, 22 Oct 2026). The host's
  side of the Claude Code plugin. `connecting-claude` moved here from
  `host-build-room` (index.js HELP_SECTION_MOVES).

  Sources:
    the Connect window     buildroom/BuildRoomPage.jsx ConnectPanel and
                           connectCase (first / now / back / update / all),
                           ReturnStep, PluginVersionLine; words.js connect*,
                           plugin*; read on dev 22 Oct (three steps, More
                           commands for later, the review switch)
    the commands           buildHostApi.js pluginInstallCommand, startCommand
                           (mkdir ~/build-room/<folder>, claude "kickoff <key>");
                           pluginTier.js (one plugin per site: engage,
                           engage-test, engage-dev); src/public/engage-mcp.mjs
                           PROMPTS and writePlugin (connect, kickoff, ideas,
                           ab-mockups, wrap-up, continue, restore, preview,
                           join, early-look, review, share-repo)
    the hooks              engage-mcp.mjs writePlugin hooks.json: Stop runs
                           --checkpoint (hookCheckpoint, gitSnapshot: a hidden
                           snapshot under refs/engage/snapshots, never a commit
                           on the branch, only in a folder connected to this
                           site's room); PostToolUse etc. run --activity (the
                           live line); the commit tool (one commit per decision
                           or milestone, project git hooks run, never pushes);
                           usePluginHere (this site's plugin on for this folder)
    the key                lambda-functions/auth/authorizer.js agentKeyContext
                           (one session's build routes only; revoked keys
                           refused); game/build-room.js routeHost hostOnly()
                           (open, close, decide, directions, settings, keys,
                           posts, wall are the host's); after ENDED only the
                           wrap-up (outcome) is written
    out of date            words.js pluginOutdated/pluginUpdate (Host screen
                           only); BuildSessionPanel.jsx Claude group
  Version numbers are left out on purpose (STRUCTURE.md §7).
*/

const claude = {
  id: 'build-room-claude',
  title: 'Connecting Claude Code',
  icon: 'Terminal',
  summary: 'Install the plugin, connect Claude Code to your Build Room, come back after a break, and keep the plugin current.',
  sections: [
    {
      id: 'connecting-claude',
      title: 'Connecting the first time',
      icon: 'Terminal',
      blocks: [
        { t: 'p', text: 'Open **Connect Claude Code** (on the Host screen, or the Session panel, Settings, Claude). Claude Code runs on this laptop and joins the room. The commands are written for a Mac or Linux terminal. Three steps:' },
        {
          t: 'steps',
          items: [
            { title: 'Install the plugin', text: 'Copy the command under **Check for the latest Engage plugin** and run it in a terminal, once per laptop. It needs Node 18 or later. If your Mac asks about node, click Allow, so the room can open the build on this Wi-Fi.' },
            { title: 'Mint a key and copy the start command', text: 'Name the project folder if you like (it goes under ~/build-room), then **Mint a key and copy the command**. The key is shown once.' },
            { title: 'Paste it into a terminal', text: 'It makes the folder with git, opens Claude Code there, connects and kicks off. Claude reads the room, says what it plans, and starts. Claude Code already open in that folder? Type the line shown under the start command there instead.' },
          ],
        },
        { t: 'p', text: 'Review Claude\'s questions, in the same window, decides whether Claude\'s questions wait for you. **More commands for later** lists the plugin\'s commands, each with a Copy button.' },
      ],
    },
    {
      id: 'commands',
      title: 'The plugin\'s commands',
      icon: 'ListBullets',
      blocks: [
        { t: 'p', text: 'You type these into Claude Code. Each Engage site has its own plugin, so they start /engage: on the main site, and /engage-test: or /engage-dev: on the others; the Connect window shows this site\'s.' },
        {
          t: 'table',
          head: ['Command', 'What Claude does'],
          rows: [
            ['kickoff', 'Connects (with the key, the first time), reads the room and plans, or picks up where it left off.'],
            ['connect', 'Connects this folder to the room with a key, or reconnects it with its saved key.'],
            ['continue', 'Picks up your latest direction and listens for the next.'],
            ['ideas, ab-mockups', 'Asks the room for ideas on a topic, or builds labelled variants for the room to choose between.'],
            ['preview', 'Runs the work so far, links it on your screen and screenshots it for the room.'],
            ['wrap-up', 'Writes the wrap-up and tidies the project (see Wrapping up a Build Room).'],
            ['restore', 'Lists the hidden snapshots and brings one back, after asking you.'],
            ['share-repo, review', 'Crew: shares the repository with builders; reviews the next early look.'],
            ['join, early-look', 'For a builder\'s own Claude Code: joins the crew; shares an early look.'],
          ],
        },
      ],
    },
    {
      id: 'in-your-project',
      title: 'What the plugin does in your project',
      icon: 'GitBranch',
      blocks: [
        {
          t: 'list',
          items: [
            { title: 'A snapshot every turn', text: 'At the end of every turn Claude takes, the plugin saves a hidden snapshot of the project in git. It is not a commit on your branch; the restore command brings one back.' },
            { title: 'A commit per decision', text: 'Claude commits once per room decision it builds, or per milestone, and keeps a README and a list of decisions current. The commits stay on your laptop; only a crew\'s base branch is pushed. Your project\'s own git hooks run. The report\'s Version history lists these commits.' },
            { title: 'The live line', text: 'As Claude works, each step becomes one plain line that you and the room see as what Claude is doing.' },
            { title: 'Only where it is connected', text: 'The plugin acts only in a folder connected to a Build Room on its own site, and turns its site\'s plugin on for that folder only. Other projects are never touched.' },
          ],
        },
      ],
    },
    {
      id: 'coming-back',
      title: 'Coming back after a break',
      icon: 'ArrowCounterClockwise',
      blocks: [
        {
          t: 'list',
          items: [
            'Closed Claude Code, or restarted the laptop? Open **Connect Claude Code**: it shows one paste that opens Claude Code in the same folder and picks up where it left off, with no new key.',
            'Claude Code still open but quiet? The Claude chip in the header reads last seen; click it to copy the continue command, and paste it into Claude Code. **Copy the Continue prompt** does the same.',
            'A direction sent while Claude Code was stopped waits for it: the Host screen says how many, with the command to copy.',
            'On another laptop, or the folder is gone: **Show all the steps** mints a new key and makes a new folder. It starts empty; Claude picks up from the room\'s decisions, the brief and the timeline. A new key stops the old one.',
          ],
        },
      ],
    },
    {
      id: 'keeping-current',
      title: 'Keeping the plugin current',
      icon: 'ArrowsClockwise',
      blocks: [
        {
          t: 'list',
          items: [
            'When Claude\'s plugin is older than the latest, the Host screen says so, with **Update**. Only you see it.',
            'Update opens Connect Claude Code at the update: one paste that updates the plugin, then opens Claude Code in the project folder. Close Claude Code first if it is open, so the new plugin loads.',
            'Connect, and the Session panel, Settings, Claude, show which plugin Claude is running and whether it is the latest.',
            'Installing on another laptop: the same install command, under **Install on another laptop**.',
          ],
        },
      ],
    },
    {
      id: 'session-key',
      title: 'What the session key can and cannot do',
      icon: 'Lock',
      blocks: [
        {
          t: 'p',
          text: 'The key in the start command lets Claude Code into this one Build Room and nothing else in Engage: no other session, and none of your account. It is shown once, and kept in the project folder, never committed. **Revoke key**, in Connect, stops it; minting a new key stops the old one at once.',
        },
        {
          t: 'list',
          items: [
            { title: 'Claude can', text: 'Read the room; ask the room questions (they wait for you while review is on); post updates, screenshots and talking points (held for you while Check Claude\'s posts is on); report a list item done; write the wrap-up.' },
            { title: 'Only you can', text: 'Open voting, show results, decide, send a direction, change settings, show a screen to the room, release a held post, mint keys and end the session.' },
            { title: 'After the end', text: 'Claude can still read the room and write the wrap-up, nothing more.' },
          ],
        },
      ],
    },
  ],
};

/**
 * The build-room-claude area. Assembled into roles by ./index.js (ROLE_AREAS); see
 * docs/help-refresh/STRUCTURE.md for the map and the conventions.
 */
export const AREA = {
  id: 'build-room-claude',
  guides: { host: [claude] },
};
