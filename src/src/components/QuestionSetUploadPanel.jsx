import React, { useState, useEffect, useRef } from 'react';
import Icon from './Icon';
import PromptShapePreview from './PromptShapePreview';
import { authFetch } from '../auth/authFetch';
import { adminApiUrl } from '../utils/adminApi';
import {
  GAME_TYPE_LIST,
  gameTypeLabel,
  isPlayableGameType,
  NOT_PLAYABLE_LABEL,
  notPlayableReason,
} from '../config/gameTypes';
import { selectableSummaryPrompts } from '../utils/questionSetEditing';
import { preflight, describePreflight } from '../utils/csvPreflight';
import { authoringPrompt } from '../config/aiAuthoringPrompt';
import './QuestionSetsPanel.css';

/**
 * MAKING A NEW QUESTION SET — every path, and the engagement type asked ONCE.
 *
 * Grounded in docs/design/admin-redesign/06-csv-errors.html and 07-new-set.html
 * (RATIONALE.md §9). Wave D part two, Q3, Q5 and Q6 — option (a).
 *
 * Q6, AND WHAT IS DELIBERATELY NOT BUILT. `engagementType` is ONE React state
 * that used to be rendered as TWO `<select>` elements in two sections of the
 * same tab — "Upload Question Set" and "Add New Question Set". Changing either
 * silently changed the other, and it also decided which AI builder opened and
 * which template downloaded. Mockup 07 resolves this with a five-path ranked
 * chooser that asks for the type inside the path you pick; the plan's Part 5
 * names that as exceeding the owner's constraint, and the owner chose option
 * (a). So: the type is asked once, here, in the panel that uses it, and every
 * creation path lives beside it. There is no `NewQuestionSetChooser`.
 *
 * Q3. The summary-prompt picker was `prompt.gameType === (engagementType ===
 * 'call-and-answer' ? 'callandanswer' : engagementType)` — a raw string compare
 * with one hand-patched case, which meant a `polls` prompt never appeared, a
 * GENERATION prompt was selectable (and does nothing, because
 * `get-ai-summary.js` rejects it and falls back to the default), and a record
 * with no `promptId` rendered `<option value={undefined}>`, which makes the
 * browser submit the option's LABEL as the value. `selectableSummaryPrompts()`
 * has existed and been tested since `d3d88322`; the set editor has used it since
 * the day it landed and this form did not. This is a one-site change and it is
 * NOT extended into a status filter — see the header of
 * utils/questionSetEditing.js: status annotates, structure excludes.
 *
 * Q5. The file is parsed in the browser before it is sent. What used to be here
 * was `lines[0].split(',')` with `replace(/"/g, '')`, feeding an auto-filled
 * description box and nothing else. See utils/csvPreflight.js.
 *
 * SURVEY. Kept visible and marked Not playable (the owner's decision on
 * OPEN-QUESTIONS #3), rather than removed. The importer rejects every survey
 * upload, so the preflight blocks the Upload button and says so — instead of
 * the shipped behaviour, which offered the type, enabled the button, and
 * admitted the problem only in a sentence beside the file picker.
 *
 * SHARED WITH THE HOST, VIA PROPS RATHER THAN A FORK. Hosts create sets too
 * now, from the create-engagement flow (components/HostQuestionSetsDialog.jsx),
 * and the CSV contract, the preflight and the importer's quirks are identical
 * for both audiences — two copies of this form would mean two places to fix the
 * next importer gap. What differs is not the upload, it is the surrounding
 * ADMIN machinery: the AI builders spend Bedrock budget and their modals live in
 * AdminPage; the summary-prompt picker chooses between records only an admin can
 * see or edit; `/builder` is an admin route. Each of those is a flag below,
 * defaulting to ON so the admin console renders exactly as it did.
 *
 * A flag here hides a control. It is NOT the permission — the permission is
 * `auth/authorizer.js` plus `admin/shared/question-set-access.js`, and a request
 * for a hidden capability is refused by the API whatever this component drew.
 */
export default function QuestionSetUploadPanel({
  /**
   * WHICH LIBRARY THIS SET IS BEING CREATED IN.
   *
   * Empty (the default) lets the server decide, which is what every caller
   * wanted before there was more than one library: `createSetRef` tries the
   * caller's organisation and falls back to the platform library. That default
   * is right inside an org and WRONG in the Engage console, where an admin
   * writing to the shared library would silently get a set in their own
   * personal space instead — they have one, so the org branch always wins.
   *
   * `'platform'` is honoured only for a caller in the `admins` group;
   * `canManageScope` refuses everybody else, so passing it is a request rather
   * than a decision.
   */
  scope = '',
  engagementType,
  onEngagementTypeChange,
  availablePrompts = [],
  defaultInstructions = '',
  /** Opens the AI builder for the current type. The builders themselves live in
   *  AdminPage, which owns the modals. */
  onOpenBuilder,
  /** A set landed. The page re-reads the list. */
  onUploaded,
  /** Offer the AI builders. Off for hosts: the generation routes are
   *  admins-only and their modals belong to AdminPage. */
  showAIBuilder = true,
  /** Offer the manual /builder route. Off for hosts — an admin route. */
  showManualBuilder = true,
  /** Offer the AI summary-prompt picker. Off for hosts: the prompt library is
   *  an admin surface, and an unset promptId already resolves a
   *  type-appropriate default at run time (get-ai-summary.js). */
  showSummaryPrompt = true,
  /** Fields beyond title/description. Off for hosts, who are creating a set to
   *  play in the next ten minutes, not curating the library. */
  showAdvancedFields = true,
  /** Heading and lead-in, so the host's copy is not the console's copy. */
  heading = 'New question set',
  intro = null,
  /**
   * TAKE THE PERSON TO THE FORM THEY JUST ASKED FOR.
   *
   *   "you click new but the list is so long that it is not obvious that it
   *    opened a section for new question set, could it scroll the page down to
   *    that?"
   *
   * This panel renders BELOW the set list in both places it is mounted, and
   * forty-one rows is taller than a screen — so pressing New appended a form
   * off the bottom of the viewport and nothing moved. The button looked dead.
   *
   * Off by default, and passed explicitly by the two call sites, because the
   * console ALSO renders this panel unconditionally when the library is empty
   * (`isCreateOpen || questionSets.length === 0`). Scrolling on that path would
   * yank the page on arrival in response to nothing the person did.
   */
  scrollIntoViewOnMount = false,
}) {
  const [file, setFile] = useState(null);
  const [report, setReport] = useState(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [customInstructions, setCustomInstructions] = useState('');
  const [aiContextInstructions, setAiContextInstructions] = useState('');
  const [promptId, setPromptId] = useState('');
  const [showDefaultInstructions, setShowDefaultInstructions] = useState(false);
  const [status, setStatus] = useState(null); // { text, tone }
  const [isUploading, setIsUploading] = useState(false);

  /*
    SCROLL AND MOVE FOCUS, NOT ONE OR THE OTHER.

    Scrolling answers "where did it go?" for somebody watching the screen. It
    answers nothing for somebody on a keyboard or a screen reader, whose caret
    is still on the New button forty rows up — they would tab through the whole
    list to reach a form that is already open. Focus is what actually tells
    those two the form arrived, and it makes the scroll redundant for them.

    The heading, not the first input: an input steals the announcement and a
    focused file picker is a strange place to be dropped. `tabIndex={-1}` makes
    the h3 programmatically focusable without adding a tab stop.

    `scrollIntoView` is GUARDED because jsdom does not implement it — unguarded,
    every test that mounts this panel would throw rather than fail on an
    assertion, which is a worse failure to read. `block: 'nearest'` so the host
    dialog scrolls its own body the minimum distance instead of jumping the
    panel to the top of a modal that is only 86vh tall.
  */
  const headingRef = useRef(null);
  useEffect(() => {
    if (!scrollIntoViewOnMount) return;
    const node = headingRef.current;
    if (!node) return;
    if (typeof node.scrollIntoView === 'function') {
      node.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
    node.focus({ preventScroll: true });
  }, [scrollIntoViewOnMount]);

  const playable = isPlayableGameType(engagementType);
  const promptChoices = selectableSummaryPrompts(availablePrompts, engagementType);
  const hiddenPromptCount = availablePrompts.length - promptChoices.length;

  const resetFile = () => {
    setFile(null);
    setReport(null);
    const input = document.getElementById('qsets-file-upload');
    if (input) input.value = '';
  };

  const handleFileSelect = (event) => {
    const chosen = event.target.files && event.target.files[0];
    if (!chosen) {
      resetFile();
      return;
    }
    setStatus(null);
    setFile(chosen);
    if (!title) setTitle(chosen.name.replace(/\.(csv|json)$/i, ''));

    const reader = new FileReader();
    reader.onload = (e) => {
      const text = String(e.target.result ?? '');
      const next = preflight(text, engagementType, { fileName: chosen.name });
      setReport(next);
      // Auto-fill from the QUOTE-AWARE parse. The old code split the header on
      // commas and stripped every `"`, so a file with a quoted comma — most real
      // files — filled the description from the wrong column.
      if (!description && next.suggestedDescription) setDescription(next.suggestedDescription);
      if (!customInstructions && next.suggestedCustomInstruction) {
        setCustomInstructions(next.suggestedCustomInstruction);
      }
    };
    reader.onerror = () => {
      setReport(null);
      setStatus({ text: 'That file could not be read.', tone: 'error' });
    };
    reader.readAsText(chosen);
  };

  const downloadTemplate = async (templateType) => {
    setStatus({ text: 'Downloading template…', tone: 'pending' });
    try {
      const response = await authFetch(adminApiUrl(`admin/download-template?type=${templateType}`));
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        setStatus({ text: `Failed to download template: ${result.error || response.status}`, tone: 'error' });
        return;
      }
      const mimeType = String(result.filename || '').endsWith('.json') ? 'application/json' : 'text/csv';
      const blob = new Blob([result.content], { type: mimeType });
      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = result.filename;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      window.URL.revokeObjectURL(url);
      setStatus({ text: `${result.filename} downloaded.`, tone: 'success' });
    } catch (error) {
      setStatus({ text: `Failed to download template: ${error.message}`, tone: 'error' });
    }
  };

  /*
    THE PROMPT FOR SOMEBODY ELSE'S AI. The owner: "if you clicked the button,
    would copy to clipboard AI instructions that i could pass along to an AI
    tool like Claude or Chat gpt with the template and ask it to fill out the
    csv." The text lives in config/aiAuthoringPrompt.js beside its contracts;
    this only moves it to the clipboard and says where to paste it.

    The execCommand fallback exists because navigator.clipboard is
    secure-context only — a host on a plain-http lab screen still gets a copy
    instead of a dead button.
  */
  const copyAuthoringPrompt = async () => {
    const text = authoringPrompt(engagementType);
    if (!text) return;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const scratch = document.createElement('textarea');
        scratch.value = text;
        document.body.appendChild(scratch);
        scratch.select();
        document.execCommand('copy');
        document.body.removeChild(scratch);
      }
      setStatus({
        text: 'AI authoring prompt copied. Paste it into Claude or ChatGPT together with the downloaded template, fill in the [BRACKETS] at the top, and upload the CSV it returns here.',
        tone: 'success',
      });
    } catch (error) {
      setStatus({ text: `Could not copy the prompt: ${error.message}`, tone: 'error' });
    }
  };

  const upload = async () => {
    if (!file || !title.trim()) return;
    setIsUploading(true);
    setStatus({ text: 'Uploading…', tone: 'pending' });
    try {
      const fileContent = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target.result);
        reader.onerror = reject;
        reader.readAsText(file);
      });

      const response = await authFetch(adminApiUrl('admin/upload-questions'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileName: file.name,
          fileContent,
          customTitle: title.trim(),
          customDescription: description.trim(),
          customInstructions: customInstructions.trim(),
          aiContextInstructions: aiContextInstructions.trim(),
          promptId: promptId.trim(),
          engagementType,
          ...(scope ? { scope } : {}),
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        setStatus({ text: `Upload failed: ${result.error || 'Unknown error'}`, tone: 'error' });
        return;
      }
      setStatus({ text: result.message || 'Question set created.', tone: 'success' });
      setTitle('');
      setDescription('');
      setCustomInstructions('');
      setAiContextInstructions('');
      setPromptId('');
      resetFile();
      if (onUploaded) onUploaded(result.message || 'Question set created.');
    } catch (error) {
      setStatus({ text: `Upload failed: ${error.message}`, tone: 'error' });
    } finally {
      setIsUploading(false);
    }
  };

  const blocked = !!(report && report.blocking.length);
  const canUpload = !!file && !!title.trim() && !isUploading && !blocked;

  return (
    <div className="qsets qsets-panel">
      <h3 ref={headingRef} tabIndex={-1}>{heading}</h3>
      <p>
        {intro || (
          <>
            The engagement type is asked once, here, because it decides everything below it: which
            builder opens, which template you get, which summary prompts apply, and how the
            importer reads your columns.
          </>
        )}
      </p>

      <div className="qsets-field" style={{ maxWidth: '340px' }}>
        <label htmlFor="engagement-type">Engagement type</label>
        <select
          id="engagement-type"
          className="qsets-input qsets-select"
          value={engagementType}
          onChange={(event) => {
            onEngagementTypeChange(event.target.value);
            // The verdict is type-dependent (poll options, trivia answers, the
            // survey block), so a stale report would be a confident wrong answer.
            setReport(null);
            resetFile();
          }}
        >
          {GAME_TYPE_LIST.map((meta) => (
            <option key={meta.id} value={meta.id}>
              {meta.label}
              {isPlayableGameType(meta.id) ? '' : ` — ${NOT_PLAYABLE_LABEL.toLowerCase()}`}
            </option>
          ))}
        </select>
        {!playable && <small>{notPlayableReason(engagementType)}</small>}
      </div>

      <div className="qsets-section">
        {/*
          THE WAYS IN ARE NOT INTERCHANGEABLE, and the panel used to present
          them as five sibling buttons in a wrap under the word "Create" — the
          same five options with the part that lets a newcomer choose between
          them removed. Reported as: "the workflow is a bit difficult to follow
          as a new person, i think the buttons should reflect what happy path
          and canceling throughout."

          docs/design/admin-redesign/07-new-set.html already answered this and
          the shipped panel diverged from it. Its heading is the model followed
          here — "They are not interchangeable, so this says what each costs" —
          so every route now names WHEN IT IS THE RIGHT ONE, and exactly one is
          marked as the lead. One column rather than the mockup's card grid,
          because this panel also renders inside the host's dialog at about half
          the console's width.
        */}
        <h4>How do you want to make it?</h4>
        <p className="qsets-route-when" style={{ margin: '-4px 0 10px' }}>
          These are not interchangeable. Each one says when it is the right one.
        </p>
        <div className="qsets-routes">
          {showAIBuilder && (
          <div className="qsets-route qsets-route--lead">
            <span className="qsets-route-nm">Generate with AI</span>
            <p className="qsets-route-when">
              Best when you have a topic and no source material. It writes the questions and
              leaves you a draft to read — a generated set arrives switched off on purpose.
            </p>
          <button type="button" className="qsets-btn qsets-btn--primary" onClick={() => onOpenBuilder && onOpenBuilder(engagementType)}>
            <Icon name="Sparkle" weight="duotone" size={14} color="currentColor" />
            {/* The survey builder does not upload: handleSurveyGenerated builds a
                Blob and clicks an anchor. Say so on the button rather than after
                the fact (OPEN-QUESTIONS #3, option (c)'s copy). */}
            AI {gameTypeLabel(engagementType)} builder{playable ? '' : ' (exports JSON)'}
          </button>
          </div>
          )}

          <div className="qsets-route">
            <span className="qsets-route-nm">Start from a template</span>
            <p className="qsets-route-when">
              Best when you want to write the questions yourself but not guess at the columns.
              Costs you a round trip through a spreadsheet.
            </p>
            <button type="button" className="qsets-btn" onClick={() => downloadTemplate(engagementType)}>
              <Icon name="FileText" weight="bold" size={14} color="currentColor" />
              Download {gameTypeLabel(engagementType)} template
            </button>
          </div>
          {/* Beside the template it pairs with, and only for the types whose
              prompt exists — authoringPrompt() returns null for the rest, so
              adding a type later is a config entry, not panel surgery. */}
          {authoringPrompt(engagementType) && (
            <div className="qsets-route">
              <span className="qsets-route-nm">Use your own chatbot</span>
              <p className="qsets-route-when">
                Best when you would rather drive the AI yourself. Paste this prompt and the
                template into Claude or ChatGPT and upload the CSV it writes.
              </p>
              <button
                type="button"
                className="qsets-btn"
                onClick={copyAuthoringPrompt}
                title="Copy instructions you can paste into Claude or ChatGPT, together with the downloaded template, to have it write the CSV for you. The bits you fill in (topic, count, difficulty…) are marked in [BRACKETS]."
              >
                <Icon name="ClipboardText" weight="bold" size={14} color="currentColor" />
                Copy AI authoring prompt
              </button>
            </div>
          )}
          {engagementType === 'call-and-answer' && (
            <div className="qsets-route">
              <span className="qsets-route-nm">Start from the artwork template</span>
              <p className="qsets-route-when">
                Best when the round is pictures: players title a famous artwork, then vote. Same
                columns as above plus an Image one.
              </p>
              <button
                type="button"
                className="qsets-btn"
                onClick={() => downloadTemplate('art-title')}
                title="Call and Answer template with an Image column: players title a famous artwork, then vote"
              >
                <Icon name="Image" weight="bold" size={14} color="currentColor" />
                Download Art Title template
              </button>
            </div>
          )}
          {showManualBuilder && (
          <div className="qsets-route">
            <span className="qsets-route-nm">Manual builder</span>
            <p className="qsets-route-when">
              Best when you are writing three or four questions. Costs you time, and it opens in
              a second tab that does not know about this set.
            </p>
            <button type="button" className="qsets-btn" onClick={() => window.open('/builder', '_blank')}>
              <Icon name="Palette" weight="duotone" size={14} color="currentColor" />
              Manual builder
            </button>
          </div>
          )}
        </div>
      </div>

      <div className="qsets-section">
        {/* THE ROUTE EVERY OTHER ONE COMPILES DOWN TO, said plainly — the
            mockup's phrase. Three of the routes above end here holding a CSV,
            and a newcomer who has just downloaded a template has no way to know
            that this is where it goes. */}
        <h4>…then upload it here</h4>
        <p className="qsets-route-when" style={{ margin: '-4px 0 10px' }}>
          Where every route above ends up, and the only one that loses nothing. Already have a
          CSV? Start here.
        </p>

        <div className="qsets-file">
          <input
            type="file"
            id="qsets-file-upload"
            aria-label="CSV file"
            accept=".csv,.json"
            onChange={handleFileSelect}
          />
          {file && (
            <span className="qsets-dim">
              {file.name}
              {report ? ` · ${describePreflight(report)}` : ''}
            </span>
          )}
        </div>

        {report && <PreflightReport report={report} />}

        <div className="qsets-grid" style={{ marginTop: '14px' }}>
          <div className="qsets-field">
            <label htmlFor="qsets-title">Question set title *</label>
            <input
              id="qsets-title"
              type="text"
              className="qsets-input"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="A descriptive title"
            />
          </div>

          <div className="qsets-field">
            <label htmlFor="qsets-description">Description</label>
            <input
              id="qsets-description"
              type="text"
              className="qsets-input"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Brief description of this question set"
            />
          </div>

          {showAdvancedFields && (
          <>
          <div className="qsets-field">
            <label htmlFor="qsets-custom-instructions">
              Custom instructions{' '}
              <button
                type="button"
                className="qsets-btn qsets-btn--link"
                onClick={() => setShowDefaultInstructions(!showDefaultInstructions)}
              >
                {showDefaultInstructions ? '(hide default)' : '(show default)'}
              </button>
            </label>
            {showDefaultInstructions && <small>Default: {defaultInstructions}</small>}
            <textarea
              id="qsets-custom-instructions"
              className="qsets-input"
              rows="3"
              value={customInstructions}
              onChange={(event) => setCustomInstructions(event.target.value)}
              placeholder={defaultInstructions}
            />
          </div>

          <div className="qsets-field">
            <label htmlFor="qsets-ai-context">AI context instructions</label>
            <small>
              Background about your project, team or meeting, for the analysis pass. E.g.
              "Supporting engineering teams through developer advocacy in healthcare".
            </small>
            <textarea
              id="qsets-ai-context"
              className="qsets-input"
              rows="3"
              value={aiContextInstructions}
              onChange={(event) => setAiContextInstructions(event.target.value)}
              placeholder="Describe your project, team context, industry or goals…"
            />
          </div>
          </>
          )}

          {showSummaryPrompt && (
          <div className="qsets-field qsets-field--wide">
            <label htmlFor="qsets-prompt-id">AI summary prompt (optional)</label>
            <select
              id="qsets-prompt-id"
              className="qsets-input qsets-select"
              value={promptId}
              onChange={(event) => setPromptId(event.target.value)}
            >
              <option value="">Use the default prompt for {gameTypeLabel(engagementType)}</option>
              {promptChoices.map((prompt) => (
                <option key={prompt.promptId} value={prompt.promptId}>
                  {prompt.name}
                  {prompt.isDefault ? ' (default)' : ''}
                  {prompt.summaryPromptStatus === 'unusable' ? ' — not a summary prompt' : ''}
                </option>
              ))}
            </select>
            <small>
              Prompts for <strong>{gameTypeLabel(engagementType)}</strong> sets only.
              {hiddenPromptCount > 0
                ? ` ${hiddenPromptCount} prompt${hiddenPromptCount === 1 ? '' : 's'} for other game types, and generation prompts, are not offered.`
                : ''}
            </small>
            <PromptShapePreview promptId={promptId} prompts={promptChoices} />
          </div>
          )}
        </div>

        <div className="qsets-actions">
          <button type="button" className="qsets-btn qsets-btn--lg qsets-btn--primary" disabled={!canUpload} onClick={upload}>
            {isUploading ? 'Uploading…' : 'Upload question set'}
          </button>
          {blocked && <span className="qsets-dim">Fix what stops the import first — nothing has been sent.</span>}
        </div>

        {status && status.text && (
          <div
            className={`qsets-alert${status.tone === 'error' ? ' qsets-alert--error' : ''}${
              status.tone === 'success' ? ' qsets-alert--success' : ''
            }`}
            style={{ marginTop: '12px' }}
            role={status.tone === 'error' ? 'alert' : 'status'}
          >
            <Icon
              name={status.tone === 'error' ? 'Warning' : 'Check'}
              weight="fill"
              size={16}
              color="currentColor"
            />
            <span>{status.text}</span>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * The three tiers, drawn as three different things because they are three
 * different things: one stops the write, one loses rows inside a write that
 * reports success, one loses fields inside rows that all import.
 */
export function PreflightReport({ report }) {
  if (!report) return null;
  const clean = !report.blocking.length && !report.skipped.length && !report.gaps.length;

  return (
    <div className="qsets-pf">
      {report.blocking.length > 0 && (
        <section className="qsets-pf-tier qsets-pf--stop">
          <h5>1. Stops the import</h5>
          {report.blocking.map((item) => (
            <div key={item.code}>
              <p>
                <strong>{item.title}</strong> {item.detail}
              </p>
            </div>
          ))}
          <p className="qsets-dim">Nothing has been sent to the server.</p>
        </section>
      )}

      {report.skipped.length > 0 && (
        <section className="qsets-pf-tier qsets-pf--skip">
          <h5>
            2. Would be skipped without telling you{' '}
            <span className="qsets-dim">
              {report.skippedRowCount} of {report.dataRowCount} data rows
            </span>
          </h5>
          <table className="qsets-pf-tbl">
            <thead>
              <tr>
                <th>Row</th>
                <th>Problem</th>
                <th>In the file</th>
                <th>Result</th>
              </tr>
            </thead>
            <tbody>
              {report.skipped.slice(0, 50).map((row) => (
                <tr key={`${row.row}-${row.problem}`}>
                  <td>{row.row}</td>
                  <td>{row.problem}</td>
                  <td className="qsets-mono">{row.excerpt}</td>
                  <td>{row.result}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {report.gaps.length > 0 && (
        <section className="qsets-pf-tier qsets-pf--gap">
          <h5>3. Known importer gaps this file will hit</h5>
          <ul>
            {report.gaps.map((gap) => (
              <li key={gap.code}>
                <strong>{gap.title}</strong> {gap.detail}
              </li>
            ))}
          </ul>
        </section>
      )}

      {clean && (
        <section className="qsets-pf-tier qsets-pf--ok">
          <h5>Nothing to fix</h5>
          <p>
            {report.importedCount} question{report.importedCount === 1 ? '' : 's'} in{' '}
            {report.categories.length} categor{report.categories.length === 1 ? 'y' : 'ies'}, read
            in your browser. No row would be dropped.
          </p>
        </section>
      )}
    </div>
  );
}
