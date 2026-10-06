/**
 * THE SESSION REPORT.
 *
 * Lifted out of GameHostPage.jsx, where it was declared inline and never
 * exported. That is not a tidiness point: nothing outside that 5,000-line file
 * could render it (HostRemote.jsx says so in a comment where its own `Session
 * report` button should have been), and nothing could TEST it, because
 * GameHostPage dies on the auth provider under jsdom. A component whose only
 * mount point cannot be mounted has no verified behaviour at all.
 *
 * It is a DOCUMENT, not a screen, and that is the whole design. A host hands
 * this to a client after the session, and on paper it was printing as a
 * screenshot of an app: boxes inside boxes, a full-bleed amber field, and
 * paragraphs guillotined across page breaks. GameReport.css carries the print
 * sheet that fixes it; the markup here is shaped to give that sheet something
 * to work with — one column, real <section>s, headings that own their content.
 *
 * The CONTENT is unchanged from the inline version. Every field that was on
 * the page is still on the page, in the same order.
 */
import React, { useEffect, useState } from 'react';
import Icon from './Icon';
import RankIcon from './RankIcon';
import MarkdownRenderer from './MarkdownRenderer';
import { authFetch } from '../auth/authFetch';
import ReportSavedDialog from './ReportSavedDialog';
import { saveReportPdf } from '../utils/saveReport';
import { resolveRoundNoun, pluralRoundNoun } from '../config/instructions';
import { calculatePlayerRankings } from '../config/podium';
import { namesMode } from '../config/surveyNames';
import KindResult from './survey/results/KindResult';
import { unexpectedSaveMessage } from '../config/reportPdf';
import './GameReport.css';

const API_BASE = window.API_BASE;

const LONG_DATE = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };

/** Trivia answer slots, in display order. */
const OPTION_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];

/**
 * The shell. Owns the three things that are not the document: the status of
 * the fetch that builds it, the screen-only toolbar, and the save-to-S3 flow.
 *
 * `status` exists because `POST games/{id}/report` re-derives the whole report
 * server-side on every open. Before, the page simply did not render until the
 * payload arrived, and the host — who had just pressed a button — was looking
 * at the screen they were already on.
 */
function GameReport({
  reportData,
  status = 'ready',
  error = null,
  onClose,
  onRetry = null,
  onBrowseAll = null,
}) {
  const [isSaving, setIsSaving] = useState(false);
  const [showSaveReportModal, setShowSaveReportModal] = useState(false);
  const [saveAsPermanent, setSaveAsPermanent] = useState(false);
  // The save response: the key, the passkey and how long they work. Shown in
  // ReportSavedDialog once, because the passkey is never retrievable again.
  const [savedReport, setSavedReport] = useState(null);

  const ready = status === 'ready' && Boolean(reportData);
  const gameId = reportData?.gameId;
  const eventTitle = reportData?.eventTitle || 'Engagements Session';

  /*
   * REPEATING IDENTIFICATION ON PAGES 2+, and why it is done from here rather
   * than in CSS.
   *
   * A running head or foot inside the document is not available. `@page`
   * margin boxes are specified and implemented by nobody; `position: fixed` is
   * repeated on every printed page by Chrome, but it is laid out MODULO the
   * page's content height — measured, not assumed: with a 0.7in/1.05in page
   * margin, `bottom: -0.55in` renders at 1.10in from the paper's top, `top:
   * 9.4in` at 0.86in, and `bottom: 0` sits on the last line of body copy.
   * There is no offset that puts a repeating element in the page margin, and
   * one inside the text block collides with the text.
   *
   * The browser's own print header is in the margin, is on by default, and
   * prints `document.title` on every page beside the page number. So the title
   * is what gets set: every sheet of a printed report then carries the name of
   * the session it belongs to, with no hack in the stylesheet at all.
   */
  useEffect(() => {
    if (!ready) return undefined;
    const previous = document.title;
    document.title = `${eventTitle} — Session report`;
    return () => { document.title = previous; };
  }, [ready, eventTitle]);

  const initiateSaveReport = () => {
    setShowSaveReportModal(true);
  };

  const saveReportToPDF = async (permanent = false) => {
    if (isSaving) return;

    setIsSaving(true);
    setShowSaveReportModal(false);
    try {
      // `.report-doc`, not `.report-container`. The container is the full-bleed
      // paper field the screen sits on; html2canvas would rasterise its
      // background and the fixed toolbar along with it. The <article> is the
      // document and nothing else.
      const element = document.querySelector('.report-doc');

      // Drawn and kept by utils/saveReport.js — the one save every report
      // uses (a Build Room's too, since 2026-10-04): sized to what AWS
      // carries, refusals in the host's words.
      const result = await saveReportPdf({
        element, gameId, title: eventTitle, permanent, apiBase: API_BASE,
      });

      // Two items, not a link: whoever opens the link also needs the passkey
      // (lambda-functions/game/report-passkey.js). The dialog hands the host
      // both, and it is the only place the passkey is ever shown.
      setSavedReport(result);

    } catch (err) {
      console.error('Error saving report:', err);
      alert((err && err.hostMessage) || unexpectedSaveMessage(err));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <>
    {/* data-theme="light" is not decoration. Warm Summit's :root is DUSK — the
        projector palette — and a report is paper. Setting the paper theme here
        means every token below (--bg, --surface, --text, --muted) resolves to
        the printable set without a single hardcoded colour in this subtree. */}
    <div className="report-container report-paper" data-theme="light">

      {/* SCREEN ONLY. `report-noprint` is the print sheet's display:none hook;
          nothing in here is a thing a sheet of paper can do. */}
      <div className="report-toolbar report-noprint">
        <button type="button" className="report-tool report-tool--back" onClick={onClose}>
          <Icon name="ArrowLeft" weight="bold" size={16} /> Back to session
        </button>
        <div className="report-tool-group">
          {onBrowseAll && (
            <button type="button" className="report-tool" onClick={onBrowseAll}>
              <Icon name="ClockCounterClockwise" weight="bold" size={16} /> All session reports
            </button>
          )}
          <button
            type="button"
            className="report-tool"
            onClick={() => window.print()}
            disabled={!ready}
          >
            <Icon name="Printer" weight="bold" size={16} /> Print
          </button>
          <button
            type="button"
            className="report-tool report-tool--primary"
            onClick={initiateSaveReport}
            disabled={isSaving || !ready}
          >
            <Icon name="FloppyDisk" weight="bold" size={16} />
            {isSaving ? 'Saving…' : 'Save report'}
          </button>
        </div>
      </div>

      {status === 'loading' && (
        <div className="report-state report-noprint" role="status" aria-live="polite">
          <div className="report-state-spinner" aria-hidden="true" />
          <h2>Building the session report</h2>
          <p>
            Every report is written fresh from the session record — the rounds,
            the responses, the scores and the AI analysis. This takes a moment.
          </p>
        </div>
      )}

      {status === 'error' && (
        <div className="report-state report-state--error report-noprint" role="alert">
          <Icon name="WarningCircle" weight="duotone" size={44} color="var(--danger)" />
          <h2>The report could not be built</h2>
          <p>{error || 'Something went wrong on the way to the session record.'}</p>
          <div className="report-state-actions">
            {onRetry && (
              <button type="button" className="report-tool report-tool--primary" onClick={onRetry}>
                <Icon name="ArrowClockwise" weight="bold" size={16} /> Try again
              </button>
            )}
            {onBrowseAll && (
              <button type="button" className="report-tool" onClick={onBrowseAll}>
                All session reports
              </button>
            )}
            <button type="button" className="report-tool" onClick={onClose}>
              Back to session
            </button>
          </div>
        </div>
      )}

      {ready && <ReportDocument reportData={reportData} />}
    </div>

      {/* Save Report Modal */}
      {showSaveReportModal && (
        <div className="expanded-qr-overlay" onClick={() => setShowSaveReportModal(false)}>
          <div className="expanded-qr-content save-report-modal" onClick={(e) => e.stopPropagation()}>
            <div className="confirmation-header">
              <h2>Save report</h2>
            </div>
            {/* THE NUMBERS ARE THE BUCKET'S, NOT A GUESS. This said "Temporary
                Save (24 hours) — deleted after 24 hours" while ReportsBucket's
                lifecycle kept a standard report 90 days, and "Permanent" for a
                report deleted at 365. template-clean.yaml DeleteOldReports is
                the authority; __tests__/reportShare.test.jsx reads both
                numbers from it and fails if this copy drifts again. */}
            <div className="save-report-content">
              <p className="save-description">
                How long should it be kept?
              </p>

              <div className="save-option">
                <input
                  type="radio"
                  id="save-temporary"
                  name="saveType"
                  checked={!saveAsPermanent}
                  onChange={() => setSaveAsPermanent(false)}
                />
                <label htmlFor="save-temporary">
                  <strong>Keep for 90 days</strong>
                  <span className="save-option-desc">Deleted automatically 90 days after you save it.</span>
                </label>
              </div>

              <div className="save-option">
                <input
                  type="radio"
                  id="save-permanent"
                  name="saveType"
                  checked={saveAsPermanent}
                  onChange={() => setSaveAsPermanent(true)}
                />
                <label htmlFor="save-permanent">
                  <strong>Keep for 1 year</strong>
                  <span className="save-option-desc">Deleted automatically a year after you save it. For a report you will come back to.</span>
                </label>
              </div>
            </div>

            <div className="dialog-actions">
              <button
                className="btn-secondary"
                onClick={() => setShowSaveReportModal(false)}
              >
                Cancel
              </button>
              <button
                className="btn-primary"
                onClick={() => saveReportToPDF(saveAsPermanent)}
                disabled={isSaving}
              >
                {isSaving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {savedReport && (
        <ReportSavedDialog
          saved={savedReport}
          gameId={gameId}
          onClose={() => setSavedReport(null)}
        />
      )}
    </>
  );
}

/**
 * WHAT THE AI MADE OF ONE ROUND — or of a whole closed survey, whose read
 * is the report's round 000 (27 Sep 2026). One renderer for both, so a
 * survey's read prints exactly as a round's does.
 */
function ReportAISummary({ aiSummary }) {
  if (!aiSummary) return null;
  return (
    <div className="report-block report-ai-summary">
      <h3 className="report-block-heading">
        <Icon name="Sparkle" weight="duotone" size={16} color="var(--primary)" />AI Analysis
      </h3>

      <div className="report-ai-content">
        {aiSummary.markdownResponse ? (
          // Use Markdown renderer if available
          <MarkdownRenderer
            content={aiSummary.markdownResponse}
            className="report-ai-markdown"
          />
        ) : (
          // Fallback to structured display
          <>
            {/* Summary */}
            {aiSummary.summaryText && (
              <div className="report-ai-text">
                <h4>Summary</h4>
                {/* Same reason as the stage fallback: this text is
                    model output and carries markdown. */}
                <MarkdownRenderer content={aiSummary.summaryText} className="report-ai-markdown" />
              </div>
            )}

            {/* Conversation Starters */}
            {aiSummary.discussionQuestions && aiSummary.discussionQuestions.length > 0 && (
              <div className="report-ai-discussion">
                <h4>Conversation Starters</h4>
                <ul>
                  {aiSummary.discussionQuestions.map((discussionQuestion, idx) => (
                    <li key={idx}>{discussionQuestion}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Next Steps */}
            {aiSummary.nextSteps && aiSummary.nextSteps.length > 0 && (
              <div className="report-ai-steps">
                <h4>Next Steps</h4>
                <ul>
                  {aiSummary.nextSteps.map((step, idx) => (
                    <li key={idx}>{step}</li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/**
 * WHAT THE ROOM SAID ABOUT THIS ROUND'S REPORT, in a feedback
 * round. The owner: *"these will get added to the round report and
 * the over all report as well. clearly called out as comments."*
 *
 * CLEARLY CALLED OUT is done three ways, because this is the one
 * surface where the two kinds of prose sit closest together and
 * the reader may be holding a printout with no way to ask: its own
 * heading, its own class, and — on every comment — the SECTION it
 * is about. That last one is the load-bearing part here. A comment
 * in the session report is read a long way from the round it
 * belongs to, so "too internal" against nothing is not a comment.
 *
 * The label is the STORED one, never re-derived from the answers
 * array beside it. That is what keeps a comment readable after the
 * 7-day ANSWER rows expire and this report rebuilds with
 * `answers: []` — from that point the label and the excerpt are
 * the only surviving record of what was being discussed.
 *
 * Absent on every report built before this feature, so the guard
 * is a real case and not defensive habit.
 *
 * A closed survey's comments (27 Sep 2026) print here too, from its round
 * 000, and arrive with no `playerName` at all — create-report.js never
 * attributes a survey comment — so each reads as "Comment N".
 */
function ReportComments({ comments }) {
  if (!Array.isArray(comments) || comments.length === 0) return null;
  return (
    <div className="report-comments">
      <h3 className="report-block-heading">Comments</h3>
      {comments.map((comment, cIdx) => (
        <div key={comment.commentId || cIdx} className="report-comment report-keep">
          {comment.anchorLabel && (
            <div className="comment-on">On {comment.anchorLabel}</div>
          )}
          {/*
            THE EXCERPT — quoted material the comment is about, not
            the comment itself. In THIS report it is not optional
            polish: the label alone names a section ("Response 1 —
            Ada") that this document has no other way to show once
            the 7-day answer rows behind it have expired, and a
            session report is read further from the round it
            belongs to than the round report ever is. Absent on a
            comment stored before this field existed — `''`, never
            undefined, so this renders nothing rather than an empty
            quote.
          */}
          {comment.anchorExcerpt && (
            <div className="comment-excerpt">{comment.anchorExcerpt}</div>
          )}
          <blockquote className="comment-text">{comment.text}</blockquote>
          <div className="comment-meta">
            {/* `playerName` is ABSENT, never null, on a round the
                server redacted — so the fallback is a position,
                never a blank where a name should be. */}
            <span className="comment-author">
              {comment.playerName || `Comment ${cIdx + 1}`}
            </span>
            {/* The host put it on the wall during the round. */}
            {comment.featured === true && (
              <span className="comment-featured">Shown to the room</span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * THE DOCUMENT ITSELF — one <article>, one column, on screen and on paper.
 *
 * Split out from the shell so it takes a guaranteed-present `reportData`: the
 * shell's loading and error states have none, and a component that destructures
 * a payload it might not have is one `?.` away from a white screen.
 */
function ReportDocument({ reportData }) {
  const { gameId, eventTitle, players = [], questions = [], questionSetData } = reportData;

  /*
   * "ABOUT THIS SESSION" (Task 2 of the 2026-09-26 feature sweep).
   *
   * The owner: "for session report it would be nice to have it start with
   * event info if given ... what they are being asked to do in the
   * session." Two separate pieces, per the brief:
   *
   *   eventDetails    the session's own free text, verbatim (create-report.js
   *                   reads it off sessionMeta.Details/EngagementInfo).
   *   "What people were asked to do"   the session's details AND/OR the
   *                   question set's own description — the set's summary
   *                   when the set has one, the same session Details
   *                   otherwise (there is no second field to split them
   *                   into today).
   *
   * FIX ROUND 1 (a controller ruling, after the first review): the report
   * must never print the same sentence twice. `purposeText` still falls
   * back to `eventDetails` when the set has no description of its own — it
   * has to, for the case where the set DOES have one and it happens to read
   * identically — but `showPurpose` is gated on that text actually
   * DIFFERING from the eventDetails paragraph already shown above it. When
   * the set has no description, purposeText === eventDetails and the
   * "What people were asked to do" label is omitted rather than repeating
   * the same sentence under a second heading.
   */
  const eventDetails = String(reportData.eventDetails || '').trim();
  const setDescription = String((questionSetData && questionSetData.description) || '').trim();
  const purposeText = setDescription || eventDetails;
  const showAbout = Boolean(eventDetails || setDescription);
  const showPurpose = Boolean(purposeText) && purposeText !== eventDetails;

  /*
   * "WHO WAS HERE" — a roster of names only, in JOIN order.
   *
   * `players` is `playerPerformance`, already ordered by score for Final
   * Scores below; this is a different question ("who showed up", not "who
   * won") and reuses the same array rather than a second source of truth.
   * `joinedAt` is only on players reported after Task 2 shipped — a report
   * with none of it falls back to the array's own order rather than
   * throwing or reshuffling arbitrarily.
   *
   * This never reveals who answered what: a round run with hidden authors
   * still omits `playerName` on its own answers/comments exactly as it does
   * today (create-report.js's isHidden gate) — the roster is drawn from
   * PLAYER# rows (who joined), a fact anonymity was never about withholding.
   */
  const roster = players
    .slice()
    .sort((a, b) => {
      const at = a && a.joinedAt;
      const bt = b && b.joinedAt;
      if (!at || !bt) return 0;
      return at < bt ? -1 : at > bt ? 1 : 0;
    })
    .map((p) => p && (p.playerName || p.name))
    .filter(Boolean);

  /*
   * SURVEY RESULTS (Task 4 of the 2026-09-26 feature sweep): "this should
   * also be what the report shows, not who filled in the survey." `null`
   * for every game type but survey, and for a survey whose close has not
   * yet frozen anything (create-report.js's own comment on the field).
   */
  const isSurvey = reportData.gameType === 'survey';
  const surveyResults = reportData.surveyResults || null;
  // A closed survey's Workie read and the room's comments on it: the round
  // 000 entry create-report.js files for it, or null.
  const surveyRead = isSurvey
    ? questions.find((q) => String(q && q.questionNumber) === '000') || null
    : null;
  // `surveyNames` travels on its own even when `surveyResults` is still
  // null (a report requested before the survey has closed), so this reads
  // off it first and falls back to the frozen results' own copy.
  const surveyNamesId = isSurvey
    ? namesMode(reportData.surveyNames ?? (surveyResults && surveyResults.names)).id
    : null;

  /*
   * NO ROSTER BESIDE ANONYMOUS ANSWERS. "Who was here" says who JOINED —
   * a fact from the PLAYER# rows, unrelated to a survey's Names setting —
   * and that is exactly the problem for an Anonymous survey: with no
   * minimum group size (the owner's ruling), a small room's anonymous
   * open answers sitting next to a short, named roster invites guessing
   * who wrote what, even though nothing in the data actually links them.
   * Finished and Named surveys keep the roster, same as every other game
   * type — Named's own promise ("the wall, the shared link and the report
   * never show a name") is about the ANSWERS, not attendance, and a
   * Finished survey never linked a name to an answer to begin with.
   */
  const showRoster = roster.length > 0 && !(isSurvey && surveyNamesId === 'anonymous');

  /*
   * WHAT THIS REPORT COULD NOT RECONSTRUCT.
   *
   * The session outlives the rows it is made of. Answer and ballot rows expire
   * seven days after a session, results and AI summaries at thirty, the session
   * brief itself at ninety — so a retro opened three weeks later can be missing
   * the responses it is entirely about. create-report.js recovers what it can
   * from the stored snapshot and states what it could not
   * (lambda-functions/game/report-merge.js).
   *
   * Rendered IN THE DOCUMENT rather than in the screen toolbar, and deliberately
   * not `report-noprint`: this is a document a host hands a client, and a
   * caveat that does not reach the paper is not a caveat. It is absent on a
   * complete report and on any report written before the field existed —
   * a standing banner would be noise, and noise is ignored.
   */
  const caveat = reportData.reportCompleteness && !reportData.reportCompleteness.complete
    ? reportData.reportCompleteness
    : null;

  // Same round noun the live screens use. resolveRoundNoun() identifies an art
  // round by a non-empty `image`/`Image` on the question — art is not a game
  // type, so the artwork is the only signal. create-report.js projects `image`
  // onto questionData for exactly this; if it is ever absent the helper simply
  // falls back to the game type's noun, so the report degrades to "Round"
  // rather than breaking.
  const reportRoundNoun = (questionData) =>
    resolveRoundNoun(questionData, reportData.gameType, reportData.roundNoun);

  // The header counts the whole set, so it must not judge by question 1 alone —
  // a set whose first question happens to carry no image would be headed
  // "3 Rounds" while every row beneath it said "Artwork".
  const headerSampleQuestion =
    (questions || []).map((q) => q?.questionData).find((q) => (q?.image || q?.Image || '').trim())
    || questions?.[0]?.questionData;

  const printedOn = new Date().toLocaleDateString('en-US', LONG_DATE);
  // A survey has no `detailedQuestions` (it writes no QUESTION# rows at
  // all), so `questions.length` would head every survey report "0
  // Questions". Its own count lives on `surveyResults` instead — the same
  // noun ("Question", config/gameTypes.js) still resolves correctly with
  // no sample question to read an image off.
  const roundCount = isSurvey ? (surveyResults ? surveyResults.questions.length : 0) : questions.length;
  const roundsLabel = pluralRoundNoun(reportRoundNoun(headerSampleQuestion), roundCount);

  return (
    <>

    <article className="report-doc">

      {/* ---- TITLE BLOCK ---------------------------------------------- */}
      <header className="report-titleblock report-keep">
        <p className="report-eyebrow">Session Report</p>
        <h1 className="report-title">{eventTitle}</h1>
        <p className="report-date">{printedOn}</p>

        <dl className="report-meta">
          <div className="report-meta-item">
            <dt>Session</dt>
            <dd>{gameId}</dd>
          </div>
          <div className="report-meta-item">
            <dt>{players.length === 1 ? 'Participant' : 'Participants'}</dt>
            <dd>{players.length}</dd>
          </div>
          <div className="report-meta-item">
            <dt>{roundsLabel}</dt>
            <dd>{roundCount}</dd>
          </div>
        </dl>
      </header>

      {/* ---- ABOUT THIS SESSION & WHO WAS HERE — Task 2's front matter ----
          Under the title, before the caveat and the rounds, per the owner's
          own ask. Both are `report-keep`, like the caveat below: short
          front-matter blocks that must never be split by a page break,
          unlike Final Scores which is allowed to run across one. Task 4's
          survey section attaches beneath this pair without touching it. */}
      {showAbout && (
        <section className="report-about report-keep">
          <header className="report-question-header">
            <p className="report-section-index">
              <span className="report-section-number">Session</span>
            </p>
            <h2 className="report-lesson-heading">About this session</h2>
          </header>
          {eventDetails && (
            <p className="report-lesson-detail">{eventDetails}</p>
          )}
          {showPurpose && (
            <div className="report-block report-about-purpose">
              <h3 className="report-block-heading">What people were asked to do</h3>
              <p>{purposeText}</p>
            </div>
          )}
        </section>
      )}

      {showRoster && (
        <section className="report-roster report-keep">
          <header className="report-question-header">
            <p className="report-section-index">
              <span className="report-section-number">Attendance</span>
            </p>
            <h2 className="report-lesson-heading">Who was here</h2>
          </header>
          <ol className="report-roster-list">
            {roster.map((name, idx) => (
              <li key={`${name}-${idx}`} className="report-roster-item">{name}</li>
            ))}
          </ol>
        </section>
      )}

      {/* ---- CAVEAT, when the record is not whole ----------------------- */}
      {caveat && (
        <aside className="report-caveat report-keep" role="note">
          <p className="report-caveat-label">Incomplete record</p>
          <p className="report-caveat-note">{caveat.note}</p>
        </aside>
      )}

      {/* ---- ROUNDS, or a survey's results ------------------------------ */}
      <div className="report-content">
        {isSurvey ? (
          /*
            SURVEY RESULTS (Task 4): the same KindResult cards Task 3 built
            for the console (SurveyResultsPanel), mounted here unchanged —
            "props in, markup out" (KindResult's own contract) is exactly
            what lets the identical component render correctly under this
            document's data-theme="light" with no code of its own. No
            `onOpenAnswers` is passed: a text question has no "Read all N"
            link, which is the right shape for a document rather than a
            console with a place to click through to. `full` IS passed
            (fix I-1, 2026-09-26 final review): the owner's binding ruling is
            that the saved report shows every open answer, even under 5, so
            this document cannot inherit TextResult's console preview of 3 —
            it has no click-through to see the rest. `null` — a survey that
            has not closed yet — renders nothing further; the front matter
            above is still a complete document as far as it goes.
          */
          <>
          {/*
            THE WORKIE'S READ OF THE SURVEY, AND WHAT THE ROOM SAID ABOUT IT
            (27 Sep 2026). A closed survey's read and its feedback round live
            at round 000 (get-ai-summary.js, comments.js), which create-report
            files as the one entry a survey has in `detailedQuestions`. First,
            as the mockup puts it (docs/design/survey-redesign/34-report.html:
            "Workie's read" above the questions) — the conclusion leads, the
            charts are the evidence beneath it. The same two renderers a round
            uses, so the two cannot print a read differently.
          */}
          {surveyRead && (surveyRead.aiSummary || (surveyRead.comments || []).length > 0) && (
            <section className="report-question report-survey-read">
              <header className="report-question-header">
                <p className="report-section-index">
                  <span className="report-section-number">Workie&rsquo;s read</span>
                </p>
                <h2 className="report-lesson-heading">What we heard</h2>
              </header>
              <ReportAISummary aiSummary={surveyRead.aiSummary} />
              <ReportComments comments={surveyRead.comments} />
            </section>
          )}
          {surveyResults && surveyResults.questions.length > 0 && (
            <section className="report-question report-survey-results">
              <header className="report-question-header">
                <p className="report-section-index">
                  <span className="report-section-number">Results</span>
                </p>
                <h2 className="report-lesson-heading">Survey results</h2>
              </header>
              <div className="report-survey-grid">
                {surveyResults.questions.map((q) => (
                  <div key={q.qid} className="report-keep report-survey-card">
                    <KindResult question={q} full />
                  </div>
                ))}
              </div>
            </section>
          )}
          </>
        ) : (
        <>
        {questions.map((question, qIdx) => {
          // Extract question data from backend format
          const questionNumber = question.questionNumber;
          const questionData = question.questionData || {};
          const questionAnswers = question.answers || [];
          const aiSummary = question.aiSummary;
          const noun = reportRoundNoun(questionData);

          return (
            <section key={questionNumber} className="report-question">
              <header className="report-question-header">
                <p className="report-section-index">
                  <span className="report-section-number">{noun} {qIdx + 1}</span>
                  <span className="field-badge">{questionData.category || 'General'}</span>
                </p>
                <h2 className="report-lesson-heading">
                  {questionData.title || `${noun} ${questionNumber}`}
                </h2>
              </header>

              {questionData.detail && (
                <p className="report-lesson-detail">
                  {questionData.detail}
                </p>
              )}

              {/* Trivia Question Options - show choices with correct answer marked */}
              {reportData.gameType === 'trivia' && (
                <div className="report-block report-trivia-choices">
                  <h3 className="report-block-heading">Answer choices</h3>
                  <ul className="trivia-options-report">
                    {OPTION_LETTERS.map(letter => {
                      const optionText = questionData[`option${letter}`];
                      if (!optionText) return null;

                      // Check if this option is the correct answer
                      const correctAnswer = questionData.correctAnswer || questionData.CorrectAnswer;
                      const isCorrect = correctAnswer === `Option${letter}` || correctAnswer === optionText;

                      return (
                        <li
                          key={letter}
                          className={`trivia-option-report report-keep ${isCorrect ? 'correct-answer' : ''}`}
                        >
                          <span className="option-letter">{letter}</span>
                          <span className="option-text">{optionText}</span>
                          {isCorrect && (
                            <span className="correct-indicator">
                              <Icon name="CheckCircle" weight="fill" size={14} color="var(--success)" /> Correct
                            </span>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}

              {/* AI Summary for this question */}
              <ReportAISummary aiSummary={aiSummary} />

              <div className="report-answers">
                <h3 className="report-block-heading">Player applications</h3>
                {questionAnswers.length > 0 ? (
                  questionAnswers.map((answer, aIdx) => (
                    <div
                      key={aIdx}
                      className={`report-answer report-keep ${answer.rank <= 3 ? 'winner' : ''}`}
                    >
                      <blockquote className="answer-text">{answer.answerText}</blockquote>
                      <div className="answer-meta">
                        {answer.rank <= 3 && (
                          <span className="winner-badge">{answer.rankDisplay}</span>
                        )}
                        <span className="answer-author">{answer.playerName}</span>
                        <span className="answer-points">{answer.totalScore} point{answer.totalScore !== 1 ? 's' : ''}</span>
                        <span className="answer-breakdown">{answer.voteBreakdown}</span>
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="no-answers">No answers recorded for this question.</p>
                )}
              </div>

              <ReportComments comments={question.comments} />
            </section>
          );
        })}

        <section className="report-final-scores">
          <header className="report-question-header">
            <p className="report-section-index">
              <span className="report-section-number">Standings</span>
            </p>
            <h2 className="report-lesson-heading">Final Scores</h2>
          </header>
          <ol className="score-grid">
            {(() => {
              // Map backend player data to expected format for calculatePlayerRankings
              const playersWithScore = players.map(player => ({
                ...player,
                name: player.playerName || player.name,
                score: player.totalScore || player.score || 0
              }));

              const rankedPlayers = calculatePlayerRankings(playersWithScore);
              const highestScore = rankedPlayers[0]?.score || 0;

              return rankedPlayers.map((player) => {
                const isChampion = (player.score || 0) === highestScore;
                return (
                  <li
                    key={player.name}
                    className={`score-item report-keep ${isChampion ? 'champion' : ''}`}
                  >
                    <span className="score-rank"><RankIcon rank={player.rank} size={16} /> {player.rank}</span>
                    <span className="player-name">{player.name}</span>
                    {isChampion && (
                      <span className="champion-badge">
                        <Icon name="Trophy" weight="duotone" size={14} color="var(--primary)" /> Session Champion
                      </span>
                    )}
                    <span className="player-final-score">{player.score || 0}</span>
                  </li>
                );
              });
            })()}
          </ol>
        </section>
        </>
        )}

        {/* The document has to end somewhere, and a page that just stops is the
            tell of a screenshot. The running foot identifies the sheet; this
            says the sheet is the last one. Print only. */}
        <p className="report-colophon" aria-hidden="true">End of report</p>
      </div>
    </article>
    </>
  );
}

export { ReportDocument };
export default GameReport;
