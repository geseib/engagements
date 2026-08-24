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
import html2pdf from 'html2pdf.js';
import Icon from './Icon';
import RankIcon from './RankIcon';
import MarkdownRenderer from './MarkdownRenderer';
import { resolveRoundNoun, pluralRoundNoun } from '../config/instructions';
import { calculatePlayerRankings } from '../config/podium';
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
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [confirmModalProps, setConfirmModalProps] = useState({
    title: '',
    message: '',
    confirmText: 'Proceed',
    onConfirm: () => {},
    onCancel: () => {}
  });

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

      const opt = {
        margin: [0.5, 0.5, 0.5, 0.5],
        filename: `${eventTitle.replace(/[^a-zA-Z0-9\s-]/g, '').replace(/\s+/g, '-')}-${new Date().toISOString().split('T')[0]}.pdf`,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: {
          scale: 2,
          useCORS: true,
          letterRendering: true,
          scrollX: 0,
          scrollY: 0
        },
        jsPDF: {
          unit: 'in',
          format: 'letter',
          orientation: 'portrait'
        },
        // html2canvas rasterises: it does not read the print stylesheet, so the
        // break rules in GameReport.css cannot reach it. This is the one lever
        // it does understand, and `.report-keep` is the same set of units the
        // print sheet marks `break-inside: avoid`.
        pagebreak: { mode: ['css', 'legacy'], avoid: ['.report-keep'] }
      };

      // Generate PDF as blob
      const pdfBlob = await html2pdf().set(opt).from(element).outputPdf('dataurlstring');

      // Extract base64 data
      const base64Data = pdfBlob.split(',')[1];

      // Send to backend for S3 storage
      const response = await fetch(`${API_BASE}games/${gameId}/save-report`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          gameId,
          eventTitle,
          pdfBlob: base64Data,
          permanent: permanent
        })
      });

      if (!response.ok) {
        throw new Error('Failed to save report');
      }

      const result = await response.json();

      // Show appropriate notification based on save type
      const message = permanent
        ? 'Report saved permanently! Your report will be kept for 1 year.'
        : 'Report saved! Download link expires in 24 hours.';

      // An encrypted report's link points at THIS API, not at S3, because the
      // stored object is an envelope and a presigned S3 link would hand a
      // browser ciphertext. Resolve it against the configured API base — the
      // handler cannot know that from inside Lambda, and hardcoding a host is
      // how every join link came to point at the retired eng.dev twin.
      const downloadHref = result.downloadUrlIsRelative
        ? `${API_BASE}${result.downloadUrl}`
        : result.downloadUrl;

      setConfirmModalProps({
        title: 'Report Saved Successfully',
        message: `${message}\n\nWould you like to download the report now?`,
        confirmText: 'Download Now',
        cancelText: 'Copy Link',
        onConfirm: () => {
          window.open(downloadHref, '_blank');
          setShowConfirmModal(false);
        },
        onCancel: () => {
          navigator.clipboard.writeText(downloadHref).then(() => {
            // Show brief success message
            const successDiv = document.createElement('div');
            successDiv.className = 'clipboard-success';
            successDiv.textContent = 'Download link copied to clipboard!';
            document.body.appendChild(successDiv);
            setTimeout(() => successDiv.remove(), 3000);
          }).catch(() => {
            // Fallback: show the URL in an input for manual copying
            const input = document.createElement('input');
            input.value = downloadHref;
            input.select();
            document.execCommand('copy');
          });
          setShowConfirmModal(false);
        }
      });
      setShowConfirmModal(true);

    } catch (err) {
      console.error('Error saving report:', err);
      alert('Failed to save report. Please try again.');
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
              <h2>Save Report Options</h2>
            </div>
            <div className="save-report-content">
              <p className="save-description">
                Choose how you'd like to save this report:
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
                  <strong>Temporary Save (24 hours)</strong>
                  <span className="save-option-desc">Report will be automatically deleted after 24 hours</span>
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
                  <strong>Permanent Save (1 year)</strong>
                  <span className="save-option-desc">Report will be kept for 1 year for future reference</span>
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
                {isSaving ? 'Saving...' : 'Save Report'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Success Confirmation Modal */}
      {showConfirmModal && (
        <div className="expanded-qr-overlay" onClick={confirmModalProps.onCancel}>
          <div className="expanded-qr-content confirmation-modal" onClick={(e) => e.stopPropagation()}>
            <div className="confirmation-header">
              <h2>{confirmModalProps.title}</h2>
            </div>
            <div className="confirmation-message">
              {confirmModalProps.message}
            </div>
            <div className="dialog-actions">
              <button
                className="btn-secondary"
                onClick={confirmModalProps.onCancel}
              >
                {confirmModalProps.cancelText || 'Cancel'}
              </button>
              <button
                className="btn-primary"
                onClick={confirmModalProps.onConfirm}
              >
                {confirmModalProps.confirmText}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
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
  const { gameId, eventTitle, players = [], questions = [] } = reportData;

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
  const roundsLabel = pluralRoundNoun(reportRoundNoun(headerSampleQuestion), questions.length);

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
            <dd>{questions.length}</dd>
          </div>
        </dl>
      </header>

      {/* ---- ROUNDS ---------------------------------------------------- */}
      <div className="report-content">
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
              {aiSummary && (
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
              )}

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
