/**
 * THE PLAYER GUIDES: what people in the room see on their phones.
 *
 * Help refresh Phase 2, workstream W1 (22 Oct 2026). Task-first guides:
 * Getting started, Joining, Playing (per type), Voting, Feedback and comments,
 * Scoring, When something goes wrong. Surveys, events and the Build Room's
 * participant page have their own area files (player-surveys.js,
 * player-events.js, build-room-participant.js).
 *
 * Written for someone holding a phone mid-session, so: short sentences, the
 * words that are actually on their screen, and the answer before the
 * explanation. Every quoted label was read in the code (PlayerPage.jsx and the
 * components cited per section) and on dev (session 2901, 22 Oct 2026).
 *
 * The phone calls the room's display "the room’s screen" (PlayerPage's look-up
 * cues), so these guides do too: a player never needs to know whether the
 * host runs one screen or two.
 */

const gettingStarted = {
  id: 'player-getting-started',
  title: 'Getting started',
  icon: 'RocketLaunch',
  summary: 'What this is, what you need, and who sees your name.',
  sections: [
    {
      /* RootPage.jsx (/join): "Enter the 4-digit code"; PlayerPage join form
         "No account, nothing to install." */
      id: 'what-you-need',
      title: 'What you need',
      icon: 'DeviceMobile',
      blocks: [
        {
          t: 'features',
          items: [
            { icon: 'DeviceMobile', title: 'Any device', text: 'Phone, tablet or laptop. Whatever is in your hand.' },
            { icon: 'LinkSimple', title: 'A link or a code', text: 'Scan the QR code on the room’s screen, or type the four digits under it.' },
            { icon: 'UserCircle', title: 'No account', text: 'Players never sign in. Only hosts and admins do.' },
            { icon: 'Broadcast', title: 'A network', text: 'Anything that loads a web page will do.' },
          ],
        },
        {
          t: 'p',
          text: 'You do not install anything and you do not register. Scan the code, type a name, and you are in. How: Joining a session.',
        },
      ],
    },
    {
      /*
        PlayerPage's look-up cues: "This page is only ever your half", "this
        page will not repeat them". Phases from config/gameTypes.js (gameTypes
        block). The screen changes on its own: "This page will change on its
        own — you do not need to refresh it."
      */
      id: 'session-looks-like',
      title: 'What a session looks like',
      icon: 'GameController',
      blocks: [
        {
          t: 'p',
          text: 'The host drives. When they move the room on, your screen changes by itself: you never refresh, and there is no "next" button for you to miss.',
        },
        {
          t: 'steps',
          items: [
            { title: 'You wait in the lobby', text: 'Your phone says "Waiting for the host.", with "You’re in as" your name above it, until the host starts the first round.' },
            { title: 'A question appears', text: 'Write an answer, pick an option, or send some words, depending on the kind of session. How each kind works: Playing.' },
            { title: 'Sometimes the room votes', text: 'Only on Call & Answer: you rank the room\'s answers. See Voting.' },
            { title: 'Results', text: 'Your phone shows your own part: what you sent and what it earned. The room\'s results, and What we heard, are on the room’s screen.' },
          ],
        },
        {
          t: 'p',
          text: 'Your phone is only ever your half. Everything the room shares (the question large, the answers, the results, the discussion) is on the room’s screen, so look up when your phone tells you to.',
        },
        { t: 'gameTypes' },
      ],
    },
    {
      /*
        Join form: "On rounds where the room votes, your name is not shown next
        to your answer until voting closes." Ballot, one line under it since
        5 Nov 2026: "Only names are hidden, from the host too, until voting
        closes." Session setting "Show who wrote each response from the
        start" (SessionSetupPanel) makes displayLabelFor (config/anonymity.js)
        show names. Comments: FeedbackRoundPanel "Your name is shown with this
        comment. Everyone in the session can read it, …"
      */
      id: 'who-sees-your-name',
      title: 'Who sees your name',
      icon: 'EyeSlash',
      blocks: [
        {
          t: 'p',
          text: 'Your name is on the scoreboard, and it is how you get back in if you lose the page.',
        },
        {
          t: 'list',
          items: [
            { title: 'Your answers, while the room votes', text: 'Shown as numbers: Response 1, Response 2. Nobody, the host included, sees who wrote what until voting closes. Then names go up with the results.' },
            { title: 'If the host shows names from the start', text: 'Some hosts turn names on for the whole session. Then answers and ballots on phones carry names from the first moment. The room’s screen still shows no names while the room votes.' },
            { title: 'Your comments', text: 'A comment on a round carries your name. Everyone in the session can read it, and the host may put it on the room’s screen. The box says so before you post.' },
          ],
        },
        {
          t: 'note',
          tone: 'info',
          title: 'Hidden names are not anonymity',
          text: 'Your ballot says it plainly: "Only names are hidden." In a small room people may still recognise how you write.',
        },
      ],
    },
    {
      /*
        PlayerShell's bar: HelpButton with reports={{ context: 'player' }} opens
        a menu (HelpButton.jsx): Read the guides, Report a bug, Request a
        feature, Ask for help. Reports go to admin/create-github-issue
        (IssueReportForm.jsx), not to the session's host. The shell is always
        dark (data-theme="dark"); type is in rem and the viewport allows zoom
        (public/index.html), so the phone's own text size and zoom work.
      */
      id: 'help-on-your-phone',
      title: 'Help on your phone',
      icon: 'Question',
      blocks: [
        {
          t: 'p',
          text: 'The ? at the top of every phone screen opens a short menu.',
        },
        {
          t: 'list',
          items: [
            { title: 'Read the guides', text: 'Opens this help.' },
            { title: 'Report a bug, Request a feature, Ask for help', text: 'Each sends a short note to the people who make Engage. It does not reach your host: for anything about this session, ask the host in the room.' },
          ],
        },
        {
          t: 'p',
          text: 'The page has no text-size or colour setting of its own. Your phone\'s text size and pinch to zoom both work on it.',
        },
      ],
    },
  ],
};

const joining = {
  id: 'player-joining',
  title: 'Joining a session',
  icon: 'UsersThree',
  summary: 'Getting in, private sessions, joining late, getting back in, and what to do when your name is taken.',
  sections: [
    {
      /*
        PlayerPage join form: "Join the session.", Session code ("Read from the
        link you followed. Nothing to type." + "Use a different code" when it
        came in a link), Your name, Join (config/playerWords.js JOIN; the code is the one four-cell widget, components/SessionCodeField.jsx). RootPage (/join): "Enter the
        4-digit code", Join. The code sits under the QR, labelled Session code
        (PresentMoments, the stage lobby).
      */
      id: 'getting-in',
      title: 'Getting in',
      icon: 'MapPin',
      blocks: [
        {
          t: 'steps',
          items: [
            { title: 'Scan the QR code', text: 'It is on the room’s screen. Your camera app offers the link, and the code is filled in for you.' },
            { title: 'Or type the code', text: 'Four digits, under the QR code, labelled Session code. No letters.' },
            { title: 'Type your name', text: 'Whatever the room will recognise you by.' },
            { title: 'Join', text: 'Press **Join**. No password, no email, no account.' },
          ],
        },
        {
          t: 'p',
          text: 'Came in by a link but the code is wrong (yesterday\'s link, a different session)? Tap **Use a different code** under the code and type the right four digits.',
        },
      ],
    },
    {
      /* PlayerPage needsAccessCode: "This session is private.", Access code,
         Join / Back (Back keeps the typed name). session-gate.js:
         "The access code you entered is incorrect. Please try again." */
      id: 'private-session',
      title: 'A private session',
      icon: 'Lock',
      blocks: [
        {
          t: 'p',
          text: 'If your screen says "This session is private.", the host has set an access code. Ask the host, or read it off the room’s screen if they put it up. Type it under Access code and press **Join** again.',
        },
        {
          t: 'p',
          text: 'A wrong code says "The access code you entered is incorrect." **Back** returns to the join form and keeps the name you typed.',
        },
      ],
    },
    {
      /*
        session-gate.js only refuses: missing, not started, wrong access code.
        It never refuses a session in progress or one that has ended (checked
        on dev: a new phone joining ended session 2901 landed on "Thanks for
        playing" with Something to add?). Results with no answer: "You didn't
        send a response this round". Scoring: a late joiner starts at 0.
      */
      id: 'joining-late',
      title: 'Joining after it has started',
      icon: 'Clock',
      blocks: [
        {
          t: 'p',
          text: 'Join whenever you arrive. You land on whatever the room is doing now.',
        },
        {
          t: 'list',
          items: [
            { title: 'A question is open', text: 'Answer it like everyone else.' },
            { title: 'The room is voting', text: 'You can rank the answers, even without one of your own on the ballot.' },
            { title: 'Results are up', text: 'Your phone says you did not send a response this round. Join in from the next one.' },
            { title: 'The session has ended', text: 'You still get in, and land on its closing screen.' },
          ],
        },
        {
          t: 'p',
          text: 'You do not see the rounds you missed, and you start from zero points. Nothing is taken off for arriving late.',
        },
      ],
    },
    {
      /*
        The session knows a player by this browser (components/joinResult.js
        getClientId), not by name alone. Same browser: "Welcome back." with
        "Rejoin as {name}" / "Join as someone else" (PlayerPage rejoinPrompt,
        checked on dev). Another browser: join-game.js answers NAME_TAKEN.
        The lobby's "Lost this page?" line (a disclosure, 5 Nov 2026) opens
        to the same steps and repeats the code.
      */
      id: 'lost-the-page',
      title: 'If you lose the page',
      icon: 'ArrowsClockwise',
      blocks: [
        {
          t: 'p',
          text: 'Reopen the link, or the join screen, on the same phone and the same browser. Your screen says "Welcome back." Tap **Rejoin as** your name, and your answers and points come back with you.',
        },
        {
          t: 'p',
          text: '**Join as someone else** forgets that name on this phone and opens an empty join form.',
        },
        {
          t: 'p',
          text: 'The session knows you by this browser, not by your name alone. On a different phone, or another browser on the same phone, your screen says your name "is already in this session": the next section moves it to you.',
        },
        {
          t: 'p',
          text: 'While you wait for the first round, **Lost this page?** under the session details opens these steps with your session code.',
        },
      ],
    },
    {
      /*
        JoinNameCollision.jsx + hooks/useHandoverFlow.js (experience plan
        §4.4, 1 Nov 2026). Heading "<name> is already in this session.";
        buttons HANDOVER_LABELS: "That's me: use my name on this device",
        "I'm someone else: pick another name", then "Try again" (the ask
        failed), "Ask again" (after 1 minute; after 30 s following Not now),
        "Pick another name". The phone retries the join every few seconds while
        it waits; the ask lapses after 10 minutes (handover.js); a grant is
        good for one move, for 5 minutes (join-game.js handover branch).
      */
      id: 'name-taken',
      title: 'When your name is taken',
      icon: 'Lock',
      blocks: [
        {
          t: 'p',
          text: 'Your screen says your name "is already in this session." Another phone or browser is in under that name. It will not simply let you in as them: that would throw away what the first person has done.',
        },
        {
          t: 'list',
          items: [
            { title: "I'm someone else: pick another name", text: 'You and someone else chose the same name. Add a last initial and carry on.' },
            { title: "That's me: use my name on this device", text: 'The name really is yours: you swapped phones, or your browser lost the page.' },
          ],
        },
        {
          t: 'steps',
          items: [
            "Tap **That's me: use my name on this device**. The screen says when the host has your request; if it did not get through, tap **Try again**.",
            'Wait on this screen. The host sees your request; say something out loud too.',
            'When the host lets you in, this page moves on by itself, with your answers and points. Nothing to tap.',
          ],
        },
        {
          t: 'faq',
          items: [
            { q: 'Nothing has happened for a minute', a: 'Tap **Ask again** to remind the host. After ten minutes the request lapses: "The host hasn\'t answered." Ask again, or pick another name.' },
            { q: '"The host said not now."', a: 'If it really is you, ask them in person; **Ask again** comes back after half a minute. Otherwise tap **Pick another name** and add a last initial.' },
          ],
        },
        {
          t: 'note',
          tone: 'warn',
          title: 'One handover at a time',
          text: 'The host lets a name move for one handover, and the old device stops. Need it again on another device? Ask again. Nobody can quietly walk into somebody else\'s name.',
        },
      ],
    },
    {
      /*
        components/NameMoved.jsx: "<name> is now on another device.", the one
        button NAME_MOVED_LABEL. Reached by the server's nameMoved frame
        (join-game.js), a refused answer or vote (NAME_MOVED: message.js,
        submit-vote.js), or a rejoin refused with nameMoved.
      */
      id: 'name-moved',
      title: 'Your name moved to another device',
      icon: 'DeviceMobile',
      blocks: [
        {
          t: 'p',
          text: 'The host let your name move to another phone or browser, so this one says your name "is now on another device" and stops. Your answers and points went with the name.',
        },
        {
          t: 'p',
          text: 'If that was you, carry on on the other device. If not, tell the host, and tap **Join again with a different name** to keep playing here.',
        },
      ],
    },
    {
      /*
        NAME_UNVERIFIED only: sessions from before identities were stamped
        (JoinNameCollision.jsx header). Buttons "Yes — rejoin as {name}" and
        "No — I'm a different {name}" (the second is written with &apos; in
        JSX, so it is quoted rather than marked).
      */
      id: 'name-unverified',
      title: '"Are you the … already here?"',
      icon: 'UserCircle',
      blocks: [
        {
          t: 'p',
          text: 'Now and then, in an older session, the site cannot tell a returning player from a namesake, so it asks: "Are you the Sam already here?"',
        },
        {
          t: 'list',
          items: [
            { title: 'It was you, on another device', text: 'Tap **Yes — rejoin as** your name. Your answers and points come back.' },
            { title: 'It was not you', text: 'Tap "No — I\'m a different Sam" and pick a name the host can tell apart.' },
          ],
        },
      ],
    },
    {
      /*
        Wording from config/playerWords.js (experience plan 3a/3e): JOIN.wrongCode
        "Nothing is running under {code}. …" on every join screen, since
        joinResult.js no longer shows the server's 404 text; EARLY "Waiting for
        the host." with "Holding your place as {name}", a lobby that retries
        the join every 4 seconds (PlayerPage EARLY_RETRY_MS) until the host
        starts. The gate never refuses an ended session.
      */
      id: 'other-things-join-screen',
      title: 'Other things the join screen might say',
      icon: 'Warning',
      blocks: [
        {
          t: 'faq',
          items: [
            { q: 'Waiting for the host (Holding your place)', a: 'The host has made the session but not started it yet. Nothing to tap: the page holds your code and name and lets you in by itself the moment they start. **Change the code or name** takes you back to the form with both kept.' },
            { q: 'Nothing is running under …', a: 'Check the four digits against the room’s screen: a 0 and an 8 look alike across a room. Every session has its own code, so an old link or an old code will not work.' },
            { q: 'The access code you entered is incorrect', a: 'See A private session, above.' },
            { q: 'The session has already ended', a: 'It still lets you in. You land on its closing screen, where you can comment on its rounds for a while.' },
          ],
        },
        {
          t: 'p',
          text: 'Still stuck, or the page will not load at all? See Troubleshooting › Players cannot get in.',
        },
      ],
    },
  ],
};

const playing = {
  id: 'player-playing',
  title: 'Playing',
  icon: 'Play',
  summary: 'What your phone shows in each kind of session: Call & Answer, Trivia, Poll and Wavelength.',
  sections: [
    {
      /*
        Every round: question, "Your task" (the instruction), the answer form,
        and in the dock at the bottom "Send my answer" (experience plan 3d:
        every next action is in the dock, config/playerWords.js SEND); with the
        keyboard up the background folds (a Call & Answer title stays; a
        passage-length question condenses), "Show the whole question ↓". The
        Call & Answer title is the headline and the brief is body text under
        it, as on the room's screen (owner, 5 Nov 2026). After
        sending: "Locked for this round. If this page reloads, it comes back."
        (PlayerPage ASK receipt), and the dock's button reads "Sent" with a
        check (components/SendButton.jsx, owner 3 Nov 2026; never for an
        answer held offline). A send that fails is a line above the button
        ("That did not send. Try again."), never a pop-up.
      */
      id: 'answering',
      title: 'Answering a round',
      icon: 'ChatCircleText',
      blocks: [
        {
          t: 'steps',
          items: [
            { title: 'Read the question', text: 'It is at the top in large type, with the round number above it. Any background the host added is under it, then Your task says what the host wants.' },
            { title: 'Answer', text: 'The form depends on the kind of session (sections below). While you type, the background folds away to make room and the question stays; **Show the whole question ↓** brings it back.' },
            { title: 'Send', text: 'The button is always in the bar at the bottom of your screen, so you never scroll to find it. Once your answer is in, the button reads **Sent** with a tick, and your screen shows what you sent.' },
          ],
        },
        {
          t: 'note',
          tone: 'tip',
          title: 'Your answer is locked once you send it',
          text: 'Check it before you press. Reloading the page or locking your phone does not lose it: it comes back when the page does.',
        },
        {
          t: 'p',
          text: 'If it did not send, the line above the button says so and you can press it again. Pressed send while offline? Your answer waits on the phone, and you can still change it. See When something goes wrong.',
        },
      ],
    },
    {
      /* PlayerPage ASK (call-and-answer): Your response, character count,
         "The room will see this response and vote on it. Your name is not
         attached to it until voting closes.", Send my answer; receipt "Your
         answer is in." ("Your title is in." for a picture round). Results: "You
         wrote response N", This round / Total / Standing. */
      id: 'call-and-answer',
      title: 'Call & Answer',
      icon: 'ChatCircleText',
      blocks: [
        {
          t: 'p',
          text: 'You get a text box. Write as much or as little as you like: the interesting answers are rarely the shortest. Press **Send my answer**; your screen says "Your answer is in."',
        },
        {
          t: 'p',
          text: 'Some rounds show a picture and ask you for its title. Same box, same button.',
        },
        {
          t: 'p',
          text: 'Then the room votes on the answers (see Voting). At results your phone says which response was yours, for example "You wrote response 3", and shows the points it earned this round, your total and your standing. Who wrote what, and the room\'s top answers, are on the room’s screen.',
        },
      ],
    },
    {
      /* Trivia ASK: options A–F (radiogroup), "X selected. You can change it
         until you send.", Send my answer, then the one receipt "Sent / Your
         answer is in." (config/playerWords.js RECEIPT). RESULTS:
         "Correct." / "Not this time." / "No answer recorded.", rows flagged
         "Your answer" and "Correct". */
      id: 'trivia',
      title: 'Trivia',
      icon: 'Brain',
      blocks: [
        {
          t: 'p',
          text: 'Usually four options, up to six, lettered A to F. Tap one. Until you press **Send my answer** you can tap a different one; after that it is locked.',
        },
        {
          t: 'p',
          text: 'When the round closes, your phone says "Correct." or "Not this time.", shows your answer and the right one, and what you scored. Faster right answers score more (see Scoring). How the whole room answered, and why, is on the room’s screen.',
        },
      ],
    },
    {
      /* Poll ASK: the survey's own input per kind (ChoiceInput, RatingInput,
         YesNoInput, TextInput), Send my answer, "Your answer is in.", look-up
         cue "the result fills in as the room answers, without names". RESULTS:
         "Your answer is counted." with the answer in a card, or "You didn't
         answer this one.". Polls score nobody, so no score shows at the end. */
      id: 'poll',
      title: 'Poll',
      icon: 'ChartBar',
      blocks: [
        {
          t: 'p',
          text: 'One question, answered one of four ways: pick an option, tap a point on a scale (its two ends say what they mean), say yes or no, or write a short answer. Press **Send my answer**.',
        },
        {
          t: 'p',
          text: 'There is no right answer and no score. The room\'s result fills in on the room’s screen as people answer, without names. Your phone shows your own answer.',
        },
      ],
    },
    {
      /* Wavelength ASK: "Aim for ten. A word counts only when everyone says it
         — go for the words the rest of the room will think of too", Word 1–10,
         "n of 10 added. Fewer is fine. Send when you run dry.", "Send my
         words (n/10)", "Your words are in.", "Nothing shows until everyone is
         in." RESULTS: "You sent N." and your words. */
      id: 'wavelength',
      title: 'Wavelength',
      icon: 'Waves',
      blocks: [
        {
          t: 'p',
          text: 'You get a term and ten word boxes. Write the words the term brings to mind. A word counts only when everyone says it, so go for the obvious words the rest of the room will think of too, not the cleverest one.',
        },
        {
          t: 'p',
          text: 'Aim for ten; fewer is fine. Press **Send my words** when you run dry.',
        },
        {
          t: 'p',
          text: 'Nothing shows until everyone is in. Then the words the room shares light up on the room’s screen, and your phone lists the words you sent. Wavelength has no winners: nobody scores.',
        },
      ],
    },
    {
      /*
        Surveys (W5, player-surveys.js) and the Build Room's participant page
        (W7, build-room-participant.js) own the detail. This keeps the one-line
        orientation and the Build Room text Phase 1 wrote, until W7's guide
        replaces it (then this item becomes a pointer).
      */
      id: 'surveys-and-build-rooms',
      title: 'Surveys and Build Rooms',
      icon: 'ClipboardText',
      blocks: [
        {
          t: 'list',
          items: [
            { title: 'Survey', text: 'Several questions you answer at your own pace: see Answering a survey.' },
            { title: 'Build Room', text: 'The room builds an app with the host\'s Claude: suggest ideas, choose between options, rate. Open the demo opens the app itself, on the room\'s Wi-Fi, or from anywhere when the host has opened it to people who are not there. That button is yours alone; if the host removes you, it stops working. History marks what reached Claude, and when the host changed the room\'s words it shows what Claude got and why; your own ideas say yours. It never shows who sent anything.' },
          ],
        },
      ],
    },
    {
      /* A question's "Reveal (shown only after the round)" field (TriviaBuilder,
         the set editor): Workie's read and the room’s screen show it after
         answers are in. */
      id: 'held-back',
      title: 'Some rounds hold something back',
      icon: 'EyeSlash',
      blocks: [
        {
          t: 'p',
          text: 'Some questions deliberately keep a detail back (the real title of the painting, the actual figure, what really happened next) and show it only after everyone has answered.',
        },
        {
          t: 'p',
          text: 'That is not the site being slow. Your answer is worth more when it was not shaped by the thing you were guessing at. The withheld detail goes up on the room’s screen with the results.',
        },
      ],
    },
    {
      /* PlayerPage, experience plan 3a: ONE way to say wait, every type
         (config/playerWords.js WAIT). The heading is always "Waiting for the
         host." and the small line above it says why: lobby "You're in as
         {name}", between rounds "The round is closed" (your total and
         standing only where the format scores), VOTE before the ballot
         "Voting next" with the question; "Loading the session…". */
      id: 'between-rounds',
      title: 'When there is nothing to do',
      icon: 'Pause',
      blocks: [
        {
          t: 'p',
          text: 'Some screens just wait. They all say "Waiting for the host." in the same place, with a small line above saying why. You do not need to refresh any of them: each changes on its own when the host moves on.',
        },
        {
          t: 'list',
          items: [
            { title: '"You’re in as" your name', text: 'The lobby, before the first round. It may show what the session is about, and how to get back in if you lose the page.' },
            { title: '"The round is closed"', text: 'Between rounds. In a scored session your total and standing are shown; the discussion is on the room’s screen, and it is the part the session is for.' },
            { title: '"Voting next"', text: 'Voting has started and your ballot is on its way. The question being voted on is shown so you know what is coming.' },
            { title: '"Loading the session…"', text: 'Your phone is finding out what kind of session this is. It takes a moment.' },
          ],
        },
      ],
    },
  ],
};

const voting = {
  id: 'player-voting',
  title: 'Voting',
  icon: 'Medal',
  summary: 'Ranking the room\'s answers on Call & Answer rounds: the two ballots, your own answer, and reading long answers.',
  sections: [
    {
      /*
        PlayerPage VOTE (5 Nov 2026): the question as one line (the title;
        a passage clamped to two lines), "Show the whole question ↓" for the
        rest, "Rank your top three." (one/two when fewer answers:
        requiredVotes = min(3, answers)), the quick ballot, the link
        "Detailed vote: read each response in full" (back: "Back to the quick
        vote"), the one-line names promise, slot bar, "Pick N more to send" →
        "Send my votes", in the dock (3d). A refused vote is a dock line ("Your votes
        did not send. Try again."); voting closing first says "Voting closed
        before your votes arrived…" on the result. Never a pop-up. Moved here
        from player-playing (HELP_SECTION_MOVES).
      */
      id: 'voting',
      title: 'Ranking the answers',
      icon: 'Medal',
      blocks: [
        {
          t: 'p',
          text: 'On Call & Answer rounds, once the host opens voting your phone shows the question in one line (tap **Show the whole question** for the rest), then asks you to rank your top three. Every answer is numbered: Response 1, Response 2, and so on. The numbers match the room’s screen, so the host can say "look at six" and everyone finds it.',
        },
        { t: 'h', text: 'Two ways to rank' },
        {
          t: 'list',
          items: [
            { title: 'The quick vote', text: 'What your phone opens on. Three dropdowns: 1st, 2nd and 3rd place. Fastest if you already know what you liked.' },
            { title: 'The detailed vote', text: 'Tap **Detailed vote** under the dropdowns. Every answer in full, with 1st, 2nd and 3rd place buttons on each. Better when you want to read them. **Back to the quick vote** returns.' },
          ],
        },
        {
          t: 'p',
          text: 'An answer holds one place at a time: give it another place and it moves there. On the detailed ballot, tap the place it holds to take it off. The bar at the bottom shows your ballot so far; the button says how many more to pick, then becomes **Send my votes**.',
        },
        {
          t: 'p',
          text: 'If your votes did not send, the line above the button says so: press it again. If voting closed first, the result screen says your votes are not in that round.',
        },
        {
          t: 'p',
          text: 'With only one or two answers in the round, you rank one or two.',
        },
      ],
    },
    {
      /* Own row: "(Yours)" in the quick vote's options, "Yours" flag on the detailed
         card (ownAnswerIndex); rankable — no self-vote check in submit-vote.js. */
      id: 'your-own-answer',
      title: 'Your own answer is on the ballot',
      icon: 'UserCircle',
      blocks: [
        {
          t: 'p',
          text: 'It is marked Yours, on your phone only, and you may rank it like any other. Nobody else can see which one is yours until voting closes.',
        },
        {
          t: 'p',
          text: 'Your points come from how the rest of the room ranks it (see Scoring).',
        },
      ],
    },
    {
      /* DetailedVotingMode: tap the text or "Show all ↓" opens AnswerSpotlight
         (Previous/Next, ← →, Esc; tap outside closes). Detailed ballot only. */
      id: 'reading-long-answer',
      title: 'Reading a long answer',
      icon: 'MagnifyingGlass',
      blocks: [
        {
          t: 'p',
          text: 'On the detailed vote (tap **Detailed vote** under the dropdowns), tap an answer\'s text or **Show all ↓** to open it full-screen. Then use Previous and Next to walk through the rest without going back to the list each time.',
        },
        {
          t: 'keys',
          items: [
            { keys: '← →', text: 'Previous and next answer.' },
            { keys: 'Esc', text: 'Close and go back to the list.' },
          ],
        },
        {
          t: 'p',
          text: 'On a phone, tapping outside the answer closes it too.',
        },
      ],
    },
    {
      /* "Sent / Your votes are in.", Your ballot, "Locked for this round."
         Still writing when voting starts: "You were still writing. Send it and
         it is kept with this round, but it is not in the vote." + "Send it
         anyway". */
      id: 'after-you-vote',
      title: 'After you vote',
      icon: 'CheckCircle',
      blocks: [
        {
          t: 'p',
          text: 'Your phone says "Your votes are in." and shows your ballot. It is locked for the round. Who wrote what, and how the room ranked them, goes up on the room’s screen when the host shows results.',
        },
        {
          t: 'note',
          tone: 'info',
          title: 'Still writing when voting started?',
          text: 'Your unsent answer stays on the ballot screen with **Send it anyway**. Send it and it is kept with the round, but it is not in the vote.',
        },
      ],
    },
  ],
};

const feedback = {
  id: 'player-feedback',
  title: 'Comments and quick questions',
  icon: 'ChatCircleText',
  summary: 'Commenting on a round, answering the host\'s question for the room, and adding something after the end.',
  sections: [
    {
      /*
        RESULTS: "Comment on this round" in the dock of every round's results
        (PlayerPage, owner's ruling 26 Sep 2026; phone-comments 3b).
        FeedbackRoundPanel + RoundReportSections: "Comment on round N"; three
        sections, Workie's read ("Comment on Workie's read"), The responses
        ("Reply to this response" on each card, "Response 2 · 6 votes, the
        most"), "Anything else about this round?" ("Comment on the whole
        round"); the docked sheet's heading and quote, the name rule, Cancel /
        Post reply; "Move your reply to …? Your words come with it." Move it /
        Keep it here; "Discard your reply?" Keep writing / Discard; "Reply
        posted under …'s response (response N)." Exits Close / "Go to the
        question".
      */
      id: 'results-feedback',
      title: 'Commenting on a round',
      icon: 'ChatCircleText',
      blocks: [
        {
          t: 'p',
          text: 'Every round\'s results screen has **Comment on this round** at the bottom. It opens the round on your phone in three parts: Workie\'s read, the responses one card each with their authors, and **Anything else about this round?** Every comment is attached to one thing.',
        },
        {
          t: 'steps',
          items: [
            'Pick what you are talking about: **Comment on Workie’s read** inside Workie\'s read, **Reply to this response** on a response\'s card, or **Comment on the whole round** for anything else.',
            'A box opens at the bottom. Its heading names what you are replying to, it quotes it, and the card behind is outlined. It also says your name is shown with your comment.',
            'Press **Post reply** (or **Post comment**), or **Cancel**. It says **Reply posted** under that response, and your reply appears in the card.',
          ],
        },
        {
          t: 'p',
          text: 'Responses are numbered as you voted on them: "Response 2 · 6 votes, the most". Replies stay folded under each card; tap **Show 2 replies**, or **Open all replies**. If you tap another card with words in the box, your phone asks before moving them.',
        },
        {
          t: 'p',
          text: '**Close** takes you back. If the host moves on while you are writing, your text is not lost: post it and it is kept with that round, then tap **Go to the question**.',
        },
        {
          t: 'p',
          text: 'Close a round with a comment still unsent and your phone keeps it with that round, never another. It is back in the box when you open that round again, for example from the end screen.',
        },
      ],
    },
    {
      /* Host-opened feedback round: the same panel for everyone, with
         "The host is preparing this round for feedback." while it loads. */
      id: 'host-feedback-round',
      title: 'When the host asks everyone for comments',
      icon: 'UsersThree',
      blocks: [
        {
          t: 'p',
          text: 'Sometimes the host opens comments for the whole room. Every phone switches to the same panel by itself. For a moment it may say "The host is preparing this round for feedback."; it changes on its own.',
        },
        {
          t: 'p',
          text: 'Then it works exactly like Commenting on a round, above. The host chooses which comments go up on the room’s screen.',
        },
      ],
    },
    {
      /*
        FollowUpCard + config/followUpWords.js: "Question for the room · Ideas /
        Choose / Rate", Send, which reads "Sent" with a check once the answer
        is in and turns back to Send on any change (owner, 3 Nov 2026), "Sent.
        You can change it until the results are shown.", "The results are already up. Your answer is kept, but not in
        the count.", Rate ends (e.g. 1 Disagree to 5 Agree). HeldFollowUp: "The
        room has moved on. Your answer is still here, and you can still send
        it.", Leave it / Done. Anonymous (KIND_LINES).
      */
      id: 'question-for-the-room',
      title: 'A question for the room',
      icon: 'Question',
      blocks: [
        {
          t: 'p',
          text: 'After a round the host may send a quick question to every phone, headed Question for the room. It is anonymous.',
        },
        {
          t: 'list',
          items: [
            { title: 'Ideas', text: 'Write a short answer.' },
            { title: 'Choose', text: 'Pick one of two to four options.' },
            { title: 'Rate', text: 'Rate a statement from 1 to 5. The two ends say what they mean, for example 1 Disagree to 5 Agree.' },
          ],
        },
        {
          t: 'p',
          text: 'Press **Send**. The button then reads **Sent** with a tick. Change your answer and it turns back to **Send**, so you can send again until the host shows the room\'s answer.',
        },
        {
          t: 'p',
          text: 'If the room moves on first, your unsent answer stays at the top of the next screen: send it, or tap **Leave it**. Sent after the results are up, it is kept but not counted, and **Done** clears it away.',
        },
      ],
    },
    {
      /*
        ENDED (components/PlayerEnded.jsx, experience plan 3a): "Thanks for
        playing" with Final score and Final standing where the format scores
        (Trivia, Call & Answer); "Thanks for taking part" and no score for a
        poll, Wavelength, a survey or a Build Room; "Something to
        add?" with a button per round, in the dock at the bottom (3d), while comments are open (24 hours after
        the end, or until the host closes them); the panel says "Comments stay
        open for 24 hours, or until your host closes them. Yours is marked as
        added later." Checked on dev (session 2901). Issue #47: each button is
        "<noun> N · <title>" (config/pastRounds.js pastRoundLabel), an opened
        round shows the lesson and "Your turn" (get-results' `question`), and
        an unsent comment is kept per round ("Unsent comment" on its button).
      */
      id: 'after-the-end',
      title: 'After the session ends',
      icon: 'FlagCheckered',
      blocks: [
        {
          t: 'p',
          text: 'Your phone says "Thanks for playing", with your final score and standing, after a scored session (Trivia, Call & Answer). They stay there if you reload or rejoin. A poll or Wavelength scores nobody, so it ends with "Thanks for taking part" and no score.',
        },
        {
          t: 'p',
          text: 'At the bottom of the screen, under **Something to add?**, there is a button for each round, with its number and title, for example "Lesson 2 · Form Follows Function". A long title is shortened; a round with no title shows its number alone.',
        },
        {
          t: 'p',
          text: 'Going back to a round shows its lesson again: the title, the lesson text and what you were asked to do, then its responses and Workie\'s read. Comment on any of it. Your comment is marked as added later.',
        },
        {
          t: 'p',
          text: 'You can move between rounds. A comment you started and did not post stays with its own round, and that round\'s button says **Unsent comment**.',
        },
        {
          t: 'p',
          text: 'Comments stay open for 24 hours after the end, or until the host closes them. After that you can close the page; if the host saves a report for you, they share the link themselves.',
        },
      ],
    },
  ],
};

const scoring = {
  id: 'player-scoring',
  title: 'Scoring',
  icon: 'Trophy',
  summary: 'Where points come from, and why the scoreboard moved.',
  sections: [
    {
      id: 'points-earned',
      title: 'How points are earned',
      icon: 'Medal',
      blocks: [
        {
          t: 'p',
          text: 'Only Trivia and Call & Answer score.',
        },
        {
          t: 'table',
          head: ['Round', 'Where points come from'],
          rows: [
            ['Call & Answer', 'Votes from the room: 3 points for each first-place vote, 2 for second, 1 for third.'],
            ['Trivia', 'Getting it right, plus a speed bonus of up to 5 points: the faster a right answer, the bigger it is.'],
            ['Poll', 'None. A poll counts opinions; nobody scores.'],
            ['Wavelength', 'None. The result shows which words the room landed on together.'],
            ['Survey', 'None.'],
          ],
        },
        {
          t: 'p',
          text: 'On a voted round your answer is on the ballot too, and points come from how the room ranks it. That is why names stay hidden while the vote is open (Voting › Your own answer is on the ballot).',
        },
      ],
    },
    {
      /* The phone shows This round / Total / Standing at results, and Final
         score / Final standing at the end; never the whole board. Only for
         the types that score (config/scoreboard.js hasScoreboard: Trivia and
         Call & Answer); a Poll, Survey or Wavelength shows no score lines. */
      id: 'scoreboard',
      title: 'The scoreboard',
      icon: 'ChartLineUp',
      blocks: [
        {
          t: 'p',
          text: 'Scores add up across the whole session and update at the end of each round, so a round in progress does not tip off the room about who is winning it. Your phone shows your own total and standing; the full board, when the host shows it, is on the room’s screen. Only Trivia and Call & Answer are scored: in a Poll or Wavelength your phone shows no points.',
        },
        {
          t: 'faq',
          items: [
            {
              q: 'I joined late. Am I out of it?',
              a: 'You start from zero on the round you joined. You cannot pick up points for rounds before you arrived, but nothing is deducted either.',
            },
            {
              q: 'I dropped out and came back. Did I lose my points?',
              a: 'No. Rejoin from the same phone and browser and your score comes back with you. On another device, ask the host to let your name move to it.',
            },
            {
              q: 'The host removed me from the list. Did that wipe my score?',
              a: 'No. Removing someone takes them out of the live count so the room is not waiting on a person who has left. Everything they answered and every point they scored stays in the results and in the report.',
            },
            {
              q: 'Why did my answer get no points?',
              a: 'On a voted round, points come from other people ranking you in their top three. A good answer that nobody put in their top three scores nothing: it is a ranking, not a rating.',
            },
          ],
        },
      ],
    },
  ],
};

const trouble = {
  id: 'player-trouble',
  title: 'When something goes wrong',
  icon: 'Lifebuoy',
  summary: 'Offline, late, a missed round, a name you cannot get back, and where to look for device problems.',
  sections: [
    {
      /*
        PlayerPage offlineBanner: "Offline. Reconnecting. This page catches up
        on its own…". Held answer: "Not sent yet", "Waiting for the
        connection.", "What you will send", and in the dock "Not sent yet. It
        will send when you’re back online. It is kept on this phone, so a reload
        does not lose it." (playerWords HELD.line) with Change my answer. A
        ballot is held the same way since 3d (utils/pendingVote.js): "Your
        ballot", the same line, Change my votes; it is dropped, never resent,
        if voting closed meanwhile ("Your votes did not reach the room. Voting
        closed while this phone was offline.").
      */
      id: 'offline',
      title: 'Your phone went offline',
      icon: 'WifiSlash',
      blocks: [
        {
          t: 'p',
          text: 'A bar at the top says "Offline. Reconnecting." The page catches up on its own when the connection comes back. Do not refresh: refreshing loses anything you have typed but not sent.',
        },
        {
          t: 'p',
          text: 'Pressed send while offline? Your screen says "Not sent yet" and "Waiting for the connection." and shows what you will send; the button only says **Sent** once the answer has really gone. The answer is kept on this phone, so a reload does not lose it, and it sends when you are back. Until then **Change my answer** lets you edit it.',
        },
        {
          t: 'p',
          text: 'Votes work the same way. Your ballot waits on the phone and sends when you are back; until then **Change my votes** puts it back on the ballot. If voting closes before you are back online, the result screen says your votes did not reach the room.',
        },
      ],
    },
    {
      /* lateBanner "Kept, but late." with the answerReceived texts; missedBanner
         "Your last answer did not reach the room. The round closed while this
         phone was offline, so it was not sent." Both dismissed with OK. */
      id: 'late-or-missed',
      title: 'Your answer was late, or did not arrive',
      icon: 'Clock',
      blocks: [
        {
          t: 'faq',
          items: [
            { q: 'Kept, but late.', a: 'Your answer reached the session after the round moved on. It is kept with that round for the record, but it is not counted, and if voting had started it is not in the vote. Tap **OK** to clear the bar.' },
            { q: 'Your last answer did not reach the room.', a: 'The round closed while your phone was offline, so the answer was never sent. Nothing more to do: answer the next round as normal.' },
          ],
        },
        {
          t: 'p',
          text: 'Missed a round completely? You score nothing for it and lose nothing either. Its results are on the room’s screen, and after the session you can still read it and comment (Comments and quick questions › After the session ends).',
        },
      ],
    },
    {
      id: 'cannot-get-back-in',
      title: 'You cannot get back in under your name',
      icon: 'Lock',
      blocks: [
        {
          t: 'p',
          text: 'Use the same phone and browser you joined with, and tap **Rejoin as** your name. On any other device the name is locked to keep it safe: the host has to let it move, and if they say "The host said not now." pick a different name. All of it: Joining a session › When your name is taken.',
        },
      ],
    },
    {
      /* Technical owns troubleshooting by symptom and requirements
         (technical.js: players-cannot-get-in, screens-not-keeping-up,
         technical-requirements#players). */
      id: 'device-problems',
      title: 'The page will not load or keeps freezing',
      icon: 'Wrench',
      blocks: [
        {
          t: 'p',
          text: 'Problems with the phone, the browser or the network are in the Technical guides: Troubleshooting › Players cannot get in, Troubleshooting › Screens are not keeping up, and What you need to run it › Players.',
        },
        {
          t: 'p',
          text: 'Still stuck? Tell the host in the room, or use **Ask for help** under the ? at the top of your screen.',
        },
      ],
    },
  ],
};

/**
 * The player area. Assembled into roles by ./index.js (ROLE_AREAS); see
 * docs/help-refresh/STRUCTURE.md for the map and the conventions.
 */
export const AREA = {
  id: 'player',
  guides: { player: [gettingStarted, joining, playing, voting, feedback, scoring, trouble] },
};
