/**
 * ANSWERING A SURVEY ON YOUR PHONE (help refresh Phase 2, W5, 22 Oct 2026).
 *
 * The respondent's side of a survey, in the order a person meets it: getting
 * in, the names promise, answering (needs an answer vs optional), each kind of
 * question, saving and coming back, checking and sending, the close, and
 * comments afterwards. Joining in general is player-joining's; commenting in
 * general is player-feedback's; this links rather than restates.
 *
 * Sources: components/survey/SurveyRunner.jsx (every screen), the five
 * *Input.jsx files, useSurveyAutosave.js, respondent.js,
 * config/surveyNames.js, PlayerPage.jsx (join note ~3226, a closed survey's
 * feedback round ~3379). Walked on dev 22 Oct 2026 at phone size (session
 * 4564, Who finished): join, seven questions of four kinds, review, warning
 * banner, send, close, comment, end. Ranking was not in that set; it is
 * described from RankInput.jsx. Readers never see these citations.
 */

const playerSurveys = {
  id: 'player-surveys',
  title: 'Answering a survey',
  icon: 'ClipboardText',
  summary: 'What a survey looks like on your phone, who sees your answers, saving and coming back, sending, and what happens when it closes.',
  sections: [
    /*
      PlayerPage join form, survey brief: "Used to get you back in if you lose
      this page." + the Names phone promise. SurveyRunner not-started: "You're
      in", "Joined as {name}.", "The survey opens when your host is ready.
      This page will change on its own."; loading "Loading the survey…";
      error "The survey did not load." + Try again. Checked on dev.
    */
    {
      id: 'getting-in',
      title: 'Getting into a survey',
      icon: 'ClipboardText',
      blocks: [
        {
          t: 'p',
          text: 'Join the way you join any session: scan the QR or open the link, check the code and type your name (see Joining a session). Under the name box the phone says what your name is used for in this survey, and who will see what.',
        },
        {
          t: 'p',
          text: 'The first question appears straight away. A survey has no rounds: you go through the questions at your own pace, and nobody waits for you.',
        },
        {
          t: 'p',
          text: 'If it says the survey opens when your host is ready, wait; the page changes on its own. If it says the survey did not load, press **Try again**.',
        },
      ],
    },
    /*
      config/surveyNames.js phoneLead + phoneLine, shown above question 1 only
      (SurveyRunner) and on the join form. Fixed once the survey opens
      (SessionOptions "Fixed once the survey opens"). FeedbackRoundPanel
      namesShown=false for a survey. SurveyRunner closed: "Nobody's name is
      shown there."
    */
    {
      id: 'who-sees-your-answers',
      title: 'Who sees your answers',
      icon: 'EyeSlash',
      blocks: [
        {
          t: 'p',
          text: 'Above the first question your phone says what the host chose, in one line. It cannot change once the survey is open.',
        },
        {
          t: 'table',
          head: ['Your phone says', 'What it means'],
          rows: [
            ['Anonymous', 'Nobody is recorded. The host sees totals and the words people write, never who wrote them.'],
            ['Your host sees that you finished', 'The host gets a list of who finished, but your answers are kept apart from your name.'],
            ['Named', 'The host sees your name with your answers. The room and any shared results never do.'],
          ],
        },
        {
          t: 'p',
          text: 'Whatever the choice, results shown to the room never carry a name. In a small group, though, people may still recognise an answer by what it says.',
        },
      ],
    },
    /*
      SurveyRunner answering: header "N of M", "Question N · needs an answer"
      / "· optional", Back, Next (answered or required) / Skip (optional and
      unanswered), "This one needs an answer before you go on." with Next
      disabled; from Check your answers the button says Review. Checked on dev.
    */
    {
      id: 'answering',
      title: 'Answering, one question at a time',
      icon: 'ListChecks',
      blocks: [
        {
          t: 'p',
          text: 'The top of the screen says where you are, for example 3 of 7. Each question says whether it **needs an answer** or is **optional**.',
        },
        {
          t: 'list',
          items: [
            { title: 'Next', text: 'Goes on once you have answered.' },
            { title: 'Skip', text: 'Shows instead of Next on an optional question you have not answered.' },
            { title: 'Back', text: 'Returns to the question before, to look or to change your answer.' },
          ],
        },
        {
          t: 'p',
          text: 'A question that needs an answer keeps Next greyed out and says "This one needs an answer before you go on." After the last question you see your answers to check (see Checking and sending, below).',
        },
      ],
    },
    /*
      RatingInput (scale steps, 0–10 wraps, stars; end labels under the ends),
      ChoiceInput ("Pick one." / "Pick any that apply." / "Pick up to N · n of
      N picked." "Untick one to change."; "Something else" write-in),
      YesNoInput (Yes/No or the host's pair, optional "Not sure", a follow-up
      "· optional" box under the answer that asks), RankInput ("Tap them in
      the order you'd put them.", "Your top N is enough.", "Top N placed —
      move or take one out…", tap a placed item to take it out, ↑ ↓ to move),
      TextInput ("Your answer", count n / limit, limit enforced).
    */
    {
      id: 'question-kinds',
      title: 'Each kind of question',
      icon: 'ListNumbers',
      blocks: [
        {
          t: 'list',
          items: [
            { title: 'Rating', text: 'Tap a number on the scale, or a star. The words under the two ends say what they mean, for example 1 Poor and 5 Excellent.' },
            { title: 'Multiple choice', text: 'The line above the options says Pick one, Pick any that apply, or Pick up to a number. At the limit, untick one to change. **Something else** opens a box for your own answer.' },
            { title: 'Yes / No', text: 'Tap one; sometimes there is **Not sure** too, or other words such as Agree and Disagree. Some answers open an optional box asking why.' },
            { title: 'Ranking', text: 'Tap the items in the order you would put them. Tap a placed item to take it out, and use ↑ ↓ to move it. When it says your top few is enough, you need not place the rest.' },
            { title: 'Open answer', text: 'Type in **Your answer**. The count under the box shows how much room is left.' },
          ],
        },
        {
          t: 'p',
          text: 'Change any answer by tapping again, before or after you send, until the host closes the survey.',
        },
      ],
    },
    /*
      SurveyRunner SavedLine: "Answers save as you go", "Saving…", "Saved",
      "Not saved – retrying", "Not saved — …". useSurveyAutosave: every
      answer saved as given, words after a pause or on leaving the box,
      retried on failure. Load: resumes at the first unanswered question, or
      the review, or "sent" (fetchMine). respondent.js: in Anonymous and Who
      finished the phone's own random id, kept in this browser per survey; a
      private window or blocked storage starts afresh on reload.
    */
    {
      id: 'saving-and-coming-back',
      title: 'Saving, and coming back later',
      icon: 'FloppyDisk',
      blocks: [
        {
          t: 'p',
          text: 'Every answer is saved the moment you give it; words are saved when you pause typing or leave the box. The line above the buttons says **Saving…**, then **Saved**. If it says it is retrying, keep going: it tries again on its own.',
        },
        {
          t: 'p',
          text: 'You can stop and come back while the survey is open. Open the same link on the same phone and browser, and you land on the first question you have not answered, with your earlier answers in place.',
        },
        {
          t: 'note',
          tone: 'info',
          title: 'Anonymous and Who finished surveys remember this browser, not you',
          text: 'Your answers are filed under a random tag kept in this browser, so nothing links them to your name. A private window, cleared site data or another phone cannot find them again, and you start from the beginning. What you saved before still counts.',
        },
      ],
    },
    /*
      SurveyRunner review: "Check your answers", "One was optional and you
      skipped it. Anything can change until your host closes the survey.",
      rows with Change / Answer, "Skipped — optional", "Needs an answer",
      Back, "Send my answers" (disabled: "Question N needs an answer before you
      can send." / "Answer at least one question to send."); sent: "Thanks,
      {name} — that's everything.", "Your answers are in. You can still change
      them…", "Change my answers". Checked on dev.
    */
    {
      id: 'checking-and-sending',
      title: 'Checking and sending',
      icon: 'PaperPlaneTilt',
      blocks: [
        {
          t: 'p',
          text: 'After the last question, **Check your answers** lists every question with what you said, or **Skipped — optional**, or **Needs an answer**. Tap **Change** or **Answer** beside one to go to it; **Review** brings you back.',
        },
        {
          t: 'p',
          text: 'Press **Send my answers**. It stays greyed out until every question that needs an answer has one, and it says which.',
        },
        {
          t: 'p',
          text: 'Your phone then says your answers are in. **Change my answers** takes you back to the list until the host closes the survey. Changes save as you make them.',
        },
        {
          t: 'note',
          tone: 'tip',
          title: 'Ran out of time?',
          text: 'Everything you answered counts, even if you never press Send. Sending tells the host you have finished.',
        },
      ],
    },
    /*
      SurveyRunner warning banner: closingSoonText ("Two minutes left." …
      "Closing any moment.") + "Your host will close the survey soon.
      Everything you have answered counts, even if you do not press Send.";
      closed: "The survey is closed." + "Thanks, {name}. Everything you
      answered counts, whether or not you pressed Send." / "Your host has
      closed it, so there is nothing more to answer.", "Your host may put the
      results on the main screen. Nobody's name is shown there."; ended:
      "That's a wrap", "Thanks for taking part, {name}.", "The session is
      over. You can close this page." Checked on dev.
    */
    {
      id: 'when-it-closes',
      title: 'When the host closes it',
      icon: 'Timer',
      blocks: [
        {
          t: 'p',
          text: 'The host may warn first: a banner counts down the minutes left and reminds you that everything you have answered counts. When the time is up it says it is closing any moment; the host closes it by hand.',
        },
        {
          t: 'p',
          text: 'Once it closes, your phone says "The survey is closed." and nothing more can be answered or changed. Everything you answered counts, whether or not you pressed Send. The host may show the results on the main screen, without names.',
        },
        {
          t: 'p',
          text: 'When the host ends the session your phone thanks you and says the session is over. You can close the page.',
        },
      ],
    },
    /*
      PlayerPage ~3379: a closed survey's feedback round, FeedbackRoundPanel
      with namesShown=false. Dev: "Read it back, then say what you think. Tap
      Comment on the summary, on the results, or on any single response.",
      "Results by question", the AI read, "Commenting on", "Your name is not
      shown with this comment.", Cancel / Post comment.
    */
    {
      id: 'comments-afterwards',
      title: 'Comments after the survey',
      icon: 'ChatCircleText',
      blocks: [
        {
          t: 'p',
          text: 'After the close the host may ask the room for comments. Your phone switches by itself to the survey\'s results, question by question, with Workie\'s read of them.',
        },
        {
          t: 'p',
          text: 'Tap **Comment** on the part you want to talk about, write, and press **Post comment**. In a survey your name is never shown with a comment, and the phone says so. The rest works as in Commenting on a round, in Comments and quick questions.',
        },
      ],
    },
  ],
};

/**
 * The player-surveys area. Assembled into roles by ./index.js (ROLE_AREAS); see
 * docs/help-refresh/STRUCTURE.md for the map and the conventions.
 */
export const AREA = {
  id: 'player-surveys',
  guides: { player: [playerSurveys] },
};
