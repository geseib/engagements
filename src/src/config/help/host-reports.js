/**
 * AFTER THE RESULTS: WHAT WE HEARD, ASK THE ROOM, THE FEEDBACK ROUND, AND THE
 * REPORT (help refresh Phase 2, workstream W3).
 *
 * Workie is introduced in the glossary; these guides use the word. Labels are
 * quoted from the code; citations sit above each section. Checked on dev
 * (22 Oct 2026) in a one-screen Call & Answer session: the four-page read,
 * "1 ask ready", the composer (Rate suggestion, Comments kind), the comments
 * beat with a featured comment, the report and its Save dialog.
 */

/*
  WHAT WE HEARD. Dock words: config/roundWords.js via roundStep.js READ
  (RW.showTheRead disabled + RW.workieWriting before the read; RW.nextPage;
  "Reading page 1 of 4 · 1 ask ready"; last page: RW.askTheRoom as primary
  when asks are unsent, else "Start round N" with RW.askTheRoom, or
  RW.requestFeedback where the follow-up asks switch is off — template
  FollowUpAsks, on for dev and test only). Mid-read secondary "Start round N"
  arms with RW.armUnasked. AISummaryStatus.jsx: "Workie is reading the
  responses…", failure "Try again", template "Workie's read didn't run" +
  "Redo". Icons beside a point: GameHostPage askAddon / FW.afterTheRead.
  Workie reads every round type's results (roundStep RESULTS primary).
*/
const heard = {
  id: 'host-what-we-heard',
  title: 'What we heard and Ask the room',
  icon: 'Ear',
  summary: 'Workie\'s read of a round, the questions it suggests for the room, and a round of comments.',
  sections: [
    {
      id: 'what-we-heard',
      title: 'Reading What we heard with the room',
      icon: 'Sparkle',
      blocks: [
        {
          t: 'p',
          text: 'After the results, **What we heard** puts up Workie\'s read of the round: what the room said, how it voted, topics worth discussing and next steps, written from the answers in front of it. It comes after every type\'s results.',
        },
        {
          t: 'list',
          items: [
            'While Workie writes, the dock shows **Show the read** greyed out and **Workie is writing**, so Space or a clicker cannot skip it.',
            'A long read comes in pages ("Reading page 1 of 4"). **Next page** or → turns the page; ← goes back, and from the first page back to the results.',
            'The second button, "Start round 2", skips the rest. If Workie suggested questions you have not asked, it asks for a second press first.',
            'On the last page, **Ask the room** opens the composer when suggestions are waiting ("1 ask ready"); otherwise the main button starts the next round. Where Ask the room is not offered, see Asking the room a quick question.',
          ],
        },
        {
          t: 'p',
          text: 'If the read fails, the stage says so with **Try again**. If Workie could not run and a plain count stands in, it reads "Workie\'s read didn\'t run" with **Redo**. **Redo the read on screen**, in the Session panel\'s Settings, rewrites the read now in the voice and approach chosen there.',
        },
      ],
    },
    {
      id: 'read-check',
      title: 'When Workie says more than the room did',
      icon: 'Warning',
      blocks: [
        {
          t: 'note',
          tone: 'info',
          title: '"Workie used words the room\'s answers don\'t support"',
          text: 'After Workie writes, Engage checks the read against what it was given: a number no answer, question or count contains, a claim about the room the vote does not show ("unanimous" when the points were split), and a next step written as already decided when the room only ranked answers. If it finds any, Workie rewrites the read once. Any words still left are named in one small line: beside Redo in the Session panel\'s Workie settings, on the two-screen console beside the read, and on the phone remote. Redo, or change what you say aloud. Only you see the line; it is never part of the read the room sees.',
        },
        {
          t: 'p',
          text: 'On rounds that hold something back (the real title, the actual number, what happened next), Workie is given the held-back detail so it can compare the room\'s answers with it and reveal it in the read. That only works if the question set filled the detail in; a reveal that never comes is the set to fix, not the session.',
        },
      ],
    },
    /*
      AskComposer.jsx with config/followUpWords.js: FW.askTheRoom, "Workie
      suggests" cards ("from Discussion topics, point 2"), FW.startFromBlank,
      KIND (KINDS + COMMENTS_KIND, KIND_LINES), FW.statement / FW.question,
      "Back to Workie's words", ENDS_WORDS ("1 means", "5 means", "Custom…"),
      FW.fromTheRead, FW.whyWorkie, FW.whatRoomSees, PRIVACY_LINES,
      FW.sendToRoom / FW.commentsSend, FW.finishFirst. Call & Answer only
      (GameHostPage asksEnabled).
    */
    {
      id: 'ask-the-room',
      title: 'Asking the room a quick question',
      icon: 'Question',
      blocks: [
        {
          t: 'p',
          text: 'In Call & Answer, **Ask the room** opens a composer. Some sites do not offer it; there you get **Request feedback** instead (A round of comments, below). Open it from the dock on the read\'s last page, or from a small icon beside a point Workie suggests asking about.',
        },
        {
          t: 'steps',
          items: [
            'Pick one of the cards under **Workie suggests**, or **Start from blank**.',
            'Choose the kind: **Ideas** (short written answers), **Choose** (one of 2 to 4 options) or **Rate** (a statement rated 1 to 5). All three are anonymous. **Comments** opens a feedback round instead.',
            'Edit the words; **Back to Workie\'s words** undoes your edits. For Rate, pick what **1 means** and **5 means** (Disagree to Agree, No to Yes…) or **Custom…** to type both. **Words from the read** lets you click a line to use it.',
            'Check **What the room sees**, then **Send to the room**.',
          ],
        },
        {
          t: 'p',
          text: 'One question can be open at a time.',
        },
      ],
    },
    /*
      AskStage.jsx: "Question for the room · Rate", FW.answeredOn, FW.theRoomsAnswer,
      FW.averageOf5, ideas picked for the room (FW.pickForWall, FW.ideasCount).
      Dock (roundStep ROOM_QUESTION / ROOM_RESULTS): RW.showResults with in-place
      arm, RW.cancelQuestion; then "Start round N" and RW.askAnother; yourPart
      ROOM_RESULTS "Pick the ideas to show."
    */
    {
      id: 'room-question',
      title: 'While the room answers your question',
      icon: 'ChatCircleText',
      blocks: [
        {
          t: 'list',
          items: [
            'The stage shows the question and how many have answered ("2 of 6 answered on their phone, laptop or tablet").',
            '**Show results** puts up the room\'s answer: the count for each option, or how the room rated the statement. Pressed early it asks in place. **Cancel the question** takes it back and returns to the read.',
            'For Ideas, nothing is shown until you pick: click an idea to put it up for the room, click again to take it down.',
            'Then start the next round, or **Ask another question**.',
          ],
        },
        {
          t: 'p',
          text: 'Answers that arrive after you show the results are kept but not counted: see Late answers and comments.',
        },
      ],
    },
    /*
      The feedback beat: FW.commentsSend "Open comments" / RW.requestFeedback;
      FeedbackWall.jsx ("What do you make of it?", "Provide feedback on the
      round from your phone, laptop or tablet.", featured quote, click to take
      down, "Said in the room"); RoomMeter arrivals (last three, no names, click
      to feature; off with the Feedback setting), RoomNote ("Said in the room",
      "Type what someone said", "Add"); dock RW.feedbackOpen, RW.backToRead,
      "Start round N". Report: GameReport "Comments", "Shown to the room".
    */
    {
      id: 'feedback-round',
      title: 'A round of comments',
      icon: 'ChatCircleText',
      blocks: [
        {
          t: 'p',
          text: '**Open comments** (the Comments kind) or **Request feedback** asks the room what it makes of the round. The stage says **What do you make of it?** and people comment from their phones on the read, the results or any answer. Comments carry the writer\'s name.',
        },
        {
          t: 'list',
          items: [
            'The room meter counts comments and, with the Feedback setting on, shows the latest few without names. Click one to put it up for the room with its writer; click the quote to take it down.',
            'Someone said something good out loud? Type it under **Said in the room** and press **Add**. It goes in as said in the room.',
            '**Back to what we heard** returns to the read and closes comments on every phone; the main button starts the next round.',
          ],
        },
        {
          t: 'p',
          text: 'Every comment is in the round\'s part of the session report, marked when it was shown to the room.',
        },
      ],
    },
  ],
};

/*
  THE SESSION REPORT. Opened by the Rounds tab's "Session report"
  (SessionSetupPanel ~940 → handleViewReports → this session's report), the
  ENDED primary RW.openReport, or the Sessions list (W2). GameReport.jsx
  toolbar: "Back to session", "All session reports", "Print", "Save report";
  a cover (Held = startedAt else createdAt, Hosted by, Format, the result
  strip), "About this session", "Who was here", per round (the opener, the
  task, "Workie's read", "What the room said" ranked with points,
  "Comments", "Arrived late"), "Final scores", "How to read this report".
  The saved PDF (utils/saveReport.js): the cover on page one, a stamped head
  and "Page n of N" foot on every later page. Built fresh each time
  (create-report is a POST).
*/
const reporting = {
  id: 'host-reporting',
  title: 'The session report',
  icon: 'FileText',
  summary: 'Opening the report, saving it to keep or share, and how long a session and a saved report last.',
  sections: [
    {
      id: 'session-report',
      title: 'Opening the session report',
      icon: 'FileText',
      blocks: [
        {
          t: 'p',
          text: 'Open it from **Session report** at the top of the Rounds tab, from **Open session report** when the session ends, or from Sessions on your start screen. It is built fresh each time, so you can open it during the session as often as you like; opening it ends nothing.',
        },
        {
          t: 'p',
          text: 'It opens with a cover: the session\'s title, the day it was held, who hosted it, the format, and the result at a glance (how many people, rounds and responses, and the top-voted response). Then what the session was about, who was there, and each round: the question and the task, Workie\'s read (marked as AI analysis, not your words), every answer ranked with its points, the comments, any questions you asked the room, and anything that arrived late. It ends with the final scores and a short guide to reading the report.',
        },
        {
          t: 'p',
          text: 'The saved PDF is the same report on Letter pages: the cover is page one, and every page after it carries the session\'s name at the top and the session, its date and "Page n of N" at the foot. It reads the same printed in black and white.',
        },
        {
          t: 'p',
          text: 'Along the top: **Back to session**, **All session reports**, **Print** and **Save report**.',
        },
      ],
    },
    /*
      GameReport.jsx save dialog ("How long should it be kept?", "Keep for 90
      days" / "Keep for 1 year" with their deletion lines, "Save");
      ReportSavedDialog.jsx ("Report saved", Link, Passkey, "send them the link
      and the passkey… separately", "You can find both again under Reports.
      Saving this session again keeps the same passkey.", "Anyone on your team
      can open it from Reports without a passkey.", "Download PDF", "Done").
      save-report.js: retention 90 / 365 days from saving. The list:
      components/ReportsPanel.jsx (search, type, retention, sort; Share, PDF;
      an auto-built row: "Auto-built — open to make the PDF", "N rounds done ·
      N not run", "Make the PDF"; an event row "· N auto-built").
      game/report-sweep.js: every 3 hours; due when ended > 24h, idle > 12h or
      < 48h before expiry; 90-day report; bell 'report.auto' / 'report.failed'.
    */
    {
      id: 'saving-report',
      title: 'Saving and sharing a report',
      icon: 'FloppyDisk',
      blocks: [
        {
          t: 'steps',
          items: [
            'Press Save report, at the top of the report.',
            'Choose **Keep for 90 days**, or **Keep for 1 year** for a report you will come back to. Each is deleted automatically that long after you save it.',
            'Press Save. **Report saved** shows a link and a passkey.',
          ],
        },
        {
          t: 'p',
          text: 'Someone who is not signed in needs both the link and the passkey; send them separately (the passkey by text or out loud) so a forwarded link alone opens nothing. **Download PDF** keeps a copy on your computer. Anyone on your team can open the report from Reports without a passkey.',
        },
        {
          t: 'p',
          text: 'A saved report outlives its session. **Reports** on your start screen, and the Reports section of the console, list every saved report with when it was saved and how long it is kept. Search, filter and sort them; **Share** gives its link and passkey again, and **PDF** downloads it. Saving the same session again keeps the same passkey.',
        },
      ],
    },
    /*
      game/report-sweep.js (every 3 hours on the usage-reconcile schedule):
      due when ended > 24h, idle > 12h, or < 48h before expiry; one Workie
      retry per round that reached results without a read; 90-day report;
      bell report.auto / report.failed. ReportsPanel: "Auto-built — open to
      make the PDF", "Make the PDF". get-report reads it after expiry.
    */
    {
      id: 'auto-report',
      title: 'Ran out of time? Engage builds the report for you',
      icon: 'Sparkle',
      blocks: [
        {
          t: 'p',
          text: 'If a session that ran has no saved report a day after it ends (or after 12 hours with nothing happening, or 2 days before it expires), Engage builds its report from the rounds that finished, and the bell tells you it is ready. If a round\'s Workie read failed, Engage tries it once more first; a round that never reached its results is listed but not read.',
        },
        {
          t: 'p',
          text: 'Reports lists it as **Auto-built — open to make the PDF**, with how many rounds it covers and how many were not run. Press **Make the PDF** to draw and save it; it then has a link and passkey like any saved report. An auto-built report is kept 90 days, and it still opens after the session has expired.',
        },
      ],
    },
    /*
      session-ttl.js (game/ and websocket/): created → +90 days; started →
      started + 7 days (game/session-start.js). Deletion is lazy (up to ~48h).
      The report is rebuilt from the session (create-report), so it cannot be
      made once the session is gone — unless the sweep (report-sweep.js) built
      it first. Saved reports: save-report.js 90 / 365; auto-built 90.
    */
    {
      id: 'how-long-data-lasts',
      title: 'How long the data lasts',
      icon: 'CalendarBlank',
      blocks: [
        {
          t: 'p',
          text: 'In short: a session lasts 7 days from its start (90 days from creation if it never starts), a saved report 90 days or a year from saving, and an auto-built report 90 days from when it was built. Everything, in one table: Data & privacy › How long things are kept.',
        },
        {
          t: 'note',
          tone: 'warn',
          title: 'Save the report within the week',
          text: 'When a session expires, its answers and rounds go with it, and the report can no longer be rebuilt. Engage builds one automatically before then if you have not saved one, but only from what is there when it runs. If the results matter, save the report yourself while the session still exists.',
        },
      ],
    },
  ],
};

/**
 * The host-reports area. Assembled into roles by ./index.js (ROLE_AREAS); see
 * docs/help-refresh/STRUCTURE.md for the map and the conventions.
 * What we heard, Ask the room, the feedback round, the session report, saved
 * reports, and how long the data lasts.
 */
export const AREA = {
  id: 'host-reports',
  guides: { host: [heard, reporting] },
};
