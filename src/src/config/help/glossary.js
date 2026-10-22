/*
  WORDS WE USE (help refresh Phase 0, owner's decisions 1-3, 22 Oct 2026).

  One short entry per word, each saying where you see it. Every term was
  checked against what the UI renders; the citations live here, never in the
  text people read:
    session / Create engagement  components/WelcomeScreen.jsx:207 ("Create engagement"),
                                 components/GameSetupDialog.jsx:798
    question set                 config/consoleSections.js:124 ("Question sets")
    owner tags                   utils/setOwnerTag.js:39-44 (Yours, Team, Engage, Public, and their titles)
    Your space                   config/consoleSections.js:433, components/DestinationField.jsx:64;
                                 the switcher says "Personal" (components/OrgSwitcher.jsx:62)
    team                         components/OrgSwitcher.jsx, components/DestinationField.jsx:64 ("(team)")
    the stage                    config/roomScreen.js:18,107 ("One screen"); the Build Room's own
                                 Stage screen is buildroom/buildScreens.js:19
    the room's window            config/consoleWords.js:20 ("Room's window"), components/stage/RoomWindowStatus.jsx
    room screen size             config/roomScreen.js:111 ("Room screen size")
    Session panel / the dock     components/stage/Dock.jsx:233 (aria-label "Session panel"), :239 (SESSION)
    Workie                       config/consoleSections.js:167 ("what Workie says afterwards")
    What we heard                components/stage/Rail.jsx:37, components/GameReport.jsx:698
    Ask the room                 config/followUpWords.js:95
                                 (only where template FollowUpAsks is on: dev and test
                                 buildspecs; prod takes the 'off' default and shows
                                 Request feedback, GameHostPage.jsx asksEnabled)
    draft (AI draft)             components/QuestionSetsPanel.jsx:647, components/DraftReview.jsx:249
    the bell                     components/NotificationsBell.jsx:124 ("Notifications")
    Build Room                   components/WelcomeScreen.jsx:223
    Claude Code plugin           buildroom/BuildRoomPage.jsx:141 ("Connect Claude Code: install the plugin…")
    event                        components/WelcomeEvents.jsx:88 ("Run an event"), config/consoleSections.js:148,
                                 components/EventBuilder.jsx:466 ("Agenda")

  Added in Phase 2 (W11, 22 Oct 2026), for words wave 1's guides use across
  several guides:
    the console                  components/WelcomeScreen.jsx:143 ("Question sets & team" / "Admin console")
    your laptop console          components/console/HostConsole.jsx (two screens; host-two-screens#laptop-console)
    Your part now                config/roundWords.js:154 (yourPartLabel)
    session code                 components/stage/PresentMoments.jsx lobby, RootPage.jsx ("Session code");
                                 the panel mid-session: host-two-screens#join-code
    the main screen              PlayerPage.jsx:3146 ("Type the four digits on the main screen.")
    phone remote                 SessionSetupPanel "Your phone as a remote"; HostRemote.jsx
    direction                    buildroom/words.js:49 ("Send to Claude"), :281 ("your last direction")
    crew                         buildroom/BuildSessionPanel.jsx:574 ("Open to a crew")
  Added in Phase 4 (22 Oct 2026):
    Workie's read                config/consoleWords.js:45 (readTitle), present/PresentMoments.jsx:499
    Topic / Shelf                components/SetTopicField.jsx ("Topic *"), DraftReview.jsx:517 and
                                 HostQuestionSetsDialog.jsx:545 ("Shelf"); a live set needs one
                                 (toggle-question-set.js)
  Checked in W11: draft now says what the list really shows (DraftsStrip.jsx
  "An AI draft is waiting for your review."; the "AI draft" chip on a set row
  is a generated set not yet reviewed, QuestionSetsPanel.jsx:647).

  Writers: a term is defined HERE, once. Elsewhere, use it; do not re-define it.
*/
const glossary = {
  id: 'glossary',
  title: 'Words we use',
  icon: 'Books',
  summary: 'The words the help and the screens use, each in a sentence or two, with where you see it.',
  sections: [
    {
      id: 'session',
      title: 'Session (and "Create engagement")',
      icon: 'GameController',
      blocks: [
        { t: 'p', text: 'A session is one run with a room: you start it, people join with its code, and it ends. The button that makes one on your start screen says Create engagement; everywhere else, including this help, it is a session.' },
      ],
    },
    {
      id: 'question-set',
      title: 'Question set',
      icon: 'Books',
      blocks: [
        { t: 'p', text: 'A named list of questions of one kind (trivia, poll, and so on), tagged by category. A session plays one set. You find them under Question sets in the console and when you create a session.' },
      ],
    },
    {
      id: 'owner-tags',
      title: 'Yours, Team, Engage, Public',
      icon: 'ListBullets',
      blocks: [
        { t: 'p', text: 'The tag beside a set in the Question sets list says whose it is. Yours: you made it and can edit it. Team: someone else in your team made it. Engage: shared by Engage with everyone. Public: published by another organisation. To change an Engage or Public set, copy it first.' },
      ],
    },
    {
      id: 'your-space',
      title: 'Your space',
      icon: 'UserCircle',
      blocks: [
        { t: 'p', text: 'Your own place in Engage, for the sets and sessions that belong to you and no team. The switcher at the top of the console calls it Personal.' },
      ],
    },
    {
      id: 'team',
      title: 'Team',
      icon: 'UsersThree',
      blocks: [
        { t: 'p', text: 'An organisation you belong to, with its own sets, sessions and members. Switch between your teams and Your space at the top of the console.' },
      ],
    },
    {
      id: 'the-stage',
      title: 'The stage',
      icon: 'Monitor',
      blocks: [
        { t: 'p', text: 'What your laptop shows the room when you run on one screen: the question, the answers and the results, large. You drive it from the dock along its bottom. (A Build Room also has a screen called Stage, one of the three the room can watch.)' },
      ],
    },
    {
      id: 'rooms-window',
      title: 'The room\'s window',
      icon: 'ArrowSquareOut',
      blocks: [
        { t: 'p', text: 'When you run on two screens, the room watches a second window and your laptop keeps your own controls. Open it with Room\'s window ↗ on your laptop\'s top line, drag it onto the display the room can see, and click it once to fill the screen.' },
      ],
    },
    {
      id: 'laptop-console',
      title: 'Your laptop console',
      icon: 'Monitor',
      blocks: [
        { t: 'p', text: 'What your laptop shows on two screens, instead of the stage: the next step, the responses and Workie\'s read, none of which the room sees.' },
      ],
    },
    {
      id: 'your-part-now',
      title: 'Your part now',
      icon: 'Play',
      blocks: [
        { t: 'p', text: 'The box on your laptop console that says what to do next, in one sentence, with the main button. Space presses it.' },
      ],
    },
    {
      id: 'room-screen-size',
      title: 'Room screen size',
      icon: 'CornersOut',
      blocks: [
        { t: 'p', text: 'How large everything is drawn for the room: Room, TV, Call or Table. Set it in Settings, under Screens, before people arrive.' },
      ],
    },
    {
      id: 'session-panel',
      title: 'Session panel',
      icon: 'SlidersHorizontal',
      blocks: [
        { t: 'p', text: 'Your panel during a session, with the Players, Questions, Rounds and Settings tabs. Open it with SESSION on the dock, or press \\.' },
      ],
    },
    {
      id: 'the-dock',
      title: 'The dock',
      icon: 'DotsSixVertical',
      blocks: [
        { t: 'p', text: 'The row of buttons along the bottom of the stage: the main button that moves the room on, and SESSION for the Session panel.' },
      ],
    },
    {
      id: 'session-code',
      title: 'Session code (the join code)',
      icon: 'LinkSimple',
      blocks: [
        { t: 'p', text: 'The four digits people join with, under the QR code. Every session has its own. During a session the join code panel puts it back up for latecomers.' },
      ],
    },
    {
      id: 'main-screen',
      title: 'The main screen',
      icon: 'Monitor',
      blocks: [
        { t: 'p', text: 'What players\' phones call whatever the room is watching, whether that is the stage or the room\'s window.' },
      ],
    },
    {
      id: 'phone-remote',
      title: 'Phone remote',
      icon: 'DeviceMobile',
      blocks: [
        { t: 'p', text: 'Your own phone, signed in, running the session while you walk the room. Scan the QR under Your phone as a remote in the Session panel\'s Settings tab.' },
      ],
    },
    {
      id: 'the-console',
      title: 'The console',
      icon: 'Gear',
      blocks: [
        { t: 'p', text: 'Where your question sets, sessions, reports and team live. Open it from your start screen with Question sets & team (Admin console for Engage admins).' },
      ],
    },
    {
      id: 'workie',
      title: 'Workie',
      icon: 'Sparkle',
      blocks: [
        { t: 'p', text: 'Workie is Engage\'s AI. After a round it reads what the room said and writes What we heard. It also helps write question sets when you ask it to.' },
      ],
    },
    {
      id: 'what-we-heard',
      title: 'What we heard',
      icon: 'Ear',
      blocks: [
        { t: 'p', text: 'Workie\'s read of a round: what the room said, questions worth asking next, and next steps. You see it at results, in the Rounds tab and in the session report.' },
      ],
    },
    {
      id: 'workies-read',
      title: 'Workie\'s read',
      icon: 'Sparkle',
      blocks: [
        { t: 'p', text: 'Another name for What we heard. Your laptop console and the room\'s window label it Workie\'s read.' },
      ],
    },
    {
      id: 'ask-the-room',
      title: 'Ask the room',
      icon: 'Question',
      blocks: [
        { t: 'p', text: 'Turns one of Workie\'s questions, or your own, into a quick question for the room: Ideas, Choose or Rate. You find it beside What we heard in Call & Answer. Some sites do not offer it; there you get Request feedback, a round of comments, instead.' },
      ],
    },
    {
      id: 'topic',
      title: 'Topic (Shelf)',
      icon: 'Books',
      blocks: [
        { t: 'p', text: 'The broad subject a question set is filed under, picked from a fixed list. People browse and filter sets by it, and a set needs one to be switched on. Some screens, such as Your question sets and the review of an AI draft, call it Shelf; it is the same field. Tags are your own extra words beside it.' },
      ],
    },
    {
      id: 'draft',
      title: 'Draft (AI draft)',
      icon: 'NotePencil',
      blocks: [
        { t: 'p', text: 'What Workie writes when you ask it for a set or for more questions. It waits, seen only by you, until you review it and accept it; nothing is saved before that. A line at the top of Question sets says when an AI draft is waiting, and the bell tells you. (A set row tagged AI draft is a set Workie wrote that nobody has reviewed yet.)' },
      ],
    },
    {
      id: 'the-bell',
      title: 'The bell',
      icon: 'Bell',
      blocks: [
        { t: 'p', text: 'Your notifications: a draft that is ready, an invitation, someone waiting for approval. It is on your start screen, the console\'s top line, the two-screen console and your phone remote, never on a screen the room sees.' },
      ],
    },
    {
      id: 'build-room',
      title: 'Build Room',
      icon: 'Wrench',
      blocks: [
        { t: 'p', text: 'A kind of session where the room and your own Claude Code build something together: Claude asks, the room answers, and you decide what Claude builds next. Start one with Build Room on your start screen.' },
      ],
    },
    {
      id: 'claude-code-plugin',
      title: 'Claude Code plugin',
      icon: 'Terminal',
      blocks: [
        { t: 'p', text: 'The small add-on for Claude Code that connects it to a Build Room. Install it once per laptop from the Connect Claude Code window.' },
      ],
    },
    {
      id: 'direction',
      title: 'Direction (Build Room)',
      icon: 'PaperPlaneTilt',
      blocks: [
        { t: 'p', text: 'What you send Claude to build next, shaped from what the room said, with Send to Claude. Claude picks it up on its next turn.' },
      ],
    },
    {
      id: 'crew',
      title: 'Crew (Build Room)',
      icon: 'UsersThree',
      blocks: [
        { t: 'p', text: 'People in a Build Room who build parts with their own Claude Code alongside yours, once you choose Open to a crew. Everyone else follows on their phone.' },
      ],
    },
    {
      id: 'event',
      title: 'Event',
      icon: 'CalendarBlank',
      blocks: [
        { t: 'p', text: 'A day or a meeting made of several items in order, such as talks, breaks and sessions, run from one agenda. Start one under Run an event on your start screen; people follow the agenda on their phones.' },
      ],
    },
  ],
};

/**
 * The glossary area. Assembled into roles by ./index.js (ROLE_AREAS); see
 * docs/help-refresh/STRUCTURE.md for the map and the conventions.
 */
export const AREA = {
  id: 'glossary',
  guides: { technical: [glossary] },
};
