/**
 * THE FACTS THE EDITOR STATES ABOUT THE SUMMARY ENGINE, PINNED TO THE ENGINE.
 *
 * utils/promptPreflight.js cannot import lambda-functions/game/get-ai-summary.js
 * (a separate bundle), so it carries copies of two things the engine decides —
 * which headings fill discussionQuestions and nextSteps (SECTION_SYNONYMS), and
 * the model a Workie is read by, with its token budget. Both had drifted by
 * 2026-09-25:
 *
 *   - the structured-fields finding cited "get-ai-summary.js:95-99, :162-163"
 *     for SECTION_SYNONYMS; the table had moved to ~:182 and the fill to ~:250;
 *   - the word-cap finding quoted max_tokens 1,024 (~750 words) and
 *     temperature 0.5; the engine had moved to 2,048 and 0.7 (the Leadership
 *     Principals Workie lost its Next Steps at 1,024), so every "under 900
 *     words" cap was waved through as enforced when it was not.
 *
 * The workbench's export (utils/workieBundle.js) hands these same facts to an
 * outside agent, so a drift now misleads two readers. This reads the engine's
 * SOURCE and fails when the copies disagree, and it pins the prose to NAMES
 * rather than line numbers, which cannot go stale.
 */
const fs = require('fs');
const path = require('path');
import { SECTION_SYNONYMS, SUMMARY_MODEL, preflightPrompt } from '../utils/promptPreflight';

const ENGINE = fs.readFileSync(
  path.join(__dirname, '..', '..', '..', 'lambda-functions', 'game', 'get-ai-summary.js'), 'utf8',
);
const PREFLIGHT = fs.readFileSync(path.join(__dirname, '..', 'utils', 'promptPreflight.js'), 'utf8');

/** The engine's SECTION_SYNONYMS, as { kind: regex source + flags }. */
function engineSynonyms() {
  const block = /const SECTION_SYNONYMS = \{([\s\S]*?)\n\};/.exec(ENGINE);
  if (!block) throw new Error('SECTION_SYNONYMS not found in get-ai-summary.js');
  const out = {};
  for (const m of block[1].matchAll(/^\s*(\w+):\s*\/(.+)\/([a-z]*),\s*$/gm)) out[m[1]] = `/${m[2]}/${m[3]}`;
  return out;
}

describe('SECTION_SYNONYMS', () => {
  test('the editor\'s copy is the engine\'s table, kind for kind, pattern for pattern', () => {
    const engine = engineSynonyms();
    expect(Object.keys(engine)).toEqual(['summary', 'discussion', 'nextSteps']);
    const mine = Object.fromEntries(Object.entries(SECTION_SYNONYMS).map(([k, re]) => [k, String(re)]));
    expect(mine).toEqual(engine);
  });

  test('the structured-fields finding names the table and the parser, not line numbers', () => {
    const report = preflightPrompt({
      instructions: 'x {responsesText}',
      outputFormat: 'y',
      promptType: 'analysis',
      outputSections: [{ heading: 'The Winning Title' }, { heading: 'The Reveal' }, { heading: 'Keep Playing' }],
    });
    const finding = report.silent.find((f) => f.code === 'structured-fields-empty');
    expect(finding).toBeTruthy();
    expect(finding.detail).toMatch(/SECTION_SYNONYMS/);
    expect(finding.detail).toMatch(/parseAIResponse/);
    // rejects: ":95-99", ":162-163", "hostRemote.js:536" — the citations that went stale.
    expect(finding.detail).not.toMatch(/\.jsx?:\d/);
    expect(finding.detail).not.toMatch(/:\d+-\d+/);
    expect(PREFLIGHT).not.toMatch(/get-ai-summary\.js:95-99/);
  });
});

describe('the model a Workie is read by', () => {
  test('the model, its max_tokens and its temperature are the engine\'s', () => {
    const call = /const invokeHaiku[\s\S]*?max_tokens:\s*(\d+)[\s\S]*?temperature:\s*([\d.]+)/.exec(ENGINE);
    expect(call).toBeTruthy();
    expect(SUMMARY_MODEL.maxTokens).toBe(Number(call[1]));
    expect(SUMMARY_MODEL.temperature).toBe(Number(call[2]));
    expect(ENGINE).toContain(SUMMARY_MODEL.bedrockId);
    expect(SUMMARY_MODEL.label).toBe('Claude Haiku 4.5');
  });

  test('the word-cap finding quotes that budget', () => {
    const report = preflightPrompt({
      instructions: 'x {responsesText}', outputFormat: 'Keep it under 900 words.', promptType: 'analysis',
    });
    const cap = report.advisory.find((f) => f.code === 'word-cap-not-enforced');
    // 900 words is well under what 2,048 tokens allows, so it is a request, not a limit.
    expect(cap).toBeTruthy();
    expect(cap.detail).toContain(SUMMARY_MODEL.maxTokens.toLocaleString('en-US'));
    expect(cap.detail).not.toMatch(/get-ai-summary\.js:\d/);
  });

  test('the dashed model ids the editor passes are recognised, not "assumed"', () => {
    for (const targetModel of ['claude-haiku-4-5-20251001', SUMMARY_MODEL.bedrockId]) {
      const report = preflightPrompt({
        instructions: 'x {responsesText}', outputFormat: 'Keep it under 300 words.', promptType: 'analysis', targetModel,
      });
      const cap = report.advisory.find((f) => f.code === 'word-cap-not-enforced');
      expect(cap.detail).not.toMatch(/assumed/);
    }
  });
});
