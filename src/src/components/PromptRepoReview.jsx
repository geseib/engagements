import React, { useState } from 'react';
import Modal from './Modal';
import Icon from './Icon';
import StatusMessage from './StatusMessage';
import {
  REPO_FIELD_ORDER, REPO_FIELD_LABEL, fieldText, countWords, wordDiff, foldDiff, sectionsChanged, shortDate,
} from '../utils/repoPromptMatch';

/**
 * THE REPO'S VERSION OF ONE PROMPT, READ BEFORE IT IS TAKEN —
 * docs/design/prompt-versions/ frame 2.
 *
 * Every part the repo file carries (instructions, output format, sections, and
 * whatever else it holds) says whether it changes, by how many words, and which
 * words: struck through for removed, underlined-green for added. Long unchanged
 * stretches fold to "…" so what is read is the change, not the prompt again.
 *
 * "Save as version N" makes the repo's text a NEW version and makes it live;
 * the version that was live stays in the history, one click from live again
 * (the editor's Versions tab). "Not now" changes nothing. Nothing on this
 * screen overwrites or deletes anything — that is the promise the footer
 * states, and update-ai-prompt.js keeps.
 *
 * A dialog (container rule: decide about one thing), with an × and a bottom
 * exit through one close, and Escape closes it unless a save is in flight.
 */
export default function PromptRepoReview({ prompt, status, onSave, onClose }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const { entry } = status;
  const liveVersion = Number(prompt.version) || 0;
  const nextVersion = Math.max(Number(prompt.latestVersion) || 0, liveVersion) + 1;

  const parts = REPO_FIELD_ORDER.filter((f) => entry.fields.includes(f));

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      await onSave(prompt, entry);
    } catch (e) {
      setError(`Nothing was saved — ${e.message} The live version is unchanged.`);
      setSaving(false);
    }
  };
  const close = () => { if (!saving) onClose(); };

  return (
    <Modal
      overlayClassName="pmgr-scrim"
      contentClassName="pmgr-modal pmgr-modal--wide"
      onClose={close}
      closeOnBackdrop={false}
      closeOnEscape={() => !saving}
      labelledBy="pmgr-repo-title"
    >
      <div className="pmgr-modal-head">
        <div className="pmgr-repo-headtext">
          <p className="pmgr-repo-crumb">Prompts › {prompt.name}</p>
          <h2 id="pmgr-repo-title">Newer version in the repo</h2>
        </div>
        <span className="pmgr-repo-live" data-testid="pmgr-repo-live">
          Live: v{liveVersion || '?'}
        </span>
        <button type="button" className="pmgr-x" onClick={close} aria-label="Close the review">×</button>
      </div>

      <div className="pmgr-advisor-body pmgr-repo-body" data-testid="pmgr-repo-review">
        <p className="pmgr-advice-lede">
          From <code>{entry.path}</code>
          {entry.commitDate ? `, as of the deploy of ${shortDate(entry.commitDate)}` : ''}.
          {' '}{status.changed.length} of {parts.length} part{parts.length === 1 ? '' : 's'} differ from what is live.
        </p>

        {status.editedHere && (
          <div className="pmgr-repo-warn" role="alert" data-testid="pmgr-repo-edited-here">
            <Icon name="Warning" weight="fill" size={16} color="currentColor" />{' '}
            <span>
              <strong>Edited here since it was taken from the repo;</strong> saving keeps that version in the history.
            </span>
          </div>
        )}

        {parts.map((field) => {
          const changed = status.changed.includes(field);
          const before = fieldText(field, prompt[field]);
          const after = fieldText(field, entry.values[field]);
          const sections = field === 'outputSections' ? sectionsChanged(prompt[field], entry.values[field]) : null;
          return (
            <section
              key={field}
              className={`pmgr-repo-part${changed ? ' pmgr-repo-part--changed' : ''}`}
              data-testid={`pmgr-repo-part-${field}`}
            >
              <h4>
                {REPO_FIELD_LABEL[field] || field}
                <span className="pmgr-advice-group-note">
                  {' — '}
                  {!changed && 'unchanged'}
                  {changed && sections && `${sections.changed} of ${sections.total} changed`}
                  {changed && !sections && `changed · ${countWords(before)} → ${countWords(after)} words`}
                </span>
              </h4>
              {changed && (
                <div className="pmgr-repo-diff" data-testid={`pmgr-repo-diff-${field}`}>
                  {foldDiff(wordDiff(before, after)).map((p, i) => {
                    if (p.type === 'add') return <ins key={i}>{p.text}</ins>;
                    if (p.type === 'del') return <del key={i}>{p.text}</del>;
                    return <span key={i}>{p.text}</span>;
                  })}
                </div>
              )}
            </section>
          );
        })}
      </div>

      <div className="form-actions pmgr-repo-foot">
        {error && (
          <div className="pmgr-notice" data-testid="pmgr-repo-error">
            <StatusMessage message={error} tone="error" />
          </div>
        )}
        <button type="button" className="btn-secondary" onClick={close} disabled={saving} data-testid="pmgr-repo-notnow">
          Not now
        </button>
        <span className="pmgr-repo-hint">
          Version {liveVersion || 'the live one'} stays in the history; you can make it live again.
        </span>
        <button type="button" className="btn-primary" onClick={save} disabled={saving} data-testid="pmgr-repo-save">
          {saving ? 'Saving…' : `Save as version ${nextVersion}`}
        </button>
      </div>
    </Modal>
  );
}
