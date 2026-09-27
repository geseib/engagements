/**
 * THE SESSION OPTIONS, WRITTEN ONCE — the create dialog's category grid,
 * Workie's briefing and its Advanced fold, shared with the event item dialog
 * (docs/superpowers/plans/2026-09-26-events-m1b-richer-agenda.md, Task 3).
 *
 * The owner, 26 Sep 2026: "It would also be nice if all of the options that
 * you get when setting up each engagement is avail". So an agenda item offers
 * exactly what GameSetupDialog offers at creation, by rendering these same
 * three components — never a second copy of the controls
 * (__tests__/sessionOptions.test.jsx fails if one appears elsewhere):
 *
 *   SessionCategories  the category grid and the line that counts it
 *   SessionBriefing    Workie's briefing (Call & Answer only) — BriefingField
 *   SessionOptions     the Advanced fold: responses (or a survey's Names),
 *                      questions, Workie, and what people see when they join
 *
 * MOVED, NOT REWRITTEN. The markup, the classes and every sentence are
 * GameSetupDialog's as they were on 26 Sep 2026;
 * __tests__/gameSetupDialogDom.test.jsx recorded the create dialog's form
 * before the move and holds it to the byte.
 *
 * CONTROLLED. Every value arrives in `value` and leaves as a patch through
 * `onChange(patch)`, under the create payload's own keys (anonymousResponses,
 * randomizeQuestions, names, personaId, promptId, aiContext, eventDetails) —
 * the keys GameSetupDialog raises and an event item stores as its Settings.
 *
 * THE ONE FETCH, moved here from GameSetupDialog with the block it serves.
 * The Advanced line says "follows this set's own summary approach" only when
 * the prompt library really holds the set's prompt, and the approach picker
 * offers the library's summary prompts for this format. One request when the
 * block mounts. A failure leaves the list UNKNOWN (null), never "empty": an
 * unreadable library is not evidence about the set, and answering it with
 * "the standard way" would over-claim in the other direction.
 *
 * STYLED BY GameSetupDialog.css under its `.gsd` scope, whose tokens are the
 * dusk card and field. The create dialog is that scope; the item dialog wraps
 * these in a `.gsd` element (sessionOptionsPalette.test.js holds its tokens
 * equal to the item dialog's own surface).
 *
 * `idPrefix` names every id, so the create dialog keeps `gsd-persona` and the
 * item dialog gets ids of its own.
 */
import React, { useEffect, useRef, useState } from 'react';
import { gameTypeMeta, normalizeGameType } from '../config/gameTypes';
import { anonymityApplies } from '../config/anonymity';
import { NAMES_MODES, namesMode } from '../config/surveyNames';
import { advancedSummary } from '../config/setupDefaults';
import { authFetch } from '../auth/authFetch';
import { adminApiUrl } from '../utils/adminApi';
import BriefingField from './BriefingField';
import Icon from './Icon';
import './GameSetupDialog.css';

/** "None picked, so all 4 are in · 12 questions" — what will be asked, not the chips. */
const questionsIn = (list) => {
  const n = list.reduce((sum, c) => sum + (Number(c.questionCount) || 0), 0);
  return `${n} question${n === 1 ? '' : 's'}`;
};

/**
 * THE CATEGORY GRID — the app's multi-select, kept deliberately. A set carries
 * 4-24 categories with wildly different counts; a single-value <select>
 * cannot say "these three, not those five".
 *
 * @param {object[]} categories  `{ name, questionCount }` for the chosen set
 * @param {Set}      selected    the chosen names
 * @param {boolean}  editing     an edit refuses an empty selection; a create
 *                               reads it as "all of them"
 * @param {Function} onToggle    (name) => void
 */
export function SessionCategories({
  idPrefix = 'gsd', categories = [], selected = new Set(), editing = false, onToggle,
}) {
  const labelId = `${idPrefix}-categories-label`;
  const picked = categories.filter((c) => selected.has(c.name));
  return (
    <div className="form-group">
      <span className="gsd-label" id={labelId}>Categories</span>
      <div className="category-selection">
        <div className="category-button-grid" role="group" aria-labelledby={labelId}>
          {categories.map((category) => (
            <button
              key={category.name}
              type="button"
              className={`category-button ${selected.has(category.name) ? 'selected' : ''}`}
              aria-pressed={selected.has(category.name)}
              onClick={() => onToggle?.(category.name)}
            >
              <span className="category-name">{category.name}</span>
              <span className="category-count">({category.questionCount})</span>
            </button>
          ))}
        </div>
        <small className="dialog-help-text">
          {/*
            Edit and create disagree about what an empty selection MEANS,
            and the copy has to carry the difference. Create's empty set
            is "the host never opened the picker" and falls back to all;
            an edit that ends empty is a host who deselected everything,
            and the save button refuses it rather than storing a session
            with no reachable questions.
          */}
          {editing
            ? (selected.size === 0
              ? 'Select at least one category — a session with none has no questions to ask.'
              : `${selected.size} of ${categories.length} categories enabled`)
            : (selected.size === 0
              ? `None picked, so all ${categories.length} are in · ${questionsIn(categories)}`
              : `${picked.length} of ${categories.length} categories · ${questionsIn(picked)}`)}
        </small>
      </div>
    </div>
  );
}

/**
 * WORKIE'S BRIEFING — main view, Call & Answer only (session-setup-redesign
 * 01, 03). The one Workie input that changes what Workie KNOWS; under
 * Advanced it would never be found. BriefingField owns every state.
 */
export function SessionBriefing({ value = null, onChange, onWorkingChange }) {
  return (
    <>
      <h3 className="gsd-section">
        Workie’s briefing<span className="gsd-tag">Call &amp; Answer only</span>
      </h3>
      <BriefingField
        value={value}
        onChange={onChange}
        onWorkingChange={onWorkingChange}
      />
    </>
  );
}

/**
 * THE ADVANCED FOLD (docs/design/session-setup-redesign, PLAN Phase 1). A
 * native <details>, closed on open; its summary is the plan in one sentence
 * (config/setupDefaults.js), any change first in amber, so closing it never
 * hides a decision. Always rendered, so a value set and folded away is still
 * in the form.
 *
 * @param {string}   gameType      the format the options are for
 * @param {object}   value         { anonymousResponses, randomizeQuestions,
 *                                   names, personaId, promptId, aiContext,
 *                                   eventDetails }
 * @param {Function} onChange      (patch) => void, keys as in `value`
 * @param {object[]} personas      the voices for this format
 * @param {string}   setPromptId   the chosen set's own summary prompt, if any
 * @param {string}   namesDefault  the chosen survey set's own Names default
 * @param {boolean}  shuffleLocked an edit: the order was drawn at creation
 */
export default function SessionOptions({
  idPrefix = 'gsd',
  gameType = 'call-and-answer',
  value = {},
  onChange = () => {},
  personas = [],
  setPromptId = '',
  namesDefault = '',
  shuffleLocked = false,
}) {
  const isSurvey = normalizeGameType(gameType) === 'survey';
  const anonymous = value.anonymousResponses !== false;
  const shuffled = value.randomizeQuestions !== false;
  const aiContext = value.aiContext || '';
  const eventDetails = value.eventDetails || '';
  const names = namesMode(value.names);
  const setNamesDefault = isSurvey && namesDefault ? namesMode(namesDefault) : null;

  // NULL IS "NOT KNOWN", AND IT IS NOT THE SAME AS EMPTY — see the header.
  const [knownPromptIds, setKnownPromptIds] = useState(null);
  // The same list, kept whole: the approach picker offers the summary
  // prompts written for this format.
  const [promptList, setPromptList] = useState([]);
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const response = await authFetch(adminApiUrl('admin/ai-prompts'));
        if (!response || !response.ok) return;
        const data = await response.json().catch(() => ({}));
        const rows = (data.prompts || []).filter((p) => p && p.promptId);
        const ids = rows.map((p) => p.promptId);
        if (live) {
          setKnownPromptIds(new Set(ids));
          setPromptList(rows);
        }
      } catch (e) {
        // Left unknown on purpose — see the header. Nothing on screen
        // depends on this request.
      }
    })();
    return () => { live = false; };
  }, []);

  /** The chosen set's own summary prompt, and whether it can actually be honoured. */
  const setPromptWillBeUsed = Boolean(setPromptId)
    && (knownPromptIds === null || knownPromptIds.has(setPromptId));
  /*
    THE APPROACH PICKER'S LIST: summary prompts for THIS format. The same
    filter the set editor applies (QuestionSetEditor.jsx:willRunAsASummary) —
    a generator prompt, or one the list already knows cannot drive a summary,
    is not offered; 'unknown' is the normal verdict and is kept.
  */
  const promptChoices = promptList.filter((p) => normalizeGameType(p.gameType) === normalizeGameType(gameType)
    && p.summaryPromptStatus !== 'unusable'
    && p.promptType !== 'generation');

  /*
    ONE RADIO GROUP, KEYBOARD INCLUDED. Three buttons with role="radio" are a
    radio group only if they behave as one: a single tab stop (the checked
    option), and the arrow keys move the choice — wrapping at the ends, the
    way a native radio group does.
  */
  const namesRefs = useRef([]);
  const onNamesKey = (event, index) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
    if (!step) return;
    event.preventDefault();
    const next = (index + step + NAMES_MODES.length) % NAMES_MODES.length;
    onChange({ names: NAMES_MODES[next].id });
    namesRefs.current[next]?.focus?.();
  };

  /*
    ── WHAT THE ADVANCED LINE SAYS ────────────────────────────────────────────
    Every default in force, any change first. config/setupDefaults.js decides
    what "default" means; the names come from the lists this block holds (the
    whole prompt list, so an edit's seeded approach is named even when it is
    not one this format offers).
  */
  const summary = advancedSummary({
    gameType,
    anonymousResponses: anonymous,
    randomizeQuestions: shuffled,
    names: value.names,
    namesDefault,
    personaId: value.personaId || '',
    promptId: value.promptId || '',
    eventDetails,
    aiContext,
    personas,
    promptChoices: promptList,
    setPromptWillBeUsed,
  });

  return (
    <details className="gsd-adv">
      <summary>
        <span className="gsd-adv-k"><i className="gsd-chev" aria-hidden="true" />Advanced</span>
        <span className="gsd-adv-s" data-testid="gsd-adv-summary">
          {summary.lead && <b>{summary.lead}</b>}
          {summary.lead && summary.rest ? ' ' : ''}
          {summary.rest}
          {!summary.lead && <span className="gsd-adv-open-only"> Change any of them here.</span>}
        </span>
      </summary>

      <div className="gsd-adv-body">
        {/* Checked against this dialog's own type picker, not the live
            game's `currentGameType`, which still names whatever is on
            screen until the new game is created. A survey's Names takes
            the anonymity card's place. */}
        {(anonymityApplies(gameType) || isSurvey) && (
          <h3 className="gsd-section">Responses</h3>
        )}

        {anonymityApplies(gameType) && (
          <div className={`gsd-opt${anonymous ? ' is-on' : ''}`}>
            <label className="gsd-opt-head">
              <input
                type="checkbox"
                checked={anonymous}
                onChange={(e) => onChange({ anonymousResponses: e.target.checked })}
              />
              <span className="gsd-opt-name">Anonymous responses</span>
              {/* aria-hidden: the checkbox already announces its own state,
                  and without this the browser folds "On" into the control's
                  accessible name and calls it "on". */}
              <span className="gsd-opt-state" aria-hidden="true">{anonymous ? 'On' : 'Off'}</span>
            </label>

            {/* KEEP THIS SENTENCE. The mockup says "Until you reveal them",
                which tells the host they hold a switch they do not hold:
                get-results.js:207-217 sets AuthorsRevealed UNCONDITIONALLY on
                entering RESULTS, and /reveal-authors is only an *early*
                reveal. A host who read the mockup's line and then closed
                voting to show the tally would have attributed every answer
                believing they had not. */}
            <p className="gsd-opt-does">
              Until voting closes, nobody sees who wrote which answer — not the room,
              not you. The room votes on the answers, not on the people. You can also
              reveal the names earlier if you want to.
            </p>

            <div className="gsd-preview">
              <div className="gsd-pv">
                <h6>While voting</h6>
                <p className="gsd-pv-ans">&ldquo;Freeze all discretionary discounting for thirty days&hellip;&rdquo;</p>
                <p className="gsd-pv-who">Response 1</p>
              </div>
              <div className="gsd-pv">
                <h6>After voting closes</h6>
                <p className="gsd-pv-ans">&ldquo;Freeze all discretionary discounting for thirty days&hellip;&rdquo;</p>
                <p className="gsd-pv-who named">Priya Raghavan &middot; +180 pts</p>
              </div>
            </div>

            <p className="gsd-opt-else">
              {anonymous
                ? <><b>Turn it off</b> and every answer is labelled with its author from the moment voting opens.</>
                : <><b>It is off</b> — every answer is labelled with its author from the moment voting opens.</>}
            </p>

            {/* Never overclaim. Shipped verbatim. */}
            <p className="gsd-opt-limit">
              This hides names, not identities. In a small group, people may still
              recognise each other’s answers.
            </p>
          </div>
        )}

        {isSurvey && (
          /*
            THE NAMES CARD — 07-start-survey.html, which draws it as "the
            shipped card, one control wider": the option card above, with its
            checkbox become a three-way choice. Every sentence is the value's
            own, from config/surveyNames.js — the chooser line, what it does,
            the phone's promise — so what the host chose and what the room is
            told cannot drift.

            "What you get" is a SAMPLE of the host's view in each mode, drawn
            from 07's own example and 33-people's statuses. It shows the shape
            of what comes back, not this survey's answers.
          */
          <>
            <div className="gsd-names">
              <div className="gsd-names-hd">
                <span className="gsd-opt-name">Names</span>
                <span className="gsd-names-st" aria-hidden="true">{names.label}</span>
              </div>
              <div className="gsd-three" role="radiogroup" aria-label="Names">
                {NAMES_MODES.map((mode, i) => {
                  const on = mode.id === names.id;
                  return (
                    <button
                      key={mode.id}
                      ref={(el) => { namesRefs.current[i] = el; }}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      tabIndex={on ? 0 : -1}
                      className="gsd-three-opt"
                      onClick={() => onChange({ names: mode.id })}
                      onKeyDown={(event) => onNamesKey(event, i)}
                    >
                      <b><i aria-hidden="true" />{mode.label}</b>
                      <span>{mode.hostLine}</span>
                    </button>
                  );
                })}
              </div>
              <p className="gsd-opt-does">{names.does}</p>
              <div className="gsd-preview">
                <div className="gsd-pv">
                  <h6>What their phone says</h6>
                  <p className="gsd-pv-ans" data-testid="names-phone-preview">
                    {names.phoneLead && <b>{names.phoneLead}</b>}
                    {names.phoneLead ? ' ' : ''}
                    {names.phoneLine}
                  </p>
                </div>
                <div className="gsd-pv">
                  <h6>What you get</h6>
                  <p className="gsd-pv-ans">&ldquo;Seeing the console actually run beat every slide about it.&rdquo;</p>
                  {names.id === 'named' ? (
                    <p className="gsd-pv-who named">Priya Raghavan</p>
                  ) : (
                    <p className="gsd-pv-who">Response 12 &middot; no name</p>
                  )}
                  {names.id === 'finished' && (
                    <>
                      <p className="gsd-pv-ans gsd-pv-gap">Priya Raghavan &middot; finished 2:12pm</p>
                      <p className="gsd-pv-who">People list &middot; no answers</p>
                    </>
                  )}
                </div>
              </div>
              {/* Never overclaim. The shipped card's own sentence, verbatim. */}
              <p className="gsd-opt-limit">
                This hides names, not identities. In a small group, people may still
                recognise each other’s answers.
              </p>
            </div>
            <p className="gsd-names-lock">
              <Icon name="Lock" weight="bold" size={13} color="currentColor" />
              {' Fixed once the survey opens — people answer on the promise their phone made them.'}
              {/* Only when the set really carries one: pointing the host at a
                  set-level default that does not exist would be a lie. */}
              {setNamesDefault && (
                <>{' This set’s default is '}<b>{setNamesDefault.label}</b>.</>
              )}
            </p>
          </>
        )}

        {!isSurvey && (
          <>
            <h3 className="gsd-section">Questions</h3>
            <div className={`gsd-opt${shuffled ? ' is-on' : ''}`}>
              <label className="gsd-opt-head">
                {/* Disabled in edit mode: the per-category order rows were
                    shuffled (or not) when the session was created, so the PUT
                    whitelist refuses this flag — a live checkbox here would
                    toggle something that silently fails to save. */}
                <input
                  type="checkbox"
                  checked={shuffled}
                  disabled={shuffleLocked}
                  onChange={(e) => onChange({ randomizeQuestions: e.target.checked })}
                />
                <span className="gsd-opt-name">Shuffle the question order</span>
                <span className="gsd-opt-state" aria-hidden="true">{shuffled ? 'On' : 'Off'}</span>
              </label>
              {/* Both branches, because the off state is the one nobody guesses. */}
              <p className="gsd-opt-does">
                {shuffled
                  ? 'Questions are drawn at random from the categories you picked, rather than in the order they were written.'
                  : 'Questions are asked in order, completing each category before moving to the next.'}
              </p>
              {shuffleLocked && (
                <p className="gsd-opt-limit">
                  Fixed once the session is created — the question order was drawn when
                  this session was set up.
                </p>
              )}
            </div>
          </>
        )}

        <h3 className="gsd-section">Workie</h3>

        <div className="form-group">
          <label htmlFor={`${idPrefix}-persona`}>Workie's voice</label>
          <select
            id={`${idPrefix}-persona`}
            value={value.personaId || ''}
            onChange={(e) => onChange({ personaId: e.target.value })}
            className="dialog-select"
          >
            {/* Adapting to the session is the designed default, not a
                fallback — a fixed persona is what made Workie refuse a
                holiday icebreaker as "insufficient for business analysis". */}
            <option value="">Adapt to the session (recommended)</option>
            {personas.map((persona) => (
              <option key={persona.personaId} value={persona.personaId}>
                {persona.name}{persona.tagline ? ` — ${persona.tagline}` : ''}
              </option>
            ))}
          </select>
          <small className="dialog-help-text">
            {value.personaId
              ? 'Workie keeps this voice for the whole session. You can change it between rounds.'
              : 'Workie reads the room and picks its own register — playful for an icebreaker, analytical for a retro.'}
          </small>
        </div>

        {/*
          THE SESSION'S SUMMARY APPROACH — the owner (2026-09-22): "how do I
          select the right prompt for the results screen ... and how can we
          change it during the session setup". Beside the voice, filtered to
          the format, and defaulting to what the Advanced line promises: the
          set's own approach if it names one, else the format standard. The
          pick lands on the game record (PromptId) and beats the set's.
        */}
        <div className="form-group">
          <label htmlFor={`${idPrefix}-prompt`}>Summary approach</label>
          <select
            id={`${idPrefix}-prompt`}
            value={value.promptId || ''}
            onChange={(e) => onChange({ promptId: e.target.value })}
            className="dialog-select"
          >
            <option value="">
              {setPromptWillBeUsed
                ? 'What the set says (recommended)'
                : `The standard ${gameTypeMeta(gameType).label} way (recommended)`}
            </option>
            {promptChoices.map((prompt) => (
              <option key={prompt.promptId} value={prompt.promptId}>
                {prompt.name}{prompt.category ? ` (${prompt.category})` : ''}
              </option>
            ))}
          </select>
          <small className="dialog-help-text">
            How Workie sums up each round on the results screen — the shape and content, where the voice is only the register. You can change it mid-session; it applies from the next round.
          </small>
        </div>


        {/*
          "AI CONTEXT", RENAMED FOR WHAT IT DOES. The prompt carries it as
          THE HOST'S INSTRUCTIONS and demands it in every section of the
          summary (personas.js) — rules, not background. Facts about the
          session are Event details' job, and the prompt reads those too.
        */}
        <div className="form-group">
          <label htmlFor={`${idPrefix}-ai-context`}>Instructions for Workie</label>
          <textarea
            id={`${idPrefix}-ai-context`}
            value={aiContext}
            onChange={(e) => onChange({ aiContext: e.target.value })}
            placeholder="Anything Workie must always do — e.g. ‘end every round with one question for the ops leads’"
            className="dialog-textarea"
            rows="2"
            maxLength="500"
          />
          <small className="dialog-help-text">
            Workie follows these in every round’s summary. Facts about the session belong in
            Event details, below.
            {' '}{aiContext.length}/500 characters
          </small>
        </div>

        <h3 className="gsd-section">What people see when they join</h3>

        <div className="form-group">
          <label htmlFor={`${idPrefix}-details`}>Event details</label>
          <textarea
            id={`${idPrefix}-details`}
            value={eventDetails}
            onChange={(e) => onChange({ eventDetails: e.target.value })}
            placeholder="What this session is for, in a sentence or two."
            className="dialog-textarea"
            rows="2"
            maxLength="300"
          />
          <small className="dialog-help-text">
            Shown to people on the screen they land on after joining. Workie reads it too.
            {' '}{eventDetails.length}/300 characters
          </small>
        </div>
      </div>
    </details>
  );
}
