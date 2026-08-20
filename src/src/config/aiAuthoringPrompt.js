/**
 * THE PROMPT A HOST HANDS TO SOMEBODY ELSE'S AI.
 *
 * The owner: "if you clicked the button, would copy to clipboard AI
 * instructions that i could pass along to an AI tool like Claude or Chat gpt
 * with the template and ask it to fill out the csv. it should say what the
 * host should fill in like number of questions/lessons, level of detail,
 * difficulty, etc." Call-and-answer and trivia only, for now.
 *
 * A CONFIG MODULE, NOT COMPONENT STRINGS, for the usual reason: the panel
 * cannot mount in a plain node test, and this text carries CONTRACTS that must
 * be pinned — the header line must match lambda-functions/admin/
 * download-template.js CHARACTER FOR CHARACTER, because the host is going to
 * paste this beside that file and the AI will follow whichever one it was
 * given. Two headers that disagree produce a CSV the importer half-drops.
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
 */

/** The two types that get the button today, by the owner's scoping. */
const AUTHORING_PROMPT_TYPES = ['call-and-answer', 'trivia'];

/*
  Verbatim from lambda-functions/admin/download-template.js — the header line
  of the file the host just downloaded. tests/… pins the two copies together.
*/
const CALL_AND_ANSWER_HEADER =
  'Category,Question#,Title,Detail_lesson,School,CustomInstruction,Tags';
const TRIVIA_HEADER =
  'id,title,questionDetail,category,optionA,optionB,optionC,optionD,optionE,optionF,correctAnswer,answerDetails,difficulty,Tags';

const FILL_IN_COMMON = [
  '- Topic / theme of the set: [TOPIC — e.g. "lessons from great sports coaches"]',
  '- Who is in the room: [AUDIENCE — e.g. "a 12-person software delivery team"]',
];

const OUTPUT_RULES = (header) => `OUTPUT RULES — follow all of them:
- Reply with ONLY the CSV, nothing before or after it (a fenced code block is fine).
- The first line must be exactly this header, unchanged:
  ${header}
- One row per question. No extra columns, no blank rows, no title line above the header.
- Wrap any field that contains a comma, a double quote or a line break in double quotes, and double any quote inside it ("like ""this""").
- If any [BRACKET] above is still unfilled, ask me for it before writing anything — do not guess.`;

const CALL_AND_ANSWER_PROMPT = `I am creating a question set for a live team engagement session (a "call and answer" format: each round, the room reads a short lesson on a screen, everyone writes their own answer to a prompt about it, and then the room votes on the answers). Please write the content and give it back to me as a CSV file matching the template I am attaching.

==== FILL THIS IN BEFORE SENDING (replace every [BRACKET]) ====
${FILL_IN_COMMON.join('\n')}
- Number of lessons/questions: [COUNT — 8 to 20 works well]
- Categories to group them under: [3 TO 8 CATEGORY NAMES, or "you choose" — 24 is the hard maximum]
- Length of each lesson: [SHORT (2–3 sentences) / MEDIUM (4–6 sentences) / LONG (a full paragraph)]
- Tone: [e.g. practical and direct / playful / reflective]
- Anything to avoid: [OPTIONAL — topics, people or angles to leave out]
===============================================================

WHAT GOES IN EACH COLUMN:
- Category: which group the row belongs to. Reuse each category name with identical spelling and capitalisation.
- Question#: number the rows sequentially from 1.
- Title: a short headline for the lesson, in capitals, readable from the back of a room.
- Detail_lesson: the lesson itself — the passage the room reads. This is where the length setting above applies. Make it concrete: a real practice, decision or idea, not an abstraction.
- School: where the lesson comes from — a discipline, era, thinker or institution (e.g. "School of Management", "Toyota Production System").
- CustomInstruction: the prompt the room answers about the lesson. THIS MUST BE FORWARD-LOOKING AND THROUGH THE TEAM'S LENS — "What could our team do with this?", "Where would this land in our organisation?" — never a personal retrospective like "Recall a time you…". It is a question, ending in a question mark.
- Tags: one to three lowercase keywords separated by | (e.g. leadership|trust).

${OUTPUT_RULES(CALL_AND_ANSWER_HEADER)}`;

const TRIVIA_PROMPT = `I am creating a trivia question set for a live team session (multiple choice, played on phones, with the answer and an explanation revealed after each round). Please write the questions and give them back to me as a CSV file matching the template I am attaching.

==== FILL THIS IN BEFORE SENDING (replace every [BRACKET]) ====
${FILL_IN_COMMON.join('\n')}
- Number of questions: [COUNT — 10 to 25 works well]
- Categories to group them under: [3 TO 8 CATEGORY NAMES, or "you choose" — 24 is the hard maximum]
- Difficulty mix: [e.g. "mostly medium, a few easy and a few hard" — each row is easy, medium or hard]
- How detailed the answer explanations should be: [BRIEF (1–2 sentences) / FULL (3–4 sentences with one genuinely interesting fact)]
- Anything to avoid: [OPTIONAL — topics, people or angles to leave out]
===============================================================

WHAT GOES IN EACH COLUMN:
- id: number the rows sequentially from 1.
- title: a short headline version of the question.
- questionDetail: the full question as the room should hear it.
- category: which group the row belongs to. Reuse each category name with identical spelling and capitalisation.
- optionA through optionD: four answer choices, always filled. optionE and optionF are optional — leave them empty unless the question genuinely needs more choices.
- correctAnswer: exactly one of OptionA, OptionB, OptionC, OptionD, OptionE or OptionF (capital O, no space), naming the column that holds the right answer. Vary which letter is correct across the set.
- answerDetails: the explanation read to the room at the reveal — why the answer is right, plus the interesting part. A live host AI riffs on this text, so a wrong "fact" here gets said out loud to people who may know better: include only things you are certain of.
- difficulty: easy, medium or hard, matching the mix above.
- Tags: one to three lowercase keywords separated by | (e.g. strategy|planning).

${OUTPUT_RULES(TRIVIA_HEADER)}`;

/**
 * The clipboard text for a type, or null for a type that has no authoring
 * prompt yet — the caller renders no button on null, so adding a type later
 * is one entry here and nothing in the panel.
 */
function authoringPrompt(gameType) {
  if (gameType === 'call-and-answer') return CALL_AND_ANSWER_PROMPT;
  if (gameType === 'trivia') return TRIVIA_PROMPT;
  return null;
}

module.exports = {
  AUTHORING_PROMPT_TYPES,
  authoringPrompt,
  CALL_AND_ANSWER_HEADER,
  TRIVIA_HEADER,
};
