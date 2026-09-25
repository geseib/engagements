import React, { useState, useEffect, useMemo, useRef } from 'react';
import Icon from './Icon';
import StatusMessage from './StatusMessage';
import PromptPreflightPanel from './PromptPreflightPanel';
import PromptBeforeAfter from './PromptBeforeAfter';
import { normalizeGameType } from '../config/gameTypes';
import { preflightPrompt, SUMMARY_MODEL } from '../utils/promptPreflight';
import {
  checkItems, aiItems, whereLabel, toApplyIssue, checksForAdvisor, compareChecks, countWords, keptInRewrite,
} from '../utils/promptWorkbench';
import {
  ADVISOR_GIVE_UP_MS, ADVISOR_POLL_INTERVAL_MS,
  asSentence, describeAdviceProgress, startPromptAdvice, waitForPromptAdvice,
} from '../utils/promptAdvisorJob';

const API_BASE = window.API_BASE;

/**
 * THREE THINGS TO ASK. Review and Improve answer in one checklist; Simplify
 * answers with a rewrite. Validate became Review and Optimize folded into
 * Improve on 2026-09-24; Simplify is the owner's 2026-09-25 "having the
 * ability to simplify the prompt is a good ask as well".
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
    description: 'Suggests a better read-back for the room: variety, a spoken voice, the round\'s and the '
      + 'event\'s facts, and tighter wording.',
  },
  {
    value: 'simplify',
    label: 'Simplify',
    icon: 'TextAlignLeft',
    description: 'Rewrites it shorter and clearer in one pass, keeping every variable, heading and save rule.',
  },
];

/** The AI's items, grouped in the words the editor uses for the parts they change. */
const HALF_GROUPS = [
  { half: 'instructions', title: 'What the AI is given', note: 'the instructions half' },
  { half: 'outputFormat', title: 'What the AI writes', note: 'the output format half' },
  { half: 'both', title: 'Both halves', note: 'changes that touch the whole prompt' },
  { half: 'sections', title: 'The reply\'s headings', note: 'Output sections, changed in the editor' },
];

/** Severity as a word in the sentence, never a tiny uppercase tag. */
const SEVERITY_WORDS = { high: 'High priority', medium: 'Medium priority', low: 'Low priority' };
/** A check's tier in the words the editor's own panel uses. */
const TIER_WORDS = { blocking: 'Stops the save', silent: 'Misbehaves quietly', advisory: 'Worth knowing' };
/** …and in its colours: red, amber, blue — the item classes the checklist already paints. */
const TIER_TONES = { blocking: 'high', silent: 'medium', advisory: 'low' };

/** What makes two drafts "the same draft" for the purpose of stale advice. */
const draftShape = (d) => JSON.stringify([d.instructions || '', d.outputFormat || '', d.outputSections || null]);

/*
  THE WORKBENCH — the editor's Improve view (docs/superpowers/specs/
  2026-09-25-prompt-workbench-design.md).

  The owner, 2026-09-25: he ran Improve from the library row, applied its
  fixes, opened the editor, and the editor showed "discussionQuestions and
  nextSteps will come back empty on every round" — a finding Improve had
  never mentioned. Two reviewers that never saw each other: this dialog, which
  reviewed the SAVED copy and was never shown Output sections, and the editor's
  deterministic checks, shown here only after Apply, at the bottom.

  Now this is a view of the editor, on the DRAFT (unsaved text included):

    1. What the checks found — the editor's own report, at once, before any
       model is paid for. Every item says where it gets fixed; the ones in the
       text halves have a tick box (utils/promptWorkbench.js decides).
    2. Ask the AI — Review or Improve adds its items to the same list, grouped
       by the part they change; the model is sent the sections and the
       findings, and told not to repeat or contradict them. Simplify rewrites.
    3. Apply selected — ONE rewrite for the ticked items from both lists. It
       opens with the checks re-run on it (fixed / still there / new), then
       each half before and after with word counts.
    4. Use this — both halves go into the editor as unsaved work. Nothing here
       writes to the prompt; Save in the editor does.

  It renders no Modal of its own: it is a view inside the editor's dialog,
  whose × and whose requestClose it shares (`onClose`). `pollIntervalMs` and
  `giveUpMs` are props only so the tests need not wait on real seconds.
*/
export default function AIPromptAdvisor({
  draft, report, onApply, onBack, onClose,
  pollIntervalMs = ADVISOR_POLL_INTERVAL_MS,
  giveUpMs = ADVISOR_GIVE_UP_MS,
}) {
  const [lens, setLens] = useState('review');
  /** 'analysis', 'apply' or 'simplify' while a job runs, else null. */
  const [busy, setBusy] = useState(null);
  const [advice, setAdvice] = useState(null);
  /** The admin's own ticks and unticks, by item key; the rest keep their default. */
  const [overrides, setOverrides] = useState(() => new Map());
  const [rewrite, setRewrite] = useState(null);
  const [notice, setNotice] = useState('');
  const [progress, setProgress] = useState('');

  /*
    Leaving the view mid-run must stop the polling and every state update
    after it. Set in the effect body, not just its cleanup, because StrictMode
    mounts, unmounts and remounts once in development.
  */
  const closedRef = useRef(false);
  useEffect(() => {
    closedRef.current = false;
    return () => { closedRef.current = true; };
  }, []);

  const url = `${API_BASE}admin/ai-prompt-advisor`;
  const halves = { instructions: draft.instructions || '', outputFormat: draft.outputFormat || '' };
  const template = String(draft.template || '');
  const onePiece = !!template.trim();
  const hasHalves = !!(halves.instructions.trim() || halves.outputFormat.trim());
  // A one-piece (older template) prompt runs as that piece, so it is reviewed
  // as it — and the server will not rewrite one into halves.
  const canRewrite = hasHalves && !onePiece;

  const checks = useMemo(() => checkItems(report, { canRewrite }), [report, canRewrite]);
  const suggestions = useMemo(() => aiItems(advice ? advice.issues : [], { canRewrite }), [advice, canRewrite]);
  const everything = [...checks, ...suggestions];
  const isTicked = (item) => item.tickable && (overrides.has(item.key) ? overrides.get(item.key) : item.preTicked);
  const chosen = everything.filter(isTicked);
  const anyTickable = everything.some((item) => item.tickable);
  const stale = !!advice && advice.forDraft !== draftShape(draft);

  /** What every job is sent: the DRAFT, never the saved copy's id. */
  const promptRequest = () => ({
    ...(onePiece ? { promptText: template } : halves),
    ...(Array.isArray(draft.outputSections) && draft.outputSections.length ? { outputSections: draft.outputSections } : {}),
    gameType: normalizeGameType(draft.gameType),
    context: { name: draft.name || '', description: draft.description || '', category: draft.category || '' },
  });

  /** Start one job and wait for it. Resolves with its result, or null once the view has gone. */
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

  const settle = () => {
    if (!closedRef.current) {
      setBusy(null);
      setProgress('');
    }
  };

  const runAnalysis = async () => {
    setBusy('analysis');
    setNotice('');
    const forDraft = draftShape(draft);
    try {
      const result = await runJob({ ...promptRequest(), analysisType: lens, checks: checksForAdvisor(report) });
      if (!result) return;
      const analysis = result.analysis || {};
      setAdvice({
        overallScore: typeof analysis.overallScore === 'number' ? analysis.overallScore : null,
        summary: analysis.summary || '',
        issues: Array.isArray(analysis.issues) ? analysis.issues : [],
        forDraft,
      });
      // Fresh advice starts from its own defaults; ticks on the code's
      // findings are the admin's and stay.
      setOverrides((current) => new Map([...current].filter(([key]) => !key.startsWith('ai:'))));
    } catch (error) {
      if (closedRef.current) return;
      console.error('Error analysing prompt:', error);
      setNotice(`No analysis was produced. ${asSentence(error.message)} The prompt itself is untouched — nothing here writes to it.`);
    } finally {
      settle();
    }
  };

  const runSimplify = async () => {
    setBusy('simplify');
    setNotice('');
    try {
      const result = await runJob({ ...promptRequest(), analysisType: 'simplify' });
      if (!result) return;
      const analysis = result.analysis || {};
      setRewrite({
        kind: 'simplify',
        instructions: String(analysis.instructions ?? ''),
        outputFormat: String(analysis.outputFormat ?? ''),
        applied: [],
        sent: [],
      });
    } catch (error) {
      if (closedRef.current) return;
      console.error('Error simplifying the prompt:', error);
      setNotice(`Nothing was simplified. ${asSentence(error.message)} The prompt itself is untouched.`);
    } finally {
      settle();
    }
  };

  const applySelected = async () => {
    const issues = chosen.map(toApplyIssue).filter(Boolean);
    if (!issues.length) return;
    setBusy('apply');
    setNotice('');
    try {
      // ONLY what was ticked — the server is told nothing about the rest.
      const result = await runJob({ ...promptRequest(), analysisType: 'apply', issues });
      if (!result) return;
      const analysis = result.analysis || {};
      setRewrite({
        kind: 'apply',
        instructions: String(analysis.instructions ?? ''),
        outputFormat: String(analysis.outputFormat ?? ''),
        applied: Array.isArray(analysis.applied) ? analysis.applied : [],
        sent: chosen.filter((item) => toApplyIssue(item)),
      });
    } catch (error) {
      if (closedRef.current) return;
      console.error('Error applying the ticked fixes:', error);
      setNotice(`The fixes were not applied. ${asSentence(error.message)} The prompt itself is untouched, and your ticks are still here.`);
    } finally {
      settle();
    }
  };

  const toggle = (item) => setOverrides((current) => {
    const next = new Map(current);
    next.set(item.key, !isTicked(item));
    return next;
  });

  /**
   * THE EDITOR'S OWN CHECKS, ON THE REWRITE — the same call the editor makes
   * on every keystroke, compared with the same checks on the draft, so the
   * verdict on a rewrite is the one Save and the room will reach.
   */
  const rewriteReport = useMemo(() => {
    if (!rewrite) return null;
    try {
      return preflightPrompt({
        ...draft,
        instructions: rewrite.instructions,
        outputFormat: rewrite.outputFormat,
        gameType: normalizeGameType(draft.gameType),
        promptType: 'analysis',
        targetModel: SUMMARY_MODEL.bedrockId,
      });
    } catch (err) {
      console.error('promptPreflight threw on the rewrite; treating the checks as not run', err);
      return null;
    }
  }, [rewrite, draft]);

  const verdict = rewrite && rewriteReport && report ? compareChecks(report, rewriteReport) : null;
  const kept = rewrite ? keptInRewrite(halves, rewrite) : null;
  const lostSomething = !!kept && (kept.lostVariables.length > 0 || kept.lostHeadings.length > 0);
  // Simplify promised to keep everything; a rewrite that did not is not handed on.
  const blockedUse = !!rewrite && rewrite.kind === 'simplify' && lostSomething;
  const notApplied = rewrite && rewrite.kind === 'apply'
    ? rewrite.sent.filter((item) => !rewrite.applied.includes(item.key))
    : [];
  const wordsBefore = countWords(halves.instructions) + countWords(halves.outputFormat);
  const wordsAfter = rewrite ? countWords(rewrite.instructions) + countWords(rewrite.outputFormat) : 0;

  const renderItem = (item) => {
    const lead = item.source === 'check' ? TIER_WORDS[item.tier] : (SEVERITY_WORDS[item.severity] || 'Priority not given');
    // A check is coloured by its tier, as the editor's own panel colours it —
    // amber for "misbehaves quietly", never the red of a blocked save.
    const tone = item.source === 'check' ? TIER_TONES[item.tier] : (item.severity || 'low');
    const text = (
      <span className="pmgr-advice-text">
        <span className="pmgr-advice-issue">
          <strong className="pmgr-advice-severity">{lead}.</strong>{' '}{item.issue}
        </span>
        {item.fix && <span className="pmgr-advice-fix">Fix: {item.fix}</span>}
        <span className={`pmgr-wb-where pmgr-wb-where--${item.route}`}>{whereLabel(item)}</span>
      </span>
    );
    return (
      <li
        key={item.key}
        className={`pmgr-advice-item pmgr-advice-item--${tone}`}
        data-testid={`pmgr-wb-item-${item.key}`}
      >
        {item.tickable ? (
          <label className="pmgr-advice-label">
            <input
              type="checkbox"
              checked={isTicked(item)}
              disabled={!!busy}
              onChange={() => toggle(item)}
              data-testid={`pmgr-advice-tick-${item.key}`}
            />
            {text}
          </label>
        ) : (
          <div className="pmgr-advice-label pmgr-advice-label--fixed">{text}</div>
        )}
      </li>
    );
  };

  /** A finding's "where", read the same way the list above reads it. */
  const whereOf = (finding) => {
    const [item] = checkItems({ [finding.tier]: [finding] }, { canRewrite });
    return item ? whereLabel(item) : '';
  };

  const findingLines = (findings, testId, heading, withWhere) => (findings.length ? (
    <div className="pmgr-rewrite-verdict-group" data-testid={testId}>
      <h5>{heading} ({findings.length})</h5>
      <ul className="pmgr-rewrite-missed">
        {findings.map((f) => (
          <li key={`${f.code}|${f.title}`}>
            {f.title}
            {withWhere && <span className="pmgr-wb-where-inline"> — {whereOf(f)}</span>}
          </li>
        ))}
      </ul>
    </div>
  ) : null);

  return (
    <>
      <div className="pmgr-advisor-body" data-testid="pmgr-advisor-body">
        {!rewrite && (
          <>
            <p className="pmgr-advice-lede">
              Everything here works on the draft in the editor, unsaved changes included. Nothing is
              saved until you press Save in the editor.
            </p>

            <section className="result-section pmgr-wb-checks" data-testid="pmgr-wb-checks" aria-label="What the checks found">
              <h4>
                What the checks found
                <span className="pmgr-advice-group-note"> — exact: the save and the room obey these</span>
              </h4>
              {!report && (
                <p className="pmgr-advice-lede">
                  The editor&rsquo;s checks did not run, so this list has only the AI&rsquo;s advice. That
                  is not the same as nothing being wrong.
                </p>
              )}
              {report && checks.length === 0 && (
                <p className="pmgr-advice-lede">The checks found nothing on this draft.</p>
              )}
              {checks.length > 0 && <ul className="pmgr-advice-list">{checks.map(renderItem)}</ul>}
            </section>

            <section className="result-section pmgr-wb-ask" aria-label="Ask the AI">
              <h4>Ask the AI</h4>
              <div className="analysis-types" role="radiogroup" aria-label="What the AI does">
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
              {lens === 'simplify' && !canRewrite && (
                <p className="pmgr-advice-lede">
                  This is an older one-piece prompt, so there are no two halves to simplify into.
                </p>
              )}
              <button
                type="button"
                className="btn-primary analyze-btn"
                onClick={lens === 'simplify' ? runSimplify : runAnalysis}
                disabled={!!busy || (lens === 'simplify' && !canRewrite)}
                data-testid="pmgr-wb-run"
              >
                {busy === 'analysis' || busy === 'simplify' ? 'Working…' : (lens === 'simplify' ? 'Simplify it' : 'Get advice')}
              </button>
            </section>
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

        {advice && !rewrite && (
          <section className="analysis-results pmgr-advice" data-testid="pmgr-advice" aria-label="What the AI suggests">
            <div className="result-section">
              <h4>
                What the AI suggests
                <span className="pmgr-advice-group-note"> — judgement, not rules</span>
              </h4>
              {advice.overallScore !== null && (
                <div className="score-display">
                  <div className="score-value">{advice.overallScore}/10</div>
                  <div className="score-bar">
                    <div
                      className="score-fill"
                      style={{ width: `${Math.max(0, Math.min(10, advice.overallScore)) * 10}%` }}
                    />
                  </div>
                </div>
              )}
              {advice.summary && <p className="pmgr-advice-summary">{advice.summary}</p>}
              {stale && (
                <p className="pmgr-advice-lede" data-testid="pmgr-advice-stale">
                  The draft has changed since this advice was written, so some of it may no longer fit.
                  Get advice again to refresh it.
                </p>
              )}
            </div>

            {suggestions.length === 0 ? (
              <p className="pmgr-advice-lede">The AI found nothing to change.</p>
            ) : (
              HALF_GROUPS.map((group) => {
                const items = suggestions.filter((item) => (item.half || 'both') === group.half);
                if (!items.length) return null;
                return (
                  <section
                    key={group.half}
                    className="result-section pmgr-advice-group"
                    data-testid={`pmgr-advice-group-${group.half}`}
                  >
                    <h4>
                      {group.half === 'both' && !hasHalves ? 'The whole prompt' : group.title}
                      {(hasHalves || group.half === 'sections') && (
                        <span className="pmgr-advice-group-note"> — {group.note}</span>
                      )}
                    </h4>
                    <ul className="pmgr-advice-list">{items.map(renderItem)}</ul>
                  </section>
                );
              })
            )}
          </section>
        )}

        {rewrite && (
          <section className="analysis-results pmgr-rewrite" data-testid="pmgr-rewrite" aria-label="The rewrite">
            <div className="result-section">
              <h4>
                <Icon name="Sparkle" weight="fill" size={16} color="var(--primary)" />{' '}
                {rewrite.kind === 'simplify' ? 'The simplified prompt' : 'The rewrite'}
              </h4>
              {rewrite.kind === 'apply' && (
                <p className="pmgr-rewrite-note">
                  {rewrite.applied.length} of {rewrite.sent.length} ticked fixes applied.
                </p>
              )}
              <p className="pmgr-rewrite-note" data-testid="pmgr-rewrite-words">
                {wordsAfter < wordsBefore
                  ? `Shorter by ${wordsBefore - wordsAfter} words (${wordsBefore} → ${wordsAfter}).`
                  : `Not shorter: ${wordsBefore} → ${wordsAfter} words.`}
              </p>
              <p className="pmgr-rewrite-note">
                Nothing has been saved: Use this puts both halves into the editor, where you read them
                and save as usual.
              </p>
              {notApplied.length > 0 && (
                <>
                  <p className="pmgr-rewrite-note">
                    Not applied — the advisor left these out, usually because applying them would break a
                    save rule:
                  </p>
                  <ul className="pmgr-rewrite-missed">
                    {notApplied.map((item) => <li key={item.key}>{item.issue}</li>)}
                  </ul>
                </>
              )}
              <p className="pmgr-rewrite-note" data-testid="pmgr-rewrite-kept">
                {lostSomething
                  ? `No longer in it: ${[
                    ...kept.lostVariables.map((v) => `{${v}}`),
                    ...kept.lostHeadings.map((h) => `the heading “${h}”`),
                  ].join(', ')}.${blockedUse ? ' A simplification must keep every one, so Use this is off.' : ''}`
                  : 'Every {variable} and heading is still there.'}
              </p>
            </div>

            <div className="result-section pmgr-rewrite-verdict" data-testid="pmgr-rewrite-checks">
              <h4>The checks, run on the {rewrite.kind === 'simplify' ? 'simplified prompt' : 'rewrite'}</h4>
              {verdict ? (
                <>
                  {findingLines(verdict.fixed, 'pmgr-rewrite-fixed', 'Fixed', false)}
                  {findingLines(verdict.remaining, 'pmgr-rewrite-remaining', 'Still there', true)}
                  {findingLines(verdict.introduced, 'pmgr-rewrite-introduced', 'New', true)}
                  {!verdict.fixed.length && !verdict.remaining.length && !verdict.introduced.length && (
                    <p className="pmgr-rewrite-note">Nothing found, before or after.</p>
                  )}
                </>
              ) : (
                <p className="pmgr-rewrite-note">
                  The editor&rsquo;s checks could not run on this, so nothing has been compared. This is
                  not the same as nothing being wrong.
                </p>
              )}
            </div>

            <PromptBeforeAfter
              title="What the AI is given"
              before={halves.instructions}
              after={rewrite.instructions}
              testId="pmgr-rewrite-instructions"
            />
            <PromptBeforeAfter
              title="What the AI writes"
              before={halves.outputFormat}
              after={rewrite.outputFormat}
              testId="pmgr-rewrite-outputFormat"
            />

            <div className="result-section">
              <h4>The checks in full</h4>
              <PromptPreflightPanel
                report={rewriteReport}
                unavailable={!rewriteReport}
                unavailableReason={'The editor\'s checks could not run on this rewrite, so nothing has been '
                  + 'checked. This is not the same as nothing being wrong.'}
              />
            </div>
          </section>
        )}
      </div>

      {/*
        THE FOOTER CARRIES THE NEXT STEP AND THE EXITS, outside the scrolling
        body so none can scroll away (commit `4fd425d6`). Close leaves the
        whole dialog through the editor's requestClose, which asks first when
        there is unsaved work; Back returns to the form.
      */}
      <div className="form-actions">
        <button type="button" className="btn-secondary" onClick={onClose} data-testid="pmgr-advisor-close">
          Close
        </button>
        <button type="button" className="btn-secondary" onClick={onBack} data-testid="pmgr-advisor-back">
          Back to the editor
        </button>
        {!rewrite && anyTickable && (
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
              {rewrite.kind === 'simplify' ? 'Back to the list' : 'Choose different fixes'}
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={blockedUse}
              onClick={() => onApply({ instructions: rewrite.instructions, outputFormat: rewrite.outputFormat })}
            >
              Use this
            </button>
          </>
        )}
      </div>
    </>
  );
}
