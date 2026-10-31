// skin-allowance: colour=6
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
 * this to a client after the session. One component draws it on screen, on
 * Print, and in the saved PDF (utils/saveReport.js).
 *
 * THE REFRESH (2026-10-31, docs/design/report-refresh/). The owner: "the PDF
 * version title sections could use a real design refresh, to match the
 * professional look that we have given the site." What it found first was a
 * bug, not a taste question: html2pdf clones `.report-doc` OUT of its
 * `.report-container.report-paper` parent before drawing it, so every rule
 * GameReport.css scoped under `.report-paper` missed the PDF, and the old
 * single-class report rules in styles.css drew it instead — yellow gradient
 * cards, emoji medals, "The taskHow could you…" run together. Two changes keep
 * that from coming back, and gameReport.test.jsx holds both:
 *
 *   1. The <article> carries its own scope. `report-paper` and
 *      `data-theme="light"` are on the article itself, and every document rule
 *      in GameReport.css is rooted at `.report-doc`, so a clone taken anywhere
 *      still matches its own stylesheet.
 *   2. The document's classes are its own (`rpt-*`). A class styles.css also
 *      styles is a leak waiting for the next clone; the test lists every class
 *      this file renders and fails on one the global sheet declares.
 *
 * The CONTENT is the same as before the refresh — every field that was on the
 * page is still on the page — with three additions the server already sent:
 * the session's date (not the day the report was built), the host's name, and
 * the scoring that the appendix explains.
 */
import React, { useEffect, useState } from 'react';
import Icon from './Icon';
import HelpButton from './HelpButton';
import { helpFor } from '../config/help/screens';
import StatusMessage from './StatusMessage';
import MarkdownRenderer from './MarkdownRenderer';
import ReportFollowUps from './ReportFollowUps';
import ReportLate from './ReportLate';
import ReportSavedDialog from './ReportSavedDialog';
import { BRAND_MARK_PATH } from './BrandMark';
import { saveReportPdf } from '../utils/saveReport';
import { resolveRoundNoun, pluralRoundNoun, resolveInstruction } from '../config/instructions';
import { plainOf } from '../config/comments';
import { calculatePlayerRankings } from '../config/podium';
import { namesMode } from '../config/surveyNames';
import { gameTypeLabel } from '../config/gameTypes';
import KindResult from './survey/results/KindResult';
import TalkingPointsReport from './TalkingPointsReport';
import { unexpectedSaveMessage } from '../config/reportPdf';
import './GameReport.css';

const API_BASE = window.API_BASE;

/** Trivia answer slots, in display order. */
const OPTION_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];

/** A cover dek longer than this would push the cover past one page; it prints under About instead. */
const COVER_DEK_MAX = 240;

/* ---------------------------------------------------------------------------
   FACTS THE COVER, THE RUNNING FOOT AND THE APPENDIX SHARE
   --------------------------------------------------------------------------- */

const validDate = (value) => {
  if (!value) return null;
  const d = new Date(value);
  return Number.isFinite(d.getTime()) ? d : null;
};

/**
 * The day the session was HELD: when play started, else when it was created.
 * Never the day the report was built — that printed a retro opened on Friday
 * as if the session had run on Friday. Null when the payload carries neither
 * (a report from before GameHostPage forwarded them), and the cover then says
 * nothing rather than something false.
 */
export function sessionDateOf(reportData) {
  return validDate(reportData && reportData.startedAt) || validDate(reportData && reportData.createdAt);
}

/** "28 October 2026". */
export const longDate = (d) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
const weekday = (d) => d.toLocaleDateString('en-GB', { weekday: 'long' });

/** The host's name as typed, or '' — create-report.js sends "Unknown Host" when there is none. */
export function hostNameOf(reportData) {
  const name = String((reportData && reportData.hostName) || '').trim();
  return name && name !== 'Unknown Host' ? name : '';
}

/** What utils/saveReport.js stamps in the head and foot of every page after the cover. */
export function runningFor(reportData) {
  const held = sessionDateOf(reportData);
  return {
    kind: 'Session report',
    title: (reportData && reportData.eventTitle) || 'Engagements Session',
    footLeft: [`Session ${reportData && reportData.gameId}`, held ? longDate(held) : ''].filter(Boolean).join(' · '),
    cover: true,
  };
}

/** How each format is played, for the cover's Format fact. */
const HOW_PLAYED = {
  'call-and-answer': 'answer, then vote for a top three',
  trivia: 'one right answer per question',
  poll: 'answers counted live',
  survey: 'questions answered on phones',
  wavelength: 'a word cloud per round',
};

/** "5 first · 2 second · 1 third" from the counts, else the server's own sentence. */
function breakdownOf(answer) {
  const [f, s, t] = [answer.firstPlace, answer.secondPlace, answer.thirdPlace];
  if ([f, s, t].every((n) => Number.isFinite(n))) return `${f} first · ${s} second · ${t} third`;
  return String(answer.voteBreakdown || '').trim();
}

const pointsWord = (n) => (n === 1 ? 'point' : 'points');
const pad2 = (n) => String(n).padStart(2, '0');

/* ---------------------------------------------------------------------------
   MARKS — inline paths only. html2canvas does not draw an SVG <use>, and an
   icon drawn as a data-URI is rasterised outside the cascade, so its
   var(--primary) never resolves (README §1, constraints 6 and 7).
   --------------------------------------------------------------------------- */

function MountainMark({ className = 'rpt-mark' }) {
  return (
    <svg className={className} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <path d={BRAND_MARK_PATH} fill="#F6A94C" />
    </svg>
  );
}

function SparkleMark() {
  return (
    <svg className="rpt-workie-mark" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M12 2 L14.2 9.8 L22 12 L14.2 14.2 L12 22 L9.8 14.2 L2 12 L9.8 9.8 Z" fill="#0F1A2E" />
    </svg>
  );
}

/** The right answer's tick, beside the word "Correct" — never colour alone. */
function TickMark() {
  return (
    <svg className="rpt-tick" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d="M3 8.5 L6.5 12 L13 4.5" fill="none" stroke="#1B2942" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Ridge() {
  return (
    <svg className="rpt-ridge" viewBox="0 0 504 46" preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <path d="M0 45 L40 30 L64 36 L98 14 L124 36 L170 36 L196 40 L230 30 L262 38 L300 18 L322 28 L352 10 L390 40 L428 26 L452 33 L478 20 L504 45" fill="none" stroke="#1B2942" strokeWidth="0.9" vectorEffect="non-scaling-stroke" />
      <path d="M118 45 L136 18 L146 31 L158 4 L176 45 Z" fill="#F6A94C" stroke="#FFFFFF" strokeWidth="4" paintOrder="stroke" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** One label shape for every section: an amber tick, tracked caps, an optional quiet half. */
function Kicker({ children, quiet = null, className = '' }) {
  return (
    <p className={`rpt-kick ${className}`.trim()}>
      <span className="rpt-kick-main">{children}</span>
      {quiet && <><span className="rpt-kick-sep" aria-hidden="true">/</span><span className="rpt-kick-quiet">{quiet}</span></>}
    </p>
  );
}

/** The label over a block inside a round: title left, a count right, a rule under both. */
function SubHead({ title, note = '' }) {
  return (
    <h3 className="rpt-sub">
      <span className="rpt-sub-title">{title}</span>
      {note && <span className="rpt-sub-note">{note}</span>}
    </h3>
  );
}

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
  // A one-line reason the host is looking at this report without having asked
  // for it — e.g. "This session has ended. Here is its report." Never printed.
  notice = '',
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
   * REPEATING IDENTIFICATION ON PRINTED PAGES 2+, and why it is done from here.
   *
   * A running head inside the document is not available to Print. `@page`
   * margin boxes are implemented by nobody, and `position: fixed` repeats but
   * is laid out MODULO the page's content height, so it collides with the
   * text. The browser's own print header is in the margin, is on by default,
   * and prints `document.title` on every page — so the title is what gets set.
   * (The saved PDF is different: utils/saveReport.js stamps its own head and
   * foot onto each page with jsPDF after slicing.)
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
      // document and nothing else — and it carries its own scope, so the clone
      // html2pdf takes of it is still drawn by GameReport.css.
      const element = document.querySelector('.report-doc');

      // Drawn and kept by utils/saveReport.js — the one save every report
      // uses (a Build Room's too, since 2026-10-04): sized to what AWS
      // carries, refusals in the host's words, head and foot on every page.
      const result = await saveReportPdf({
        element, gameId, title: eventTitle, permanent, apiBase: API_BASE,
        running: runningFor(reportData),
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
        projector palette — and a report is paper. The article below repeats
        it, because the saved PDF draws a clone of the article on its own. */}
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
          {/* The reporting guide's report section (Help Phase 3). Last in
              the tools, after the primary; on screen only, like them. */}
          <HelpButton {...helpFor('host-session-report')} variant="inline" size="small" tooltip="Help: the session report" className="help-button-quiet" />
        </div>
      </div>

      {notice && (
        <div className="report-noprint">
          <StatusMessage message={notice} tone="success" className="status-message report-notice" />
        </div>
      )}

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
 * WORKIE'S READ — what the AI made of one round, or of a whole closed survey,
 * whose read is the report's round 000 (27 Sep 2026). One renderer for both.
 *
 * A framed panel with a dusk bar and its own label, because it is a different
 * voice from the rest of the document: a machine's reading of the room, not
 * the host's. The tint is optional ink — with background graphics off, the
 * frame, the bar and the words "AI analysis" still set it apart.
 */
function ReportAISummary({ aiSummary }) {
  if (!aiSummary) return null;
  return (
    <section className="rpt-workie report-keep" aria-label="Workie's read">
      <div className="rpt-workie-head">
        <SparkleMark />
        <span className="rpt-workie-title">Workie&rsquo;s read</span>
        <span className="rpt-workie-who">AI analysis of the responses, not the host&rsquo;s words</span>
      </div>

      <div className="rpt-workie-body">
        {aiSummary.markdownResponse ? (
          <MarkdownRenderer
            content={aiSummary.markdownResponse}
            className="rpt-md"
          />
        ) : (
          <>
            {aiSummary.summaryText && (
              <div className="rpt-workie-part">
                <h4 className="rpt-workie-label">Summary</h4>
                {/* Same reason as the stage fallback: this text is
                    model output and carries markdown. */}
                <MarkdownRenderer content={aiSummary.summaryText} className="rpt-md" />
              </div>
            )}

            {aiSummary.discussionQuestions && aiSummary.discussionQuestions.length > 0 && (
              <div className="rpt-workie-part">
                <h4 className="rpt-workie-label">Conversation starters</h4>
                <ol className="rpt-workie-list rpt-workie-list--numbered">
                  {aiSummary.discussionQuestions.map((discussionQuestion, idx) => (
                    <li key={idx}>{discussionQuestion}</li>
                  ))}
                </ol>
              </div>
            )}

            {aiSummary.nextSteps && aiSummary.nextSteps.length > 0 && (
              <div className="rpt-workie-part">
                <h4 className="rpt-workie-label">Next steps</h4>
                <ul className="rpt-workie-list rpt-workie-list--steps">
                  {aiSummary.nextSteps.map((step, idx) => (
                    <li key={idx}>{step}</li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}

/**
 * WHAT THE ROOM SAID ABOUT THIS ROUND'S REPORT, in a feedback round. The
 * owner: *"these will get added to the round report and the over all report
 * as well. clearly called out as comments."*
 *
 * CLEARLY CALLED OUT by SHAPE, not colour: its own heading, an indent behind a
 * rule, and — on every comment — the SECTION it is about. The label is the
 * STORED one, never re-derived from the answers beside it, so a comment stays
 * readable after the 7-day answer rows expire and the report rebuilds with
 * `answers: []`.
 *
 * A closed survey's comments (27 Sep 2026) print here too, from its round
 * 000, and arrive with no `playerName` at all — create-report.js never
 * attributes a survey comment — so each reads as "Comment N".
 */
function ReportComments({ comments }) {
  if (!Array.isArray(comments) || comments.length === 0) return null;
  const note = `${comments.length} ${comments.length === 1 ? 'comment' : 'comments'} on this round’s results`;
  const one = (comment, cIdx) => (
    <div key={comment.commentId || cIdx} className="report-comment report-keep">
      {comment.anchorLabel && (
        <div className="comment-on">On {comment.anchorLabel}</div>
      )}
      {/* THE EXCERPT — quoted material the comment is about. Absent on a
          comment stored before this field existed — `''`, never undefined,
          so this renders nothing rather than an empty quote. */}
      {comment.anchorExcerpt && (
        <div className="comment-excerpt">{plainOf(comment.anchorExcerpt)}</div>
      )}
      <blockquote className="comment-text">{comment.text}</blockquote>
      <div className="comment-meta">
        {/* `playerName` is ABSENT, never null, on a round the server
            redacted — so the fallback is a position, never a blank. */}
        <span className="comment-author">
          {comment.playerName || `Comment ${cIdx + 1}`}
        </span>
        {/* The host put it on the wall during the round. */}
        {comment.featured === true && (
          <span className="comment-featured">Shown to the room</span>
        )}
      </div>
    </div>
  );
  return (
    <div className="report-comments">
      {/* The heading travels with the first comment: a label stranded at the
          foot of a page over a blank is a printing fault. */}
      <div className="rpt-keepnext report-keep">
        <SubHead title="Comments" note={note} />
        {one(comments[0], 0)}
      </div>
      {comments.slice(1).map((c, i) => one(c, i + 1))}
    </div>
  );
}

/**
 * WHAT THE ROOM SAID — the responses, ranked. Points as a number AND a bar,
 * the top one marked in words ("Top-voted"), so the order survives a
 * greyscale printer. No emoji medals: the rank numeral already carries the
 * rank, and `rankDisplay` (create-report.js) is not printed.
 */
function ReportResponses({ answers, scoring }) {
  const voted = answers.some((a) => (a.totalScore || 0) > 0);
  const top = voted ? Math.max(...answers.map((a) => a.totalScore || 0)) : 0;
  const scale = scoring
    ? [scoring.firstPlacePoints, scoring.secondPlacePoints, scoring.thirdPlacePoints].filter((n) => Number.isFinite(n))
    : [];
  const note = [
    `${answers.length} ${answers.length === 1 ? 'response' : 'responses'}`,
    voted && scale.length === 3 ? `${scale.join(' / ')} points` : '',
  ].filter(Boolean).join(' · ');

  const row = (answer, aIdx) => {
    const score = answer.totalScore || 0;
    const isTop = voted && answer.rank === 1 && score > 0;
    const breakdown = voted ? breakdownOf(answer) : '';
    return (
      <div key={aIdx} className={`rpt-resp report-keep${isTop ? ' rpt-resp--top' : ''}${voted ? '' : ' rpt-resp--unvoted'}`}>
        <span className="rpt-resp-rank">{voted ? answer.rank : aIdx + 1}</span>
        <div className="rpt-resp-main">
          <blockquote className="rpt-resp-text">{answer.answerText}</blockquote>
          <div className="rpt-resp-meta">
            {isTop && <span className="rpt-flag">Top-voted</span>}
            {/* Empty, never absent, on a hidden-author round: the slot is
                there and says nothing (create-report.js's isHidden gate). */}
            <span className="rpt-resp-author">{answer.playerName || ''}</span>
            {breakdown && <span className="rpt-resp-breakdown">{breakdown}</span>}
          </div>
        </div>
        {voted && (
          <span className="rpt-resp-pts">
            <span className="rpt-resp-pts-n">{score}</span>
            <span className="rpt-resp-pts-l">{pointsWord(score)}</span>
          </span>
        )}
        {voted && (
          <span className="rpt-resp-bar" aria-hidden="true">
            <i style={{ width: `${top > 0 ? Math.round((score / top) * 100) : 0}%` }} />
          </span>
        )}
      </div>
    );
  };

  if (answers.length === 0) {
    return (
      <div className="rpt-responses">
        <div className="rpt-keepnext report-keep">
          <SubHead title="What the room said" />
          <p className="rpt-empty">No answers recorded for this question.</p>
        </div>
      </div>
    );
  }
  return (
    <div className="rpt-responses">
      <div className="rpt-keepnext report-keep">
        <SubHead title="What the room said" note={note} />
        {row(answers[0], 0)}
      </div>
      {answers.slice(1).map((a, i) => row(a, i + 1))}
    </div>
  );
}

/**
 * THE COVER — page one of the PDF, and the head of the sheet on screen.
 * Leads with the result: the counts, and the top-voted response with its
 * points (or the session champion where nothing was voted on).
 */
function ReportCover({ reportData, roundCount, roundsLabel, responseCount, topResponse, champion, dek }) {
  const held = sessionDateOf(reportData);
  const host = hostNameOf(reportData);
  const format = gameTypeLabel(reportData.gameType);
  const how = HOW_PLAYED[reportData.gameType] || '';
  const setTitle = String((reportData.questionSetData && (reportData.questionSetData.category || reportData.questionSetData.title)) || '').trim();
  const players = reportData.players || [];
  const generated = longDate(new Date());

  return (
    <header className="rpt-cover" data-pdf-part="cover">
      <div className="rpt-cover-top">
        <span className="rpt-brand">
          <span className="rpt-brand-tab"><MountainMark className="rpt-brand-mark" /></span>
          <span className="rpt-brand-word">Engage</span>
        </span>
        <span className="rpt-cover-doc">
          <b>Session report</b>
          <span>Session {reportData.gameId}</span>
        </span>
      </div>

      <div className="rpt-cover-ridge"><Ridge /></div>

      <Kicker quiet={setTitle || null}>{format}</Kicker>
      <h1 className="rpt-cover-title">{reportData.eventTitle}</h1>
      {dek && <p className="rpt-cover-dek">{dek}</p>}

      <dl className="rpt-facts">
        {held && (
          <div className="rpt-fact">
            <dt>Held</dt>
            <dd>{weekday(held)}<br />{longDate(held)}</dd>
          </div>
        )}
        {host && (
          <div className="rpt-fact">
            <dt>Hosted by</dt>
            <dd>{host}</dd>
          </div>
        )}
        <div className="rpt-fact">
          <dt>Format</dt>
          <dd>{format}{how && <><br /><span className="rpt-fact-quiet">{how}</span></>}</dd>
        </div>
      </dl>

      <div className="rpt-cover-spacer" />

      <div className="rpt-strip">
        <div className="rpt-strip-count">
          <span className="rpt-strip-n">{players.length}</span>
          <span className="rpt-strip-l">{players.length === 1 ? 'Person' : 'People'}</span>
        </div>
        <div className="rpt-strip-count">
          <span className="rpt-strip-n">{roundCount}</span>
          <span className="rpt-strip-l">{roundsLabel}</span>
        </div>
        {responseCount > 0 && (
          <div className="rpt-strip-count">
            <span className="rpt-strip-n">{responseCount}</span>
            <span className="rpt-strip-l">{responseCount === 1 ? 'Response' : 'Responses'}</span>
          </div>
        )}
        {topResponse ? (
          <div className="rpt-strip-key">
            <span className="rpt-strip-l">Top-voted response</span>
            <span className="rpt-strip-q">{topResponse.text}</span>
            <span className="rpt-strip-s">{topResponse.where}</span>
          </div>
        ) : champion ? (
          <div className="rpt-strip-key">
            <span className="rpt-strip-l">Session champion</span>
            <span className="rpt-strip-q">{champion.name}</span>
            <span className="rpt-strip-s">{champion.score} {pointsWord(champion.score)}</span>
          </div>
        ) : null}
      </div>

      <p className="rpt-cover-foot">
        <span>Prepared with Engage</span>
        <span>Generated {generated}</span>
      </p>
    </header>
  );
}

/**
 * THE DOCUMENT ITSELF — one <article>, one column, on screen and on paper.
 *
 * Split out from the shell so it takes a guaranteed-present `reportData`: the
 * shell's loading and error states have none, and a component that destructures
 * a payload it might not have is one `?.` away from a white screen.
 *
 * Its top-level children are the PDF's units: the cover (`data-pdf-part`) is
 * drawn as its own page, and every `data-pdf-block` is a place the save may
 * start a new canvas when a long report would pass the 32,000 px ceiling
 * (utils/saveReport.js `partsFor`).
 */
function ReportDocument({ reportData }) {
  const { players = [], questions = [], questionSetData } = reportData;

  /*
   * "ABOUT THIS SESSION" (Task 2 of the 2026-09-26 feature sweep): the
   * session's own free text, and what people were asked to do — the set's
   * description when it has one. The report never prints the same sentence
   * twice: the purpose column shows only when it DIFFERS from the details,
   * and short details sit on the cover as its standfirst instead of here.
   */
  const eventDetails = String(reportData.eventDetails || '').trim();
  const setDescription = String((questionSetData && questionSetData.description) || '').trim();
  const purposeText = setDescription || eventDetails;
  const showPurpose = Boolean(purposeText) && purposeText !== eventDetails;
  const dek = eventDetails && eventDetails.length <= COVER_DEK_MAX ? eventDetails : '';
  const aboutDetails = eventDetails && !dek ? eventDetails : '';
  // Omitted when its only words already went on the cover.
  const showAbout = Boolean(aboutDetails || showPurpose);

  /*
   * "WHO WAS HERE" — a roster of names only, in JOIN order. `players` is
   * ordered by score for the standings; this is a different question ("who
   * showed up", not "who won"). `joinedAt` is only on players reported after
   * Task 2 shipped — without it the array's own order stands. Never reveals
   * who answered what: a hidden-author round still omits `playerName`.
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
   * SURVEY RESULTS (Task 4): `null` for every game type but survey, and for a
   * survey whose close has not yet frozen anything.
   */
  const isSurvey = reportData.gameType === 'survey';
  const surveyResults = reportData.surveyResults || null;
  const surveyRead = isSurvey
    ? questions.find((q) => String(q && q.questionNumber) === '000') || null
    : null;
  const surveyNamesId = isSurvey
    ? namesMode(reportData.surveyNames ?? (surveyResults && surveyResults.names)).id
    : null;

  /*
   * NO ROSTER BESIDE ANONYMOUS ANSWERS: with no minimum group size, a small
   * room's anonymous open answers next to a short named roster invites
   * guessing. Finished and Named surveys keep it, as every other type does.
   */
  const showRoster = roster.length > 0 && !(isSurvey && surveyNamesId === 'anonymous');

  /*
   * WHAT THIS REPORT COULD NOT RECONSTRUCT (report-merge.js). In the document,
   * not the toolbar, and not `report-noprint`: a caveat that does not reach
   * the paper is not a caveat. Absent on a complete report.
   */
  const caveat = reportData.reportCompleteness && !reportData.reportCompleteness.complete
    ? reportData.reportCompleteness
    : null;

  // Same round noun the live screens use (an art round is known by its image).
  const reportRoundNoun = (questionData) =>
    resolveRoundNoun(questionData, reportData.gameType, reportData.roundNoun);

  // The cover counts the whole set, so it must not judge by question 1 alone.
  const headerSampleQuestion =
    (questions || []).map((q) => q?.questionData).find((q) => (q?.image || q?.Image || '').trim())
    || questions?.[0]?.questionData;

  // A survey has no QUESTION# rows; its own count lives on `surveyResults`.
  const roundCount = isSurvey ? (surveyResults ? surveyResults.questions.length : 0) : questions.length;
  const roundsLabel = pluralRoundNoun(reportRoundNoun(headerSampleQuestion), roundCount);

  const responseCount = isSurvey ? 0 : questions.reduce((n, q) => n + ((q && q.answers) || []).length, 0);

  // The cover's key result: the best-scored response anywhere in the session.
  let topResponse = null;
  if (!isSurvey) {
    questions.forEach((q, qIdx) => {
      ((q && q.answers) || []).forEach((a) => {
        const score = a.totalScore || 0;
        if (score > 0 && (!topResponse || score > topResponse.score)) {
          const firsts = Number.isFinite(a.firstPlace) && a.firstPlace > 0
            ? ` · ${a.firstPlace} first-choice ${a.firstPlace === 1 ? 'vote' : 'votes'}` : '';
          topResponse = {
            score,
            text: `“${a.answerText}”`,
            where: `${reportRoundNoun(q.questionData)} ${qIdx + 1} · ${score} ${pointsWord(score)}${firsts}`,
          };
        }
      });
    });
  }

  const rankedPlayers = isSurvey ? [] : calculatePlayerRankings(players.map((player) => ({
    ...player,
    name: player.playerName || player.name,
    score: player.totalScore || player.score || 0,
  })));
  const highestScore = rankedPlayers[0]?.score || 0;
  const champion = highestScore > 0 ? rankedPlayers[0] : null;

  const isTrivia = reportData.gameType === 'trivia';
  const scoring = reportData.scoringConfig || null;
  const anyRead = questions.some((q) => q && q.aiSummary);
  const anyComments = questions.some((q) => q && Array.isArray(q.comments) && q.comments.length > 0);
  const anyVoted = questions.some((q) => ((q && q.answers) || []).some((a) => (a.totalScore || 0) > 0));
  const built = longDate(new Date());

  return (
    <article className="report-doc report-paper" data-theme="light">

      <ReportCover
        reportData={reportData}
        roundCount={roundCount}
        roundsLabel={roundsLabel}
        responseCount={responseCount}
        topResponse={topResponse}
        champion={champion}
        dek={dek}
      />

      {/* ---- ABOUT THIS SESSION ------------------------------------------ */}
      {showAbout && (
        <section className="report-about report-keep" data-pdf-block="">
          <Kicker>About this session</Kicker>
          <h2 className="rpt-h-section">What the room was asked to do</h2>
          <div className="rpt-about-cols">
            {aboutDetails && (
              <div className="rpt-about-col">
                <p className="rpt-about-text">{aboutDetails}</p>
                <p className="rpt-source">From the session&rsquo;s details</p>
              </div>
            )}
            {showPurpose && (
              <div className="rpt-about-col report-about-purpose">
                <p className="rpt-about-text">{purposeText}</p>
                <p className="rpt-source">From the question set&rsquo;s description</p>
              </div>
            )}
          </div>
        </section>
      )}

      {/* ---- WHO WAS HERE ------------------------------------------------- */}
      {showRoster && (
        <section className="report-roster report-keep" data-pdf-block="">
          <Kicker quiet={`${roster.length} ${roster.length === 1 ? 'person' : 'people'}, in the order they joined`}>Who was here</Kicker>
          <ol className="rpt-roster-list">
            {roster.map((name, idx) => (
              <li key={`${name}-${idx}`} className="report-roster-item">{name}</li>
            ))}
          </ol>
        </section>
      )}

      {/* ---- CAVEAT, when the record is not whole ----------------------- */}
      {caveat && (
        <aside className="report-caveat report-keep" role="note" data-pdf-block="">
          <p className="report-caveat-label">Incomplete record</p>
          <p className="report-caveat-note">{caveat.note}</p>
        </aside>
      )}

      {/* ---- WHAT "INCLUDE ITEMS NOT REVIEWED" LEFT OUT (late-labels.js) -- */}
      {reportData.notReviewedLeftOut && reportData.notReviewedLeftOut.line && (
        <p className="report-left-out report-keep" role="note" data-pdf-block="">{reportData.notReviewedLeftOut.line}</p>
      )}

      {isSurvey ? (
        <>
          {/* THE WORKIE'S READ OF THE SURVEY first, as the survey report
              mockup puts it (docs/design/survey-redesign/34-report.html): the
              conclusion leads, the charts are the evidence beneath it. */}
          {surveyRead && (surveyRead.aiSummary || (surveyRead.comments || []).length > 0) && (
            <section className="rpt-section report-survey-read" data-pdf-block="">
              <div className="rpt-keepnext report-keep">
                <Kicker>Workie&rsquo;s read</Kicker>
                <h2 className="rpt-h-section">What we heard</h2>
              </div>
              <ReportAISummary aiSummary={surveyRead.aiSummary} />
              <ReportComments comments={surveyRead.comments} />
            </section>
          )}
          {/* KindResult cards, mounted unchanged — `full`, so every open
              answer prints (the owner's ruling), and no `onOpenAnswers`: a
              document has nowhere to click through to. */}
          {surveyResults && surveyResults.questions.length > 0 && (
            <section className="rpt-section report-survey-results" data-pdf-block="">
              <div className="rpt-keepnext report-keep">
                <Kicker>Results</Kicker>
                <h2 className="rpt-h-section">Survey results</h2>
              </div>
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
            const questionNumber = question.questionNumber;
            const questionData = question.questionData || {};
            const questionAnswers = question.answers || [];
            const noun = reportRoundNoun(questionData);
            const correctAnswer = questionData.correctAnswer || questionData.CorrectAnswer;

            return (
              <section key={questionNumber} className="rpt-section rpt-round" data-pdf-block="">
                {/* THE OPENER, the question, its background and the task are
                    ONE unit: a round's heading never sits at the foot of a
                    page with its question overleaf. */}
                <div className="rpt-opener-unit report-keep">
                  <header className="rpt-opener">
                    <span className="rpt-opener-num" aria-hidden="true">{pad2(qIdx + 1)}</span>
                    <div className="rpt-opener-head">
                      <Kicker quiet={questionData.category || 'General'}>
                        {noun} {qIdx + 1} of {questions.length}
                      </Kicker>
                      <h2 className="rpt-opener-title">
                        {questionData.title || `${noun} ${questionNumber}`}
                      </h2>
                    </div>
                  </header>

                  {questionData.detail && (
                    <p className="rpt-lead">{questionData.detail}</p>
                  )}

                  {/* THE TEAM'S TASK, what the room answered (session 7924,
                      finding #5): the round's own instruction, else the set's,
                      else the game type's. Not for trivia ("Select the best
                      answer"). Label and words are separate elements, so they
                      can never run together as "The taskHow…". */}
                  {!isTrivia && (
                    <p className="rpt-task">
                      <span className="rpt-task-label">The task</span>
                      <span className="rpt-task-text">
                        {resolveInstruction(
                          questionData,
                          questionSetData && questionSetData.customInstruction,
                          reportData.gameType,
                        )}
                      </span>
                    </p>
                  )}

                {/* Trivia: the choices, the right one marked by a rule, bold
                    and the word "Correct" — never by colour alone. Inside the
                    opener's unit: a trivia question is its choices, and a
                    heading left at a page foot without them says nothing. */}
                {isTrivia && (
                  <div className="rpt-choices">
                    {(() => {
                      /* HOW THE ROOM ANSWERED (create-report.js triviaTally:
                         counts only, read through the scorer's slot rules) and
                         WHY IT'S RIGHT (the set's answerDetails) — the owner,
                         2026-10-31. Never the question's `background`: that is
                         Workie's material, never shown to players. */
                      const tally = question.triviaTally && Array.isArray(question.triviaTally.options) ? question.triviaTally : null;
                      const bySlot = new Map(((tally && tally.options) || []).map((o) => [o.slot, o]));
                      const answered = tally ? tally.answered || 0 : 0;
                      const why = String(questionData.answerDetails || '').trim();
                      const choices = OPTION_LETTERS.filter((letter) => questionData[`option${letter}`]).map((letter) => {
                        const optionText = questionData[`option${letter}`];
                        const counted = bySlot.get(letter) || null;
                        const isCorrect = counted ? counted.correct === true
                          : correctAnswer === `Option${letter}` || correctAnswer === optionText;
                        const count = counted ? counted.count || 0 : 0;
                        const share = answered > 0 ? Math.round((count / answered) * 100) : 0;
                        return (
                          <div key={letter} className={`rpt-choice report-keep${isCorrect ? ' rpt-choice--correct' : ''}${tally ? ' rpt-choice--counted' : ''}`}>
                            <span className="rpt-choice-letter">{counted ? counted.letter : letter}</span>
                            <span className="rpt-choice-text">
                              {optionText}
                              {isCorrect && <span className="rpt-tag rpt-tag--correct"><TickMark />Correct</span>}
                            </span>
                            {tally && (
                              <span className="rpt-choice-count">
                                <span className="rpt-choice-n">{count} picked</span>
                                <span className="rpt-choice-pct">{share}%</span>
                              </span>
                            )}
                            {tally && (
                              <span className="rpt-choice-bar" aria-hidden="true"><i style={{ width: `${share}%` }} /></span>
                            )}
                            {isCorrect && why && (
                              <span className="rpt-why">
                                <span className="rpt-why-label">Why it&rsquo;s right</span>
                                <span className="rpt-why-text">{why}</span>
                              </span>
                            )}
                          </div>
                        );
                      });
                      const correctPicks = tally ? tally.correct || 0 : 0;
                      const note = tally
                        ? `${answered} answered${answered > 0 ? ` · ${Math.round((correctPicks / answered) * 100)}% correct` : ''}`
                        : '';
                      return (
                        <>
                          <div className="rpt-keepnext report-keep">
                            <SubHead title="Answer choices" note={note} />
                            {choices[0]}
                          </div>
                          {choices.slice(1)}
                        </>
                      );
                    })()}
                  </div>
                )}
                </div>

                <ReportAISummary aiSummary={question.aiSummary} />

                {(!isTrivia || questionAnswers.length > 0) && (
                  <ReportResponses answers={questionAnswers} scoring={scoring} />
                )}

                <ReportComments comments={question.comments} />
                <ReportFollowUps followUps={question.followUps} late={question.late} />
                <ReportLate late={question.late} roundNoun={noun} />
              </section>
            );
          })}

          {/* ---- STANDINGS ----------------------------------------------
              Rows are blocks, not <tr>s: html2pdf pushes a row to the next
              page by inserting a spacer before it, which a table cannot hold.
              The heading, the column labels and the first row are one unit. */}
          {(() => {
            const rows = rankedPlayers.map((player) => {
              const isChampion = highestScore > 0 && (player.score || 0) === highestScore;
              return (
                <div key={player.name} role="listitem" className={`rpt-standing report-keep${isChampion ? ' rpt-standing--champion' : ''}`}>
                  <span className="rpt-standing-rank">{player.rank}</span>
                  <span className="rpt-standing-name">{player.name}</span>
                  <span className="rpt-standing-flag">{isChampion ? <span className="rpt-flag">Session champion</span> : null}</span>
                  <span className="rpt-standing-pts rpt-num">{player.score || 0}</span>
                </div>
              );
            });
            return (
              <section className="rpt-section rpt-standings" data-pdf-block="">
                <div className="rpt-keepnext report-keep">
                  <Kicker>Standings</Kicker>
                  <h2 className="rpt-h-part">Final scores</h2>
                  <div className="rpt-standing rpt-standing--head" aria-hidden="true">
                    <span>#</span><span>Name</span><span /><span className="rpt-num">Points</span>
                  </div>
                  <div role="list" className="rpt-standings-list">{rows[0]}</div>
                </div>
                {rows.length > 1 && <div role="list" className="rpt-standings-list">{rows.slice(1)}</div>}
              </section>
            );
          })()}
        </>
      )}

      {/* Build Room: findings, votes, the run list. Null for every other game. */}
      {reportData.talkingPoints && (
        <div className="rpt-section" data-pdf-block="">
          <TalkingPointsReport data={reportData.talkingPoints} />
        </div>
      )}

      {/* ---- APPENDIX: how to read this report -------------------------- */}
      <section className="rpt-section rpt-appendix report-keep" data-pdf-block="">
        <Kicker>Appendix</Kicker>
        <h2 className="rpt-h-section">How to read this report</h2>
        <dl className="rpt-defs">
          {anyVoted && (
            <div className="rpt-def">
              <dt>Points</dt>
              <dd>
                {scoring && Number.isFinite(scoring.firstPlacePoints)
                  ? `Each voter picks a first, second and third choice, worth ${scoring.firstPlacePoints}, ${scoring.secondPlacePoints} and ${scoring.thirdPlacePoints} points. `
                  : 'Each voter picks a first, second and third choice. '}
                A response&rsquo;s points are the sum; a person&rsquo;s score is the sum across {pluralRoundNoun(reportRoundNoun(headerSampleQuestion), 2).toLowerCase()}.
              </dd>
            </div>
          )}
          {isTrivia && (
            <div className="rpt-def">
              <dt>Correct</dt>
              <dd>The right answer to each question is marked with a rule and the word Correct.</dd>
            </div>
          )}
          {(anyRead || surveyRead) && (
            <div className="rpt-def">
              <dt>Workie&rsquo;s read</dt>
              <dd>Written by Engage&rsquo;s AI assistant from the room&rsquo;s responses. It is an analysis, not a decision, and not the host&rsquo;s words.</dd>
            </div>
          )}
          {(anyComments || (surveyRead && (surveyRead.comments || []).length > 0)) && (
            <div className="rpt-def">
              <dt>Comments</dt>
              <dd>What people said about a round&rsquo;s results afterwards, each labelled with the part it is about.</dd>
            </div>
          )}
          <div className="rpt-def">
            <dt>Record</dt>
            <dd>
              Built {built} from the session record. Responses are kept 7 days and summaries 30; a report built later says what it could not recover.
            </dd>
          </div>
        </dl>
      </section>

      {/* The document has to end somewhere; a page that just stops is the
          tell of a screenshot. */}
      <p className="rpt-end" data-pdf-block="">
        <MountainMark className="rpt-end-mark" />
        <span>End of report</span>
      </p>
    </article>
  );
}

export { ReportDocument, MountainMark, Ridge, Kicker, SubHead };
export default GameReport;
