import React, { useRef, useState } from 'react';
import Icon from './Icon';
import StatusMessage from './StatusMessage';
import { startGenerationJob, pollGenerationJob } from '../utils/aiBatchClient';
import { interpretGenerationJob, generationJobTone } from '../utils/generationJob';
import {
  applyFieldDraft,
  classifyField,
  dropEditedSince,
  lockedKeys,
  hasSeedContent,
  hasUnlockedField,
} from '../utils/fieldDrafting';

/**
 * THE AI HELPER FOR A BUILDER FORM — one panel, three builders.
 *
 * The owner: *"i do wish there was an AI helper that filled out the forms for
 * the user based on some prelim info they offered … or if the user filled those
 * in the ai would refine (unless locked, a small icon lock/unlock on cells."*
 * And, about reuse: *"we need to expose the same style (maybe the same modal
 * etc) … why recreat everything."*
 *
 * So this is deliberately the SAME SHAPE as the drafter already shipped in
 * `QuestionSetEditor.jsx`: a collapsible panel inside the form it serves, a
 * status line, and — when a proposal cannot be applied safely — the operator's
 * own words shown beside the draft with an explicit per-field choice. No dialog:
 * the builders are already inside a modal, and a modal inside a modal is a focus
 * trap inside a focus trap. `components/Modal.jsx` is the right primitive for a
 * dialog and the wrong one here.
 *
 * ── WHAT THIS COMPONENT DOES NOT DECIDE ────────────────────────────────────
 *
 * Not the lock state — the builder owns that, because the lock icons live beside
 * the builder's own inputs and the builder is what sends the form.
 * Not which values become form values — `utils/fieldDrafting.applyFieldDraft`
 * does, so the rule is testable without mounting anything.
 * Not whether a locked field is safe — that was already refused twice on the
 * server before the response was written, and is refused again inside
 * `applyFieldDraft`. This component only reports it if it ever happens.
 *
 * Nothing here starts a generation of questions, and nothing here saves. The
 * operator still presses Generate afterwards.
 */
export default function AIFormAssist({
  formId,
  fields,
  seed,
  values,
  locked,
  onApply,
  /** Read-only steer for the prompt: the topic card picked, the category count. */
  hints = [],
  /** Test seam only. The builders leave it alone. */
  endpoint = null,
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState({ text: '', tone: '' });
  // Proposals that read as a replacement rather than a refinement, plus the
  // operator's own text at the moment they were held. `{ key: { draft, mine } }`.
  const [held, setHeld] = useState({});
  // What each accepted proposal replaced, so a single click puts it back.
  // `{ key: previousText }`.
  const [undoable, setUndoable] = useState({});
  // Fields this panel wrote into, for the provenance mark beside them.
  const [touched, setTouched] = useState([]);

  // THE LIVE VALUES, readable from inside an async call that started several
  // renders ago. `values` inside `draft` is the closure's copy — which is what
  // the request was built from and exactly what the classification needs — but
  // deciding what to WRITE also needs to know what the operator has typed in the
  // meantime. See `dropEditedSince`.
  const valuesRef = useRef(values);
  valuesRef.current = values;

  const url = endpoint || `${window.API_BASE}admin/ai-draft-builder-form`;
  const labelOf = (key) => (fields.find((f) => f.key === key) || {}).label || key;
  const names = (list) => list.map(labelOf).join(', ');
  const seedLabel = labelOf(seed);

  const nothingToWorkFrom = !hasSeedContent(fields, values);
  const everythingLocked = !hasUnlockedField(fields, locked);

  const draft = async () => {
    setBusy(true);
    setHeld({});
    setStatus({ text: 'Starting…', tone: 'pending' });
    const onStatus = (text) => setStatus({ text, tone: 'pending' });
    // Snapshot the values the request is built from. The operator can keep
    // typing while the job runs, and applying a proposal against fields that
    // have moved on underneath it would overwrite words the model never saw.
    const sent = { ...values };
    const sentLocked = lockedKeys(locked, fields);
    try {
      const { jobId } = await startGenerationJob(url, {
        formId,
        current: sent,
        // THE LOCK, ON THE WIRE. The server builds the tool schema from this, so
        // a locked field is never offered to the model at all.
        locked: sentLocked,
        hints,
      }, { label: 'Form helper', onStatus });

      const job = await pollGenerationJob(url, jobId, { label: 'Form helper', onStatus });

      // Read the outcome, never `items.length` — a FAILED job can carry
      // partials, which is how a partial failure used to render as a success.
      const interpreted = interpretGenerationJob(job);
      if (interpreted.outcome !== 'complete') {
        setStatus({
          text: `Nothing was proposed: ${interpreted.error
            || interpreted.warnings.join(' ')
            || 'the job ended without producing anything'}. Your form is untouched.`,
          tone: generationJobTone(interpreted.outcome),
        });
        return;
      }

      const result = applyFieldDraft(interpreted.items[0], {
        fields,
        values: sent,
        locked: sentLocked,
      });

      // Anything the operator has edited while the job ran is theirs and the
      // model never saw it. Skipped, and said out loud.
      const { patch, stale } = dropEditedSince(result.patch, {
        snapshot: sent,
        latest: valuesRef.current,
      });
      const landed = (list) => list.filter((key) => !stale.includes(key));

      if (Object.keys(patch).length > 0) onApply(patch);
      setUndoable((current) => ({
        ...current,
        ...Object.fromEntries(landed(result.refined).map((key) => [key, result.previous[key]])),
      }));
      setTouched((current) => [
        ...new Set([...current, ...landed(result.filled), ...landed(result.refined)]),
      ]);
      setHeld(Object.fromEntries(
        Object.entries(result.held).map(([key, value]) => [key, { draft: value, mine: sent[key] }]),
      ));

      const lines = [
        landed(result.filled).length ? `Filled in: ${names(landed(result.filled))}.` : '',
        landed(result.refined).length ? `Refined: ${names(landed(result.refined))} — undo is below each one.` : '',
        stale.length
          ? `You changed ${names(stale)} while this was running, so ${stale.length === 1 ? 'that proposal was' : 'those proposals were'} dropped — the AI never saw what you typed.`
          : '',
        result.unchanged.length ? `Left as you wrote ${result.unchanged.length === 1 ? 'it' : 'them'}: ${names(result.unchanged)}.` : '',
        Object.keys(result.held).length
          ? `${names(Object.keys(result.held))} came back rewritten rather than refined, so nothing was changed — take it or leave it below.`
          : '',
        // Only ever printed if a server-side guarantee has failed. Saying so is
        // the point: a silent catch here would hide exactly the bug that matters.
        result.blocked.length
          ? `The AI returned ${names(result.blocked)}, which you had locked. It was refused.`
          : '',
      ].filter(Boolean);

      setStatus({
        text: lines.length ? lines.join(' ') : 'The draft came back empty. Your form is untouched.',
        tone: lines.length ? 'success' : 'error',
      });
    } catch (error) {
      console.error('AI form assist error:', error);
      setStatus({ text: `${error.message} Your form is untouched.`, tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  /** The operator chose the draft over their own words, on purpose, one field. */
  const acceptHeld = (key) => {
    const entry = held[key];
    if (!entry) return;
    onApply({ [key]: entry.draft });
    setUndoable((current) => ({ ...current, [key]: entry.mine }));
    setTouched((current) => [...new Set([...current, key])]);
    setHeld(({ [key]: dropped, ...rest }) => rest);
  };

  /** The operator kept their own words. The draft is dropped, not stored. */
  const rejectHeld = (key) => setHeld(({ [key]: dropped, ...rest }) => rest);

  /** Put back exactly what was there before this panel wrote over it. */
  const undo = (key) => {
    const previous = undoable[key];
    if (previous === undefined) return;
    onApply({ [key]: previous });
    setUndoable(({ [key]: dropped, ...rest }) => rest);
    setTouched((current) => current.filter((f) => f !== key));
  };

  const heldKeys = fields.map((f) => f.key).filter((key) => held[key]);

  return (
    <section className="form-assist" data-testid="form-assist">
      <button
        type="button"
        className="btn-secondary form-assist-toggle"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <Icon name="Sparkle" weight="duotone" size={16} color="var(--primary)" />{' '}
        {open ? 'Hide the AI helper' : 'Let AI fill this in'}
      </button>

      {open && (
        <div className="form-assist-body">
          <p className="form-assist-lede">
            Describe what you want in <strong>{seedLabel}</strong> and the rest can be
            proposed from it. A field you have already written is <strong>refined</strong>,
            not replaced. A field you <strong>lock</strong> is never touched — use the
            padlock beside any label.
          </p>

          {/*
            THE PLAN, BEFORE ANYTHING IS SPENT. What the operator is about to
            get, field by field, computed from the same classification the server
            will make. A panel that says "fill 3, refine 1, leave 1 alone" and
            then does something else is the defect this list exists to prevent —
            it is the one place the lock is visible as an effect rather than as
            an icon.
          */}
          <ul className="form-assist-plan">
            {fields.map((field) => {
              const kind = classifyField(values, locked, field.key);
              return (
                <li key={field.key} className={`form-assist-plan-${kind}`} data-testid={`assist-plan-${field.key}`}>
                  <span className="form-assist-plan-field">{field.label}</span>
                  <span className="form-assist-plan-kind">
                    {kind === 'locked' && (<><Icon name="Lock" weight="fill" size={12} color="currentColor" /> locked — left alone</>)}
                    {kind === 'fill' && 'empty — will be filled in'}
                    {kind === 'refine' && 'yours — will be refined'}
                  </span>
                </li>
              );
            })}
          </ul>

          <StatusMessage message={status.text} tone={status.tone} />

          <button
            type="button"
            className="btn-primary"
            onClick={draft}
            disabled={busy || nothingToWorkFrom || everythingLocked}
          >
            <Icon name="Sparkle" weight="duotone" size={16} color="var(--primary)" />{' '}
            {busy ? 'Thinking…' : 'Fill in the rest'}
          </button>

          {nothingToWorkFrom && (
            <p className="form-assist-note">
              Type something into <strong>{seedLabel}</strong> first — there is nothing here to
              work from, and a helper handed an empty form invents a session nobody asked for.
            </p>
          )}
          {!nothingToWorkFrom && everythingLocked && (
            <p className="form-assist-note">
              Every field is locked, so there is nothing to propose. Unlock one first.
            </p>
          )}

          {/*
            HELD BACK — proposals that rewrote the operator instead of refining
            them. Their words and the draft, side by side, and neither is chosen
            for them. This is the same treatment QuestionSetEditor gives a field
            the author had already written, for the same reason: a helper that
            silently replaces a paragraph somebody wrote is a data-loss bug
            wearing a feature's clothes.
          */}
          {heldKeys.length > 0 && (
            <div className="form-assist-held">
              <h4>These came back rewritten, not refined.</h4>
              <p className="form-assist-note">
                Too little of what you wrote survived for this to be called a refinement,
                so nothing was changed. Your words are on the left.
              </p>
              {heldKeys.map((key) => (
                <div className="form-assist-held-field" key={key} data-testid={`assist-held-${key}`}>
                  <span className="form-assist-held-label">{labelOf(key)}</span>
                  <blockquote className="form-assist-mine">
                    <span className="form-assist-quote-label">Yours</span>
                    {held[key].mine}
                  </blockquote>
                  <blockquote className="form-assist-draft">
                    <span className="form-assist-quote-label">The AI&rsquo;s</span>
                    {held[key].draft}
                  </blockquote>
                  <div className="form-assist-held-actions">
                    <button type="button" className="btn-secondary" onClick={() => acceptHeld(key)}>
                      Use the AI&rsquo;s
                    </button>
                    <button type="button" className="btn-secondary" onClick={() => rejectHeld(key)}>
                      Keep mine
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/*
            UNDO, per field, for anything this panel wrote over. It holds the
            exact previous text rather than re-deriving it, so taking a
            refinement back is lossless — which is what makes applying one
            automatically defensible in the first place.
          */}
          {touched.filter((key) => undoable[key] !== undefined).length > 0 && (
            <div className="form-assist-undo">
              {touched.filter((key) => undoable[key] !== undefined).map((key) => (
                <button
                  type="button"
                  className="btn-secondary"
                  key={key}
                  data-testid={`assist-undo-${key}`}
                  onClick={() => undo(key)}
                >
                  <Icon name="ArrowCounterClockwise" weight="bold" size={14} color="currentColor" />{' '}
                  Undo {labelOf(key)}
                </button>
              ))}
            </div>
          )}

          {touched.length > 0 && (
            <p className="form-assist-note" data-testid="assist-provenance">
              <Icon name="Sparkle" weight="duotone" size={12} color="var(--primary)" />{' '}
              <strong>AI wrote {names(touched)}.</strong> Edit any of it before you generate —
              nothing has been generated or saved yet.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
