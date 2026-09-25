import React from 'react';
import PromptPreflightPanel from './PromptPreflightPanel';
import PromptBeforeAfter from './PromptBeforeAfter';
import { FIELD_LABELS } from '../utils/workieBundle';

/**
 * AN UPLOADED WORKIE, READ BEFORE IT IS TAKEN — the editor's Upload view.
 *
 * The owner, 2026-09-25: "A link that allows us to download and then upload
 * the prompt would be fantastic." The file has already been parsed and checked
 * against this prompt and game type (utils/workieBundle.js); what is left is
 * the admin's decision, made with what changes in front of them and the
 * editor's own checks run on the version that would result. "Put it in the
 * editor" makes it unsaved work — Save is still the only write.
 *
 * `changes` is takeFromBundle's list; `ignored` names identity fields the
 * file changed and that are not taken. Like the workbench, this is a view in
 * the editor's dialog and shares its × and its requestClose (`onClose`).
 */
const describeSections = (value) => (Array.isArray(value) && value.length
  ? value.map((s) => `## ${s && s.heading}${s && s.guidance ? `\n${s.guidance}` : ''}`).join('\n\n')
  : 'None declared — the default Summary · Discussion Questions · Next Steps');

const describeAngles = (value) => (value && typeof value === 'object' && Object.keys(value).length
  ? Object.entries(value).map(([k, v]) => `${k}: ${v}`).join(', ')
  : 'The house mix');

/** Identity fields a file may not change, in words. */
const IGNORED_WORDS = {
  name: 'the name',
  category: 'the category',
  promptType: 'the prompt type',
  status: 'the status',
  isDefault: 'the default flag',
  tags: 'the tags',
  template: 'the template',
  scenario: 'the scenario',
};

const asText = (field, value) => {
  if (field === 'outputSections') return describeSections(value);
  if (field === 'angleWeights') return describeAngles(value);
  return String(value ?? '');
};

export default function PromptImportReview({ fileName, changes, ignored, report, onConfirm, onBack, onClose }) {
  return (
    <>
      <div className="pmgr-advisor-body" data-testid="pmgr-import-body">
        <p className="pmgr-advice-lede">
          From <strong>{fileName}</strong>: {changes.length} {changes.length === 1 ? 'part changes' : 'parts change'}.
          Nothing is saved until you press Save in the editor.
        </p>
        {ignored.length > 0 && (
          <p className="pmgr-advice-lede" data-testid="pmgr-import-ignored">
            Not taken from the file: {ignored.map((f) => IGNORED_WORDS[f] || f).join(', ')}. They identify the prompt, so they are changed in the
            editor, not by a file.
          </p>
        )}

        {changes.map((change) => (
          <PromptBeforeAfter
            key={change.field}
            title={FIELD_LABELS[change.field] || change.field}
            before={asText(change.field, change.before)}
            after={asText(change.field, change.after)}
            testId={`pmgr-import-${change.field}`}
            changedWord="changed"
          />
        ))}

        <div className="result-section">
          <h4>The checks, run on the uploaded version</h4>
          <PromptPreflightPanel
            report={report}
            unavailable={!report}
            unavailableReason={'The editor\'s checks could not run on this file, so nothing has been checked. '
              + 'This is not the same as nothing being wrong.'}
          />
        </div>
      </div>

      <div className="form-actions">
        <button type="button" className="btn-secondary" onClick={onClose} data-testid="pmgr-import-close">
          Close
        </button>
        <button type="button" className="btn-secondary" onClick={onBack} data-testid="pmgr-import-back">
          Back to the editor
        </button>
        <button type="button" className="btn-primary" onClick={onConfirm} data-testid="pmgr-import-confirm">
          Put it in the editor
        </button>
      </div>
    </>
  );
}
