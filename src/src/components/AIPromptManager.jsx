import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import './AIPromptManager.css';
import { authFetch } from '../auth/authFetch';
import { normalizeGameType } from '../config/gameTypes';
import {
  unknownVariableTokens,
  extractVariableTokens,
  extractBracketDirections,
} from '../config/templateVariables';
import Icon from './Icon';
import Modal from './Modal';
import StatusMessage from './StatusMessage';
import PromptVariableInspector, { DEFAULT_ROOM_SIZE } from './PromptVariableInspector';
import PromptAssembledPreview from './PromptAssembledPreview';
import PromptPreflightPanel, { blocksSave } from './PromptPreflightPanel';
import PromptLibraryPanel from './PromptLibraryPanel';

const API_BASE = window.API_BASE;

/**
 * `utils/promptPreflight.js`, if this build has it.
 *
 * It is owned by another stream and may not be present. A literal
 * `require('../utils/promptPreflight')` — even inside a try/catch — is a
 * webpack build ERROR when the file is absent, not a catchable one, and `npm
 * run build` must compile today. Composing the specifier makes it a runtime
 * context lookup instead, so a missing module degrades to `null` and the panel
 * says the checks did not run.
 *
 * Contract, fixed, and the panel is written against it:
 *   preflightPrompt({ instructions, outputFormat, outputSections, template,
 *                     gameType, isDefault, targetModel })
 *     => { blocking, silent, advisory, stats }
 */
/**
 * The model a summary prompt is actually read by, and it is not the model that
 * helped write it. `get-ai-summary.js:2267` invokes
 * `us.anthropic.claude-haiku-4-5-20251001-v1:0` with `max_tokens: 1024` and
 * `temperature: 0.5`. The dry run's §D.1 is binding: a prompt that behaves on a
 * large model may ramble or manufacture consensus here, so the preflight is
 * told which model it is grading for rather than assuming.
 */
const SUMMARY_MODEL_ID = 'claude-haiku-4-5-20251001';

const PREFLIGHT_MODULE = 'promptPreflight';
function loadPreflight() {
  try {
    // A DELIBERATE dynamic require: the preflight module is optional and this
    // returns null rather than failing the editor when it is absent. (Was a
    // disable directive for import/no-dynamic-require and global-require;
    // neither rule is configured, and a directive naming an unknown rule is an
    // error in itself.)
    const mod = require(`../utils/${PREFLIGHT_MODULE}`);
    const fn = mod && (mod.preflightPrompt || (mod.default && mod.default.preflightPrompt));
    return typeof fn === 'function' ? fn : null;
  } catch (err) {
    return null;
  }
}

// Canonical dashed ids — the same vocabulary as src/config/gameTypes.js and
// AIGenerationPromptEditor. `survey` is included so survey sets can carry a
// summary prompt at all; it previously matched nothing anywhere.
const GAME_TYPE_OPTIONS = [
  { value: 'call-and-answer', label: 'Call & Answer' },
  { value: 'trivia', label: 'Trivia' },
  { value: 'poll', label: 'Poll' },
  { value: 'wavelength', label: 'Wavelength' },
  { value: 'survey', label: 'Survey' }
];

/** Derived, not a second list — the default warning names the type out loud. */
const GAME_TYPE_LABELS = Object.fromEntries(
  GAME_TYPE_OPTIONS.map((t) => [t.value, t.label])
);

// Lifted to module scope so the LIST FILTER can derive from it too. The filter
// used to hardcode the call-and-answer categories, so filtering the library by
// a trivia or wavelength category was impossible — you could author one and
// never find it again.
const PROMPT_CATEGORIES = {
  'call-and-answer': [
    'lessons-learned',
    'problem-solving',
    'amazon-principles',
    'interview-prep',
    'team-building',
    'art-titles',
    'custom',
    'opinions'
  ],
  trivia: ['general', 'business', 'technology', 'history', 'science', 'custom'],
  poll: ['opinion', 'preference', 'feedback', 'evaluation', 'custom'],
  wavelength: ['word-association', 'brainstorming', 'creativity', 'team-building', 'general', 'custom'],
  survey: ['general', 'feedback', 'evaluation', 'custom']
};

/** Every category any game type offers, de-duplicated, in game-type order. */
const ALL_PROMPT_CATEGORIES = [...new Set(Object.values(PROMPT_CATEGORIES).flat())];

/**
 * The `{tokens}` in this text that nothing will ever substitute.
 *
 * Author-time gate. Deliberately a WARNING: the wall is create/update-ai-prompt,
 * which is the gate both AI helpers pass through. Blocking here would only stop
 * the one person who can already see the problem.
 */
const unknownTokensIn = (...texts) => {
  const seen = [];
  for (const text of texts) {
    for (const name of unknownVariableTokens(text)) {
      if (!seen.includes(name)) seen.push(name);
    }
  }
  return seen;
};

/**
 * THE TWO HALVES, and why they are named rather than numbered.
 *
 * The fields have always been `instructions` and `outputFormat`, labelled
 * "1. General Instructions" and "2. Output Format (Markdown)". Those labels
 * describe the FORM, not the model: neither says that the first half is where
 * the round's data goes. So a careful author put the persona in the first,
 * the whole layout in the second, and no variable carrying the responses in
 * either — and the model was handed a question, an instruction to critique an
 * answer, and no answer. It replied by asking for one, and that reply was
 * stored and read to the room.
 *
 * The storage keys do not change; only what the screen calls them does. The
 * lambda concatenates `instructions + '\n\n' + outputFormat` and substitutes
 * over the WHOLE result (get-ai-summary.js:2146, :2205), so variables in the
 * first half have always worked. Nothing in the engine had to move for this.
 */
const HALVES = {
  instructions: {
    field: 'instructions',
    label: 'What the AI is given',
    testId: 'prompt-half-given',
  },
  outputFormat: {
    field: 'outputFormat',
    label: 'What the AI writes',
    testId: 'prompt-half-writes',
  },
};

// AI Prompt Editor Modal Component
function AIPromptEditor({ prompt, isNew = false, onSave, onCancel }) {
  const [formData, setFormData] = useState({
    name: prompt?.name || '',
    description: prompt?.description || '',
    // This manager only ever authors ANALYSIS (summary) prompts. It used not to
    // send promptType at all, so create-ai-prompt.js's old `= 'generation'`
    // default persisted every one of them mislabeled (D15).
    promptType: 'analysis',
    // Canonical dashed ids, matching config/gameTypes.js. Storing
    // `callandanswer` here while the generation editor stored
    // `call-and-answer` is what made every game-type filter miss (R3).
    gameType: normalizeGameType(prompt?.gameType),
    category: prompt?.category || '',
    scenario: prompt?.scenario || '',
    template: prompt?.template || '',
    instructions: prompt?.instructions || '',
    outputFormat: prompt?.outputFormat || '',
    status: prompt?.status || 'draft',
    tags: prompt?.tags || [],
    isDefault: prompt?.isDefault || false,
    questionSetIds: prompt?.questionSetIds || []
  });

  const [tagInput, setTagInput] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  /**
   * WHAT WENT WRONG, ON THE SURFACE THE PERSON IS LOOKING AT.
   *
   * These three were `alert()`. An alert states the severity ("Failed to
   * update prompt: …"), blocks the whole window, and leaves nothing behind
   * when it is dismissed — so a failed save looked exactly like a save that
   * had not been pressed yet, and the only record of it was in the console.
   * The banner lives in the footer, beside the button that failed, and stays
   * until the next attempt.
   */
  const [notice, setNotice] = useState('');

  /**
   * THE ONE WAY OUT, AND WHAT IT COSTS.
   *
   * Commit `4fd425d6` is the worked example: a dialog whose exits do not all
   * route through one `requestClose` ends up with a Cancel that silently bins
   * an afternoon's work and an X that does something else. This form is the
   * tallest in the product, so "did I lose it?" is the expensive question.
   *
   * Dirty is measured against the working copy this editor OPENED with, not
   * against a flag set by each handler — a flag has to be set in every place
   * that writes, and `handleGenerateWithAI` and `insertVariable` both write.
   */
  const openedWith = useRef(null);
  if (openedWith.current === null) openedWith.current = JSON.stringify(formData);
  const isDirty = JSON.stringify(formData) !== openedWith.current;
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  const requestClose = useCallback(() => {
    if (!onCancel) return;
    if (isDirty) {
      setConfirmDiscard(true);
      return;
    }
    onCancel();
  }, [onCancel, isDirty]);
  /**
   * One textarea per half, and the half a click currently aims at.
   *
   * The palette used to hold a single ref — the output format's — so every
   * variable an author inserted landed in the half that describes the REPLY.
   * There was no way to put one in the half that carries the data except by
   * typing it, and nothing on screen suggested you should. That is the
   * mechanical half of the defect this editor exists to make hard.
   *
   * The default is the input half, deliberately: data belongs there, and the
   * previous default is the one that shipped the bad prompt.
   */
  /*
    A REF, NOT STATE, and the first cut of this got it wrong in a way worth
    recording: an inline `ref={(node) => setHalfRefs(...)}` callback is a NEW
    function on every render, so React detaches the old ref (calling it with
    null) and attaches the new one on each commit. With a setState inside, that
    is an unconditional render loop — "Maximum update depth exceeded", every
    test in three suites. Nothing reads these nodes during render; only the
    insert handler does, at event time. That is exactly what a ref is for.
  */
  const halfRefs = useRef({ instructions: null, outputFormat: null });
  const [activeHalf, setActiveHalf] = useState('instructions');
  const [isGeneratingWithAI, setIsGeneratingWithAI] = useState(false);
  const [savedInstructions, setSavedInstructions] = useState('');
  const [savedOutputFormat, setSavedOutputFormat] = useState('');

  // The catalogue used to be redeclared here, 49 entries long, and then read
  // straight out of config/templateVariables.js. It is now read by
  // PromptVariableInspector, which does not trust the catalogue's descriptions
  // — see the header of that file for why.

  // Author-time gate: name the tokens nothing can fill, as they are typed.
  const unknownTokens = unknownTokensIn(formData.outputFormat, formData.instructions);

  /* ---- what this prompt will actually do, before it is saved ------------- */

  // The sample room the preview and the inspector share, so the value shown
  // beside a variable is the value substituted into the preview. Two different
  // sample sets on one screen would be a worse lie than none.
  const [roomSize, setRoomSize] = useState(DEFAULT_ROOM_SIZE);

  const preflightPrompt = useMemo(() => loadPreflight(), []);
  const report = useMemo(() => {
    if (!preflightPrompt) return null;
    try {
      return preflightPrompt({
        instructions: formData.instructions,
        outputFormat: formData.outputFormat,
        outputSections: prompt?.outputSections,
        template: formData.template,
        gameType: normalizeGameType(formData.gameType),
        isDefault: formData.isDefault,
        /*
          THE ARGUMENT THIS CALL WAS MISSING, and it is the whole reason
          `e8c167d1` protected nothing.

          `promptPreflight.js:933` gates the `no-answer-variable` rule on
          `String(input.promptType || '') === 'analysis'` — narrowed on purpose,
          because a first version treated a missing promptType as "analysis" and
          lit up ten question-GENERATION defaults. Correct rule, correct
          narrowing — and this call site never passed the field, so
          `input.promptType` was `undefined` on every keystroke and the rule
          could not fire in the editor at all.

          `promptPreflight.test.js:780-831` exercises the rule with an explicit
          `promptType`, so the module was green and the screen was unprotected:
          the standing landmine "test the call site, not just the module",
          reproduced exactly. The editor authors analysis prompts only — the
          field is hardcoded in formData for the same reason — so it is passed
          from formData rather than re-derived, and a call-site test now covers
          it.
        */
        promptType: formData.promptType,
        targetModel: SUMMARY_MODEL_ID,
      });
    } catch (err) {
      // A preflight that throws must not take the editor down with it. The
      // panel's absent state then says the checks did not run, which is true.
      console.error('promptPreflight threw; treating the checks as not run', err);
      return null;
    }
  }, [
    preflightPrompt,
    formData.instructions,
    formData.outputFormat,
    formData.template,
    formData.gameType,
    formData.isDefault,
    formData.promptType,
    prompt,
  ]);

  const saveBlocked = blocksSave(report);

  // Every token the author has written, for the "In your prompt" mark in the
  // inspector. Unknown ones are included deliberately — a token you invented is
  // exactly the one you want to find in the list and fail to find.
  const usedTokens = useMemo(
    () => [
      ...new Set([
        ...extractVariableTokens(formData.instructions || ''),
        ...extractVariableTokens(formData.outputFormat || ''),
        ...extractVariableTokens(formData.template || ''),
      ]),
    ],
    [formData.instructions, formData.outputFormat, formData.template]
  );

  /**
   * The variables the INPUT half carries — the data the model will actually
   * receive.
   *
   * This is the reading that was impossible to take before. The prompt that
   * broke a live session had `{questionTitle}` and `{questionDetail}` and
   * nothing else, and no surface in the product would tell its author that the
   * responses were not among them.
   */
  const givenTokens = useMemo(
    () => extractVariableTokens(formData.instructions || ''),
    [formData.instructions]
  );

  /**
   * The `[bracketed]` spans in the OUTPUT half.
   *
   * Nothing substitutes these. The model reads the words. Listing them under
   * the half, labelled as directions rather than slots, is the smallest thing
   * that makes the distinction visible at the moment it is being typed —
   * `[Summary of the core idea/response being analyzed]` looked finished, and
   * arrived at the model as a request it then answered.
   */
  const bracketDirections = useMemo(
    () => extractBracketDirections(formData.outputFormat || ''),
    [formData.outputFormat]
  );

  /**
   * Insert at the cursor of whichever half is in play, not always the output.
   *
   * `activeHalf` follows focus and starts on the input half. A click with
   * nothing focused therefore puts data where data goes.
   */
  const insertVariable = (variableName) => {
    const field = HALVES[activeHalf] ? activeHalf : 'instructions';
    const node = halfRefs.current[field];
    const current = formData[field] || '';
    const token = `{${variableName}}`;

    // No node yet (first render, or a half that has never mounted): append
    // rather than drop the click on the floor. Losing the insertion silently is
    // the same class of failure as the variable that resolves to nothing.
    const start = node ? node.selectionStart : current.length;
    const end = node ? node.selectionEnd : current.length;
    const next = current.substring(0, start) + token + current.substring(end);

    setFormData({ ...formData, [field]: next });

    if (node) {
      const caret = start + token.length;
      setTimeout(() => {
        node.setSelectionRange(caret, caret);
        node.focus();
      }, 0);
    }
  };

  const gameTypes = GAME_TYPE_OPTIONS;

  const handleSubmit = async (e) => {
    e.preventDefault();
    // The disabled button is not the gate. Pressing Enter in any text input
    // submits a form whose submit button is disabled, which is how a "blocked"
    // save ships anyway. This is the gate.
    if (saveBlocked) return;
    setIsSaving(true);
    setNotice('');

    try {
      const endpoint = isNew 
        ? `${API_BASE}admin/ai-prompts`
        : `${API_BASE}admin/ai-prompts/${prompt.promptId}`;
      
      const method = isNew ? 'POST' : 'PUT';
      
      const response = await authFetch(endpoint, {
        method,
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(formData)
      });

      if (!response.ok) {
        throw new Error(`Failed to ${isNew ? 'create' : 'update'} prompt`);
      }

      const result = await response.json();
      onSave(result);
    } catch (error) {
      console.error('Error saving prompt:', error);
      // The consequence, not the severity: nothing was written, and the words
      // on screen are the only copy of them.
      setNotice(
        `Nothing was saved — the ${isNew ? 'create' : 'update'} was refused (${error.message}). `
        + 'Your text is still in this form and nowhere else; leave the dialog open and try again.'
      );
    } finally {
      setIsSaving(false);
    }
  };

  const handleAddTag = () => {
    if (tagInput.trim() && !formData.tags.includes(tagInput.trim())) {
      setFormData({ ...formData, tags: [...formData.tags, tagInput.trim()] });
      setTagInput('');
    }
  };

  const handleRemoveTag = (tag) => {
    setFormData({ ...formData, tags: formData.tags.filter(t => t !== tag) });
  };

  // Magic wand AI generation handler
  const handleGenerateWithAI = async () => {
    if (!formData.gameType) {
      setNotice('Please select an engagement type first — the generator writes against that type\'s variables, and with none chosen it has no list to write from.');
      return;
    }

    setIsGeneratingWithAI(true);
    setNotice('');
    
    // Save current values for revert functionality
    setSavedInstructions(formData.instructions);
    setSavedOutputFormat(formData.outputFormat);

    try {
      const response = await authFetch(`${API_BASE}admin/ai-generate-prompt`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          gameType: formData.gameType,
          category: formData.category || 'general',
          currentInstructions: formData.instructions,
          currentOutputFormat: formData.outputFormat,
          promptName: formData.name,
          description: formData.description
        })
      });

      if (!response.ok) {
        // The handler now rejects an unrecognised game type by name rather than
        // silently generating against an empty variable list. Discarding that
        // message would put the loudness back where nobody can hear it.
        const detail = await response.json().catch(() => null);
        throw new Error(detail?.message || detail?.error || 'Failed to generate AI prompt');
      }

      const result = await response.json();
      
      // Ensure response fields are strings, not objects
      const safeInstructions = typeof result.instructions === 'string' 
        ? result.instructions 
        : (result.instructions ? JSON.stringify(result.instructions, null, 2) : '');
      
      const safeOutputFormat = typeof result.outputFormat === 'string' 
        ? result.outputFormat 
        : (result.outputFormat ? JSON.stringify(result.outputFormat, null, 2) : '');
      
      // Update the form with generated content
      setFormData(prev => ({
        ...prev,
        instructions: safeInstructions || prev.instructions,
        outputFormat: safeOutputFormat || prev.outputFormat
      }));

    } catch (error) {
      console.error('Error generating AI prompt:', error);
      // Nothing in the form was touched, which is the fact worth stating: the
      // old alert read like the generation had half-happened.
      setNotice(`The generator wrote nothing (${error.message}). Both halves are exactly as you left them.`);
    } finally {
      setIsGeneratingWithAI(false);
    }
  };

  // Revert to saved values
  const handleRevert = () => {
    setFormData(prev => ({
      ...prev,
      instructions: savedInstructions,
      outputFormat: savedOutputFormat
    }));
    
    // Clear saved values
    setSavedInstructions('');
    setSavedOutputFormat('');
  };

  return (
    /*
      THROUGH THE PRIMITIVE, NOT A HAND-ROLLED OVERLAY.
      This was a bare `<div className="prompt-editor-overlay">`: no Escape, no
      focus trap, no scroll lock, no `role="dialog"` and no accessible name —
      on the tallest form in the product, where the page behind it scrolled
      under your cursor while you typed. `Modal` owns all five.

      `closeOnBackdrop={false}` and `closeOnEscape={() => !isDirty}` are the
      same pair `QuestionSetEditor`'s container uses: a stray tap or a reflexive
      Escape must not bin a half-written prompt. They are not a substitute for
      an exit — there are two, the × and the Cancel, and both go through
      `requestClose`.
    */
    <Modal
      overlayClassName="pmgr-scrim"
      contentClassName="pmgr-modal pmgr-modal--wide"
      onClose={requestClose}
      closeOnBackdrop={false}
      closeOnEscape={() => !isDirty}
      labelledBy="pmgr-editor-title"
    >
        <div className="pmgr-modal-head">
          <h2 id="pmgr-editor-title">{isNew ? 'Create New AI Prompt' : 'Edit AI Prompt'}</h2>
          <button
            type="button"
            className="pmgr-x"
            onClick={requestClose}
            aria-label="Close the prompt editor"
          >
            ×
          </button>
        </div>

        <form onSubmit={handleSubmit} className="prompt-editor-form">
          <div className="form-group">
            <label>Prompt Name *</label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder="e.g., Lessons Learned - Call and Answer"
              required
            />
          </div>

          <div className="form-group">
            <label>Description</label>
            <textarea
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              placeholder="Describe what this prompt does..."
              rows="3"
            />
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>Game Type *</label>
              <select
                value={formData.gameType}
                onChange={(e) => setFormData({ 
                  ...formData, 
                  gameType: e.target.value,
                  category: '' // Reset category when game type changes
                })}
                required
              >
                {gameTypes.map(type => (
                  <option key={type.value} value={type.value}>{type.label}</option>
                ))}
              </select>
            </div>

            {/*
              CATEGORY AND SCENARIO ARE GONE FROM THIS FORM, on the owner's
              call: "i think the Category, Scenario are not really helpful".

              Neither reaches the model. `category` is a list-filter facet and a
              hint passed to the AI generator; `scenario` is passed to the
              advisor and to nothing else. Both were sitting in the top third of
              the editor, above the two fields that decide what the summary
              says, and an author reads down.

              THE STORED VALUES ARE NOT DISCARDED. Both stay in `formData`,
              initialised from the record and submitted unchanged, so editing a
              prompt authored before this change does not silently strip its
              category and orphan it from the library's category filter. The
              filter still offers every category that exists. Restoring the two
              controls is re-adding two <div>s; nothing else in the file assumes
              they are absent.
            */}

            <div className="form-group">
              <label>Status</label>
              <select
                value={formData.status}
                onChange={(e) => setFormData({ ...formData, status: e.target.value })}
              >
                <option value="draft">Draft</option>
                <option value="active">Active</option>
                <option value="archived">Archived</option>
              </select>
            </div>
          </div>

          {/*
            ============================================================
            THE TWO HALVES.
            ============================================================
            One grid: the two authored halves in the left column, the
            variable rail in the right, so a variable can be inserted into
            either half from one place. The palette used to live inside the
            output format's own container, which said — structurally, before
            anybody read a word — that variables belong to the reply.
          */}
          <div className="prompt-build">
            <div className="prompt-build-halves">
              {/*
                THE CONVENTION, STATED. `{}` and `[]` look alike, sit side by
                side in every prompt in this product, and do opposite things.
                Nothing in the editor had ever said so, and a live session was
                summarised by a model politely asking its author for the
                responses — because `[Summary of the core idea/response being
                analyzed]` reads like a slot and is prose.

                This is an owner decision that was asked and not answered. It is
                built because the mistake it prevents is a real outage, and it
                is four lines of copy to remove if he disagrees.
              */}
              <div className="prompt-convention" data-testid="prompt-convention">
                <h4>Two kinds of bracket, and they do opposite things</h4>
                <ul>
                  <li>
                    <code className="pc-brace">{'{braces}'}</code>
                    <span>
                      <strong>are replaced with real data</strong> before the model reads a word of
                      this prompt. Pick them from the list — anything else is left on screen as the
                      characters you typed.
                    </span>
                  </li>
                  <li>
                    <code className="pc-bracket">[brackets]</code>
                    <span>
                      <strong>are prose.</strong> Nothing replaces them. The model reads the words
                      inside as an instruction, so <em>[Summary of the responses]</em> tells it to
                      write a summary &mdash; it does not hand it the responses.
                    </span>
                  </li>
                </ul>
              </div>

          <div className="form-group prompt-half prompt-half--given" data-testid="prompt-half-given">
            <div className="label-with-actions">
              <label htmlFor="prompt-input-half">1. What the AI is given</label>
              <div className="magic-wand-actions">
                <button 
                  type="button" 
                  className="magic-wand-btn"
                  onClick={handleGenerateWithAI}
                  disabled={isGeneratingWithAI || !formData.gameType}
                  title="Generate AI-powered prompt based on game type and category"
                >
                  {isGeneratingWithAI
                    ? <Icon name="Timer" weight="bold" size={16} color="var(--muted)" />
                    : <Icon name="MagicWand" weight="duotone" size={16} color="var(--primary)" />}
                  {' '}AI Generate
                </button>
                {(savedInstructions || savedOutputFormat) && (
                  <button 
                    type="button" 
                    className="revert-btn"
                    onClick={handleRevert}
                    title="Restore your original text"
                  >
                    <Icon name="ArrowCounterClockwise" weight="bold" size={16} color="currentColor" /> Revert
                  </button>
                )}
              </div>
            </div>
            <p className="prompt-half-lede">
              Everything the model knows about this round arrives here, and nowhere else. Put the
              voice you want first, then the data: one <code>{'{variable}'}</code> per line, with a
              label in front of it, is the shape that reads best.
            </p>
            <textarea
              id="prompt-input-half"
              data-testid="prompt-input-textarea"
              ref={(node) => { halfRefs.current.instructions = node; }}
              onFocus={() => setActiveHalf('instructions')}
              value={formData.instructions}
              onChange={(e) => setFormData({ ...formData, instructions: e.target.value })}
              placeholder={'You are a helpful consultant. Here is what was said.\n\n'
                + 'Question:  {questionInfo}\n'
                + 'Responses: {topVotedAnswers}\n'
                + 'Standing:  {cumulativeScores}'}
              rows="4"
              required
            />

            {/*
              WHAT THE MODEL WILL ACTUALLY RECEIVE, counted from this half.

              A reading that could not be taken before. The prompt that broke a
              live session carried {questionTitle} and {questionDetail} and
              nothing else; every screen it passed through showed a well-formed
              prompt. The empty case is called out at the point of authorship —
              the preflight below blocks the save, but a blocked save is read
              after the writing, and this is read during it.
            */}
            {givenTokens.length > 0 ? (
              <div className="prompt-readout" data-testid="prompt-given-readout">
                <span className="prompt-readout-l">The model receives</span>
                <span className="prompt-readout-v">
                  {givenTokens.map((name) => (
                    <code key={name}>{`{${name}}`}</code>
                  ))}
                </span>
              </div>
            ) : (
              <div
                className="prompt-readout prompt-readout--none"
                data-testid="prompt-given-empty"
                role="status"
              >
                <Icon name="Warning" weight="fill" size={14} color="currentColor" />{' '}
                <strong>This half names no data.</strong> The model will be given a voice, a layout,
                and nothing about the round &mdash; not the question, not the responses. A summary
                prompt in that state replies by asking for the answers, and that reply is what the
                room reads.
              </div>
            )}

            <small className="form-help">
              Stored as <code>instructions</code>. Variables here are substituted exactly as they
              are in the half below &mdash; the engine replaces tokens across the whole assembled
              prompt (<code>get-ai-summary.js:2205</code>), not just the output format.
            </small>
          </div>

          <div
            className="form-group template-group prompt-half prompt-half--writes"
            data-testid="prompt-half-writes"
          >
            <label htmlFor="prompt-output-half">2. What the AI writes</label>
            <p className="prompt-half-lede">
              The shape of the reply, in Markdown. Use <code>[square brackets]</code> to say what
              each section should contain &mdash; they are directions the model reads, so describe
              the writing you want, and leave the data to the half above.
            </p>
            <div className="template-editor-container">
              <div className="template-textarea-container">
                <textarea
                  id="prompt-output-half"
                  data-testid="prompt-output-textarea"
                  ref={(node) => { halfRefs.current.outputFormat = node; }}
                  onFocus={() => setActiveHalf('outputFormat')}
                  value={formData.outputFormat}
                  onChange={(e) => setFormData({ ...formData, outputFormat: e.target.value })}
                  placeholder={'**RADIO SHOW REVIEW**\n\n'
                    + '## Summary\n'
                    + '[What was asked, and what the room said, in three sentences]\n\n'
                    + '## Discussion\n'
                    + '[Two questions worth asking this room next]\n\n'
                    + 'Bold, italic, `code`, lists, tables and quotes all render. '
                    + 'Images, HTML and nested lists do not.'}
                  rows="12"
                  required
                />
              </div>
            </div>

            {/*
              THE BRACKETS, LISTED BACK. Square brackets are the affordance that
              made the broken prompt look finished, and the only cure that
              scales is showing the author their own brackets under the label
              "direction", not "slot", while they are typing them.
            */}
            {bracketDirections.length > 0 && (
              <div className="prompt-readout" data-testid="prompt-writes-readout">
                <span className="prompt-readout-l">
                  {bracketDirections.length === 1 ? 'One direction' : `${bracketDirections.length} directions`},
                  read as prose
                </span>
                <span className="prompt-readout-v">
                  {bracketDirections.slice(0, 6).map((body) => (
                    <code key={body}>{`[${body}]`}</code>
                  ))}
                  {bracketDirections.length > 6 && <em>+{bracketDirections.length - 6} more</em>}
                </span>
              </div>
            )}

            {unknownTokens.length > 0 && (
              <div className="unknown-variable-warning" data-testid="unknown-variable-warning">
                <Icon name="Warning" weight="fill" size={16} color="var(--danger)" />{' '}
                <strong>
                  {unknownTokens.length === 1 ? 'This variable does not exist' : 'These variables do not exist'}:
                </strong>{' '}
                {unknownTokens.map((name) => `{${name}}`).join(', ')}
                {' — '}
                nothing replaces them, so they appear on screen as literal braces and the
                prompt will be rejected when you save. Use a variable from the panel.
              </div>
            )}
            <small className="form-help">
              Stored as <code>outputFormat</code>. The system appends its own FORMAT contract after
              this, and that contract overrides any formatting instruction written here &mdash; see
              the preview below.
            </small>
          </div>
            </div>

            {/*
              THE RAIL. One picker, two possible targets, and it says which one
              it is aimed at. Before this it held a single ref — the output
              format's — so every variable an author inserted landed in the half
              that describes the reply, and the half that carries the data could
              only be filled by typing.

              THE ROWS ARE STILL BUILT FROM THE EMITTER, not from the
              catalogue's prose: `voteTally`'s description has read back
              `votingBreakdown`'s shape since D11. The catalogue's description
              and example are now shown too, underneath, labelled as its words —
              additive, and ranked below the sample on purpose.
            */}
            <aside className="prompt-build-rail">
              <PromptVariableInspector
                gameType={normalizeGameType(formData.gameType)}
                roomSize={roomSize}
                usedNames={usedTokens}
                onInsert={insertVariable}
                insertTargetLabel={(HALVES[activeHalf] || HALVES.instructions).label}
              />
            </aside>
          </div>

          {/*
            3. WHAT THIS PROMPT WILL DO. Everything above is what you typed;
            everything here is what the model gets. The two are not the same
            string and the difference is where six shipped defects lived.
          */}
          <div className="form-group prompt-check-group">
            <label>3. Before you save</label>
            <PromptPreflightPanel report={report} unavailable={!preflightPrompt} />
            <PromptAssembledPreview
              instructions={formData.instructions}
              outputFormat={formData.outputFormat}
              template={formData.template}
              outputSections={prompt?.outputSections}
              gameType={normalizeGameType(formData.gameType)}
              roomSize={roomSize}
              onRoomSizeChange={setRoomSize}
            />
          </div>

          <div className="form-group">
            <label>Tags</label>
            <div className="tag-input-container">
              <input
                type="text"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddTag())}
                placeholder="Add tags..."
              />
              <button type="button" onClick={handleAddTag} className="btn-add-tag">Add</button>
            </div>
            <div className="tags-list">
              {formData.tags.map(tag => (
                <span key={tag} className="tag">
                  {tag}
                  <button type="button" onClick={() => handleRemoveTag(tag)}>×</button>
                </span>
              ))}
            </div>
          </div>

          {/*
            THE BLAST RADIUS, AT THE POINT OF THE DECISION.
            The old label read "Set as default prompt for this category" and it
            was wrong in the direction that matters. `create-ai-prompt.js:230`
            and `update-ai-prompt.js:255` clear isDefault from every other prompt
            of this GAME TYPE, not this category — deliberately, because
            `findDefaultPromptId` (get-ai-summary.js:344-352) looks the default
            up by game type alone, and per-category defaults once produced seven
            simultaneous call-and-answer "defaults" and an arbitrary winner.
            So ticking this box silently demotes whatever is default now, and
            unticking it later does NOT put that prompt back
            (update-ai-prompt.js:320-333 deletes the lookup and restores
            nothing). The screen used to say none of this.
          */}
          <div className="form-group checkbox-group default-group">
            <label>
              <input
                type="checkbox"
                checked={formData.isDefault}
                onChange={(e) => setFormData({ ...formData, isDefault: e.target.checked })}
              />
              Make this the default {GAME_TYPE_LABELS[normalizeGameType(formData.gameType)] || ''} summary prompt
            </label>
            <p className="default-blast-note">
              Not a per-category default. There is exactly one default per engagement type, and it
              is what runs for <strong>every</strong> {GAME_TYPE_LABELS[normalizeGameType(formData.gameType)] || 'session'} set
              in this environment that has no prompt of its own.
            </p>
            {formData.isDefault && (
              <div className="default-blast-warning" data-testid="default-blast-warning" role="alert">
                <Icon name="Warning" weight="fill" size={16} color="currentColor" />{' '}
                <strong>
                  Saving this replaces the default for every{' '}
                  {GAME_TYPE_LABELS[normalizeGameType(formData.gameType)] || 'session'} set in this
                  environment.
                </strong>{' '}
                The prompt that is default now is demoted in the same write, with no record of
                which one it was, and un-ticking this box later does not put it back &mdash; it
                leaves the engagement type with no default at all. Hosts will not be told the
                summary changed.
              </div>
            )}
          </div>

          <div className="form-actions">
            {saveBlocked && (
              <p className="save-blocked-note" data-testid="save-blocked-note">
                Save is blocked by {report.blocking.length}{' '}
                {report.blocking.length === 1 ? 'finding' : 'findings'} above.
              </p>
            )}
            {notice && (
              <div className="pmgr-notice" data-testid="pmgr-editor-notice">
                <StatusMessage message={notice} tone="error" />
              </div>
            )}
            {/* The bottom exit. Same handler as the ×, so there is no second
                way out that skips the confirmation. */}
            <button
              type="button"
              className="btn-secondary"
              onClick={requestClose}
              data-testid="pmgr-editor-cancel"
            >
              Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={isSaving || saveBlocked}>
              {isSaving ? 'Saving...' : (isNew ? 'Create Prompt' : 'Save Changes')}
            </button>
          </div>
        </form>

        {/*
          CLOSING WITH AN UNSAVED WORKING COPY.

          Rendered INSIDE this dialog's own scrim on purpose: `Modal` picks the
          topmost dialog by DOM containment, so Escape here means "go back and
          keep them" — the safe half of the choice — and cannot fall through to
          the close it is guarding.
        */}
        {confirmDiscard && (
          <Modal
            overlayClassName="modal-overlay"
            contentClassName="modal-content"
            labelledBy="pmgr-discard-title"
            onClose={() => setConfirmDiscard(false)}
          >
            <h3 id="pmgr-discard-title">
              <Icon name="Warning" weight="fill" size={16} color="var(--primary)" />{' '}
              This prompt has never been saved
            </h3>
            <p>
              Everything typed into this form &mdash; both halves, the tags, the default
              flag &mdash; exists in this browser tab and nowhere else. Closing throws it
              away; there is no draft kept anywhere and no undo.
            </p>
            <div className="modal-actions">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setConfirmDiscard(false)}
                data-testid="pmgr-discard-keep"
              >
                Go back and keep writing
              </button>
              <button
                type="button"
                className="btn-danger"
                onClick={() => { setConfirmDiscard(false); onCancel(); }}
                data-testid="pmgr-discard-confirm"
              >
                Close and lose what I typed
              </button>
            </div>
          </Modal>
        )}
    </Modal>
  );
}

// AI Prompt Advisor Modal Component
function AIPromptAdvisor({ prompt, onClose, onApplyImprovedPrompt }) {
  const [analysisType, setAnalysisType] = useState('improve');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState(null);
  const [notice, setNotice] = useState('');

  const analysisTypes = [
    { value: 'improve', label: 'Improve Prompt', icon: 'Sparkle' },
    { value: 'validate', label: 'Validate Quality', icon: 'MagnifyingGlass' },
    { value: 'optimize', label: 'Optimize Performance', icon: 'Lightning' }
  ];

  const runAnalysis = async () => {
    setIsAnalyzing(true);
    setAnalysis(null);
    setNotice('');

    try {
      const response = await authFetch(`${API_BASE}admin/ai-prompt-advisor`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          promptText: prompt.template || (prompt.instructions + '\n\n' + prompt.outputFormat),
          gameType: prompt.gameType,
          scenario: prompt.scenario,
          analysisType,
          existingPromptId: prompt.promptId
        })
      });

      if (!response.ok) {
        throw new Error('Failed to analyze prompt');
      }

      const result = await response.json();
      setAnalysis(result.analysis);
    } catch (error) {
      console.error('Error analyzing prompt:', error);
      // Nothing was changed and nothing was stored: the prompt is exactly as it
      // was, and this reading simply did not happen.
      setNotice(`No analysis was produced (${error.message}). The prompt itself is untouched — nothing here writes to it.`);
    } finally {
      setIsAnalyzing(false);
    }
  };

  return (
    /*
      THROUGH THE PRIMITIVE, for the same five reasons as the editor. The
      backdrop is inert because an analysis takes a model call and several
      seconds, and a stray click on the darkened page behind it threw the
      result away with no way to get it back except paying for it again.
    */
    <Modal
      overlayClassName="pmgr-scrim"
      contentClassName="pmgr-modal"
      onClose={onClose}
      closeOnBackdrop={false}
      labelledBy="pmgr-advisor-title"
    >
        <div className="pmgr-modal-head">
          <h2 id="pmgr-advisor-title">
            <Icon name="MagicWand" weight="duotone" size={16} color="var(--primary)" /> AI Prompt Advisor
          </h2>
          <button
            type="button"
            className="pmgr-x"
            onClick={onClose}
            aria-label="Close the prompt advisor"
          >
            ×
          </button>
        </div>

        <div className="pmgr-advisor-body" data-testid="pmgr-advisor-body">
          <div className="prompt-info">
            <h3>{prompt.name}</h3>
            <div className="prompt-meta">
              <span className="badge">{prompt.gameType}</span>
              {prompt.category && <span className="badge">{prompt.category}</span>}
            </div>
          </div>

          <div className="analysis-types">
            {analysisTypes.map(type => (
              <label key={type.value} className={`analysis-type-option ${analysisType === type.value ? 'selected' : ''}`}>
                <input
                  type="radio"
                  value={type.value}
                  checked={analysisType === type.value}
                  onChange={(e) => setAnalysisType(e.target.value)}
                />
                <span className="type-icon"><Icon name={type.icon} weight="duotone" size={18} color="var(--primary)" /></span>
                <span className="type-label">{type.label}</span>
              </label>
            ))}
          </div>

          <button
            className="btn-primary analyze-btn"
            onClick={runAnalysis}
            disabled={isAnalyzing}
          >
            {isAnalyzing ? 'Analyzing...' : 'Run Analysis'}
          </button>

          {notice && (
            <div className="pmgr-notice" data-testid="pmgr-advisor-notice">
              <StatusMessage message={notice} tone="error" />
            </div>
          )}

          {analysis && (
            <div className="analysis-results">
              {analysisType === 'improve' && analysis.improvedPrompt && (
                <div className="result-section">
                  <h4><Icon name="Sparkle" weight="fill" size={16} color="var(--primary)" /> Improved Prompt</h4>
                  <div className="improved-prompt">
                    <pre>{analysis.improvedPrompt}</pre>
                    <div className="improved-prompt-actions">
                      <button 
                        className="btn-secondary copy-btn"
                        onClick={() => navigator.clipboard.writeText(analysis.improvedPrompt)}
                      >
                        <Icon name="ClipboardText" weight="bold" size={16} color="currentColor" /> Copy to Clipboard
                      </button>
                      <button 
                        className="btn-primary apply-btn"
                        onClick={() => {
                          onApplyImprovedPrompt(analysis.improvedPrompt);
                          onClose();
                        }}
                      >
                        <Icon name="Sparkle" weight="fill" size={16} color="var(--primary)" /> Apply to Prompt
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {analysis.overallScore && (
                <div className="result-section">
                  <h4><Icon name="ChartBar" weight="duotone" size={16} color="var(--primary)" /> Overall Score</h4>
                  <div className="score-display">
                    <div className="score-value">{analysis.overallScore}/10</div>
                    <div className="score-bar">
                      <div 
                        className="score-fill"
                        style={{ width: `${analysis.overallScore * 10}%` }}
                      />
                    </div>
                  </div>
                </div>
              )}

              {analysis.strengths && (
                <div className="result-section">
                  <h4>Strengths</h4>
                  <ul className="analysis-list">
                    {analysis.strengths.map((strength, idx) => (
                      <li key={idx}>{strength}</li>
                    ))}
                  </ul>
                </div>
              )}

              {analysis.improvements && (
                <div className="result-section">
                  <h4><Icon name="NotePencil" weight="bold" size={16} color="currentColor" /> Improvements</h4>
                  <div className="improvements-list">
                    {analysis.improvements.map((improvement, idx) => (
                      <div key={idx} className={`improvement-item priority-${improvement.priority}`}>
                        <div className="improvement-header">
                          <span className="improvement-category">{improvement.category}</span>
                          <span className="improvement-priority">{improvement.priority}</span>
                        </div>
                        <p className="improvement-issue">{improvement.issue}</p>
                        <p className="improvement-suggestion">{improvement.suggestion}</p>
                        {improvement.example && (
                          <pre className="improvement-example">{improvement.example}</pre>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {analysis.alternativeApproaches && (
                <div className="result-section">
                  <h4><Icon name="ArrowsClockwise" weight="bold" size={16} color="currentColor" /> Alternative Approaches</h4>
                  {analysis.alternativeApproaches.map((approach, idx) => (
                    <div key={idx} className="alternative-approach">
                      <h5>{approach.approach}</h5>
                      <p>{approach.description}</p>
                      <div className="approach-details">
                        <div className="pros">
                          <strong>Pros:</strong>
                          <ul>
                            {approach.pros.map((pro, i) => (
                              <li key={i}>{pro}</li>
                            ))}
                          </ul>
                        </div>
                        <div className="cons">
                          <strong>Cons:</strong>
                          <ul>
                            {approach.cons.map((con, i) => (
                              <li key={i}>{con}</li>
                            ))}
                          </ul>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {analysis.recommendations && (
                <div className="result-section">
                  <h4><Icon name="Lightbulb" weight="duotone" size={16} color="var(--primary)" /> Recommendations</h4>
                  <ul className="analysis-list">
                    {analysis.recommendations.map((rec, idx) => (
                      <li key={idx}>{rec}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>

        {/*
          THE BOTTOM EXIT THE ADVISOR NEVER HAD.

          It had an × in the header and nothing else. An `improve` analysis
          renders an improved prompt, a score, strengths, improvements,
          alternative approaches and recommendations — several screens of it —
          and the only way out was above all of them. Commit `4fd425d6` is the
          same report about the set editor: a person who has finished reading
          DOWN should not have to scroll back UP to leave.

          It sits OUTSIDE the scrolling body, so it is on screen at every scroll
          position rather than only at the end.
        */}
        <div className="form-actions">
          <button
            type="button"
            className="btn-secondary"
            onClick={onClose}
            data-testid="pmgr-advisor-close"
          >
            Close
          </button>
        </div>
    </Modal>
  );
}

// Main AI Prompt Manager Component
function AIPromptManager() {
  const [prompts, setPrompts] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  /*
    ONE FILTER OBJECT, AND NO DERIVED-STATE MIRROR.

    This used to be four `useState`s plus a `filteredPrompts` array kept in sync
    by an effect — the classic derived-state-in-state arrangement, which means
    every render draws a list computed one render ago and an effect that forgets
    a dependency simply shows the wrong rows. `filterPrompts` was also the
    source of the file's only exhaustive-deps warning. The filtering is a pure
    function of props and filters and now lives in PromptLibraryPanel, computed
    at render, the way QuestionSetsPanel does it.
  */
  const [filters, setFilters] = useState({
    search: '', gameType: 'all', category: 'all', status: 'all',
  });

  const [editingPrompt, setEditingPrompt] = useState(null);
  const [isCreating, setIsCreating] = useState(false);
  const [advisorPrompt, setAdvisorPrompt] = useState(null);

  /*
    THE FIVE `alert()`s AND TWO `window.confirm()`s THIS SCREEN USED TO RUN.

    An `alert` is not a report. It blocks the window, states the severity
    rather than the consequence, and leaves nothing behind — so "Failed to
    load prompts" was dismissed into the library's "No prompts yet" poster,
    which is the empty state that lies: an outage rendered as an empty
    collection, with a Create button as the suggested next step.

    `window.confirm` is worse for the two destructive paths, because its text
    is one line with no formatting and no room to say WHAT breaks — so both
    read "Are you sure?" and neither named the prompt, the sets pinned to it,
    or the default it was about to demote.
  */
  const [notice, setNotice] = useState('');
  const [pendingArchive, setPendingArchive] = useState(null);
  /** The promptId whose copy-to-archive round trip is in flight, or null. */
  const [copyingToArchiveId, setCopyingToArchiveId] = useState(null);
  const [confirmPopulate, setConfirmPopulate] = useState(false);
  /** The prompt whose status round trip is in flight, and the one default whose
   *  deactivation is waiting to be confirmed. See the two blocks below. */
  const [togglingId, setTogglingId] = useState(null);
  const [pendingDraft, setPendingDraft] = useState(null);

  useEffect(() => {
    fetchPrompts();
  }, []);

  const fetchPrompts = async () => {
    setIsLoading(true);
    setNotice('');
    try {
      const response = await authFetch(`${API_BASE}admin/ai-prompts?includeContent=true`);
      if (!response.ok) {
        throw new Error('Failed to fetch prompts');
      }
      const data = await response.json();
      
      // Transform the prompts to include the content from S3
      const transformedPrompts = (data.prompts || []).map(prompt => ({
        ...prompt,
        // Handle both old (template) and new (instructions + outputFormat) structure
        template: prompt.promptContent?.template || '',
        instructions: prompt.promptContent?.instructions || '',
        outputFormat: prompt.promptContent?.outputFormat || '',
        description: prompt.promptContent?.description || prompt.description || '',
        tags: prompt.promptContent?.tags || prompt.tags || []
      }));
      
      setPrompts(transformedPrompts);
    } catch (error) {
      console.error('Error fetching prompts:', error);
      /*
        THE LIST BELOW IS NOT EMPTY, IT IS UNKNOWN, and the banner has to say
        so because the panel cannot: `PromptLibraryPanel` decides between its
        two empty states from `prompts.length` and `loading` alone, so a failed
        fetch renders "No prompts yet — create your first one", which is the
        empty state that lies. Naming the outage above it is the part this
        component can fix without touching that file (AUDIT §6.2 item 9 owns it).
      */
      setNotice(
        `The prompt list could not be loaded (${error.message}). `
        + 'Anything shown below is stale or empty because of that, not because there are no prompts — '
        + 'do not create a replacement for something you cannot see.'
      );
    } finally {
      setIsLoading(false);
    }
  };

  /** The record behind the id the row hands back, for the dialog's copy. */
  const archiveTarget = pendingArchive
    ? prompts.find((p) => p.promptId === pendingArchive) || null
    : null;

  const handleDeletePrompt = (promptId) => setPendingArchive(promptId);

  /**
   * PUT A COPY IN THE SHARED ARCHIVE. The prompt is not changed and does not
   * leave the list.
   *
   * This is `POST admin/export-to-archive` — the same route the Archive panel's
   * checkbox-and-export flow uses, with one id in the array — and it is a
   * DIFFERENT OPERATION from the row's Retire button next to it. See the note
   * on the row buttons in PromptLibraryPanel.jsx for why both now exist and why
   * the names changed.
   *
   * REPORTS THE PER-ITEM FAILURE, NOT JUST THE HTTP STATUS. `export-to-archive`
   * answers 200 with `{ results: { successful, failed } }`, so an export that
   * archived nothing still arrives as a success. That is exactly how the
   * question-set export reported "export completed, 0 items exported" for a
   * whole afternoon. The per-item `error` string is the one worth showing —
   * for the em-dash failure it names the character and the code point.
   *
   * NO REFETCH. Nothing about the prompt changed, so re-reading the list would
   * only make the screen flicker to prove it.
   */
  const copyPromptToArchive = async (prompt) => {
    const promptId = prompt?.promptId;
    if (!promptId) return;
    setCopyingToArchiveId(promptId);
    setNotice('');
    try {
      const response = await authFetch(`${API_BASE}admin/export-to-archive`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ selectedItems: [promptId], exportType: 'prompts' }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        setNotice(`“${prompt.name}” was not copied to the archive: ${result.error || `HTTP ${response.status}`}. It is unchanged and still in this list.`);
        return;
      }
      const failed = result?.results?.failed || [];
      const succeeded = result?.results?.successful || [];
      if (failed.length > 0) {
        setNotice(`“${prompt.name}” was not copied to the archive: ${failed[0].error || 'the archive service refused it'} It is unchanged and still in this list.`);
        return;
      }
      if (succeeded.length === 0) {
        // 200 with neither list populated. Says so rather than claiming a copy
        // that nothing in the response evidences.
        setNotice(`The archive reported no error and no copy for “${prompt.name}”. Check the Archive tab before relying on it.`);
        return;
      }
      setNotice(`“${prompt.name}” was copied to the shared archive. It is unchanged and still in this list.`);
    } catch (error) {
      setNotice(`“${prompt.name}” was not copied to the archive: ${error.message}. It is unchanged and still in this list.`);
    } finally {
      setCopyingToArchiveId(null);
    }
  };

  const archivePrompt = async (promptId) => {
    setPendingArchive(null);
    setNotice('');

    try {
      const response = await authFetch(`${API_BASE}admin/ai-prompts/${promptId}`, {
        method: 'DELETE'
      });

      if (!response.ok) {
        throw new Error('Failed to delete prompt');
      }

      await fetchPrompts();
    } catch (error) {
      console.error('Error deleting prompt:', error);
      setNotice(`That prompt was not retired (${error.message}). It is still active and still in the list.`);
    }
  };

  /*
    ACTIVATE / DEACTIVATE FROM THE LIST.

    The owner asked for the question-set list's behaviour: click the status chip
    and it changes. `AdminPage.handleToggleActive` is the arrangement copied
    here, including the bit that is easy to get wrong — the local row is updated
    AFTER the response, never optimistically. An optimistic flip that has to be
    put back on failure spends the moment of the failure showing the wrong
    answer, which on a screen about what the AI says to a room is exactly the
    wrong place to be approximate.

    ONE FIELD IS SENT. `PUT /admin/ai-prompts/{id}` treats `undefined` as "leave
    alone" for every field, so `{ status }` moves the status and touches nothing
    else — no name, no halves, no isDefault, no questionSetIds. That is also
    what makes the S3 guard in that handler necessary; see its header.
  */
  const applyStatus = async (prompt, status) => {
    setTogglingId(prompt.promptId);
    setNotice('');

    try {
      const response = await authFetch(`${API_BASE}admin/ai-prompts/${prompt.promptId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status })
      });

      if (!response.ok) {
        const detail = await response.json().catch(() => null);
        throw new Error(detail?.message || detail?.error || `HTTP ${response.status}`);
      }

      setPrompts((prev) => prev.map(
        (p) => (p.promptId === prompt.promptId ? { ...p, status } : p)
      ));
    } catch (error) {
      console.error('Error changing prompt status:', error);
      // The consequence, not the severity: the row on screen is what is stored,
      // because it was never moved. Nobody has to reload to find out.
      setNotice(
        `“${prompt.name}” was not changed (${error.message}). It is still `
        + `${prompt.status === 'active' ? 'Active' : 'a Draft'}, which is what the row still says.`
      );
    } finally {
      setTogglingId(null);
    }
  };

  /*
    DEACTIVATING THE DEFAULT IS THE ONE CASE THAT NEEDS A SENTENCE FIRST — and
    what it needs saying is the OPPOSITE of the obvious fear.

    `findDefaultPromptId` (get-ai-summary.js:326-345) selects on `isDefault`
    alone and never reads `status`. So a default set to Draft KEEPS RUNNING for
    every set of its engagement type that has no prompt of its own. Drafting it
    does exactly one thing: `AdminPage.js:238` filters the per-set prompt picker
    to `status === 'active'`, so it stops being offered there.

    That is a row that will read "Draft" while still being what the room hears,
    and a screen that says the opposite of what the engine does is worth one
    dialog. It is a WARNING, not a refusal: nothing breaks, and the honest exit
    — make another prompt the default — is named rather than implied.
  */
  const handleToggleStatus = (prompt, status) => {
    if (status === 'draft' && prompt.isDefault) {
      setPendingDraft(prompt);
      return;
    }
    applyStatus(prompt, status);
  };

  const handleSavePrompt = async (result) => {
    setEditingPrompt(null);
    setIsCreating(false);
    await fetchPrompts();
  };

  const handleApplyImprovedPrompt = (improvedTemplate) => {
    if (advisorPrompt) {
      // Update the prompt in the state and open it for editing
      // For now, put the improved template in the outputFormat field
      const updatedPrompt = { ...advisorPrompt, outputFormat: improvedTemplate };
      setEditingPrompt(updatedPrompt);
      setAdvisorPrompt(null);
    }
  };

  const handlePopulateDefaults = () => setConfirmPopulate(true);

  const populateDefaults = async () => {
    setConfirmPopulate(false);
    setNotice('');

    try {
      setIsLoading(true);
      const response = await authFetch(`${API_BASE}admin/populate-defaults`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ overwrite: true })
      });

      if (!response.ok) {
        throw new Error('Failed to populate default prompts');
      }

      const result = await response.json();
      
      if (result.success) {
        const { created, skipped, overwritten, errors } = result.results;
        let message = 'Success! ';
        
        if (created > 0) message += `Created ${created} new prompts. `;
        if (overwritten > 0) message += `Overwritten ${overwritten} existing prompts. `;
        if (skipped > 0) message += `${skipped} prompts were skipped. `;
        if (errors > 0) message += `${errors} errors occurred. `;
        
        await fetchPrompts(); // Refresh the list, which clears `notice`…
        setNotice(message.trim()); // …so the outcome is set after it.
      } else {
        throw new Error(result.message || 'Unknown error');
      }
    } catch (error) {
      console.error('Error populating defaults:', error);
      setNotice(
        `The default prompts were not written (${error.message}). `
        + 'Whether any of them landed before it stopped is not reported by the endpoint — reload and read the list before running it again.'
      );
    } finally {
      setIsLoading(false);
    }
  };

  return (
    /*
      `.pmgr` IS THE SCOPE CLASS, and it replaced `.ai-prompt-manager` in the
      same change as the stylesheet. Every selector in AIPromptManager.css is
      now rooted at one of seven scope classes instead of declaring `.tag`,
      `.form-group`, `.btn-primary` and thirty more at the whole application —
      see that file's header, and __tests__/promptManagerScope.test.js.
    */
    <div className="pmgr">
      {/* The heading names WHICH library this is, in the words the chooser tile
          used to get here — not the section, which AdminShell's work head
          already titles "Prompts". `.pgen-header` is the same block on the
          generation side, styled by one rule, so the two places open the same
          way as well as being reached the same way. */}
      <div className="pmgr-header">
        <h2><Icon name="Sparkle" weight="duotone" size={18} color="var(--primary)" /> Engagement results prompts</h2>
        <p className="pmgr-lede">
          A summary prompt is what Workie says after a round. Each engagement type has one default;
          a question set can pin its own.
        </p>
      </div>

      {notice && (
        <div className="pmgr-status" data-testid="pmgr-notice">
          <StatusMessage message={notice} />
        </div>
      )}

      {/*
        THE LIST IS A PURE COMPONENT NOW. Everything it decides — filtering,
        the two empty states, the drop-exits — happens in PromptLibraryPanel,
        where it can be mounted and tested without mocking a fetch. This
        component keeps the fetching, the dialogs and the callbacks, exactly
        the split AdminPage/QuestionSetsPanel already uses.
      */}
      <PromptLibraryPanel
        prompts={prompts}
        loading={isLoading}
        filters={filters}
        onFilterChange={setFilters}
        gameTypeOptions={GAME_TYPE_OPTIONS}
        categoryOptions={
          filters.gameType === 'all'
            ? ALL_PROMPT_CATEGORIES
            : (PROMPT_CATEGORIES[normalizeGameType(filters.gameType)] || [])
        }
        onEdit={setEditingPrompt}
        onAdvise={setAdvisorPrompt}
        onDelete={handleDeletePrompt}
        onCreate={() => setIsCreating(true)}
        onPopulateDefaults={handlePopulateDefaults}
        onToggleStatus={handleToggleStatus}
        busyPromptId={togglingId}
        onCopyToArchive={copyPromptToArchive}
        copyingPromptId={copyingToArchiveId}
      />

      {(editingPrompt || isCreating) && (
        <AIPromptEditor
          prompt={editingPrompt}
          isNew={isCreating}
          onSave={handleSavePrompt}
          onCancel={() => {
            setEditingPrompt(null);
            setIsCreating(false);
          }}
        />
      )}

      {advisorPrompt && (
        <AIPromptAdvisor
          prompt={advisorPrompt}
          onClose={() => setAdvisorPrompt(null)}
          onApplyImprovedPrompt={handleApplyImprovedPrompt}
        />
      )}

      {/*
        RETIRE A PROMPT.

        Was `window.confirm('Are you sure you want to archive this prompt?')`,
        which named neither the prompt nor anything that depends on it. The
        three facts that decide this are all in hand before the click: whether
        it is the default for its engagement type, how many question sets pin
        it, and that Draft does the same job reversibly. RATIONALE §8: state
        the consequence, count before you ask, and offer the reversible
        neighbour.

        SAYS "RETIRE" THROUGHOUT NOW, because "archive" was two things. The row
        next to this one puts a COPY in the shared cross-tier archive and leaves
        the prompt alone; this takes the prompt out of the list and copies it
        nowhere. Sharing the word made the destructive one sound like the
        preserving one, which is how it got pressed by mistake. The `pmgr-
        archive-*` test ids are left alone deliberately — they are handles, not
        copy, and renaming them would churn every test for no reader's benefit.
      */}
      {archiveTarget && (
        <Modal
          overlayClassName="modal-overlay"
          contentClassName="modal-content"
          labelledBy="pmgr-archive-title"
          onClose={() => setPendingArchive(null)}
        >
          <h3 id="pmgr-archive-title">Retire “{archiveTarget.name}”?</h3>
          <p>
            Retiring takes it out of the pickers and out of this list. It is not deleted
            &mdash; the record and its text stay, and it can be set back to Active from the
            editor. It is <strong>not</strong> copied to the shared archive; that is the
            &ldquo;Copy to archive&rdquo; button next to it, which leaves the prompt alone.
          </p>
          {archiveTarget.isDefault && (
            /*
              WHAT RETIRING A DEFAULT ACTUALLY DOES, which is not what this
              paragraph used to claim.

              It said retiring left the engagement type "with no default at
              all, so every set of that type gets no summary". That is false,
              and it is false in the direction that matters: `findDefaultPromptId`
              (lambda-functions/game/get-ai-summary.js:326-345) selects on
              `isDefault === true` and NEVER READS `status`. A retired default
              keeps resolving and keeps running, word for word, in every room.

              So the hazard is not an outage, it is a screen that lies: the
              prompt reads as retired while the rooms still hear it. Told
              plainly, with the one real effect (AdminPage.jsx:238 filters the
              per-set picker to `status === 'active'`) and the actual exit.
            */
            <p data-testid="pmgr-archive-default">
              <strong>
                This is the default{' '}
                {GAME_TYPE_LABELS[normalizeGameType(archiveTarget.gameType)] || ''} summary prompt,
                and retiring it does not stop it running.
              </strong>{' '}
              The summary engine picks the default by its default flag and never looks at its
              status, so every set of that type without a prompt of its own keeps getting this
              one &mdash; it just stops being offered when you attach a prompt to a set. To
              actually replace it, make another prompt of this type the default; that demotes
              this one in the same save.
            </p>
          )}
          {archiveTarget.questionSetIds && archiveTarget.questionSetIds.length > 0 && (
            <p data-testid="pmgr-archive-pinned">
              <strong>
                {archiveTarget.questionSetIds.length}{' '}
                {archiveTarget.questionSetIds.length === 1 ? 'question set pins' : 'question sets pin'}{' '}
                this prompt.
              </strong>{' '}
              Those sets keep pointing at it, and what they get after this is decided by the
              summary engine, not by this screen.
            </p>
          )}
          <p>
            If the aim is only to stop hosts choosing it, <strong>Draft</strong> does that and
            reads as a work in progress rather than a retirement.
          </p>
          <div className="modal-actions">
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                const target = archiveTarget;
                setPendingArchive(null);
                setEditingPrompt(target);
              }}
              data-testid="pmgr-archive-draft"
            >
              Open it and set Draft instead
            </button>
            <button
              type="button"
              className="btn-danger"
              onClick={() => archivePrompt(archiveTarget.promptId)}
              data-testid="pmgr-archive-confirm"
            >
              Retire it
            </button>
          </div>
        </Modal>
      )}

      {/*
        DEACTIVATE THE DEFAULT.

        RATIONALE §8: state the consequence, not the severity. The consequence
        here is unusual enough to be worth the dialog — the thing an admin
        expects Draft to do to a default is the one thing it does NOT do. See
        `handleToggleStatus` for the two file:line references this copy is
        derived from; if either changes, this text is wrong and has to move
        with it.

        No confirmation on the way back to Active, and none on any non-default
        prompt: those do what they look like they do.
      */}
      {pendingDraft && (
        <Modal
          overlayClassName="modal-overlay"
          contentClassName="modal-content"
          labelledBy="pmgr-draft-title"
          onClose={() => setPendingDraft(null)}
        >
          <h3 id="pmgr-draft-title">Set “{pendingDraft.name}” to Draft?</h3>
          <p data-testid="pmgr-draft-still-runs">
            <strong>
              This is the default{' '}
              {GAME_TYPE_LABELS[normalizeGameType(pendingDraft.gameType)] || ''} summary prompt, and
              Draft does not stop it running.
            </strong>{' '}
            The summary engine picks the default by its default flag alone and never looks at
            status, so every{' '}
            {GAME_TYPE_LABELS[normalizeGameType(pendingDraft.gameType)] || 'session'} set without a
            prompt of its own keeps getting this one, word for word.
          </p>
          <p>
            What changes is the picker: a question set choosing a prompt is only offered Active
            ones, so this stops appearing there. The row will read Draft while the rooms keep
            hearing it.
          </p>
          <p>
            To actually retire it, open another prompt of this engagement type and make{' '}
            <strong>that</strong> one the default — the same save demotes this one.
          </p>
          <div className="modal-actions">
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setPendingDraft(null)}
              data-testid="pmgr-draft-cancel"
            >
              Leave it Active
            </button>
            <button
              type="button"
              className="btn-danger"
              onClick={() => {
                const target = pendingDraft;
                setPendingDraft(null);
                applyStatus(target, 'draft');
              }}
              data-testid="pmgr-draft-confirm"
            >
              Set it to Draft anyway
            </button>
          </div>
        </Modal>
      )}

      {/*
        POPULATE DEFAULTS.

        `populate-defaults.js:102` matches on `item.name === promptData.name`,
        and this call sends `overwrite: true` — so the consequence is precise
        and was worth writing down: same name, same id, different text. The old
        one-liner said "Existing prompts will be overwritten", which reads as
        "the ones I did not write".
      */}
      {confirmPopulate && (
        <Modal
          overlayClassName="modal-overlay"
          contentClassName="modal-content"
          labelledBy="pmgr-populate-title"
          onClose={() => setConfirmPopulate(false)}
        >
          <h3 id="pmgr-populate-title">Rewrite the built-in prompts?</h3>
          <p>
            This writes the built-in prompt for every category. It matches on <strong>name</strong>:
            any prompt here whose name matches a built-in is <strong>replaced by the built-in
            text, keeping its id</strong> — so question sets pinned to it keep working and start
            reading something different. Edits made to those prompts are not kept and there is
            no undo.
          </p>
          <p>
            One built-in per engagement type is flagged default, so whatever is default now is
            demoted in the same run. Prompts you named anything else are untouched.
          </p>
          <p>
            {prompts.length === 0
              ? 'There are no prompts here yet, so this run can only create.'
              : `${prompts.length} prompts exist here now. Which of them collide is decided by name inside the lambda and cannot be previewed from this screen.`}
          </p>
          <div className="modal-actions">
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setConfirmPopulate(false)}
              data-testid="pmgr-populate-cancel"
            >
              Leave them as they are
            </button>
            <button
              type="button"
              className="btn-danger"
              onClick={populateDefaults}
              data-testid="pmgr-populate-confirm"
            >
              Write the built-in prompts
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

export default AIPromptManager;