/**
 * ONE LIST, AND EVERY ITEM SAYS WHERE IT GETS FIXED — utils/promptWorkbench.js.
 *
 * The owner, 2026-09-25: he ran Improve, applied its fixes, opened the editor,
 * and the editor showed "discussionQuestions and nextSteps will come back empty
 * on every round" — a finding Improve had never mentioned and could not have
 * fixed, because it is about the prompt's Output sections and Improve rewrites
 * only the two text halves. Spec: docs/superpowers/specs/2026-09-25-prompt-
 * workbench-design.md.
 *
 * So the workbench shows the editor's deterministic checks and the AI's advice
 * in one list, and every item names where it gets fixed: Improve can fix it
 * (the text halves — a tick box), Fix in the editor (Output sections, the
 * default box, the two halves), or For information.
 *
 * rejects: a finding the preflight can emit that has no route (it would show
 *          with no "where", or worse be offered to a rewrite that cannot fix
 *          it); the structured-fields finding offered to Improve; a heading
 *          item from the AI sent to a rewrite; a before/after comparison that
 *          hides a finding the rewrite introduced.
 */
const fs = require('fs');
const path = require('path');
import { preflightPrompt } from '../utils/promptPreflight';
import {
  FINDING_ROUTES, checkItems, aiItems, whereLabel, toApplyIssue, checksForAdvisor,
  compareChecks, countWords, keptInRewrite, halfOfEvidence,
} from '../utils/promptWorkbench';

const PREFLIGHT = fs.readFileSync(path.join(__dirname, '..', 'utils', 'promptPreflight.js'), 'utf8');

const ART = {
  instructions: 'You are Workie, a warm host.\n\n**The titles the room wrote:**\n{responsesText}',
  outputFormat: '## The Winning Title\nSay which title won.',
  outputSections: [
    { heading: 'The Winning Title', guidance: 'Name it.' },
    { heading: 'The Reveal', guidance: 'The real title.' },
    { heading: 'Keep Playing', guidance: 'One line.' },
  ],
  promptType: 'analysis',
  gameType: 'call-and-answer',
};

describe('every finding the editor can raise has a place it gets fixed', () => {
  test('the routes cover exactly the codes promptPreflight.js emits', () => {
    // Derived from the module's source, not typed: a new check fails this
    // until someone decides where it gets fixed.
    const emitted = [...new Set([...PREFLIGHT.matchAll(/finding\(\s*'([a-z-]+)'/g)].map((m) => m[1]))].sort();
    expect(emitted.length).toBeGreaterThan(10);
    expect(Object.keys(FINDING_ROUTES).sort()).toEqual(emitted);
    for (const [code, r] of Object.entries(FINDING_ROUTES)) {
      expect(['improve', 'editor', 'info']).toContain(r.route);
      if (r.route === 'editor') expect(typeof r.where).toBe('string');
      expect(code).toBeTruthy();
    }
  });

  test("the owner's finding is fixed in the editor, in Output sections — and it has no tick box", () => {
    const items = checkItems(preflightPrompt(ART));
    const empty = items.find((i) => i.code === 'structured-fields-empty');
    expect(empty).toBeTruthy();
    expect(empty.route).toBe('editor');
    expect(empty.where).toBe('Output sections');
    expect(empty.tickable).toBe(false);
    expect(whereLabel(empty)).toBe('Fix in the editor: Output sections');
  });

  test('a finding in the text halves is Improve\'s, ticked from the start when it is not merely advice', () => {
    const report = preflightPrompt({
      ...ART, instructions: `${ART.instructions}\n\nFind two answers in {responsesText} that disagree.`,
    });
    const item = checkItems(report).find((i) => i.code === 'duplicated-variable');
    expect(item.route).toBe('improve');
    expect(item.tickable).toBe(true);
    expect(item.preTicked).toBe(true);
    expect(item.half).toBe('instructions');
    expect(whereLabel(item)).toBe('Improve can fix this');
  });

  test('advisory items are Improve\'s too, but left for the admin to tick', () => {
    const report = preflightPrompt({ ...ART, outputFormat: `${ART.outputFormat}\nKeep it under 300 words.` });
    const cap = checkItems(report).find((i) => i.code === 'word-cap-not-enforced');
    expect(cap.tickable).toBe(true);
    expect(cap.preTicked).toBe(false);
    expect(cap.severity).toBe('low');
  });

  test('the default flag is the editor\'s box', () => {
    const item = checkItems(preflightPrompt({ ...ART, isDefault: true })).find((i) => i.code === 'default-blast-radius');
    expect(whereLabel(item)).toBe('Fix in the editor: the default box');
    expect(item.tickable).toBe(false);
  });

  test('a heading typed into the text with no outputSections declared is fixed in Output sections, not by Improve', () => {
    // BUGSWEEP 5c's finding: a "## Heading" line in instructions/outputFormat
    // is thrown away by the FORMAT block unless outputSections is declared.
    // Improve rewrites only the two text halves — it cannot declare a section
    // — so like output-shape-discarded and structured-fields-empty, the fix
    // is in the editor's Output sections field.
    const report = preflightPrompt({
      instructions: 'Read the answers and say what the room decided.\n\n- The answers: {responsesText}',
      outputFormat: '## Room Verdict\nSay what happened.',
      gameType: 'call-and-answer',
    });
    const item = checkItems(report).find((i) => i.code === 'prose-heading-overridden');
    expect(item).toBeTruthy();
    expect(item.route).toBe('editor');
    expect(item.where).toBe('Output sections');
    expect(item.tickable).toBe(false);
    expect(whereLabel(item)).toBe('Fix in the editor: Output sections');
  });

  test('a finding whose evidence sits only in a section\'s guidance is fixed in Output sections, not by Improve', () => {
    const report = preflightPrompt({
      ...ART,
      outputSections: [{ heading: 'Summary', guidance: 'Quote from {responsesText} and then {responsesText} again.' }],
    });
    const items = checkItems(report).filter((i) => i.half === 'sections');
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(item.route).toBe('editor');
      expect(item.where).toBe('Output sections');
      expect(item.tickable).toBe(false);
    }
  });

  test('nothing is tickable when the prompt cannot be rewritten (a one-piece template)', () => {
    const report = preflightPrompt({ ...ART, template: 'Review {responsesText} and {responsesText}.' });
    const items = checkItems(report, { canRewrite: false });
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((i) => !i.tickable)).toBe(true);
  });

  test('halfOfEvidence reads the field names the preflight prefixes its quotes with', () => {
    expect(halfOfEvidence('instructions: a\ninstructions: b')).toBe('instructions');
    expect(halfOfEvidence('outputFormat: a')).toBe('outputFormat');
    expect(halfOfEvidence('instructions: a\noutputFormat: b')).toBe('both');
    expect(halfOfEvidence('outputSections[0].guidance: a')).toBe('sections');
    expect(halfOfEvidence('template: a')).toBe('both');
    expect(halfOfEvidence('isDefault: true')).toBe('both');
  });
});

describe("the AI's items join the same list", () => {
  const ISSUES = [
    { id: 'i1', severity: 'high', half: 'instructions', issue: 'Flat.', fix: 'Warmer.' },
    { id: 'i2', severity: 'medium', half: 'sections', issue: 'Keep Playing matches nothing.', fix: 'Rename it.' },
    { id: 'i3', severity: 'low', half: 'both', issue: 'Long.', fix: 'Cut.' },
  ];

  test('a heading item is the editor\'s and cannot be ticked; the rest are Improve\'s', () => {
    const items = aiItems(ISSUES);
    expect(items.map((i) => i.key)).toEqual(['ai:i1', 'ai:i2', 'ai:i3']);
    expect(items[1].route).toBe('editor');
    expect(whereLabel(items[1])).toBe('Fix in the editor: Output sections');
    expect(items[1].tickable).toBe(false);
    expect(items.map((i) => i.preTicked)).toEqual([true, false, false]);
  });

  test('what an apply is sent: the key as the id, the half, the words — and never a heading item', () => {
    const [ai] = aiItems(ISSUES);
    expect(toApplyIssue(ai)).toEqual({ id: 'ai:i1', severity: 'high', half: 'instructions', issue: 'Flat.', fix: 'Warmer.' });
    const heading = aiItems(ISSUES)[1];
    expect(toApplyIssue(heading)).toBeNull();
  });

  test('a check sent to apply carries its evidence, so the model can find the passage', () => {
    const report = preflightPrompt({
      ...ART, instructions: `${ART.instructions}\n\nFind two answers in {responsesText} that disagree.`,
    });
    const item = checkItems(report).find((i) => i.code === 'duplicated-variable');
    const sent = toApplyIssue(item);
    expect(sent.id).toBe(item.key);
    expect(sent.issue).toContain(item.issue);
    expect(sent.issue).toContain('{responsesText}');
    expect(sent.fix).toBe(item.fix);
  });

  test('what the advisor is told about the checks: code, tier, title and fix, nothing else', () => {
    const told = checksForAdvisor(preflightPrompt(ART));
    const empty = told.find((c) => c.code === 'structured-fields-empty');
    expect(Object.keys(empty).sort()).toEqual(['code', 'fix', 'tier', 'title']);
    expect(empty.tier).toBe('silent');
    expect(checksForAdvisor(null)).toEqual([]);
  });
});

describe('before and after', () => {
  test('compareChecks names what a rewrite fixed, what it left and what it introduced', () => {
    const before = preflightPrompt({
      ...ART, instructions: `${ART.instructions}\n\nFind two answers in {responsesText} that disagree.`,
    });
    const after = preflightPrompt({ ...ART, outputFormat: `${ART.outputFormat}\n[two sentences]` });
    const { fixed, remaining, introduced } = compareChecks(before, after);
    expect(fixed.map((f) => f.code)).toContain('duplicated-variable');
    expect(remaining.map((f) => f.code)).toContain('structured-fields-empty');
    expect(introduced.map((f) => f.code)).toContain('bracket-direction');
  });

  test('countWords counts what a person would', () => {
    expect(countWords('')).toBe(0);
    expect(countWords('  One two\nthree —   four. ')).toBe(4); // the dash is not a word
  });

  test('keptInRewrite names every variable and heading line a rewrite lost', () => {
    const before = { instructions: 'A {responsesText} and {voteTally}.', outputFormat: '## Winner\nx\n## The Reveal\ny' };
    expect(keptInRewrite(before, before)).toEqual({ lostVariables: [], lostHeadings: [] });
    const after = { instructions: 'A {responsesText}.', outputFormat: '## Winner\nx' };
    expect(keptInRewrite(before, after)).toEqual({ lostVariables: ['voteTally'], lostHeadings: ['The Reveal'] });
  });
});
