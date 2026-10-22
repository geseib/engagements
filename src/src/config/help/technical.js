/**
 * THE TWO TECHNICAL GUIDES: troubleshooting by symptom, and what you need.
 *
 * Help refresh Phase 2, workstream W11 (22 Oct 2026). Technical OWNS
 * troubleshooting by symptom and the requirements (docs/help-refresh/README.md
 * §2). Each symptom says what the reader sees, the likely cause and what to do,
 * and links to the guide that owns the detail instead of restating it. Section
 * ids from before Phase 2 are kept (players-cannot-get-in,
 * screens-not-keeping-up, ai-not-useful, signing-in, data-vanished; players,
 * hosts, network, video-call): player.js and admin-console.js link to them.
 *
 * Organised by the symptom, not the subsystem: somebody opening this mid-
 * session knows whose screen is wrong, not which connection failed.
 *
 * Checked on dev (engage.dev.seibtribe.us, 22 Oct 2026): /join with 0000
 * ("Nothing is running under 0000", Try again); /play on a created, not
 * started session ("This game has not been started yet. Please wait for the
 * host to start the session."); the host start screen.
 */

const troubleshooting = {
  id: 'technical-troubleshooting',
  title: 'Troubleshooting',
  icon: 'Wrench',
  summary: 'Something is not working: find what you see, and what to do about it.',
  sections: [
    {
      /*
        lambda-functions/game/session-gate.js (404 "Game not found"; 403 "This
        game has not been started yet. Please wait for the host to start the
        session."; never refuses an ended session). components/RootPage.jsx and
        JoinCodeEntry.jsx (/join: "Nothing is running under {code}", Try
        again). PlayerPage "Use a different code". components/joinResult.js
        getClientId: the per-browser id lives in browser storage; with none,
        joining still works but the phone cannot be recognised later.
        SessionSetupPanel "Players join at".
      */
      id: 'players-cannot-get-in',
      title: 'Players cannot get in',
      icon: 'Lock',
      blocks: [
        {
          t: 'table',
          head: ['What they see', 'What to do'],
          rows: [
            ['"This game has not been started yet"', 'The session exists but has not started. Start it, then they press **Join Game** again: the page does not retry by itself.'],
            ['"Nothing is running under …", or "Game not found"', 'The four digits are wrong, or come from an old link. Read the code off the main screen (a 0 and an 8 look alike from the back). On a link, **Use a different code** lets them type it.'],
            ['"This session is private."', 'It needs the access code as well. See Joining a session › A private session.'],
            ['"That name is taken."', 'Someone else, or their own other device, holds that name. See Joining a session › When your name is taken.'],
            ['The QR code does nothing', 'Some camera apps need a tap on the link they find. Or go to the join page and type the four digits.'],
            ['The page will not load at all', 'The network, not the session: see Screens are not keeping up, below.'],
          ],
        },
        {
          t: 'note',
          tone: 'info',
          title: 'Players never sign in',
          text: 'A player asked to sign in has a host link. Give them the join address, under **Players join at** in the Session panel\'s Settings, or the QR.',
        },
        {
          t: 'p',
          text: 'A private browsing window forgets a player when it closes, so they cannot be welcomed back under their name. An ordinary tab is better.',
        },
      ],
    },
    {
      /*
        SessionSetupPanel header ws badge (" Connected" / " Connecting…");
        consoleWords connected/offline in ConsoleRail Session tools ("● Connected"
        / "Offline"); HostRemote hr-live-word ("Live" / "Offline"); PlayerPage
        offlineBanner ("Offline. Reconnecting."). WebSocketClient.js reconnects
        on its own with back-off, and again on a network or visibility event.
        The admin switch: admin-console.js real-time-communication.
      */
      id: 'screens-not-keeping-up',
      title: 'Screens are not keeping up',
      icon: 'Broadcast',
      blocks: [
        {
          t: 'p',
          text: 'Every screen follows the session over a live connection. When it drops, a screen stops changing: a phone still shows the last round, or your console shows old numbers.',
        },
        {
          t: 'table',
          head: ['Where', 'The sign'],
          rows: [
            ['A player\'s phone', '"Offline. Reconnecting." across the top.'],
            ['Your stage', 'The Session panel\'s header says Connecting… instead of Connected.'],
            ['Your laptop console', 'Session tools on the left rail says Offline.'],
            ['Your phone remote', 'Offline at the top, instead of Live.'],
          ],
        },
        {
          t: 'steps',
          items: [
            { title: 'Give it a moment', text: 'Screens reconnect by themselves and catch up. A player should not refresh while they have an answer typed.' },
            { title: 'Reload the screen that is stuck', text: 'A player then taps **Rejoin as** their name, and nothing is lost.' },
            { title: 'Try another network', text: 'Some guest and company Wi-Fi blocks live connections. A phone that stays stuck can switch to mobile data. See What you need to run it › The network.' },
          ],
        },
        {
          t: 'p',
          text: 'Testing as a player in a browser where you are an admin? The real-time switch in the console\'s Settings must be on there (Settings › Real-time communication).',
        },
      ],
    },
    {
      /*
        present/roomWindow.js (Chrome/Edge Window Management placement; blocked
        popup returns null; one window name); config/roomScreen.js quickBlocked,
        openTab, noSecondDisplay; config/presentStatus.js (STALE_MS 90 s);
        PresentPage FILL_CUE. The full how-to: host-two-screens.
      */
      id: 'rooms-window',
      title: 'The room\'s window will not open, or is on the wrong screen',
      icon: 'ArrowSquareOut',
      blocks: [
        {
          t: 'list',
          items: [
            { title: 'Nothing opened', text: 'The browser blocked it. Press **Room\'s window ↗** on the console\'s top line again, or allow pop-ups for Engage.' },
            { title: 'It opened beside you, not on the room\'s display', text: 'Only Chrome and Edge can place it, and only if you allowed them to manage windows on all your displays. Drag it across and click it once. Said no by mistake? Allow window management for Engage in the browser\'s site settings.' },
            { title: 'The room sees your console', text: 'The display is mirroring your laptop. Set it to extend the desktop, or run on one screen.' },
            { title: 'It says Not open, but it is up', text: 'It stopped checking in for a minute and a half. Reload the room\'s window; it comes back on the same moment.' },
            { title: 'No second display', text: 'Use **Open as a tab**, then share that tab or press F on it.' },
          ],
        },
        {
          t: 'p',
          text: 'How it all works: Two screens and your phone › Opening the room\'s window, and Is the room\'s window up?',
        },
      ],
    },
    {
      /*
        hooks/useFullscreenKey.js, utils/fullscreen.js (F toggles, Esc leaves,
        not while typing: isTypingTarget; no Fullscreen API on an iPhone).
        No audio anywhere in the app (no <audio>, no AudioContext; the only
        <video> is on the marketing pages).
      */
      id: 'fullscreen-sound',
      title: 'Full screen, and sound',
      icon: 'CornersOut',
      blocks: [
        {
          t: 'list',
          items: [
            { title: 'F does nothing', text: 'F works on your host screens and on the room\'s window, but not while you are typing in a box: click outside it first. On the room\'s window, a single click fills the screen while it says **Click anywhere to fill the screen**.' },
            { title: 'Leaving full screen', text: 'F again, or Esc.' },
            { title: 'On an iPhone', text: 'A web page cannot go full screen there. Use a laptop for anything the room watches.' },
            { title: 'No sound', text: 'Engage plays no sound on any screen, so there is nothing to unmute. Music or a video for the room comes from another app.' },
          ],
        },
      ],
    },
    {
      /*
        config/hostRemote.js accessDeniedMessage (expired / error / account);
        HostRemote.jsx access gate buttons: Try again, Sign in again, Sign in
        as someone else, the team switcher (account only), Enter a different
        code. The remote does not drive a Build Room (host-two-screens).
      */
      id: 'phone-remote-refused',
      title: 'Your phone remote is refused',
      icon: 'DeviceMobile',
      blocks: [
        {
          t: 'table',
          head: ['The phone says', 'What to do'],
          rows: [
            ['"That account can\'t run this session."', 'Press **Sign in as someone else** and use an account on the team that runs it (for a personal session, the account that created it). If it offers a team switcher, pick the session\'s team.'],
            ['"Your sign-in has run out."', 'Press **Sign in again**.'],
            ['"Could not confirm this device can run the session."', 'Check the phone\'s signal, then **Try again**.'],
            ['The wrong session, or a typo in the code', 'Press **Enter a different code**.'],
          ],
        },
        {
          t: 'p',
          text: 'The phone remote does not drive a Build Room. Setting it up: Two screens and your phone › Your phone as a remote.',
        },
      ],
    },
    {
      /*
        components/AISummaryStatus.jsx ("Workie is reading the responses…",
        failure block with Try again / Trying again…, fallback "Workie's read
        didn't run" with Redo); utils/aiSummaryRecovery.js headlines and which
        ones retry by themselves (offline, unreachable, 5xx; never a 4xx);
        config/workieOptions.js fallbackDetail ("No summary approach is set up
        for this kind of session").
      */
      id: 'what-we-heard-failed',
      title: 'What we heard did not appear',
      icon: 'Ear',
      blocks: [
        {
          t: 'p',
          text: '"Workie is reading the responses…" for a few seconds is normal. If something goes wrong, the place where the read would be says so. The round itself is never lost: you can always move the room on.',
        },
        {
          t: 'table',
          head: ['It says', 'What to do'],
          rows: [
            ['"This device is offline."', 'Reconnect. It starts again by itself.'],
            ['"Could not reach the server." or "The server could not start the summary."', 'It tries again by itself twice. Then press **Try again**.'],
            ['"Workie started, but never reported back." or "Workie could not write the summary."', 'Press **Try again**, or move on and redo it later with **Redo the read on screen** in the Session panel\'s Settings tab.'],
            ['"The server turned the summary down."', 'Trying again will not help: the set\'s prompt needs an admin\'s look (Prompts › When the output is wrong).'],
            ['"Workie\'s read didn\'t run", with only a count', 'Press **Redo**. If it says no summary approach is set up, an admin has to add one for that kind of session.'],
          ],
        },
        {
          t: 'p',
          text: 'Workie wrote something the room did not say? See What we heard and Ask the room › When Workie says more than the room did.',
        },
      ],
    },
    {
      /*
        The old "The AI did not say anything useful" section, kept by id. Its
        facts now live in ai.js (output-wrong, generation-prompts, statuses),
        builder.js (holding-back: the empty reveal) and admin-console.js
        (debug-settings).
      */
      id: 'ai-not-useful',
      title: 'Workie wrote something unhelpful',
      icon: 'Sparkle',
      blocks: [
        {
          t: 'table',
          head: ['Symptom', 'Where to look'],
          rows: [
            ['Generic, or oddly formatted', 'The prompt behind it: Prompts › When the output is wrong.'],
            ['It promised a reveal and never revealed', 'The question has nothing held back to reveal: Writing questions › Holding something back until they have answered.'],
            ['Every generated set comes out wrong the same way', 'The generation prompt, not your request: AI builders › Generation prompts shape the output.'],
            ['Something inexplicable', 'Turn on **Show AI Prompts in Debug Mode** and read what was actually sent: Settings › Debug settings.'],
          ],
        },
      ],
    },
    {
      /*
        components/DraftsStrip.jsx ("Writing N of M … for …", Watch; "Generation
        for … failed — nothing to review."; "Discarded: … Restorable for N more
        days." Restore…); utils/draftsApi.js (a draft lives in ONE library;
        the bell finds it from anywhere); admin/shared/generation-drafts.js
        READY_DAYS 30, DISCARD_RESTORE_DAYS 7.
      */
      id: 'ai-draft-missing',
      title: 'An AI draft has not appeared',
      icon: 'NotePencil',
      blocks: [
        {
          t: 'list',
          items: [
            { title: 'It is still being written', text: 'The line at the top of Question sets says "Writing …" with how far it has got. **Watch** opens it; the bell tells you when it is ready.' },
            { title: 'You are in another library', text: 'A draft waits in the library it will be saved into: Your space or one team. Switch at the top of the console, or open it from the bell, which finds it from anywhere.' },
            { title: '"Generation for … failed — nothing to review."', text: 'Nothing was written. Ask for it again.' },
            { title: 'You discarded it', text: 'It is listed as discarded, with **Restore…**, until its time runs out.' },
            { title: 'Its time ran out', text: 'It has gone (Drafts and the bell › How long drafts are kept). Ask for it again.' },
          ],
        },
        {
          t: 'p',
          text: 'More: Drafts and the bell › Reviewing a draft.',
        },
      ],
    },
    {
      /*
        buildroom/BuildRoomPage.jsx AgentChip ("… not connected", "last seen …"
        copies the continue command; tooltip "Not connected. Open Session to
        connect."), stoppedBefore ("Claude Code stopped before your last
        direction."); words.js installNote, needLine, showAllSteps;
        src/public/engage-mcp.mjs errorResult (401/403: "This folder's key no
        longer opens Build Room …: a newer key was minted, it was revoked, or
        the session has ended."); buildHostApi.js (curl, node, mkdir -p, claude:
        commands for a Mac or Linux shell); pluginTier.js (one plugin per site).
      */
      id: 'build-room-not-connecting',
      title: 'Claude Code will not connect to the Build Room',
      icon: 'Terminal',
      blocks: [
        {
          t: 'table',
          head: ['What you see', 'What to do'],
          rows: [
            ['The install command fails', 'Check the laptop has Node 18 or later and git, then run it again. See What you need to run it › For a Build Room.'],
            ['The terminal cannot find claude', 'Install Claude Code on this laptop first.'],
            ['Claude Code says this folder\'s key no longer opens the Build Room', 'A newer key was minted, the key was revoked, or the session ended. In **Connect Claude Code**, **Show all the steps** gives a new start command.'],
            ['The Claude chip in the header says not connected, or last seen', 'Claude Code was closed or has gone quiet. See Connecting Claude Code › Coming back after a break.'],
            ['"Claude Code stopped before your last direction."', 'Run the command shown with it in Claude Code; the direction is waiting.'],
            ['Commands begin with another site\'s name', 'Each Engage site has its own plugin. Use the Connect Claude Code window of the site you are hosting on.'],
          ],
        },
      ],
    },
    {
      /*
        build-room.js sharing: guest Wi-Fi blocks the share; one Claude Code
        window shares a room at a time; the remote link goes through
        Cloudflare. engage-mcp.mjs TUNNEL_WORDS (download, refused, platform)
        and ensureCloudflared (downloads Cloudflare's tool the first time).
      */
      id: 'build-room-demo',
      title: 'People cannot open the Build Room\'s demo',
      icon: 'Globe',
      blocks: [
        {
          t: 'list',
          items: [
            { title: 'Nobody in the room can open it', text: 'Guest Wi-Fi often stops one device reaching another. Test from your own phone first; the room still sees Claude\'s screenshots. See Sharing the demo › Sharing it on this Wi-Fi.' },
            { title: 'The count of who opened it looks wrong', text: 'Update the plugin from Connect Claude Code, and keep one Claude Code window per room.' },
            { title: '"Couldn\'t download Cloudflare\'s remote-link tool"', text: 'Sharing beyond the room downloads a small tool the first time. Check the laptop is online, then turn the share off and on. Some company networks block it.' },
            { title: '"Cloudflare is not giving out new remote links from this network right now"', text: 'Wait a few minutes and try again, or try another network.' },
          ],
        },
        {
          t: 'p',
          text: 'More: Sharing the demo › People who are not in the room.',
        },
      ],
    },
    {
      /*
        auth/PendingApproval.jsx ("Your account exists. It cannot host yet.");
        auth/AuthContext.jsx forgotPassword InvalidParameterException ("This
        account can't be reset by email. If you signed up with Google, use
        'Continue with Google' instead."); LoginForm "Continue with Google".
        Console sections by role: admin-console.js console-sections.
      */
      id: 'signing-in',
      title: 'Signing in',
      icon: 'UserCircle',
      blocks: [
        {
          t: 'list',
          items: [
            { title: '"Your account exists. It cannot host yet."', text: 'New accounts wait for approval. An admin lets you host: The console: a tour › Someone cannot host yet.' },
            { title: '"This account can\'t be reset by email."', text: 'It signs in with Google, so there is no password to reset. Use **Continue with Google**.' },
            { title: 'No reset code arrives', text: 'An account set up for you with a temporary password has nothing to reset until that password is changed. Sign in with the temporary password: you are asked to choose your own.' },
            { title: 'A console section is missing', text: 'The console shows what your role allows: The console: a tour › What is in the console, and who sees it.' },
          ],
        },
      ],
    },
    {
      /* The rules themselves live in admin-team.js (admin-data-privacy
         sessions-expire) and host-reports.js (how-long-data-lasts). */
      id: 'data-vanished',
      title: 'A session or a report has gone',
      icon: 'CalendarBlank',
      blocks: [
        {
          t: 'p',
          text: 'Sessions, their answers and saved reports are each kept for a fixed time and then removed for good; nobody can bring them back. How long each lasts: Data & privacy › How long things are kept, and The session report › How long the data lasts.',
        },
        {
          t: 'p',
          text: 'Not expired, just not in the list? Sessions and sets belong to Your space or to one team: switch at the top of the console.',
        },
      ],
    },
  ],
};

const requirements = {
  id: 'technical-requirements',
  title: 'What you need to run it',
  icon: 'ClipboardText',
  summary: 'Devices, browsers, the room\'s display, the network, and what a Build Room adds.',
  sections: [
    {
      /* PlayerPage join form ("No account, nothing to install."); joinResult.js
         getClientId (browser storage remembers the player). */
      id: 'players',
      title: 'Players',
      icon: 'DeviceMobile',
      blocks: [
        {
          t: 'list',
          items: [
            'Any phone, tablet or laptop with a current browser.',
            'A network: anything that loads a web page.',
            'A camera, if they want to scan the QR code rather than type four digits.',
            'No account, no install, no app.',
            'An ordinary browser tab, not private browsing, so the session can welcome them back if they lose the page.',
          ],
        },
      ],
    },
    {
      /* present/roomWindow.js canPlace (getScreenDetails: Chrome, Edge);
         config/remoteSignIn.js; SessionSetupPanel "Your phone as a remote". */
      id: 'hosts',
      title: 'Hosts',
      icon: 'Monitor',
      blocks: [
        {
          t: 'list',
          items: [
            'A laptop with a current browser, signed in to an account that may host.',
            'For two screens, Chrome or Edge: they can put the room\'s window on the room\'s display by themselves. Other browsers work; you drag the window across.',
            'Pop-ups allowed for Engage, so the room\'s window can open.',
            'Optionally, your own phone as a remote (Two screens and your phone › Your phone as a remote).',
          ],
        },
      ],
    },
    {
      /* host-two-screens.js when-two-screens, open-room-window, room-size;
         usePresentation.js (the room's window reads without sign-in). */
      id: 'room-display',
      title: 'The room\'s display',
      icon: 'CornersOut',
      blocks: [
        {
          t: 'list',
          items: [
            { title: 'One screen', text: 'The room watches your laptop: connect the display and mirror it, or share your screen.' },
            { title: 'Two screens', text: 'Connect the display as a second screen that extends your desktop, not a mirror. The room\'s window needs no sign-in.' },
            { title: 'Any size', text: 'Set **Room screen size** to match, and check it from the back of the room before people arrive.' },
          ],
        },
        {
          t: 'p',
          text: 'Choosing between them: Two screens and your phone › When to use two screens.',
        },
      ],
    },
    {
      /* config.js on dev: API_BASE https://….execute-api.us-east-1.amazonaws.com,
         WS_URL wss://….execute-api.us-east-1.amazonaws.com; public/index.html
         loads Google Fonts. */
      id: 'network',
      title: 'The network',
      icon: 'Broadcast',
      blocks: [
        {
          t: 'p',
          text: 'Every screen keeps a live connection open (a secure WebSocket). Most networks allow it; some guest and company networks do not, and no setting in Engage gets round that. A phone that stays stuck can switch to mobile data.',
        },
        {
          t: 'p',
          text: 'If a venue\'s IT team asks: Engage needs ordinary web traffic (HTTPS) to this site and to Amazon Web Services, secure WebSockets to Amazon Web Services, and Google Fonts.',
        },
        {
          t: 'note',
          tone: 'tip',
          title: 'Test the room, not the platform',
          text: 'At a new venue, join from your own phone on the guest Wi-Fi before the room fills up. That is the thing that fails, and you can fix it in two minutes if you find out early.',
        },
      ],
    },
    {
      /* The how-to is host-two-screens#video-call (Open as a tab, share the
         tab, Room screen size Call). Kept here by id; only the chat tip is
         technical's own. */
      id: 'video-call',
      title: 'Running it on a video call',
      icon: 'Broadcast',
      blocks: [
        {
          t: 'p',
          text: 'Share the room\'s window as a tab, and size it for a call: Two screens and your phone › Running it on a video call. People still join on their own devices.',
        },
        {
          t: 'p',
          text: 'Paste the join address into the call\'s chat as well: a QR code inside a screen share is awkward to scan.',
        },
      ],
    },
    {
      /* words.js needLine ("The laptop that runs Claude Code needs Node 18 or
         later and git."), installNote; buildHostApi.js pluginInstallCommand
         (curl, node) and startCommand (mkdir -p, cd, claude): POSIX shell;
         engage-mcp.mjs CLOUDFLARED assets (macOS, Linux, Windows) fetched
         from GitHub the first time, only for sharing beyond the room. */
      id: 'build-room',
      title: 'For a Build Room',
      icon: 'Terminal',
      blocks: [
        {
          t: 'list',
          items: [
            'Claude Code on the laptop you host from. Claude builds there.',
            'Node 18 or later, and git, on that laptop.',
            'The Engage plugin for Claude Code, installed once per laptop from **Connect Claude Code**.',
            'A terminal. The commands Engage gives you are written for a Mac or Linux terminal.',
            'To share the demo beyond the room: a network that lets the laptop download Cloudflare\'s small remote-link tool the first time, and reach Cloudflare.',
            'People in the room need only a phone, tablet or laptop. Crew builders bring their own Claude Code.',
          ],
        },
        {
          t: 'p',
          text: 'Setting up: Build Room: what it is and setting one up › Before you start, and Connecting Claude Code › Connecting the first time.',
        },
      ],
    },
  ],
};

/**
 * The technical area. Assembled into roles by ./index.js (ROLE_AREAS); see
 * docs/help-refresh/STRUCTURE.md for the map and the conventions.
 */
export const AREA = {
  id: 'technical',
  guides: { technical: [troubleshooting, requirements] },
};
