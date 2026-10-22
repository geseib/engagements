/*
  EVENTS FOR ATTENDEES (help refresh Phase 2, W6, 22 Oct 2026).

  One guide, player-events. Checked against the code and on dev on 22 Oct 2026
  (event 4698: two phones, one joining during a talk; a talk, a trivia item
  paused and resumed, a break, the end). Sources:

    joining-an-event    hooks/useJoinCode.js (an event's code typed on /join
                        goes to /play?event=), PlayerPage.jsx (an event code
                        on the session form goes there too);
                        EventAttendeePage.jsx name step ("Your name", "Join the
                        event", "Once, for the whole day…", the name's help
                        line), first sight lands a late arrival in the live item;
                        "Nothing is running with {code}." for an unknown code.
    the-agenda          EventAttendeePage.jsx agenda (state words from
                        eventDisplay.stateWord: Not started, Next, Now, Paused,
                        Done), "Nothing to do here.", "Back to live · …",
                        the bar's "Agenda" (components/PlayerShell.jsx, eventBar.js).
    when-an-item-starts EventAttendeePage switch beat ("You're in as … No code
                        needed."), PlayerPage `event` ("Getting you in…", "Not
                        in yet." + Try again), end screen ("Keep this page
                        open: the next item starts here by itself.", "Back to
                        the agenda").
    talks-breaks-pauses EventAttendeePage talk ("Look up", "Show the slides
                        here", "Hide the slides"), break ("Back at …"), paused
                        ("The host will be back.", "Open the agenda").
    coming-back         PlayerPage lobby card in an event ("Open the join screen
                        and enter {code} again. This phone is remembered…"),
                        attendeeApi token per event, "Not you?".
    end-of-day          "That's the day." / "Thanks for taking part."
*/

const playerEvents = {
  id: 'player-events',
  title: 'Events: one code for the day',
  icon: 'CalendarBlank',
  summary: 'Joining an event once, following its agenda on your phone, what happens as each item starts, breaks, and getting back in.',
  sections: [
    {
      id: 'joining-an-event',
      title: 'Joining an event',
      icon: 'DeviceMobile',
      blocks: [
        {
          t: 'steps',
          items: [
            { title: 'Scan or type the code', text: 'Scan the QR code on the main screen, or type its four-digit code on the join screen. An event\'s code takes you to the event; there is nothing else to choose.' },
            { title: 'Type your name, once', text: 'Under **Your name**, then press **Join the event**. No account and nothing to install. Your name is used for the scoreboard in scored items.' },
          ],
        },
        {
          t: 'p',
          text: 'That is the only time you type anything to get in. From then on your phone follows the agenda and takes you into each item as the host starts it.',
        },
        {
          t: 'p',
          text: 'Arriving late is fine: join the same way, and if something is live you land straight in it.',
        },
        {
          t: 'note',
          tone: 'info',
          title: '"Nothing is running with" the code',
          text: 'Check the code on the main screen, or ask the host for the link. **Type a different code** takes you back to the join screen.',
        },
      ],
    },
    {
      id: 'the-agenda',
      title: 'The agenda on your phone',
      icon: 'ListNumbers',
      blocks: [
        {
          t: 'p',
          text: 'Between items your phone shows the whole agenda: each item\'s planned time, its title, its kind and who leads it, and a word for where it is.',
        },
        {
          t: 'table',
          head: ['Word', 'Means'],
          rows: [
            ['**Not started**', 'The day has not begun.'],
            ['**Next**', 'Probably the next item the host will start.'],
            ['**Now**', 'Live at the moment.'],
            ['**Paused**', 'The host has paused it; it can come back.'],
            ['**Done**', 'Finished.'],
          ],
        },
        {
          t: 'p',
          text: 'Times are the plan; each item starts when the host starts it. Leave the page open and it switches by itself.',
        },
        {
          t: 'p',
          text: 'Inside an item, **Agenda** in the top bar shows the agenda without leaving: what you were doing stays as it was. **Back to live** at the bottom takes you back.',
        },
      ],
    },
    {
      id: 'when-an-item-starts',
      title: 'When the host starts an item',
      icon: 'PlayCircle',
      blocks: [
        {
          t: 'p',
          text: 'Your phone switches by itself. It names the item for a moment ("You\'re in as" your name, "No code needed"), then opens it.',
        },
        {
          t: 'list',
          items: [
            { title: 'A session', text: 'Trivia, Call & Answer, a poll, Wavelength or a survey plays just as it does on its own: see Playing. You are already in under your event name. If it shows **Not in yet.**, press **Try again**.' },
            { title: 'A talk or an activity', text: 'Your phone says what it is and who leads it, and asks you to look up.' },
            { title: 'A break', text: 'Your phone says when to be back.' },
          ],
        },
        {
          t: 'p',
          text: 'When a session ends, keep the page open: the next item starts there by itself. **Back to the agenda** shows the day so far.',
        },
      ],
    },
    {
      id: 'talks-breaks-pauses',
      title: 'Talks, breaks and pauses',
      icon: 'Clock',
      blocks: [
        {
          t: 'list',
          items: [
            { title: 'A talk with slides', text: 'Your phone says which slide is up ("Slide 3 of 12"). Tap **Show the slides here** to see the same slide on your phone, following each turn within a few seconds; **Hide the slides** puts them away. They load only when you tap, to spare the venue\'s wifi.' },
            { title: 'A break', text: '**Back at** and the time.' },
            { title: 'A pause', text: '"The host will be back." Anything you already sent is kept, and the page picks up where it left off when the host resumes. **Open the agenda** shows the day meanwhile.' },
          ],
        },
      ],
    },
    {
      id: 'coming-back',
      title: 'Leaving and coming back',
      icon: 'ArrowCounterClockwise',
      blocks: [
        {
          t: 'p',
          text: 'Close the page, lose signal or reload: open the join screen and enter the event\'s code again on the same phone. It is remembered, so no name is needed, and you return to whatever is live with your answers.',
        },
        {
          t: 'list',
          items: [
            { title: 'On a different phone', text: 'Join again with the code and your name. It counts as a new arrival.' },
            { title: '**Not you?**', text: 'At the foot of the agenda. Forgets the name on this phone so someone else can join with their own.' },
            { title: 'Offline', text: 'The page keeps what it has and catches up when the connection comes back: see When something goes wrong.' },
          ],
        },
      ],
    },
    {
      id: 'end-of-day',
      title: 'When the event ends',
      icon: 'CheckCircle',
      blocks: [
        {
          t: 'p',
          text: 'Your phone shows "That\'s the day." and the agenda with everything finished. You can close the page. Once an event has ended, nobody new can join it.',
        },
      ],
    },
  ],
};

/**
 * The player-events area. Assembled into roles by ./index.js (ROLE_AREAS); see
 * docs/help-refresh/STRUCTURE.md for the map and the conventions.
 */
export const AREA = {
  id: 'player-events',
  guides: { player: [playerEvents] },
};
