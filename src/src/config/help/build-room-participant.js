/*
  BUILD ROOM FOR THE PEOPLE IN THE ROOM (help refresh Phase 2, W7, 22 Oct 2026).

  Sources: buildroom/BuildPlayer.jsx (tabs Now / Ideas / History; SuggestAsk
  up to three; ChoiceAsk and RatingAsk with an optional why, changeable until
  voting closes; VoteAsk "pick up to N", own ideas marked yours, Take back my
  votes; PhoneWheel "Your turn"; PreviewFeedback Looks good / Needs a change;
  the demo's Open the demo, Didn't open?, Try again; idea statuses
  IDEA_STATUS/ideaStatusText; the removed and moved screens; the ended screen),
  BuildPlayerPoints.jsx (Talk it over, the run list), BuildPlayerCrew.jsx
  (I have Claude Code, the builder key shown once, Your lane), words.js.
  Checked on dev 22 Oct on a phone viewport: join, send an idea, suggest two
  ideas, vote, results, decided, the end.
  "On the wall" and "the big screen" appear on some phone screens; they are
  retired words in help, so this guide says "the room's screen".
*/

const playerBuildRoom = {
  id: 'player-build-room',
  title: 'In a Build Room',
  icon: 'Wrench',
  summary: 'The host and their Claude Code are building something, and you help decide what. Suggest, vote, and watch it come together.',
  sections: [
    {
      id: 'joining',
      title: 'Joining and finding your way',
      icon: 'DeviceMobile',
      blocks: [
        {
          t: 'p',
          text: 'Join as for any session: the four-digit code and your name, then **Join Game**. A Build Room works on a phone, a tablet or a laptop. Your screen has three tabs:',
        },
        {
          t: 'list',
          items: [
            { title: 'Now', text: 'What the room is doing: a question to answer, a vote, the results, or, between questions, the latest decision and what Claude has been doing.' },
            { title: 'Ideas', text: 'Your own ideas and what happened to each.' },
            { title: 'History', text: 'What the room decided and what reached Claude. Your own ideas are marked as yours; no one else\'s name is shown.' },
          ],
        },
        { t: 'p', text: 'Before the host\'s Claude Code connects, Now says Waiting for Claude Code. You can still send ideas.' },
      ],
    },
    {
      id: 'answering',
      title: 'Answering a question',
      icon: 'ChatCircleText',
      blocks: [
        {
          t: 'list',
          items: [
            { title: 'Ideas', text: 'Type a suggestion and press **Suggest**. You can send up to three. Voting on them opens soon after.' },
            { title: 'Choose', text: 'Pick one lettered option, or as many as the question allows. An option may have a picture or an Open preview link.' },
            { title: 'Rate', text: 'Pick a number: 1 needs work, 5 great.' },
          ],
        },
        {
          t: 'p',
          text: 'With Choose and Rate you can add why (optional): Claude reads the reasons. You can change your answer until voting closes; the button then says Change to.',
        },
      ],
    },
    {
      id: 'voting',
      title: 'Voting on ideas',
      icon: 'ListChecks',
      blocks: [
        {
          t: 'p',
          text: 'When the host opens voting, the room\'s ideas become a ballot. Pick up to the number shown (usually three), then press Submit. Your own ideas are marked yours, and you may vote for them. Change your picks, or take your votes back, until the host shows the results.',
        },
        {
          t: 'p',
          text: 'Sometimes the wheel picks instead. If the wheel chooses you, your phone says Your turn: press **Spin the wheel** for the room. Everyone sees it land on the same answer.',
        },
      ],
    },
    {
      id: 'sending-ideas',
      title: 'Sending the host an idea',
      icon: 'Lightbulb',
      blocks: [
        {
          t: 'p',
          text: '**Send an idea to the host** is there on every screen. Type it and press **Send idea**. The host sees your name with it; the room\'s screen does not.',
        },
        {
          t: 'p',
          text: 'The Ideas tab says what happened to each: With the host, Seen by the host, Sent to Claude, Put to a vote, Saved for later, Not used this time, and so on. The host decides; not every idea is used.',
        },
        {
          t: 'p',
          text: 'When the host puts a talking point up for the room, Now shows **Talk it over** with a box for your idea about it.',
        },
      ],
    },
    {
      id: 'watching',
      title: 'Watching the build',
      icon: 'Eye',
      blocks: [
        {
          t: 'list',
          items: [
            { title: 'Results and decisions', text: 'After a question you see what the room chose, then what the host sent to Claude.' },
            { title: 'What Claude is doing', text: 'Between questions, Now shows Claude\'s updates and screenshots as the host shares them.' },
            { title: 'A list', text: 'When Claude works through a list, Now shows which item it is on.' },
            { title: 'A preview', text: 'When Claude shows the work, you can answer **Looks good** or **Needs a change** (and say what).' },
            { title: 'Trying the demo', text: 'If the host shares it, **Open the demo** opens what Claude built on your own device. If it does not open, **Didn\'t open?** says what to try: you may be on mobile data, another Wi-Fi or a VPN. The screenshots are always there.' },
          ],
        },
      ],
    },
    {
      id: 'names',
      title: 'Who sees your name',
      icon: 'UserCircle',
      blocks: [
        {
          t: 'p',
          text: 'The host sees your name beside your ideas and answers, and who has answered or voted. The room\'s screen shows ideas and votes without names, unless the host chooses to list names in the room count. History on every screen leaves out who sent an idea.',
        },
      ],
    },
    {
      id: 'building-too',
      title: 'Building with your own Claude Code',
      icon: 'TerminalWindow',
      blocks: [
        {
          t: 'p',
          text: 'If the host opens the room to a crew and you brought a laptop with Claude Code, you can build a part yourself. Tap **I have Claude Code**: your phone shows a key, once, to type into Claude Code on your laptop. Your Claude can push your own branch and share early looks, but not merge; the host decides what the room sees. Everyone else just follows along on their phone.',
        },
      ],
    },
    {
      id: 'the-end',
      title: 'When it ends, or you are taken out',
      icon: 'FlagCheckered',
      blocks: [
        {
          t: 'list',
          items: [
            'When the host ends the session, your screen shows what was built, the latest decision and the build so far.',
            'If the host takes you out of the session, your screen says so. Your ideas and votes stay in the report.',
            'If the host let another device take your name, this one says the name is on another device now. Join again with another name if you need to.',
          ],
        },
      ],
    },
  ],
};

/**
 * The build-room-participant area. Assembled into roles by ./index.js (ROLE_AREAS); see
 * docs/help-refresh/STRUCTURE.md for the map and the conventions.
 */
export const AREA = {
  id: 'build-room-participant',
  guides: { player: [playerBuildRoom] },
};
