/**
 * RUNNING A SURVEY (help refresh Phase 2, W5, 22 Oct 2026).
 *
 * A survey is a session with no rounds: created and opened in one press,
 * answered at each person's own pace, closed by the host, then read back.
 * One guide, task first: make one, choose Names, watch it fill, warn and
 * close, read the results, walk the room through them, What we heard and
 * comments, the end, the report. Polls (a survey question asked one at a
 * time) are owned by host-running.js (host-stage-by-type#poll); this links.
 *
 * Every control is quoted from the surface it lives on; the file each claim
 * was checked against is in the comment above its section. Walked on dev
 * 22 Oct 2026 (QA host, session 4564, "survey-event-feedback", Who finished):
 * create → open → phone answers → warning → close → See the results → Walk
 * through → What We Heard → Request feedback → End the session → Session
 * report → Sessions row. Readers never see these citations.
 */

const hostSurveys = {
  id: 'host-surveys',
  title: 'Running a survey',
  icon: 'ClipboardText',
  summary: 'Opening a survey, watching answers come in, warning and closing, reading and showing the results, and the report.',
  sections: [
    /*
      config/hostControls.js: survey phases LOBBY → COLLECTING → CLOSED
      (+ FIELD_NOTES, FEEDBACK) → ENDED; primaries "Close the survey",
      "What We Heard", "End the session", "Back to Menu"; secondaries
      "Two-minute warning", "See the results" + tertiary "Walk through".
      GameSetupDialog.jsx: a survey is created AND opened by "Open the survey"
      (openNewSurvey in GameHostPage.jsx). One screen only (config/surfaces.js:
      two screens are Call & Answer only).
    */
    {
      id: 'how-a-survey-runs',
      title: 'How a survey runs',
      icon: 'ClipboardText',
      blocks: [
        {
          t: 'p',
          text: 'A survey has no rounds. People answer every question on their own phone, at their own pace, and the only thing you decide is when it closes.',
        },
        {
          t: 'steps',
          items: [
            { title: 'Open it', text: 'Create the session as a survey. **Open the survey** creates it and opens it to answers in one press.' },
            { title: 'Let it fill', text: 'The join code and QR stay up while people answer. Your stage shows how far the room has got.' },
            { title: 'Warn, then close', text: '**Two-minute warning** tells every phone the close is coming; **Close the survey** stops the answers.' },
            { title: 'Read it back', text: '**See the results** for yourself, **Walk through** them with the room, then **What We Heard**.' },
            { title: 'End it', text: '**End the session**. The report keeps everything.' },
          ],
        },
        {
          t: 'note',
          tone: 'info',
          title: 'One screen only',
          text: 'A survey runs on your stage; it cannot use the room\'s window. See Choosing one or two screens in Setting a session up.',
        },
      ],
    },
    /*
      GameSetupDialog.jsx: Format "Survey" ("Structured multi-question
      feedback, reported in aggregate." on dev); categories, shuffle and goal
      hidden for a survey (isSurvey, ~311-340); foot note not shown; button
      "Open the survey" / "Opening…". openNewSurvey: on a refused start, "The
      survey was created but did not open: …" and the Sessions list opens.
      QuickstartMenu.jsx offers no survey. Sessions: rowActions (closed survey:
      Report, Results, Continue). Checked on dev.
    */
    {
      id: 'making-a-survey',
      title: 'Making a survey session',
      icon: 'PlayCircle',
      blocks: [
        {
          t: 'steps',
          items: [
            'On the start screen choose **Create engagement**.',
            'Give it a title and pick **Survey** as the format. The question set list then offers your survey sets.',
            'Open **Advanced** and choose **Names** (next section). It starts on Anonymous, or on the set\'s own choice if it has one.',
            'Press **Open the survey**. The stage opens with the join code, and phones can answer straight away.',
          ],
        },
        {
          t: 'p',
          text: 'There are no categories, shuffle or goal for a survey: everyone gets every question, in the set\'s order. **Quick start** does not offer surveys.',
        },
        {
          t: 'p',
          text: 'If the survey is created but does not open, your sessions list says why; press **Start** on its row to try again. A survey set is made like any other set: see Making a set, and reviewing an AI draft in Setting a session up.',
        },
      ],
    },
    /*
      config/surveyNames.js (NAMES_MODES: label, hostLine, phoneLine);
      SessionOptions.jsx Names card: "What their phone says", "What you get",
      "This hides names, not identities…", "Fixed once the survey opens —
      people answer on the promise their phone made them." GameReport.jsx
      showRoster: no "Who was here" for an Anonymous survey. survey-host.js
      people(): Anonymous keeps no names (409). The results, the walk-through
      and the report never carry a name with an answer (SurveyResultsPanel,
      SurveyOpenAnswersPanel "no name anywhere"). Named's own "does" line
      promises who-said-what in the console and a CSV; no such view exists,
      so it is not repeated here (issue #43).
    */
    {
      id: 'names',
      title: 'Names: what is recorded about people',
      icon: 'UsersThree',
      blocks: [
        {
          t: 'p',
          text: '**Names**, under **Advanced**, decides what Engage records about who answered. Choose before you open: it is fixed once the survey opens, because every phone has already told its owner what you chose.',
        },
        {
          t: 'table',
          head: ['Choice', 'What is recorded', 'What their phone says'],
          rows: [
            ['**Anonymous**', 'Nobody. You see totals and the words people write, never who wrote them.', 'Anonymous. Your host sees totals and the words you write, never who wrote them.'],
            ['**Who finished**', 'A list of who finished and who stopped partway, kept apart from the answers. Nobody, you included, can match an answer to a person.', 'Your host sees that you finished, not what you answered.'],
            ['**Named**', 'Each answer with the person\'s name. The room never sees it.', 'Named. Your host sees your name with your answers. The room and any shared results never do.'],
          ],
        },
        {
          t: 'p',
          text: 'The results, the walk-through and the report show answers without names whichever you choose. An Anonymous survey\'s report also leaves out who was there.',
        },
        {
          t: 'note',
          tone: 'warn',
          title: 'Names, not identities',
          text: 'In a small group people may still recognise each other\'s answers, especially open ones.',
        },
      ],
    },
    /*
      SurveyCollecting.jsx: session title, surveyWallSubtitle ("Seven quick
      questions on your phone, laptop or tablet." + the Names wallLine), QR,
      "Scan, or go to" / "and enter". GameHostPage meter ~7453: "Finished"
      n / joined, "Answered, by question" rows Q1…; dock status
      surveyStatusLine "N finished · N partway · N not started"; "ALL IN"
      when everyone has finished. RoomMeter REVEAL_LABEL COLLECTING "Still
      going", offered only for Who finished / Named (surveyWaiting), hover or
      click the count, U toggles. Checked on dev.
    */
    {
      id: 'while-it-collects',
      title: 'While answers come in',
      icon: 'ChartBar',
      blocks: [
        {
          t: 'p',
          text: 'The stage shows the survey\'s title, how many questions there are, the Names promise, and the QR and join code, which stay up the whole time. People can join and start at any point until you close it.',
        },
        {
          t: 'list',
          items: [
            { title: 'Finished', text: 'How many people have sent their answers, out of everyone who joined. It says **All in** when everyone has.' },
            { title: 'Answered, by question', text: 'A bar per question: how far through the survey the room has got.' },
            { title: 'The dock', text: 'How many have finished, are partway, or have not started.' },
          ],
        },
        {
          t: 'p',
          text: 'With **Who finished** or **Named**, the room meter can list who is still going, so you can chase them: point at or click the count, or press U. The list is on the stage, so the room sees those names too. An Anonymous survey has no list.',
        },
        {
          t: 'p',
          text: 'Answers themselves stay hidden until you close the survey.',
        },
      ],
    },
    /*
      hostControls.js: WARN_SURVEY secondary "Two-minute warning" (moves
      nothing; dock adds "· warning sent", GameHostPage ~7910); SurveyRunner
      banner "N minutes left. Your host will close the survey soon.…" counting
      down, "Closing any moment." past it. CLOSE_SURVEY primary with
      surveyCloseConfirm: "Close the survey?", counts, "A closed survey cannot
      be reopened.", irreversible (→ does not confirm). SurveyClosed: "Survey
      closed", "Thank you for your answers", "N people answered · N
      finished." Checked on dev.
    */
    {
      id: 'warning-and-closing',
      title: 'The two-minute warning, and closing',
      icon: 'Timer',
      blocks: [
        {
          t: 'p',
          text: '**Two-minute warning** puts a banner on every phone counting down the minutes and saying that everything already answered counts. It closes nothing: the survey stays open until you close it, and the dock adds "warning sent".',
        },
        {
          t: 'p',
          text: '**Close the survey** (or Space) asks first, with how many have finished and how many are partway. Confirm and every phone stops taking answers. A closed survey cannot be reopened.',
        },
        {
          t: 'p',
          text: 'Partly finished surveys count: whatever someone answered before the close is in the results, whether or not they pressed send.',
        },
        {
          t: 'p',
          text: 'The stage then thanks the room and says how many answered and how many finished. The QR comes down: nobody new can answer.',
        },
      ],
    },
    /*
      SurveyResultsPanel.jsx: "Back to session", "Walk through", "Survey
      results", "Names: …", "N finished of N who answered something"; per
      question KindResult: rating mean + histogram ("out of 5 · mean", "% said
      4 or 5"), 0–10 "recommend score" −100 to +100 (0–6 would not, 7–8
      maybe, 9–10 would), choice bars "Most picked" (multi-pick "can add to
      more than 100%"), yes/no split + whys, ranking "avg" place, open answers
      preview + "Read all N" (SurveyOpenAnswersPanel, "Back to results").
      Offered on CLOSED and a survey's ENDED; Sessions row "Results". Checked
      on dev.
    */
    {
      id: 'results',
      title: 'Reading the results',
      icon: 'ChartBar',
      blocks: [
        {
          t: 'p',
          text: 'Once the survey is closed, **See the results** opens Survey results on your screen. It says which Names choice the survey used and how many finished, then gives each question a card:',
        },
        {
          t: 'list',
          items: [
            { title: 'Rating', text: 'The average and how many gave each score. A 0 to 10 question shows a recommend score instead (from −100 to +100), split into 0–6 would not, 7–8 maybe and 9–10 would.' },
            { title: 'Multiple choice', text: 'A bar per option with its share and count; the top one is marked **Most picked**. When people could pick several, the shares can add up to more than 100%.' },
            { title: 'Yes / No', text: 'The split, and any reasons people gave.' },
            { title: 'Ranking', text: 'Items in order of their average place, with where people put each one.' },
            { title: 'Open answer', text: 'The first few answers; **Read all** opens the full list.' },
          ],
        },
        {
          t: 'p',
          text: '**Back to session** returns to the stage. The results are frozen at the close, and are also on the survey\'s row in your sessions list (**Results**).',
        },
      ],
    },
    /*
      stage/SurveyWalkthrough.jsx + config/surveyWalkthrough.js: kicker
      "Results", "Question N of M", "N answered.", dock "Walking the room
      through the results", "Previous", "Next result" / "Done", SPACE; keys
      → / Space next, ← previous, Esc leaves; ↑ ↓ page a long open answer
      (Pager); at the last result the keyboard's next does nothing. Opened
      from the dock (CLOSED and a survey's ENDED) or Survey results' "Walk
      through" (Esc returns there). Checked on dev.
    */
    {
      id: 'walk-through',
      title: 'Walking the room through the results',
      icon: 'Monitor',
      blocks: [
        {
          t: 'p',
          text: '**Walk through**, on the dock or at the top of Survey results, puts the results on the stage one question at a time, full size, for the room to read together. No names are shown.',
        },
        {
          t: 'keys',
          items: [
            { keys: 'Space  →', text: '**Next result**.' },
            { keys: '←', text: '**Previous**.' },
            { keys: '↑ ↓', text: 'Page through a long list of open answers.' },
            { keys: 'Esc', text: 'Stop and go back to where you started it.' },
          ],
        },
        {
          t: 'p',
          text: 'On the last result the button says **Done**, and Space does nothing, so a clicker pressed once too often cannot end the session.',
        },
      ],
    },
    /*
      hostControls.js CLOSED primary "What We Heard" (Workie's read of the
      survey, round 000); FIELD_NOTES last page: primary "End the session",
      secondary "Request feedback"; FEEDBACK: primary "End the session",
      secondary "Back to What We Heard". endSurveyControl has no confirm.
      PlayerPage: a survey's feedback round shows FeedbackRoundPanel with
      namesShown=false ("Your name is not shown with this comment."). ENDED
      (survey): "The session is over", "See the results", "Walk through",
      "Back to Menu". canEndSession: no End session in the Session panel for
      a survey. Checked on dev (Workie's read on dev said it did not run: no
      summary approach is set up there for surveys).
    */
    {
      id: 'after-closing',
      title: 'What we heard, comments and the end',
      icon: 'Sparkle',
      blocks: [
        {
          t: 'p',
          text: 'After the close, the main button is **What We Heard**: Workie\'s read of the whole survey, on the stage. It works as it does after a round; see Reading What we heard with the room in What we heard and Ask the room.',
        },
        {
          t: 'p',
          text: 'On its last page, **Request feedback** asks the room what it makes of the results. Phones show the results and Workie\'s read to comment on, and a survey\'s comments never carry a name. **Back to What We Heard** closes comments. See A round of comments, in the same guide, for the stage side.',
        },
        {
          t: 'p',
          text: '**End the session** finishes it, without asking first. Phones say thank you and that the session is over. On your stage **See the results** and **Walk through** are still there, and **Back to Menu** takes you to the start screen.',
        },
        {
          t: 'p',
          text: 'The Session panel has no End session for a survey: this button is the way to end it.',
        },
      ],
    },
    /*
      GameReport.jsx survey: "About this session", "Who was here" (not for
      Anonymous: showRoster), "What we heard" with comments ("Comment N"),
      "Survey results" (KindResult per question). Opened from the Rounds tab's
      "Session report" (checked on dev) or the Sessions row "Report"; survey
      ENDED primary is Back to Menu, not the report (hostControls.js).
    */
    {
      id: 'report',
      title: 'The survey\'s report',
      icon: 'FileText',
      blocks: [
        {
          t: 'p',
          text: 'Open it from **Session report** at the top of the Session panel\'s Rounds tab, or later from **Report** on the survey\'s row in your sessions list. A closed survey\'s row also has **Results** and **Continue**, which takes you back to its stage.',
        },
        {
          t: 'p',
          text: 'It holds what the session was about, who was there (left out for an Anonymous survey), Workie\'s read with the room\'s comments, and a card for every question, the same as Survey results. It never puts a name beside an answer.',
        },
        {
          t: 'p',
          text: 'Saving it to keep or share, and how long the answers last, are in The session report guide.',
        },
      ],
    },
    /*
      CLAUDE.md "Polls": a poll question is a survey question the host asks,
      choice, rating, yes/no or open (config/surveyKinds.js POLL_KINDS; no
      ranking). host-running.js owns how a poll runs (host-stage-by-type#poll).
    */
    {
      id: 'one-question-at-a-time',
      title: 'One question at a time instead: a poll',
      icon: 'Question',
      blocks: [
        {
          t: 'p',
          text: 'Want the room to answer together, one question at a time, and see each result fill in on the stage? Use a poll. A poll question is the same kind of question as a survey\'s (multiple choice, rating, yes or no, or an open answer; there is no ranking), but you ask each one in turn. See Poll in Each type on the stage.',
        },
      ],
    },
  ],
};

/**
 * The host-surveys area. Assembled into roles by ./index.js (ROLE_AREAS); see
 * docs/help-refresh/STRUCTURE.md for the map and the conventions.
 */
export const AREA = {
  id: 'host-surveys',
  guides: { host: [hostSurveys] },
};
