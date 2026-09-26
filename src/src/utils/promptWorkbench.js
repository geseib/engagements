/**
 * ONE LIST OF WHAT IS WRONG WITH A PROMPT, AND WHERE EACH THING GETS FIXED.
 *
 * Spec: docs/superpowers/specs/2026-09-25-prompt-workbench-design.md.
 *
 * WHY THIS EXISTS. The owner, 2026-09-25, ran Improve, applied its fixes,
 * opened the editor, and met a finding Improve had never mentioned —
 * "discussionQuestions and nextSteps will come back empty on every round".
 * There were two reviewers that never saw each other: the AI advisor, which
 * rewrites the two text halves, and the editor's deterministic checks
 * (utils/promptPreflight.js), whose finding was about Output sections — a part
 * of the prompt Improve was never shown and could not change.
 *
 * So the workbench draws ONE list: the code's findings first (exact, and what
 * the save gate and the room obey), then the AI's advice (judgement), each
 * item carrying where it gets fixed:
 *
 *   improve  in the text halves — Improve can rewrite it; it has a tick box
 *   editor   in a field of the editor — Output sections, the default box, or
 *            the two halves themselves; no tick box, because no rewrite can
 *   info     a trade to know about, nothing to fix
 *
 * Pure functions, no React, so the routing is testable on its own and the
 * dialog only draws what this decides.
 */
import { extractVariableTokens } from '../config/templateVariables';

/**
 * Where each preflight finding gets fixed. __tests__/promptWorkbench.test.js
 * derives the codes promptPreflight.js can emit from its source and fails
 * when this map misses one — a new check has to be given a place before it
 * ships, or it would appear with no "where" at all.
 */
export const FINDING_ROUTES = Object.freeze({
  'empty-prompt': { route: 'editor', where: 'the two halves' },
  'unusable-shape': { route: 'editor', where: 'the two halves' },
  'no-answer-variable': { route: 'improve' },
  'unknown-variable': { route: 'improve' },
  'bracket-direction': { route: 'improve' },
  'output-shape-discarded': { route: 'editor', where: 'Output sections' },
  'prose-inlined-variable': { route: 'improve' },
  'duplicated-variable': { route: 'improve' },
  'unsafe-variable': { route: 'improve' },
  'structured-fields-empty': { route: 'editor', where: 'Output sections' },
  // A "## Heading" typed into instructions/outputFormat, with no
  // outputSections declared to hold it — same fix as output-shape-discarded
  // and structured-fields-empty, and for the same reason: Improve rewrites
  // only the two text halves, and cannot declare a section. The fix is to
  // add one in the editor's Output sections field, not to reword the prose.
  'prose-heading-overridden': { route: 'editor', where: 'Output sections' },
  'default-blast-radius': { route: 'editor', where: 'the default box' },
  'word-cap-not-enforced': { route: 'improve' },
  // A trade about airtime (raise the cap, drop a section, quote less) — the
  // finding itself says "this is a decision, not a defect".
  'evidence-budget': { route: 'info' },
  'assembled-size': { route: 'improve' },
  'emoji-shown-and-banned': { route: 'improve' },
  'back-reference-collision': { route: 'improve' },
});

const TIERS = ['blocking', 'silent', 'advisory'];
const TIER_SEVERITY = { blocking: 'high', silent: 'high', advisory: 'low' };

/**
 * Which part of the prompt a finding's evidence quotes. The preflight
 * prefixes every quote with its field (`instructions: …`, `outputSections[1].
 * guidance: …`); a finding quoting only one half is that half's, one quoting
 * only section guidance is Output sections', anything else is both.
 */
export function halfOfEvidence(evidence) {
  const fields = new Set();
  for (const line of String(evidence || '').split('\n')) {
    const m = /^(?:\w+ — )?([A-Za-z]+)(\[\d+\]\.\w+)?:/.exec(line.trim());
    if (!m) continue;
    if (m[1] === 'instructions') fields.add('instructions');
    else if (m[1] === 'outputFormat') fields.add('outputFormat');
    else if (m[1] === 'outputSections') fields.add('sections');
    else fields.add('other');
  }
  return fields.size === 1 && !fields.has('other') ? [...fields][0] : 'both';
}

/**
 * The preflight report as workbench items, in tier order.
 *
 * `canRewrite` is false for a one-piece (older template) prompt: the server
 * refuses to rewrite one, so nothing is offered to Improve and the halves
 * themselves become the place to fix it.
 */
export function checkItems(report, { canRewrite = true } = {}) {
  if (!report) return [];
  const items = [];
  const taken = new Set();
  for (const tier of TIERS) {
    for (const finding of Array.isArray(report[tier]) ? report[tier] : []) {
      const base = FINDING_ROUTES[finding.code] || { route: 'info' };
      const half = halfOfEvidence(finding.evidence);
      let { route } = base;
      let where = base.where || null;
      if (route === 'improve' && half === 'sections') { route = 'editor'; where = 'Output sections'; }
      if (route === 'improve' && !canRewrite) { route = 'editor'; where = 'the two halves'; }
      const tickable = route === 'improve';
      // A key that names the finding, not its position, so a tick survives the
      // list being recomputed while the admin edits the draft underneath it.
      const token = /\{([A-Za-z_$][\w$]*)\}/.exec(String(finding.title || ''));
      const stem = `check:${finding.code}${token ? `:${token[1]}` : ''}`;
      let key = stem;
      for (let n = 2; taken.has(key); n += 1) key = `${stem}:${n}`;
      taken.add(key);
      items.push({
        key,
        source: 'check',
        code: finding.code,
        tier,
        severity: TIER_SEVERITY[tier],
        half,
        route,
        where,
        tickable,
        // The ones that stop a save or misbehave in front of a room start
        // ticked; advice waits for the admin.
        preTicked: tickable && tier !== 'advisory',
        issue: finding.title,
        detail: finding.detail,
        fix: finding.fix,
        evidence: finding.evidence,
      });
    }
  }
  return items;
}

/** The AI's checklist as workbench items. A heading item is the editor's. */
export function aiItems(issues, { canRewrite = true } = {}) {
  return (Array.isArray(issues) ? issues : []).map((raw) => {
    const sections = raw.half === 'sections';
    const route = sections || !canRewrite ? 'editor' : 'improve';
    const tickable = route === 'improve';
    return {
      key: `ai:${raw.id}`,
      source: 'ai',
      id: raw.id,
      severity: raw.severity,
      half: raw.half,
      route,
      where: sections ? 'Output sections' : (route === 'editor' ? 'the two halves' : null),
      tickable,
      preTicked: tickable && raw.severity === 'high',
      issue: raw.issue,
      fix: raw.fix,
    };
  });
}

/** The line every item carries, in the words the screen uses. */
export function whereLabel(item) {
  if (item.route === 'improve') return 'Improve can fix this';
  if (item.route === 'editor') return `Fix in the editor: ${item.where}`;
  return 'For information';
}

/** How much of a finding's evidence rides along to the rewrite. */
const EVIDENCE_CHARS = 600;

/**
 * What the apply job is sent for one ticked item, or null for one no rewrite
 * may touch. A check carries its evidence, so the model can find the passage
 * the code found; the server bounds every field again.
 */
export function toApplyIssue(item) {
  if (!item || !item.tickable || item.half === 'sections') return null;
  const half = ['instructions', 'outputFormat'].includes(item.half) ? item.half : 'both';
  const issue = item.source === 'check' && item.evidence
    ? `${item.issue}\nWhere: ${String(item.evidence).slice(0, EVIDENCE_CHARS)}`
    : item.issue;
  return { id: item.key, severity: item.severity, half, issue, fix: item.fix };
}

/** The code's findings as the advisor is told them — so it neither repeats nor contradicts them. */
export function checksForAdvisor(report) {
  if (!report) return [];
  return TIERS.flatMap((tier) => (Array.isArray(report[tier]) ? report[tier] : [])
    .map((f) => ({ code: f.code, tier, title: f.title, fix: f.fix })));
}

/**
 * One finding's identity across two reports. Variable findings put the
 * variable first in the title and a count after it ("{x} appears 3 times"),
 * so the variable — not the whole title — is what makes two the same finding.
 */
const identity = (f) => {
  const token = /\{[A-Za-z_$][\w$]*\}/.exec(String(f.title || ''));
  return `${f.code}|${token ? token[0] : f.title}`;
};

const flatten = (report) => (report
  ? TIERS.flatMap((tier) => (Array.isArray(report[tier]) ? report[tier] : []).map((f) => ({ ...f, tier })))
  : []);

/** What a rewrite fixed, left and introduced, by the code's own checks. */
export function compareChecks(beforeReport, afterReport) {
  const before = flatten(beforeReport);
  const after = flatten(afterReport);
  const had = new Set(before.map(identity));
  const has = new Set(after.map(identity));
  return {
    fixed: before.filter((f) => !has.has(identity(f))),
    remaining: after.filter((f) => had.has(identity(f))),
    introduced: after.filter((f) => !had.has(identity(f))),
  };
}

/** Words as a person counts them — a dash or a bullet is not one. */
export function countWords(text) {
  return String(text || '').split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

const headingsOf = (text) => String(text || '').split('\n')
  .map((line) => line.trim())
  .filter((line) => /^#{1,6}\s+\S/.test(line))
  .map((line) => line.replace(/^#{1,6}\s+/, '').replace(/\s+#+\s*$/, '').trim());

/**
 * What a rewrite lost that it must not: a variable (every one named before
 * is named at least once after) or a heading line of the output format. The
 * server refuses a simplification that loses either; this is the screen's
 * own reading of the same rule, for a rewrite it is about to hand the editor.
 */
export function keptInRewrite(before, after) {
  const joined = (p) => `${(p && p.instructions) || ''}\n${(p && p.outputFormat) || ''}`;
  const afterVars = new Set(extractVariableTokens(joined(after)));
  const afterHeadings = new Set(headingsOf(after && after.outputFormat));
  return {
    lostVariables: extractVariableTokens(joined(before)).filter((v) => !afterVars.has(v)),
    lostHeadings: headingsOf(before && before.outputFormat).filter((h) => !afterHeadings.has(h)),
  };
}
