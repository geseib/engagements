/**
 * THE PROMPT A HOST HANDS TO SOMEBODY ELSE'S AI.
 *
 * The owner: "if you clicked the button, would copy to clipboard AI
 * instructions that i could pass along to an AI tool like Claude or Chat gpt
 * with the template and ask it to fill out the csv. it should say what the
 * host should fill in like number of questions/lessons, level of detail,
 * difficulty, etc." First Call & Answer and Trivia; since 25 Oct 2026 every
 * type a template is downloaded for (docs/design/authoring-guidance/).
 *
 * A CONFIG MODULE, NOT COMPONENT STRINGS, for the usual reason: the panel
 * cannot mount in a plain node test, and this text carries CONTRACTS that must
 * be pinned — the header line must match the template the host downloads from
 * lambda-functions/admin/download-template.js CHARACTER FOR CHARACTER, because
 * the host pastes this beside that file and the AI follows whichever one it was
 * given. Two headers that disagree produce a CSV the importer half-drops.
 * tests/template-roundtrip.js downloads every template and checks its header
 * is in this text; __tests__/aiAuthoringPrompt.test.js pins the rest.
 *
 * POLL AND SURVEY READ THE SURVEY CONTRACT, NOT A COPY OF IT. Their CSVs have
 * twenty kind columns, and which ones a row uses, what values they take and
 * the limits are the importer's (lambda-functions/admin/shared/survey-kinds.js).
 * The frontend cannot import outside src/, so scripts/build-survey-contract.js
 * writes those facts into ./surveyContract.json and tests/survey-contract-fresh.js
 * fails when it is stale. Nothing below retypes a kind, a scale or a limit.
 *
 * WHAT THE HOST FILLS IN IS MARKED [LIKE THIS], loudly, in a fenced block at
 * the top. The prompt also tells the assistant to ASK about any bracket left
 * unfilled rather than guess — a guessed audience produces thirty questions
 * for the wrong room, and nobody notices until it is on a projector.
 *
 * THE CALL-AND-ANSWER CustomInstruction RULE IS THE OWNER'S OWN. From the
 * Historic World Leaders rework: the participant prompt must be
 * forward-looking and through the TEAM's lens ("What could our team…"),
 * never a personal retrospective ("Recall a time you…"). A generated set
 * that gets this wrong reproduces exactly the defect that rework fixed, so
 * the rule ships inside the prompt rather than being hoped for.
 *
 * CommonJS, so tests/template-roundtrip.js can require it from plain node.
 */
const contract = require('./surveyContract.json');

/** Every type that has a template, so every type gets the button. */
const AUTHORING_PROMPT_TYPES = ['call-and-answer', 'trivia', 'poll', 'survey', 'wavelength', 'art-title'];

/** The types whose prompt offers the optional trailing Background column. */
const BACKGROUND_TYPES = ['call-and-answer', 'trivia'];

/*
  Verbatim the header line of each template the host downloads
  (lambda-functions/admin/download-template.js). Poll and survey take theirs
  from the contract, which is what the template is written with.
*/
const CALL_AND_ANSWER_HEADER =
  'Category,Question#,Title,Detail_lesson,School,CustomInstruction,Tags';
const TRIVIA_HEADER =
  'id,title,questionDetail,category,optionA,optionB,optionC,optionD,optionE,optionF,correctAnswer,answerDetails,difficulty,Tags';
const WAVELENGTH_HEADER = CALL_AND_ANSWER_HEADER;
const ART_TITLE_HEADER =
  'Category,Question#,Title,Detail_lesson,School,CustomInstruction,AnswerDetails,Image,Tags';
const SURVEY_HEADER = contract.header;

/** The file the template downloads as, so the copy confirmation can name it. */
const TEMPLATE_FILES = {
  'call-and-answer': 'call-and-answer-template.csv',
  trivia: 'trivia-template.csv',
  poll: 'poll-template.csv',
  survey: 'survey-template.csv',
  wavelength: 'wavelength-template.csv',
  'art-title': 'art-title-template.csv',
};

/** The one instruction every wavelength row carries (the game's, not a direction's). */
const WAVELENGTH_INSTRUCTION =
  'Enter up to 10 words or short phrases that come to mind when you think about this subject.';

const FILL_IN_COMMON = [
  '- Topic / theme of the set: [TOPIC — e.g. "lessons from great sports coaches"]',
  '- Who is in the room: [AUDIENCE — e.g. "a 12-person software delivery team"]',
];
const CATEGORIES_LINE = '- Categories to group them under: [3 TO 8 CATEGORY NAMES, or "you choose" — 24 is the hard maximum]';
const AVOID_LINE = '- Anything to avoid: [OPTIONAL — topics, people or angles to leave out]';

const fillIn = (lines) => `==== FILL THIS IN BEFORE SENDING (replace every [BRACKET]) ====
${lines.join('\n')}
===============================================================`;

const BACKGROUND_COLUMN = '- Background (optional): 2-4 sentences Workie may draw on — context, a well-established fact, an angle. Never shown to players. Only what you are certain of; no statistics, names or quotations you cannot stand behind.';

const HOUSE_RULES = `HOUSE RULES:
- Plain words a room can read at a glance. No jargon the audience would not use themselves.
- Nothing you are not certain of: no invented facts, statistics, names, quotations or links. If you are unsure, leave it out.
- No hyperbole ("amazing", "world-class", "game-changing") and no exclamation marks.`;

const OUTPUT_RULES = (header, { background = false } = {}) => `OUTPUT RULES — follow all of them:
- Reply with ONLY the CSV, nothing before or after it (a fenced code block is fine).
${background
    ? '- The first line must be exactly this header, unchanged — except that if any row carries a Background, add one trailing `,Background` column to this header line:'
    : '- The first line must be exactly this header, unchanged:'}
  ${header}
${background
    ? '- One row per question. No extra columns beyond the optional Background column described above; no blank rows, no title line above the header.'
    : '- One row per question. No extra columns; no blank rows, no title line above the header.'}
- Wrap any field that contains a comma, a double quote or a line break in double quotes, and double any quote inside it ("like ""this""").
- If any [BRACKET] above is still unfilled, ask me for it before writing anything — do not guess.

I will upload the CSV back into Engage, which checks every row and skips any that break these rules, so follow them exactly.`;

// ── Call & Answer ─────────────────────────────────────────────────────────

const CALL_AND_ANSWER_PROMPT = `I am creating a question set for a live team engagement session (a "call and answer" format: each round, the room reads a short lesson on a screen, everyone writes their own answer to a prompt about it, and then the room votes on the answers). Please write the content and give it back to me as a CSV file matching the template I am attaching.

${fillIn([
    ...FILL_IN_COMMON,
    '- Number of lessons/questions: [COUNT — 8 to 20 works well]',
    CATEGORIES_LINE,
    '- Length of each lesson: [SHORT (2–3 sentences) / MEDIUM (4–6 sentences) / LONG (a full paragraph)]',
    '- Tone: [e.g. practical and direct / playful / reflective]',
    AVOID_LINE,
  ])}

WHAT GOES IN EACH COLUMN:
- Category: which group the row belongs to. Reuse each category name with identical spelling and capitalisation.
- Question#: number the rows sequentially from 1.
- Title: a short headline for the lesson, in capitals, readable from the back of a room.
- Detail_lesson: the lesson itself — the passage the room reads. This is where the length setting above applies. Make it concrete: one real practice, decision or idea, not an abstraction or a list of frameworks.
- School: where the lesson comes from — a discipline, era, thinker or institution (e.g. "Toyota Production System", "Site Reliability Engineering").
- CustomInstruction: the prompt the room answers about the lesson. THIS MUST BE FORWARD-LOOKING AND THROUGH THE TEAM'S LENS — "What could our team do with this?", "Where would this land in our organisation?" — never a personal retrospective like "Recall a time you…". It is a question, ending in a question mark.
${BACKGROUND_COLUMN}
- Tags: one to three lowercase keywords separated by | (e.g. leadership|trust).

${HOUSE_RULES}

${OUTPUT_RULES(CALL_AND_ANSWER_HEADER, { background: true })}`;

// ── Trivia ────────────────────────────────────────────────────────────────

const TRIVIA_PROMPT = `I am creating a trivia question set for a live team session (multiple choice, played on phones, with the answer and an explanation revealed after each round). Please write the questions and give them back to me as a CSV file matching the template I am attaching.

${fillIn([
    ...FILL_IN_COMMON,
    '- Number of questions: [COUNT — 10 to 25 works well]',
    CATEGORIES_LINE,
    '- Difficulty mix: [e.g. "mostly medium, a few easy and a few hard" — each row is easy, medium or hard]',
    '- How detailed the answer explanations should be: [BRIEF (1–2 sentences) / FULL (3–4 sentences with one genuinely interesting fact)]',
    AVOID_LINE,
  ])}

WHAT GOES IN EACH COLUMN:
- id: number the rows sequentially from 1.
- title: a short headline version of the question.
- questionDetail: the full question as the room should hear it.
- category: which group the row belongs to. Reuse each category name with identical spelling and capitalisation.
- optionA through optionD: four plausible answer choices of the same kind (four dates, four names, four methods), always filled. No joke answers. optionE and optionF are optional — leave them empty unless the question genuinely needs more choices.
- correctAnswer: exactly one of OptionA, OptionB, OptionC, OptionD, OptionE or OptionF (capital O, no space), naming the column that holds the right answer. Vary which letter is correct across the set.
- answerDetails: the explanation read to the room at the reveal — why the answer is right, plus the interesting part. A live host AI riffs on this text, so a wrong "fact" here gets said out loud to people who may know better: include only things you are certain of.
${BACKGROUND_COLUMN}
- difficulty: easy, medium or hard, matching the mix above.
- Tags: one to three lowercase keywords separated by | (e.g. strategy|planning).

${HOUSE_RULES}

${OUTPUT_RULES(TRIVIA_HEADER, { background: true })}`;

// ── Wavelength ────────────────────────────────────────────────────────────

const WAVELENGTH_PROMPT = `I am creating a "wavelength" set for a live team session: a word-association game. Each round shows the room one SUBJECT, everyone lists up to 10 words or short phrases it brings to mind, and the game shows how many words overlap across the room. Please write the subjects and give them back to me as a CSV file matching the template I am attaching.

${fillIn([
    ...FILL_IN_COMMON,
    '- Number of subjects: [COUNT — 8 to 15 works well]',
    CATEGORIES_LINE,
    AVOID_LINE,
  ])}

WHAT GOES IN EACH COLUMN:
- Category: which group the row belongs to. Reuse each category name with identical spelling and capitalisation.
- Question#: number the rows sequentially from 1.
- Title: the SUBJECT, 1 to 4 words (e.g. Remote Work, Customer Trust, Accountability). Not a question, not a sentence to complete, nothing with a right answer.
- Detail_lesson: ALWAYS EMPTY. Do not describe or define the subject: any words written there end up on everyone's list, which is exactly what the game measures.
- School: General.
- CustomInstruction: exactly this sentence on every row: ${WAVELENGTH_INSTRUCTION}
- Tags: one to three lowercase keywords separated by | (e.g. culture|trust).

WHAT A GOOD SUBJECT LOOKS LIKE: broad enough that everyone can list ten words for it, specific enough that the lists overlap in interesting ways. Mix concrete subjects (Office Coffee, Monday Mornings) with abstract ones (Trust, Risk).

${HOUSE_RULES}

${OUTPUT_RULES(WAVELENGTH_HEADER)}`;

// ── Art Title ─────────────────────────────────────────────────────────────

const ART_TITLE_PROMPT = `I am creating an "art title" set for a live team session: each round shows the room a famous artwork, everyone invents their own title for it, the room votes on the best, and then the real title is revealed. Please choose the works and give them back to me as a CSV file matching the template I am attaching.

${fillIn([
    '- Theme, period or artist: [TOPIC — e.g. "Impressionism" or "famous portraits"]',
    '- Who is in the room: [AUDIENCE — e.g. "a 12-person software delivery team"]',
    '- Number of artworks: [COUNT — 6 to 12 works well]',
    CATEGORIES_LINE.replace('[3 TO 8 CATEGORY NAMES', '[1 TO 6 MOVEMENTS OR PERIODS'),
    AVOID_LINE,
  ])}

WHAT GOES IN EACH COLUMN:
- Category: the movement or period (e.g. Renaissance, Post-Impressionism). Reuse each name with identical spelling.
- Question#: number the rows sequentially from 1.
- Title: a short teaser in capitals that names what is in the picture without giving the real title away (e.g. A SWIRLING NIGHT SKY for The Starry Night).
- Detail_lesson: ALWAYS EMPTY. Players see it while they invent their title, so anything here spoils the round.
- School: the artist and date (e.g. Vincent van Gogh, 1889). This is shown to players.
- CustomInstruction: leave empty; the set's own instruction is used.
- AnswerDetails: the reveal, in this shape: "Real title: <title>, <artist>, <date>, <where it is held>. Trivia: <one well-documented fact about it>." Players see this only after they have voted.
- Image: a full https:// link to an image of the work — only a link you are certain exists (for example a Wikimedia Commons Special:FilePath link to a file whose exact name you know). Otherwise leave it empty and I will add the image myself. Never invent a link.
- Tags: one to three lowercase keywords separated by | (e.g. portrait|renaissance).

WHAT A GOOD ROUND LOOKS LIKE: a work well known enough that the reveal lands, with something in it worth naming. Prefer works old enough to be in the public domain.

${HOUSE_RULES}

${OUTPUT_RULES(ART_TITLE_HEADER)}`;

// ── Poll and Survey: from the contract ────────────────────────────────────

const { limits, defaultMaxLength } = contract;

/** What each kind column means, in the AI's terms. Every contract column must have one (the test checks). */
const KIND_COLUMN_HELP = {
  Options: (kind) => (kind === 'rank'
    ? `Options — the ${limits.rankItems.min} to ${limits.rankItems.max} items to put in order, separated by |`
    : `Options — ${limits.choiceOptions.min} to ${limits.choiceOptions.max} answers, separated by | (e.g. In the office|At home|A mix of both)`),
  AllowMultiple: () => 'AllowMultiple — true lets people pick more than one, otherwise false',
  MaxPicks: () => 'MaxPicks — only when AllowMultiple is true: the most they may pick, from 2 up to the number of options; empty for no limit',
  AllowOther: () => 'AllowOther — true adds a write-in "Other" answer',
  Shuffle: () => 'Shuffle — true shows the options in a random order; false for answers with a natural order (Too slow|About right|Too fast)',
  Scale: () => `Scale — one of ${contract.scales.join(', ')} (0-10 is a "how likely to recommend" score)`,
  LowLabel: () => 'LowLabel — the words at the bottom of the scale (e.g. Not useful)',
  HighLabel: () => 'HighLabel — the words at the top of the scale (e.g. Very useful)',
  YesLabel: () => 'YesLabel — leave empty for "Yes", or rename it (Approve, Agree, True)',
  NoLabel: () => 'NoLabel — leave empty for "No", or rename it to match (Decline, Disagree, False)',
  Unsure: () => 'Unsure — true adds a "Not sure" answer',
  FollowUpWhen: () => `FollowUpWhen — empty for no follow-up, or ${contract.followUps.filter(Boolean).join(', ')}: which answer gets a "why?" question`,
  FollowUpPrompt: () => 'FollowUpPrompt — that follow-up question; required whenever FollowUpWhen is set',
  RankTop: () => 'RankTop — optional: rank only the top N, from 1 to one fewer than the number of items',
  TextLength: () => `TextLength — ${contract.textLengths.join(' or ')} (short is one line, long is a paragraph)`,
  MaxLength: () => `MaxLength — the most characters an answer may have, ${limits.maxLength.min} to ${limits.maxLength.max}; empty means ${defaultMaxLength.short} for short and ${defaultMaxLength.long} for long`,
  Placeholder: () => 'Placeholder — optional hint text shown in the empty answer box',
  Themes: () => 'Themes — true (the usual) lets Workie group the answers into themes afterwards',
};

/** One line per kind: the columns it uses beyond Kind and Required. */
function kindColumnLines(kinds) {
  return kinds.map((kind) => {
    const extra = contract.columnsByKind[kind].filter((column) => column !== 'Kind' && column !== 'Required');
    return `- ${kind}: ${extra.map((column) => KIND_COLUMN_HELP[column](kind)).join('; ')}.`;
  }).join('\n');
}

const KIND_RULES = `- Kind: one of the kinds below.
- Required: true or false.
- Every other kind column: fill in only the ones the row's kind uses (listed below) and leave the rest empty. Write true or false in full, never yes/no or 1/0.`;

const POLL_PROMPT = `I am creating a poll set for a live team session: the host asks one question at a time, everyone answers on their phone, and the result fills in live on the room's screen. Please write the questions and give them back to me as a CSV file matching the template I am attaching.

${fillIn([
    ...FILL_IN_COMMON,
    '- Number of questions: [COUNT — 5 to 12 works well]',
    CATEGORIES_LINE,
    `- Kinds of question to use: [KINDS — any of ${contract.pollKinds.join(', ')}, or "a sensible mix"]`,
    AVOID_LINE,
  ])}

WHAT GOES IN EACH COLUMN:
- Category: which group the row belongs to; the host can switch a whole category on or off during the session. Reuse each name with identical spelling and capitalisation.
- Question#: number the rows from 1 within each category.
- Title: the question itself, as it appears on the screen and on phones. One short sentence ending in a question mark.
- Detail_lesson: optional one-line framing shown under the question. Usually empty: a poll reads at a glance.
- School: leave empty.
- CustomInstruction: leave empty.
${KIND_RULES}

THE KINDS A POLL QUESTION MAY BE, AND THE COLUMNS EACH USES:
${kindColumnLines(contract.pollKinds)}

WHAT A GOOD POLL QUESTION LOOKS LIKE: one question, one idea. Neutral wording that does not lean toward an answer. Answers that do not overlap and cover the likely views; two to five is usual. Use a rating for "how much", a yesno for a decision, a choice for "which", and text when you want people's own words.

${HOUSE_RULES}

${OUTPUT_RULES(SURVEY_HEADER)}`;

const SURVEY_PROMPT = `I am creating a survey for a live team session: people answer it on their phones, at their own pace, and the results are summarised afterwards. Please write the questions and give them back to me as a CSV file matching the template I am attaching.

${fillIn([
    ...FILL_IN_COMMON,
    '- What I want to find out: [GOAL — e.g. "whether the new onboarding works, and what to change"]',
    '- Number of questions: [COUNT — 5 to 10 works well; 20 at most]',
    `- Kinds of question to use: [KINDS — any of ${contract.kinds.join(', ')}, or "a sensible mix"]`,
    AVOID_LINE,
  ])}

WHAT GOES IN EACH COLUMN:
- Category: always exactly ${contract.surveyCategory}, on every row.
- Question#: number the rows sequentially from 1.
- Title: the question itself, as people read it on their phone. One sentence, ending in a question mark.
- Detail_lesson: optional one-line note under the question. Usually empty.
- School: leave empty.
- CustomInstruction: leave empty.
${KIND_RULES} Make Required true only for the two or three questions that matter most.

THE KINDS, AND THE COLUMNS EACH USES:
${kindColumnLines(contract.kinds)}

WHAT A GOOD SURVEY LOOKS LIKE: one thing per question, in neutral wording. Answers that do not overlap and cover the likely ones (add AllowOther when you are not sure they do). Words on both ends of every scale. A "why?" follow-up after a no or a low score. The most important questions first, and short overall: people answer on a phone.

${HOUSE_RULES}

${OUTPUT_RULES(SURVEY_HEADER)}`;

const PROMPTS = {
  'call-and-answer': CALL_AND_ANSWER_PROMPT,
  trivia: TRIVIA_PROMPT,
  poll: POLL_PROMPT,
  survey: SURVEY_PROMPT,
  wavelength: WAVELENGTH_PROMPT,
  'art-title': ART_TITLE_PROMPT,
};

/**
 * The clipboard text for a type, or null for a type with no template (and so
 * no prompt) — the caller renders no button on null.
 */
function authoringPrompt(gameType) {
  return Object.prototype.hasOwnProperty.call(PROMPTS, gameType) ? PROMPTS[gameType] : null;
}

/** How many [BRACKETS] the host has to fill in — the copy confirmation says it. */
function fillInCount(gameType) {
  const text = authoringPrompt(gameType);
  if (!text) return 0;
  const block = text.split('==== FILL THIS IN')[1]?.split('\n=====')[0] || '';
  return block.split('\n').filter((line) => /\[[A-Z0-9]/.test(line) && !/\[OPTIONAL/.test(line)).length;
}

/** The template's file name, for "paste it with <file>". */
function templateFileFor(gameType) {
  return TEMPLATE_FILES[gameType] || '';
}

module.exports = {
  AUTHORING_PROMPT_TYPES,
  BACKGROUND_TYPES,
  KIND_COLUMN_HELP,
  authoringPrompt,
  fillInCount,
  templateFileFor,
  CALL_AND_ANSWER_HEADER,
  TRIVIA_HEADER,
  WAVELENGTH_HEADER,
  ART_TITLE_HEADER,
  SURVEY_HEADER,
  WAVELENGTH_INSTRUCTION,
};
