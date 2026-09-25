import React, { useState, useEffect, useMemo, useRef } from 'react';
import Icon from './Icon';
import Modal from './Modal';
import StatusMessage from './StatusMessage';
import PromptPreflightPanel from './PromptPreflightPanel';
import { normalizeGameType } from '../config/gameTypes';
import { preflightPrompt } from '../utils/promptPreflight';
import {
  ADVISOR_GIVE_UP_MS, ADVISOR_POLL_INTERVAL_MS,
  asSentence, describeAdviceProgress, startPromptAdvice, waitForPromptAdvice,
} from '../utils/promptAdvisorJob';

const API_BASE = window.API_BASE;

/**
 * The model the summary prompt is read by — the preflight grades a rewrite for
 * it, exactly as the editor grades what is typed (AIPromptManager.jsx,
 * SUMMARY_MODEL_ID: get-ai-summary.js runs Haiku 4.5).
 */
const SUMMARY_MODEL_ID = 'claude-haiku-4-5-20251001';

/**
 * TWO LENSES, WHERE THERE WERE THREE. Validate became Review; Optimize, which
 * rendered nothing at all, folded into Improve. Both answer in the same
 * checklist, so the screen below has one shape to draw.
 */
const LENSES = [
  {
    value: 'review',
    label: 'Review',
    icon: 'MagnifyingGlass',
    description: 'Checks safety, fairness and clarity, and the rules a prompt must follow to save.',
  },
  {
    value: 'improve',
    label: 'Improve',
    icon: 'Sparkle',
    description: 'Suggests how to get a better summary for the room, and where to tighten the wording.',
  },
];

/** The groups, in the words the editor uses for its two halves. */
const HALF_GROUPS = [
  { half: 'instructions', title: 'What the AI is given', note: 'the instructions half' },
  { half: 'outputFormat', title: 'What the AI writes', note: 'the output format half' },
  { half: 'both', title: 'Both halves', note: 'changes that touch the whole prompt' },
];

/** Severity as a word in the sentence, never a tiny uppercase tag. */
const SEVERITY_WORDS = { high: 'High priority', medium: 'Medium priority', low: 'Low priority' };

/*
  THE WORKIE ADVISOR — TICK THE ADVICE, APPLY THE TICKED.

  The owner, 2026-09-24: "It gave good advice on validate quality, but you cant
  action that advice". This dialog used to draw a score, strengths and general
  recommendations; Validate's own list of issues — severity, where, the fix —
  was never shown, Optimize drew nothing, and "Apply to Prompt" pasted one
  rewritten string into Output Format and left the old Instructions in place.

  Now: choose a lens and run it (a job — the analysis takes Sonnet 35-60
  seconds and the gateway gives up at 30; utils/promptAdvisorJob.js). The
  checklist comes back grouped by the half each fix changes, a checkbox per
  item, high severity pre-ticked. "Apply selected (N)" runs a second job,
  `analysisType: "apply"`, sent the two halves and ONLY the ticked fixes; the
  rewrite is shown half by half, before and after, with the editor's own
  preflight run on it; and "Use this" hands BOTH halves to the editor, where
  the admin reads them and saves as usual. Nothing here writes to the prompt.

  `pollIntervalMs` and `giveUpMs` are props only so the tests need not wait on
  real seconds; the screen always uses the defaults.
*/
export default function AIPromptAdvisor({
  prompt, onClose, onApplyImprovedPrompt,
  pollIntervalMs = ADVISOR_POLL_INTERVAL_MS,
  giveUpMs = ADVISOR_GIVE_UP_MS,
}) {
  const [lens, setLens] = useState('review');
  /** 'analysis' or 'apply' while a job runs, else null. */
  const [busy, setBusy] = useState(null);
  const [checklist, setChecklist] = useState(null);
  const [ticked, setTicked] = useState(() => new Set());
  const [rewrite, setRewrite] = useState(null);
  const [notice, setNotice] = useState('');
  const [progress, setProgress] = useState('');

  /*
    Closing the dialog mid-run must stop the polling and every state update
    after it. Set in the effect body, not just its cleanup, because StrictMode
    mounts, unmounts and remounts once in development — a flag set only by the
    cleanup would read "closed" for the whole life of the real mount.
  */
  const closedRef = useRef(false);
  useEffect(() => {
    closedRef.current = false;
    return () => { closedRef.current = true; };
  }, []);

  const url = `${API_BASE}admin/ai-prompt-advisor`;
  const before = { instructions: prompt.instructions || '', outputFormat: prompt.outputFormat || '' };
  const hasHalves = !!(before.instructions.trim() || before.outputFormat.trim());

  /**
   * What every job is sent: the two halves SEPARATELY (they used to be joined
   * into one string, so no advice could say which half it meant), and the
   * saved prompt's id, which the server reads from instead when it has one.
   */
  const promptRequest = () => ({
    instructions: before.instructions,
    outputFormat: before.outputFormat,
    ...(prompt.template ? { promptText: prompt.template } : {}),
    gameType: prompt.gameType,
    scenario: prompt.scenario,
    existingPromptId: prompt.promptId,
  });

  /** Start one job and wait for it. Resolves with its result, or null once the dialog has closed. */
  const runJob = async (payload) => {
    const startedAt = Date.now();
    setProgress(describeAdviceProgress(null, 0));
    const { jobId } = await startPromptAdvice(url, payload);
    if (closedRef.current) return null;
    const result = await waitForPromptAdvice(url, jobId, {
      intervalMs: pollIntervalMs,
      giveUpMs,
      isCancelled: () => closedRef.current,
      onProgress: (job) => {
        if (!closedRef.current) setProgress(describeAdviceProgress(job, Date.now() - startedAt));
      },
    });
    return closedRef.current ? null : result;
  };

  const runAnalysis = async () => {
    setBusy('analysis');
    setChecklist(null);
    setRewrite(null);
    setNotice('');
    try {
      const result = await runJob({ ...promptRequest(), analysisType: lens });
      if (!result) return;
      const analysis = result.analysis || {};
      const issues = Array.isArray(analysis.issues) ? analysis.issues : [];
      setChecklist({
        overallScore: typeof analysis.overallScore === 'number' ? analysis.overallScore : null,
        summary: analysis.summary || '',
        issues,
      });
      // High severity starts ticked: those are the ones that break a save rule
      // or put something wrong in front of a room.
      setTicked(new Set(issues.filter((item) => item.severity === 'high').map((item) => item.id)));
    } catch (error) {
      if (closedRef.current) return;
      console.error('Error analysing prompt:', error);
      // Nothing was changed and nothing was stored: the prompt is exactly as it
      // was, and this reading simply did not happen. The sentence is the
      // server's own when it gave one (utils/promptAdvisorJob.js).
      setNotice(`No analysis was produced. ${asSentence(error.message)} The prompt itself is untouched — nothing here writes to it.`);
    } finally {
      if (!closedRef.current) {
        setBusy(null);
        setProgress('');
      }
    }
  };

  const chosen = checklist ? checklist.issues.filter((item) => ticked.has(item.id)) : [];

  const applySelected = async () => {
    if (!chosen.length) return;
    setBusy('apply');
    setNotice('');
    try {
      // ONLY what was ticked, each fix with its own text — the server is told
      // nothing about the advice that was left unticked.
      const result = await runJob({ ...promptRequest(), analysisType: 'apply', issues: chosen });
      if (!result) return;
      const analysis = result.analysis || {};
      setRewrite({
        instructions: String(analysis.instructions ?? ''),
        outputFormat: String(analysis.outputFormat ?? ''),
        applied: Array.isArray(analysis.applied) ? analysis.applied : [],
        sent: chosen,
      });
    } catch (error) {
      if (closedRef.current) return;
      console.error('Error applying the ticked fixes:', error);
      setNotice(`The fixes were not applied. ${asSentence(error.message)} The prompt itself is untouched, and your ticks are still here.`);
    } finally {
      if (!closedRef.current) {
        setBusy(null);
        setProgress('');
      }
    }
  };

  const toggle = (id) => setTicked((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  /**
   * THE EDITOR'S OWN CHECKS, ON THE REWRITE — the same call the editor makes
   * on every keystroke, so a rewrite the save would refuse says so here,
   * before it is carried into the editor.
   */
  const report = useMemo(() => {
    if (!rewrite) return null;
    try {
      return preflightPrompt({
        instructions: rewrite.instructions,
        outputFormat: rewrite.outputFormat,
        outputSections: prompt.outputSections,
        template: prompt.template,
        gameType: normalizeGameType(prompt.gameType),
        isDefault: !!prompt.isDefault,
        promptType: 'analysis',
        targetModel: SUMMARY_MODEL_ID,
      });
    } catch (err) {
      console.error('promptPreflight threw on the rewrite; treating the checks as not run', err);
      return null;
    }
  }, [rewrite, prompt]);

  const takeRewrite = () => {
    onApplyImprovedPrompt({ instructions: rewrite.instructions, outputFormat: rewrite.outputFormat });
    onClose();
  };

  const notApplied = rewrite ? rewrite.sent.filter((item) => !rewrite.applied.includes(item.id)) : [];

  return (
    /*
      THROUGH THE PRIMITIVE. The backdrop is inert because an analysis takes a
      model call and most of a minute, and a stray click on the darkened page
      behind it threw the result away with no way to get it back except paying
      for it again. Wide, because the rewrite is shown before and after, side
      by side.
    */
    <Modal
      overlayClassName="pmgr-scrim"
      contentClassName="pmgr-modal pmgr-modal--wide"
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

        {!rewrite && (
          <>
            <div className="analysis-types" role="radiogroup" aria-label="What the advisor looks at">
              {LENSES.map((type) => (
                <label key={type.value} className={`analysis-type-option ${lens === type.value ? 'selected' : ''}`}>
                  <input
                    type="radio"
                    name="pmgr-advisor-lens"
                    value={type.value}
                    checked={lens === type.value}
                    disabled={!!busy}
                    onChange={(e) => setLens(e.target.value)}
                  />
                  <span className="type-icon"><Icon name={type.icon} weight="duotone" size={18} color="var(--primary)" /></span>
                  <span className="type-label">{type.label}</span>
                  <span className="type-desc">{type.description}</span>
                </label>
              ))}
            </div>

            <button
              type="button"
              className="btn-primary analyze-btn"
              onClick={runAnalysis}
              disabled={!!busy}
            >
              {busy === 'analysis' ? 'Analysing…' : 'Run analysis'}
            </button>
          </>
        )}

        {busy && progress && (
          <div className="pmgr-notice" data-testid="pmgr-advisor-progress">
            <StatusMessage message={progress} tone="pending" />
          </div>
        )}

        {notice && (
          <div className="pmgr-notice" data-testid="pmgr-advisor-notice">
            <StatusMessage message={notice} tone="error" />
          </div>
        )}

        {checklist && !rewrite && (
          <section className="analysis-results pmgr-advice" data-testid="pmgr-advice" aria-label="The advice">
            {(checklist.overallScore !== null || checklist.summary) && (
              <div className="result-section">
                {checklist.overallScore !== null && (
                  <div className="score-display">
                    <div className="score-value">{checklist.overallScore}/10</div>
                    <div className="score-bar">
                      <div
                        className="score-fill"
                        style={{ width: `${Math.max(0, Math.min(10, checklist.overallScore)) * 10}%` }}
                      />
                    </div>
                  </div>
                )}
                {checklist.summary && <p className="pmgr-advice-summary">{checklist.summary}</p>}
              </div>
            )}

            {checklist.issues.length === 0 ? (
              <p className="pmgr-advice-lede">
                The advisor found nothing to change. The prompt is exactly as it was.
              </p>
            ) : (
              <>
                <p className="pmgr-advice-lede">
                  Tick the fixes you want; the high-priority ones start ticked. Apply selected rewrites
                  only what is ticked and shows you both halves, before and after, before anything
                  reaches the editor.
                </p>
                {HALF_GROUPS.map((group) => {
                  const items = checklist.issues.filter((item) => item.half === group.half);
                  if (!items.length) return null;
                  return (
                    <section
                      key={group.half}
                      className="result-section pmgr-advice-group"
                      data-testid={`pmgr-advice-group-${group.half}`}
                    >
                      <h4>
                        {group.half === 'both' && !hasHalves ? 'The whole prompt' : group.title}
                        {hasHalves && <span className="pmgr-advice-group-note"> — {group.note}</span>}
                      </h4>
                      <ul className="pmgr-advice-list">
                        {items.map((item) => (
                          <li key={item.id} className={`pmgr-advice-item pmgr-advice-item--${item.severity}`}>
                            <label className="pmgr-advice-label">
                              <input
                                type="checkbox"
                                checked={ticked.has(item.id)}
                                disabled={!!busy}
                                onChange={() => toggle(item.id)}
                                data-testid={`pmgr-advice-tick-${item.id}`}
                              />
                              <span className="pmgr-advice-text">
                                <span className="pmgr-advice-issue">
                                  <strong className="pmgr-advice-severity">{SEVERITY_WORDS[item.severity] || 'Priority not given'}.</strong>
                                  {' '}{item.issue}
                                </span>
                                {item.fix && <span className="pmgr-advice-fix">Fix: {item.fix}</span>}
                              </span>
                            </label>
                          </li>
                        ))}
                      </ul>
                    </section>
                  );
                })}
              </>
            )}
          </section>
        )}

        {rewrite && (
          <section className="analysis-results pmgr-rewrite" data-testid="pmgr-rewrite" aria-label="The rewrite">
            <div className="result-section">
              <h4><Icon name="Sparkle" weight="fill" size={16} color="var(--primary)" /> The rewrite</h4>
              <p className="pmgr-rewrite-note">
                {rewrite.applied.length} of {rewrite.sent.length} ticked fixes applied. Nothing has been
                saved: Use this puts both halves into the editor, where you read them and save as usual.
              </p>
              {notApplied.length > 0 && (
                <>
                  <p className="pmgr-rewrite-note">
                    Not applied — the advisor left these out, usually because applying them would
                    break a save rule:
                  </p>
                  <ul className="pmgr-rewrite-missed">
                    {notApplied.map((item) => <li key={item.id}>{item.issue}</li>)}
                  </ul>
                </>
              )}
            </div>

            {HALF_GROUPS.filter((group) => group.half !== 'both').map((group) => {
              const was = before[group.half];
              const now = rewrite[group.half];
              return (
                <section
                  key={group.half}
                  className="result-section pmgr-rewrite-half"
                  data-testid={`pmgr-rewrite-${group.half}`}
                >
                  <h4>
                    {group.title}
                    <span className="pmgr-advice-group-note">
                      {' — '}{was === now ? 'unchanged' : 'rewritten'}
                    </span>
                  </h4>
                  <div className="pmgr-rewrite-pair">
                    <div className="pmgr-rewrite-side">
                      <h5>Before</h5>
                      <pre data-testid={`pmgr-rewrite-${group.half}-before`}>{was}</pre>
                    </div>
                    <div className="pmgr-rewrite-side">
                      <h5>After</h5>
                      <pre data-testid={`pmgr-rewrite-${group.half}-after`}>{now}</pre>
                    </div>
                  </div>
                </section>
              );
            })}

            <div className="result-section">
              <h4>The editor&rsquo;s checks, run on the rewrite</h4>
              <PromptPreflightPanel
                report={report}
                unavailable={!report}
                unavailableReason={'The editor\'s checks could not run on this rewrite, so nothing has been '
                  + 'checked. This is not the same as nothing being wrong.'}
              />
            </div>
          </section>
        )}
      </div>

      {/*
        THE FOOTER CARRIES THE NEXT STEP AND THE EXIT, outside the scrolling
        body so neither can scroll away: the checklist runs to ten items and the
        rewrite to two long halves side by side. A person who has finished
        reading DOWN should not have to scroll back UP to act or to leave
        (commit `4fd425d6`, the set editor's version of the same report).
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
        {checklist && !rewrite && checklist.issues.length > 0 && (
          <button
            type="button"
            className="btn-primary"
            onClick={applySelected}
            disabled={!chosen.length || !!busy}
            data-testid="pmgr-advice-apply"
          >
            Apply selected ({chosen.length})
          </button>
        )}
        {rewrite && (
          <>
            <button type="button" className="btn-secondary" onClick={() => setRewrite(null)}>
              Choose different fixes
            </button>
            <button type="button" className="btn-primary" onClick={takeRewrite}>
              Use this
            </button>
          </>
        )}
      </div>
    </Modal>
  );
}
