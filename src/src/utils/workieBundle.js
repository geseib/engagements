/**
 * ONE FILE AN OUTSIDE AGENT CAN WORK FROM, AND READ BACK — the workbench's
 * Download and Upload.
 *
 * The owner, 2026-09-25: "If a user wants to take all this to an external
 * agent, could they download enough info about the system to do so? A link
 * that allows us to download and then upload the prompt would be fantastic.
 * This should only be for Engage admins though." Spec: docs/superpowers/
 * specs/2026-09-25-prompt-workbench-design.md.
 *
 * THE FORMAT. Markdown — an agent reads prose best and a person can read it
 * too — ending in ONE hand-back section between two HTML-comment markers:
 *
 *   <!-- engage-workie:begin -->
 *   ```json engage-workie          identity + the structured fields
 *   ````text engage-workie:instructions
 *   ````text engage-workie:outputFormat
 *   <!-- engage-workie:end -->
 *
 * The two halves ride in their own text fences, NOT as JSON strings: asked for
 * two long halves as JSON, Sonnet 4.6 wrote a reply with no parseable object
 * in it (ai-prompt-advisor.js, parseRewrite), and an outside agent editing a
 * 5,000-character JSON string by hand is that failure waiting to happen. A
 * fence needs no escaping; each is made longer than any run of backticks in
 * its text. Upload also accepts the bare JSON object with the halves inside,
 * for an agent that answers that way.
 *
 * WHERE THE FACTS COME FROM — never retyped here:
 *   the save rules, the variables, the section limits and default, and the
 *     assembly layers: the `reference` the server returns (lambda-functions/
 *     admin/shared/workie-reference.js), behind the prompt-authoring gate;
 *   how the reply is split (SECTION_SYNONYMS) and the model's budget
 *     (SUMMARY_MODEL): utils/promptPreflight.js, pinned to get-ai-summary.js by
 *     __tests__/promptEngineFactsPinned.test.js;
 *   the round angles: config/roundAngles.js, pinned by tests/round-angles.js;
 *   the findings: the editor's own preflight report, routed by
 *     utils/promptWorkbench.js.
 * The one list written here is SCREENS, and __tests__/workieBundle.test.js
 * fails if a file it names stops reading the field it is listed against.
 */
import { SECTION_SYNONYMS, SUMMARY_MODEL } from './promptPreflight';
import { checkItems, whereLabel } from './promptWorkbench';
import { ROUND_ANGLES, ANGLE_GAME_TYPES } from '../config/roundAngles';
import { gameTypeLabel, normalizeGameType, resolveGameType } from '../config/gameTypes';

export const BUNDLE_FORMAT = 'engage-workie-prompt';
export const BUNDLE_VERSION = 1;

const BEGIN = '<!-- engage-workie:begin -->';
const END = '<!-- engage-workie:end -->';
const JSON_INFO = 'json engage-workie';
const HALF_INFO = {
  instructions: 'text engage-workie:instructions',
  outputFormat: 'text engage-workie:outputFormat',
};

/** What an agent may change. Everything else identifies the prompt and is ignored on upload. */
export const AGENT_MAY_CHANGE = Object.freeze(['instructions', 'outputFormat', 'outputSections', 'angleWeights', 'description']);

/** Carried so the agent sees the whole prompt; never taken back from a file. */
const IDENTITY_FIELDS = ['name', 'category', 'promptType', 'status', 'isDefault', 'tags', 'template', 'scenario'];

/** The editor's words for each field an upload can change. */
export const FIELD_LABELS = Object.freeze({
  instructions: 'What the AI is given',
  outputFormat: 'What the AI writes',
  outputSections: 'Output sections',
  angleWeights: 'Round angles',
  description: 'Description',
});

/**
 * Which screen reads which field of a parsed reply (get-ai-summary.js,
 * parseAIResponse). Each `files` entry is under src/src and is checked by the
 * test to still mention its field.
 */
export const SCREENS = Object.freeze([
  {
    field: 'markdownResponse',
    holds: 'The whole reply, exactly as written',
    readBy: 'The projector, and the round and session reports',
    files: ['components/AISummaryStatus.jsx', 'components/RoundReport.jsx', 'components/GameReport.jsx'],
  },
  {
    field: 'summaryText',
    holds: 'The summary section — with declared headings, the whole reply',
    readBy: "The lead line on the host's phone remote, and the reports",
    files: ['config/hostRemote.js', 'components/RoundReport.jsx', 'components/GameReport.jsx'],
  },
  {
    field: 'discussionQuestions',
    holds: 'Up to five list items from a discussion heading',
    readBy: "The host's phone remote (its topics), the stage's structured read-back, and the reports",
    files: ['config/hostRemote.js', 'GameHostPage.jsx', 'components/RoundReport.jsx', 'components/GameReport.jsx'],
  },
  {
    field: 'nextSteps',
    holds: 'Up to five list items from a next-steps heading',
    readBy: "The host's phone remote (its next steps), the stage's structured read-back, and the reports",
    files: ['config/hostRemote.js', 'components/AISummaryStatus.jsx', 'components/RoundReport.jsx', 'components/GameReport.jsx'],
  },
]);

const TIER_HEADINGS = {
  blocking: 'Stops the save',
  silent: 'Saves fine, misbehaves quietly',
  advisory: 'Worth knowing',
};

/* ------------------------------------------------------------ helpers -- */

const fmt = (value) => Number(value).toLocaleString('en-US');

/** A table cell: one line, pipes escaped. */
const cell = (value) => String(value ?? '').replace(/\r?\n/g, ' ').replace(/\|/g, '\\|');

/** A fence longer than any run of backticks in the text, and never shorter than four. */
function fenceFor(text) {
  const runs = String(text || '').match(/`+/g) || [];
  const longest = runs.reduce((max, run) => Math.max(max, run.length), 0);
  return '`'.repeat(Math.max(4, longest + 1));
}

function fenced(info, text) {
  const fence = fenceFor(text);
  return `${fence}${info}\n${text}\n${fence}`;
}

/** `The Art & Titles!` → `the-art-titles.workie.md`. */
export function bundleFileName(name) {
  const slug = String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  return `${slug || 'workie'}.workie.md`;
}

/* -------------------------------------------------------------- build -- */

function describeSections(draft, reference) {
  const { sections } = reference;
  const declared = Array.isArray(draft.outputSections) && draft.outputSections.length ? draft.outputSections : null;
  const shown = declared || sections.default;
  return [
    '## The reply\'s headings (Output sections)',
    '',
    '`outputSections` is the list of headings the reply must use, in order, each with a line of guidance. '
      + (declared ? 'This prompt declares:' : 'This prompt declares none, so it gets the default:'),
    '',
    ...shown.map((s) => `- **${s && s.heading}**${s && s.guidance ? ` — ${String(s.guidance).replace(/\n/g, ' ')}` : ''}`),
    '',
    'The rules — a declaration that breaks any one of them is discarded WHOLE, and the default runs instead:',
    '',
    `- at most ${sections.maxSections} sections;`,
    `- each heading at most ${sections.maxHeadingChars} characters, on one line, plain text — no \`#\`, \`*\`, \`_\`, `
      + 'backtick, `>`, `|`, `[`, `]`, `{` or `}` — with at least one letter, and no two the same ignoring case;',
    `- each guidance at most ${sections.maxGuidanceChars} characters, and no line of it written as a heading;`,
    `- \`null\` or \`[]\` means the default: ${sections.default.map((s) => s.heading).join(' / ')}.`,
    '',
    '### How the reply is read',
    '',
    'The model\'s reply is kept whole and also split at its headings into the fields below. Each is read '
      + 'by a different screen:',
    '',
    '| Field | What it holds | Read by |',
    '|---|---|---|',
    ...SCREENS.map((s) => `| \`${s.field}\` | ${cell(s.holds)} | ${cell(s.readBy)} |`),
    '',
    `\`discussionQuestions\` is filled only from a section whose heading matches \`${String(SECTION_SYNONYMS.discussion)}\`, `
      + `and \`nextSteps\` only from one matching \`${String(SECTION_SYNONYMS.nextSteps)}\` (a summary heading matches `
      + `\`${String(SECTION_SYNONYMS.summary)}\`). With declared headings that match neither, both come back empty on `
      + 'every round: the projector still shows the whole reply, and the phone remote and the reports have nothing to list.',
  ];
}

function describeAngles(gameType) {
  if (!ANGLE_GAME_TYPES.includes(gameType)) {
    return [
      '## Round angles',
      '',
      `A ${gameTypeLabel(gameType)} round draws no round angle; leave \`angleWeights\` as \`null\`.`,
    ];
  }
  return [
    '## Round angles',
    '',
    'Each round is read from ONE angle, drawn at random by these weights (never the same angle two rounds running; '
      + 'the final round leans toward the race). `angleWeights` overrides the house mix: whole numbers 0–100, a key '
      + 'left out takes the house weight, 0 turns an angle off, and `null` means the house mix. This is the '
      + 'strongest lever for variety across a session.',
    '',
    '| Angle | House weight | What it does |',
    '|---|---|---|',
    ...ROUND_ANGLES.map((a) => `| \`${a.key}\` | ${a.house} | ${cell(a.help)} |`),
  ];
}

function describeVariables(reference, label) {
  return [
    `## Variables for ${label}`,
    '',
    'Each `{variable}` is replaced with this round\'s data before the model reads a word. Use only these: any '
      + 'other `{token}` reaches the projector as literal braces, and Engage will refuse to save it.',
    '',
    '| Variable | Group | What it holds | Example |',
    '|---|---|---|---|',
    ...reference.variables.map((v) => `| \`{${v.name}}\` | ${cell(v.category)} | ${cell(v.description)} | ${cell(v.example)} |`),
  ];
}

function describeRules(reference) {
  return [
    '## Save rules',
    '',
    ...reference.rules.map((r, i) => `${i + 1}. ${r.text}${r.enforcedOnSave ? ' **(Save refuses a prompt that breaks this.)**' : ''}`),
  ];
}

function describeFindings(report, draft) {
  const canRewrite = !String(draft.template || '').trim();
  const items = checkItems(report, { canRewrite });
  const out = [
    '## What Engage\'s checks found on this version',
    '',
    'These are exact checks Engage ran on the prompt as exported — the same ones its editor shows and its save '
      + 'gate and summary engine obey. Each says where it gets fixed in Engage; in this file every one of those '
      + 'places is yours to change too (`outputSections` is in the JSON block).',
    '',
  ];
  if (!report) {
    return [...out, 'Engage\'s checks did not run on this version, so nothing here says it is clean. Engage '
      + 'will run them when the file comes back.'];
  }
  if (!items.length) return [...out, 'Engage\'s checks found nothing on this version.'];
  for (const tier of ['blocking', 'silent', 'advisory']) {
    const inTier = items.filter((i) => i.tier === tier);
    if (!inTier.length) continue;
    out.push(`### ${TIER_HEADINGS[tier]}`, '');
    for (const item of inTier) {
      out.push(`- **${item.issue}** — ${whereLabel(item)}.${item.fix ? ` Fix: ${String(item.fix).replace(/\n/g, ' ')}` : ''}`);
    }
    out.push('');
  }
  return out;
}

/**
 * The whole file, as a string. `reference` is the server's (it carries the
 * rules and the catalogue); `report` is the editor's preflight on `draft`.
 */
export function buildWorkieBundle({
  promptId = null, draft, reference, report, exportedAt = new Date().toISOString(),
}) {
  const gameType = normalizeGameType(draft.gameType);
  const label = gameTypeLabel(gameType);
  const instructions = String(draft.instructions || '');
  const outputFormat = String(draft.outputFormat || '');
  const block = {
    format: BUNDLE_FORMAT,
    version: BUNDLE_VERSION,
    promptId: promptId || null,
    gameType,
    promptType: draft.promptType || 'analysis',
    name: draft.name || '',
    category: draft.category || '',
    status: draft.status || 'draft',
    isDefault: Boolean(draft.isDefault),
    tags: Array.isArray(draft.tags) ? draft.tags : [],
    scenario: draft.scenario || '',
    template: draft.template || '',
    description: draft.description || '',
    outputSections: Array.isArray(draft.outputSections) && draft.outputSections.length ? draft.outputSections : null,
    angleWeights: draft.angleWeights && Object.keys(draft.angleWeights).length ? draft.angleWeights : null,
    exportedAt,
  };
  const json = JSON.stringify(block, null, 2);

  return [
    `# Engage Workie: ${draft.name || 'Untitled'}`,
    '',
    'This file is one **Workie** from Engage, a live engagement platform: the prompt that writes the AI read-back '
      + `a room sees after each round of a **${label}** session. It was exported on ${exportedAt.slice(0, 10)} so it `
      + 'can be improved outside Engage. Everything needed to work on it is in this file — no access to Engage or '
      + 'its code is required.',
    '',
    '## What to do',
    '',
    'Improve the prompt so the read-back the room hears is better. Here, better means:',
    '',
    '- **Variety** — round five should not read like round one. Avoid fixed formulas and stock phrases; the system '
      + 'already varies how each reply opens and which angle it takes (see *How it runs*).',
    '- **A well-spoken voice** — the reply is read aloud or off a projector to the people who were just in the room: '
      + 'natural sentences addressed to them, not a report about them.',
    '- **Facts about this round and this event** — use what the prompt is given: the question, the answers, the '
      + 'votes, the event\'s title and description, the host\'s context. Specific beats general.',
    '- **Outside knowledge where it helps** — general knowledge, the host\'s material or the prompt\'s own '
      + 'background may sharpen a point; say it as general knowledge and never present it as something the room said.',
    '- **Short and clear** — cut what repeats or does nothing.',
    '',
    `You may change: ${AGENT_MAY_CHANGE.map((f) => `\`${f}\``).join(', ')}. Leave every other field exactly as it `
      + 'is — they identify the prompt, and Engage ignores changes to them.',
    '',
    'Every rule under *Save rules* must still hold, and every variable must come from *Variables*. Engage runs its '
      + 'checks again on the file when it comes back.',
    '',
    '## How to hand it back',
    '',
    'Return this whole file with your changes made inside the hand-back section below, between the '
      + '`engage-workie:begin` and `engage-workie:end` markers:',
    '',
    '- edit the two text blocks in place — plain text, nothing escaped;',
    '- edit `outputSections`, `angleWeights` and `description` in the JSON block;',
    '- keep the markers, the fence lines and their labels exactly as they are. If your text needs a line of '
      + 'backticks as long as its fence, make that fence longer, on both of its lines.',
    '',
    'An Engage admin loads it with **Upload a revised file** in the prompt editor, reads what changed and decides — '
      + 'nothing is saved until they press Save.',
    '',
    '## The prompt',
    '',
    BEGIN,
    fenced(JSON_INFO, json),
    '',
    '**What the AI is given** (`instructions`) — everything the model knows about the round arrives here, each '
      + '`{variable}` replaced by this round\'s data:',
    '',
    fenced(HALF_INFO.instructions, instructions),
    '',
    '**What the AI writes** (`outputFormat`) — the shape of the reply, in Markdown:',
    '',
    fenced(HALF_INFO.outputFormat, outputFormat),
    END,
    '',
    '## How it runs',
    '',
    `At the end of each round Engage builds one prompt, in this order, and sends it to ${SUMMARY_MODEL.label} `
      + `(\`${SUMMARY_MODEL.bedrockId}\`) with max_tokens ${fmt(SUMMARY_MODEL.maxTokens)} — roughly `
      + `${fmt(SUMMARY_MODEL.approxWords)} words, so a word limit written in the prompt is a request the model may `
      + `overrun — and temperature ${SUMMARY_MODEL.temperature}:`,
    '',
    ...reference.layers.map((layer, i) => `${i + 1}. **${layer.name}** — ${layer.text}`),
    '',
    ...describeSections(draft, reference),
    '',
    ...describeAngles(gameType),
    '',
    ...describeVariables(reference, label),
    '',
    ...describeRules(reference),
    '',
    ...describeFindings(report, draft),
    '',
  ].join('\n');
}

/* -------------------------------------------------------------- parse -- */

const fail = (error) => ({ ok: false, error });
const NOT_A_BUNDLE = 'This is not an Engage Workie file — it has no ```json engage-workie block with '
  + `"format": "${BUNDLE_FORMAT}" in it. Nothing was changed.`;

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The text inside the first fence labelled `info`, or null. The closing fence
 * is the first line of at least as many backticks; the one newline before it
 * is layout, not content — so a half ending in a newline keeps it.
 */
function readFence(text, info) {
  const open = new RegExp(`(^|\\n)(\`{3,})${escapeRe(info)}[ \\t]*\\r?\\n`).exec(text);
  if (!open) return null;
  const start = open.index + open[0].length;
  const rest = text.slice(start);
  const close = new RegExp(`(^|\\n)\`{${open[2].length},}[ \\t]*(?=\\r?\\n|$)`).exec(rest);
  if (!close) return null;
  return rest.slice(0, close.index);
}

const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * Read a Workie file — the whole file, just its hand-back section, or a bare
 * JSON object with the halves inside. Returns `{ ok: true, identity, prompt }`
 * or `{ ok: false, error }` with a sentence; never throws.
 */
export function parseWorkieBundle(text) {
  const raw = String(text || '');
  if (!raw.trim()) return fail('The file is empty. Nothing was changed.');

  const begin = raw.indexOf(BEGIN);
  const end = begin >= 0 ? raw.indexOf(END, begin) : -1;
  const region = begin >= 0 ? raw.slice(begin, end >= 0 ? end : undefined) : raw;

  let block = readFence(region, JSON_INFO);
  if (block === null) {
    const trimmed = raw.trim();
    if (!trimmed.startsWith('{')) return fail(NOT_A_BUNDLE);
    block = trimmed;
  }
  let obj;
  try {
    obj = JSON.parse(block);
  } catch (error) {
    return fail(`The file's ${JSON_INFO} block is not valid JSON (${error.message}). Nothing was changed.`);
  }
  if (!isPlainObject(obj) || obj.format !== BUNDLE_FORMAT) return fail(NOT_A_BUNDLE);
  if (obj.version !== BUNDLE_VERSION) {
    return fail(`This file is version ${JSON.stringify(obj.version)}; this editor reads version ${BUNDLE_VERSION}. `
      + 'Nothing was changed.');
  }

  const prompt = {};
  for (const half of ['instructions', 'outputFormat']) {
    const fromFence = readFence(region, HALF_INFO[half]);
    const value = fromFence !== null ? fromFence : obj[half];
    if (typeof value !== 'string') {
      return fail(`The file has no ${FIELD_LABELS[half]} (\`${half}\`) — its \`${HALF_INFO[half]}\` block is `
        + 'missing and the JSON does not carry it as text. Nothing was changed.');
    }
    prompt[half] = value;
  }
  if (obj.outputSections !== undefined && obj.outputSections !== null && !Array.isArray(obj.outputSections)) {
    return fail('The file\'s `outputSections` is not a list of { heading, guidance }. Nothing was changed.');
  }
  if (obj.angleWeights !== undefined && obj.angleWeights !== null && !isPlainObject(obj.angleWeights)) {
    return fail('The file\'s `angleWeights` is not an object of { question, race, event, fact }. Nothing was changed.');
  }
  if (obj.description !== undefined && obj.description !== null && typeof obj.description !== 'string') {
    return fail('The file\'s `description` is not text. Nothing was changed.');
  }
  for (const field of ['outputSections', 'angleWeights', 'description', 'gameType', ...IDENTITY_FIELDS]) {
    if (Object.prototype.hasOwnProperty.call(obj, field)) prompt[field] = obj[field];
  }
  return {
    ok: true,
    identity: {
      format: obj.format,
      version: obj.version,
      promptId: typeof obj.promptId === 'string' && obj.promptId ? obj.promptId : null,
      gameType: obj.gameType,
    },
    prompt,
  };
}

/**
 * May this file go into the editor open on `promptId` / `gameType`? Null when
 * it may, else the sentence saying why not. The prompt it names and its game
 * type are identity: a file cannot move a Workie to another type (the type
 * decides which variables exist), and one prompt's file does not overwrite
 * another prompt's draft.
 */
export function checkBundleFits(parsed, { promptId = null, gameType } = {}) {
  const fileType = resolveGameType(parsed.identity.gameType);
  const here = normalizeGameType(gameType);
  if (!fileType) {
    return `The file names no game type Engage plays (${JSON.stringify(parsed.identity.gameType ?? null)}). `
      + 'Nothing was changed.';
  }
  if (fileType !== here) {
    return `This file is a ${gameTypeLabel(fileType)} prompt, and this one is ${gameTypeLabel(here)}. A Workie's game `
      + 'type decides which variables exist, so a file cannot change it. Nothing was changed.';
  }
  const fileId = parsed.identity.promptId;
  if (!promptId && fileId) {
    return `This file was exported from a saved prompt (${fileId}), and this is a new prompt. Open that prompt `
      + 'and upload it there. Nothing was changed.';
  }
  if (promptId && fileId !== promptId) {
    return `This file is for ${fileId ? `prompt ${fileId}` : 'a new, unsaved prompt'}, not this one (${promptId}). `
      + 'Open that prompt and upload it there. Nothing was changed.';
  }
  return null;
}

/** "Nothing" for each field, so an absent, null and empty value compare equal. */
function normalised(field, value) {
  if (field === 'outputSections') return Array.isArray(value) && value.length ? value : null;
  if (field === 'angleWeights') return isPlainObject(value) && Object.keys(value).length ? value : null;
  if (field === 'isDefault') return Boolean(value);
  if (field === 'tags') return Array.isArray(value) ? value : [];
  return value === undefined || value === null ? '' : value;
}
const same = (field, a, b) => JSON.stringify(normalised(field, a)) === JSON.stringify(normalised(field, b));

/**
 * The editor's next draft from a file: ONLY the fields an agent may change are
 * taken. `changes` lists those that differ (for the before-and-after);
 * `ignored` names identity fields the file changed, which stay as they are.
 */
export function takeFromBundle(current, incoming) {
  const next = { ...current };
  const changes = [];
  for (const field of AGENT_MAY_CHANGE) {
    if (!Object.prototype.hasOwnProperty.call(incoming, field)) continue;
    if (same(field, current[field], incoming[field])) continue;
    const value = normalised(field, incoming[field]);
    next[field] = value === null ? null : JSON.parse(JSON.stringify(value));
    changes.push({ field, label: FIELD_LABELS[field], before: current[field], after: next[field] });
  }
  const ignored = IDENTITY_FIELDS.filter((field) => Object.prototype.hasOwnProperty.call(incoming, field)
    && !same(field, current[field], incoming[field]));
  return { next, changes, ignored };
}
