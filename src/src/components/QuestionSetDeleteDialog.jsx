import React, { useState } from 'react';
import Icon from './Icon';
import Modal from './Modal';
import { authFetch } from '../auth/authFetch';
import { adminApiUrl } from '../utils/adminApi';
import { gameTypeLabel } from '../config/gameTypes';
import './QuestionSetsPanel.css';

/**
 * DELETING A QUESTION SET.
 *
 * Grounded in docs/design/admin-redesign/14-confirm-delete-set.html and
 * RATIONALE.md §8. Wave D part two, Q1.
 *
 * THE DEFECT. `questionSetDeleteStatus` was assigned in six places in
 * `AdminPage.jsx` and rendered in none; `isDeletingQuestionSet` was assigned
 * twice and read nowhere, so there was no busy state; and
 * `confirmDeleteQuestionSet` closed the modal on its first line, BEFORE the
 * request was sent. A delete that failed was therefore pixel-for-pixel
 * identical to one that succeeded: the dialog vanished, the set stayed in the
 * list, and the only account of what went wrong was in the console.
 *
 * The version-delete flow in `QuestionSetEditor.jsx` already gets this right,
 * and this is modelled on it: the request is sent first, the dialog owns its own
 * busy and outcome state, and it CLOSES ONLY ON ACKNOWLEDGEMENT — success and
 * failure both produce something to read.
 *
 * WHAT IS NOT HERE, AND WHY. Mockup 14 lists the past sessions that used the
 * set and says, per session, what the delete decides for its report. That needs
 * a backend contract set-delete does not have (plan item B1:
 * `DELETE /admin/question-sets/{setId}` checks only that the id is present and
 * the set exists — no usage check, no `?confirm=true`). Two things the dialog
 * can say today are said, and both are unconditionally true:
 *
 *   - The report consequence, stated generically. A report is built from the
 *     LIVE set the first time it is requested (`create-report.js:139-141`), so
 *     deleting a set decides which past sessions can still produce one.
 *   - The reversible neighbour. Nine times in ten "delete this set" means "stop
 *     offering it to hosts", which is exactly what the Active toggle already
 *     does. RATIONALE §8: naming the non-destructive alternative inside the
 *     destructive dialog prevents more damage than any amount of red.
 *
 * NO TYPE-TO-CONFIRM. RATIONALE §8 spends the console's entire budget for it on
 * two dialogs: delete-all-sessions, and delete-a-set-WITH-HISTORY. This dialog
 * cannot yet know whether a set has history — that is B1 — and "anywhere else it
 * is friction theatre, and friction theatre trains people to type without
 * reading". When B1 lands, arming this on `usedByGames.length` is one condition.
 */
export default function QuestionSetDeleteDialog({
  questionSet,
  onCancel,
  /** Called once the operator acknowledges a completed delete. The page closes
   *  the dialog and re-reads the list. */
  onDeleted,
  /** The reversible neighbour: deactivate instead. Optional. */
  onDeactivate,
}) {
  const [phase, setPhase] = useState('confirm'); // confirm | deleting | failed | done
  const [message, setMessage] = useState('');

  if (!questionSet) return null;

  const name = questionSet.name || questionSet.id;
  const questions = questionSet.totalQuestions ?? 0;
  const categories = questionSet.categoryCount ?? 0;

  const remove = async () => {
    setPhase('deleting');
    setMessage('');
    try {
      const response = await authFetch(
        adminApiUrl(`admin/question-sets/${encodeURIComponent(questionSet.id)}`),
        { method: 'DELETE', headers: { 'Content-Type': 'application/json' } }
      );
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        setMessage(`Delete failed: ${result.error || `HTTP ${response.status}`}`);
        setPhase('failed');
        return;
      }
      setMessage(result.message || `Deleted “${name}”.`);
      setPhase('done');
    } catch (error) {
      console.error('Delete question set error:', error);
      setMessage(`Delete failed: ${error.message}`);
      setPhase('failed');
    }
  };

  const busy = phase === 'deleting';
  const finished = phase === 'done';

  // THE GATE, STATED ONCE AND SPENT TWICE. An in-flight delete must not be
  // dismissable — unmounting the only surface that can report the outcome is
  // the whole defect this dialog was written for — and a finished one closes by
  // acknowledgement, not by dismissal. Escape is now held to exactly the same
  // rule as the scrim; a second way out that skips the gate is the same bug.
  const dismissable = () => !busy && !finished;

  return (
    <Modal
      overlayClassName="qsets qsets-scrim"
      contentClassName="qsets-modal"
      labelledBy="qsets-del-title"
      onClose={() => onCancel && onCancel()}
      closeOnBackdrop={dismissable}
      closeOnEscape={dismissable}
    >
      <header>
        <Icon
          name={finished ? 'Check' : 'Warning'}
          weight="fill"
          size={20}
          color={finished ? 'var(--success)' : 'var(--danger-text)'}
        />
        <div>
          <h2 id="qsets-del-title">{finished ? 'Question set deleted' : 'Delete this question set?'}</h2>
          <p className="qsets-dim">
            {name} · {gameTypeLabel(questionSet.engagementType)} · {questions} question
            {questions === 1 ? '' : 's'} in {categories} categor{categories === 1 ? 'y' : 'ies'}
          </p>
        </div>
      </header>

      <div className="qsets-modal-body">
        {!finished && (
          <>
            <p>
              This removes every question, category and version in the set. It cannot be
              undone.
            </p>
            {/*
              Unconditionally true, so it is stated without needing B1's usage
              list: the report is built from the live set on demand.
            */}
            <p>
              A session report is built from the live set the first time it is asked for, so
              deleting this set decides, permanently, which past sessions can still produce
              one.
            </p>

            {onDeactivate && questionSet.active && (
              <div className="qsets-alt">
                <b>Or deactivate it instead.</b> It stops appearing in the host's picker and
                nothing is lost — you can turn it back on from the list at any time.{' '}
                {/* The set's name is already in the header. Repeating it inside a
                    link is how a 98-character title (the longest this product
                    has produced) pushes the dialog sideways. */}
                <button
                  type="button"
                  className="qsets-btn qsets-btn--link"
                  disabled={busy}
                  onClick={() => onDeactivate(questionSet)}
                >
                  Deactivate it instead
                </button>
              </div>
            )}
          </>
        )}

        {message && (
          <div
            className={`qsets-alert ${phase === 'failed' ? 'qsets-alert--error' : 'qsets-alert--success'}`}
            role={phase === 'failed' ? 'alert' : 'status'}
          >
            <Icon
              name={phase === 'failed' ? 'Warning' : 'Check'}
              weight="fill"
              size={16}
              color="currentColor"
            />
            <span>{message}</span>
          </div>
        )}
      </div>

      <footer>
        <span className="qsets-grow" />
        {finished ? (
          <button type="button" className="qsets-btn qsets-btn--primary" onClick={() => onDeleted && onDeleted(message)}>
            Done
          </button>
        ) : (
          <>
            <button type="button" className="qsets-btn" disabled={busy} onClick={() => onCancel && onCancel()}>
              {phase === 'failed' ? 'Close' : 'Keep it'}
            </button>
            <button type="button" className="qsets-btn qsets-btn--dangersolid" disabled={busy} onClick={remove}>
              {busy ? 'Deleting…' : phase === 'failed' ? 'Try again' : 'Delete the set'}
            </button>
          </>
        )}
      </footer>
    </Modal>
  );
}
