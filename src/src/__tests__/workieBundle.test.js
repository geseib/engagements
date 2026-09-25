/**
 * THE FILE AN OUTSIDE AGENT WORKS FROM — utils/workieBundle.js.
 *
 * The owner, 2026-09-25: "If a user wants to take all this to an external
 * agent, could they download enough info about the system to do so? A link
 * that allows us to download and then upload the prompt would be fantastic."
 * Spec: docs/superpowers/specs/2026-09-25-prompt-workbench-design.md.
 *
 * One Markdown file: prose for the agent, then a hand-back section holding a
 * ```json engage-workie block and the two halves in their own text fences —
 * not JSON strings, because this repo measured a model failing to escape two
 * long halves into JSON (ai-prompt-advisor.js, parseRewrite).
 *
 * The reference used here is the SERVER'S OWN (lambda-functions/admin/shared/
 * workie-reference.js), required directly, so "the file carries every rule and
 * every variable" is checked against the lists the save gate and the advisor
 * use, not against a fixture that could agree with a wrong copy.
 *
 * rejects: a file missing a rule, a variable, a meaning or an example; a file
 *          that does not say how the reply is read or which screen reads what;
 *          a round trip that changes a character; a half with its own code
 *          fence breaking the file; a file for another prompt or game type put
 *          in the editor; identity fields (status, the default flag) taken from
 *          an agent's copy.
 */
import {
  BUNDLE_FORMAT, AGENT_MAY_CHANGE, SCREENS, bundleFileName, buildWorkieBundle, parseWorkieBundle,
  checkBundleFits, takeFromBundle,
} from '../utils/workieBundle';
import { SECTION_SYNONYMS, SUMMARY_MODEL, preflightPrompt } from '../utils/promptPreflight';
import { ROUND_ANGLES } from '../config/roundAngles';

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..');
const { buildWorkieReference } = require(path.join(SRC, '..', '..', 'lambda-functions', 'admin', 'shared', 'workie-reference.js'));

const REFERENCE = buildWorkieReference('call-and-answer');

const DRAFT = {
  name: 'Art & Creative Titles',
  description: 'For art rounds.',
  gameType: 'call-and-answer',
  category: 'art-titles',
  promptType: 'analysis',
  status: 'active',
  isDefault: false,
  tags: ['art'],
  template: '',
  scenario: '',
  instructions: 'You are Workie — say “warm” things.\n\n**The titles:**\n{responsesText}\n\n**Votes:**\n{voteTally}\n',
  outputFormat: '## The Winning Title\nSay which won.\n\n```\nnot a fence of ours\n```\n## The Reveal\nThe real title.',
  outputSections: [
    { heading: 'The Winning Title', guidance: 'Name it.' },
    { heading: 'The Reveal', guidance: 'The real title,\nand one fact.' },
    { heading: 'Keep Playing', guidance: 'One line.' },
  ],
  angleWeights: { race: 10 },
};

const REPORT = preflightPrompt({ ...DRAFT, targetModel: SUMMARY_MODEL.bedrockId });

const build = (over = {}) => buildWorkieBundle({
  promptId: 'art1', draft: DRAFT, reference: REFERENCE, report: REPORT, exportedAt: '2026-09-25T10:00:00.000Z', ...over,
});

describe('what the file tells the agent', () => {
  const md = build();

  test('every save rule, verbatim, and whether Save enforces it', () => {
    for (const rule of REFERENCE.rules) expect(md).toContain(rule.text);
    expect(REFERENCE.rules.some((r) => r.enforcedOnSave)).toBe(true);
    expect(md).toMatch(/Save refuses/);
  });

  test('every variable for the game type, with its meaning and its example', () => {
    expect(REFERENCE.variables.length).toBeGreaterThan(20);
    for (const v of REFERENCE.variables) {
      const row = md.split('\n').find((line) => line.startsWith(`| \`{${v.name}}\``));
      expect(row).toBeTruthy();
      // A table cell is one line with its pipes escaped.
      const asCell = (text) => text.replace(/\r?\n/g, ' ').replace(/\|/g, '\\|');
      expect(row).toContain(asCell(v.description));
      expect(row).toContain(asCell(v.example));
    }
  });

  test('how the reply is read: the headings that fill each field, and which screen reads what', () => {
    expect(md).toContain(String(SECTION_SYNONYMS.discussion));
    expect(md).toContain(String(SECTION_SYNONYMS.nextSteps));
    for (const screen of SCREENS) {
      expect(md).toContain(`\`${screen.field}\``);
      expect(md).toContain(screen.readBy);
    }
  });

  test('the section rules and the default shape, from prompt-shape.js', () => {
    expect(md).toContain(`at most ${REFERENCE.sections.maxSections}`);
    expect(md).toContain(`${REFERENCE.sections.maxHeadingChars} characters`);
    expect(md).toContain(`${REFERENCE.sections.maxGuidanceChars} characters`);
    for (const s of REFERENCE.sections.default) expect(md).toContain(s.heading);
  });

  test('how the prompt is assembled, and the model that reads it', () => {
    for (const layer of REFERENCE.layers) expect(md).toContain(layer.text);
    expect(md).toContain(SUMMARY_MODEL.label);
    expect(md).toContain(SUMMARY_MODEL.maxTokens.toLocaleString('en-US'));
    expect(md).toContain(String(SUMMARY_MODEL.temperature));
  });

  test('the round angles and their house weights, for a Call & Answer prompt', () => {
    for (const a of ROUND_ANGLES) {
      expect(md).toContain(`\`${a.key}\``);
      expect(md).toContain(a.help);
    }
    const poll = build({ draft: { ...DRAFT, gameType: 'poll' }, reference: buildWorkieReference('poll') });
    expect(poll).toMatch(/draws no round angle/);
  });

  test("the checks Engage ran on this version, each with where it gets fixed — the owner's finding included", () => {
    expect(md).toContain('discussionQuestions and nextSteps will come back empty on every round.');
    expect(md).toContain('Fix in the editor: Output sections');
    const clean = build({ report: { blocking: [], silent: [], advisory: [] } });
    expect(clean).toMatch(/found nothing/i);
    // rejects: "found nothing" when the checks never ran — a different sentence.
    const unrun = build({ report: null });
    expect(unrun).toMatch(/did not run/i);
    expect(unrun).not.toMatch(/found nothing/i);
  });

  test('what the agent may change, how to hand it back, and what "better" means here', () => {
    for (const field of AGENT_MAY_CHANGE) expect(md).toContain(`\`${field}\``);
    expect(md).toMatch(/hand it back/i);
    expect(md).toMatch(/Upload a revised file/);
    expect(md).toMatch(/variety/i);
    expect(md).toMatch(/event/i);
    expect(md).toMatch(/general knowledge/i);
    expect(md).toMatch(/nothing is saved until/i);
  });

  test('the file is named for the prompt, and says what it is in its first line', () => {
    expect(bundleFileName('Art & Creative Titles')).toBe('art-creative-titles.workie.md');
    expect(bundleFileName('')).toBe('workie.workie.md');
    expect(md.split('\n')[0]).toBe('# Engage Workie: Art & Creative Titles');
  });
});

describe('the round trip', () => {
  test('parsing the file gives back every field, character for character', () => {
    const parsed = parseWorkieBundle(build());
    expect(parsed.ok).toBe(true);
    expect(parsed.identity).toEqual({ format: BUNDLE_FORMAT, version: 1, promptId: 'art1', gameType: 'call-and-answer' });
    for (const field of Object.keys(DRAFT)) expect(parsed.prompt[field]).toEqual(DRAFT[field]);
  });

  test('a half that carries a longer fence of its own gets a longer fence, and survives', () => {
    const draft = { ...DRAFT, instructions: 'Before\n````\nfour ticks\n````\nAfter {responsesText}' };
    const parsed = parseWorkieBundle(build({ draft }));
    expect(parsed.ok).toBe(true);
    expect(parsed.prompt.instructions).toBe(draft.instructions);
  });

  test('just the hand-back section, pasted on its own, is enough', () => {
    const md = build();
    const section = md.slice(md.indexOf('<!-- engage-workie:begin -->'), md.indexOf('<!-- engage-workie:end -->'));
    const parsed = parseWorkieBundle(section);
    expect(parsed.ok).toBe(true);
    expect(parsed.prompt.outputFormat).toBe(DRAFT.outputFormat);
  });

  test('an agent that answers with one JSON object, halves inside, is read too', () => {
    const bare = JSON.stringify({
      format: BUNDLE_FORMAT, version: 1, promptId: 'art1', gameType: 'call-and-answer',
      ...DRAFT, instructions: 'New {responsesText}', outputFormat: '## A\nb',
    });
    for (const text of [bare, `Here you go:\n\`\`\`json engage-workie\n${bare}\n\`\`\``]) {
      const parsed = parseWorkieBundle(text);
      expect(parsed.ok).toBe(true);
      expect(parsed.prompt.instructions).toBe('New {responsesText}');
    }
  });

  test('malformed files are refused with a sentence, never an exception', () => {
    const md = build();
    const cases = [
      ['', /empty/i],
      ['# Some notes\nNothing to see.', /not an Engage Workie file/i],
      [md.replace('"format": "engage-workie-prompt"', '"format": "something-else"'), /not an Engage Workie file/i],
      [md.replace('"version": 1', '"version": 9'), /version 9/],
      [md.replace('"gameType": "call-and-answer",', '"gameType": "call-and-answer",,'), /JSON/],
      [md.replace(/````text engage-workie:instructions[\s\S]*?\n````\n/, ''), /instructions/],
      [JSON.stringify({ format: BUNDLE_FORMAT, version: 1, gameType: 'poll', instructions: 5, outputFormat: 'x' }), /instructions/],
    ];
    for (const [text, said] of cases) {
      const parsed = parseWorkieBundle(text);
      expect(parsed.ok).toBe(false);
      expect(parsed.error).toMatch(said);
    }
  });
});

describe('putting a file into the editor', () => {
  const parsed = parseWorkieBundle(build());

  test('a file for this prompt and this game type fits', () => {
    expect(checkBundleFits(parsed, { promptId: 'art1', gameType: 'call-and-answer' })).toBeNull();
  });

  test('a file for another prompt is refused, naming both', () => {
    const said = checkBundleFits(parsed, { promptId: 'other9', gameType: 'call-and-answer' });
    expect(said).toMatch(/art1/);
    expect(said).toMatch(/other9/);
    expect(said).toMatch(/Nothing was changed/);
    expect(checkBundleFits(parsed, { promptId: null, gameType: 'call-and-answer' })).toMatch(/new prompt/i);
  });

  test('a file for another game type is refused', () => {
    expect(checkBundleFits(parsed, { promptId: 'art1', gameType: 'trivia' })).toMatch(/Trivia|trivia/);
  });

  test('only the fields an agent may change are taken; the rest are named as left alone', () => {
    const current = { ...DRAFT, instructions: 'Old {responsesText}', status: 'draft' };
    const incoming = { ...DRAFT, status: 'archived', isDefault: true, name: 'Renamed', description: 'New words.' };
    const { next, changes, ignored } = takeFromBundle(current, incoming);
    expect(next.instructions).toBe(DRAFT.instructions);
    expect(next.description).toBe('New words.');
    expect(next.status).toBe('draft');
    expect(next.isDefault).toBe(false);
    expect(next.name).toBe(DRAFT.name);
    expect(changes.map((c) => c.field).sort()).toEqual(['description', 'instructions']);
    expect(ignored.sort()).toEqual(['isDefault', 'name', 'status']);
  });

  test('an unchanged file changes nothing', () => {
    const { changes, ignored } = takeFromBundle(DRAFT, parsed.prompt);
    expect(changes).toEqual([]);
    expect(ignored).toEqual([]);
  });
});

describe('the screens the file names really read those fields', () => {
  test('each named file exists and mentions its field', () => {
    for (const screen of SCREENS) {
      expect(screen.files.length).toBeGreaterThan(0);
      for (const file of screen.files) {
        const src = fs.readFileSync(path.join(SRC, file), 'utf8');
        expect(src).toContain(screen.field);
      }
    }
  });
});
