/**
 * WHICH SHELF THIS SET LOOKS LIKE — proposed, never applied.
 *
 * The owner, in the sentence that asked for the whole feature: *"maybe when
 * saving or making public the tag can get verified, or recommended as well."*
 * Recommended, and verified — two jobs, one call:
 *
 *   RECOMMEND  a shelf from shared/set-topics.js and a few words, so the person
 *              being asked for a topic is not asked cold.
 *   VERIFY     where the shelf they chose plainly contradicts what the set is
 *              about — chemistry questions filed under Music — say so.
 *
 * ── A HELPER, AND NEVER A GATE ─────────────────────────────────────────────
 *
 * Nothing here decides anything. The caller records what comes back beside the
 * review (set-review.js `topicSuggestion`) and the set's own `topic` is not
 * touched: a check that quietly re-filed somebody's set would be a library
 * rearranging itself behind its owner. The GATE is elsewhere and is a plain
 * fact about a shelf being absent — check-question-set.js and
 * publish-question-set.js — never a model's opinion about which one it is.
 *
 * That is also why the contradiction needs TWO signals to agree: the model must
 * say the chosen shelf does not fit AND name a different one itself. One
 * confident sentence from a model is not enough to tell somebody they have
 * filed their own set wrongly, and a product that argued about every set that
 * could sit on two shelves would be switched off within a week.
 *
 * THE CATCH-ALL CANNOT BE CONTRADICTED. "General Knowledge: a genuine mix that
 * spans the shelves" is a claim no single shelf disproves, and it is the one
 * honest answer for a set that really is a mix. Arguing with it would push
 * people off the shelf that exists for them.
 *
 * ── WHAT IT COSTS, AND WHAT IT MAY NEVER COST ──────────────────────────────
 *
 * One Haiku call per check, capped and budget-guarded exactly as
 * shared/finding-explanations.js is, and for the same reason: the review row
 * still has to be written, and a nicety must never be what stops it. A hundred-
 * question set sends a SAMPLE — twelve questions, each truncated — because the
 * question being answered is a fifteen-way one and a hundred questions do not
 * make it a better answer.
 *
 * Everything that can go wrong answers `null`: no model, no budget, a throttle,
 * prose instead of JSON, a shelf that is not on the shelf. A check then records
 * no suggestion and is otherwise exactly the check it was. Bedrock being busy
 * must never be the reason a set cannot be shared.
 *
 * THE MODEL SEES NOTHING NEW. The text sent is `setText` and `questionText` —
 * the same published surface the guardrail has already judged (publishable.js),
 * never ids, keys or anything a room could not see.
 */
const {
  SET_TOPICS, SET_TOPIC_IDS, UNFILED, normalizeSetTopic, resolveSetTopic, setTopicLabel,
} = require('./set-topics');
const { MIN_SUGGESTED_TAGS, MAX_TAGS, normalizeTags } = require('./tags');
const { questionText, setText } = require('./publishable');

// The same profile, and the same region-aware shape, as finding-explanations.js
// — the check's other model call. Four copies of this ARN already exist in this
// bundle; a fifth beside its neighbour beats a shared constant nobody expected.
const HAIKU = () => `arn:aws:bedrock:${process.env.AWS_REGION || 'us-east-1'}:${process.env.ACCOUNT_ID}:inference-profile/us.anthropic.claude-haiku-4-5-20251001-v1:0`;

/** How many questions are described to the model, and how much of each. */
const SAMPLE_QUESTIONS = 12;
const MAX_QUESTION_CHARS = 200;
/** The shelf that is a claim about spanning shelves, so no shelf refutes it. */
const CATCH_ALL = 'general-knowledge';

/** The shelf, written for a model: the id it must answer with, and what belongs there. */
const shelfList = () => SET_TOPIC_IDS
  .map((id) => `${id} — ${SET_TOPICS[id].label}: ${SET_TOPICS[id].blurb}`)
  .join('\n');

/**
 * An EVEN sample, not the first twelve. A long set is usually ordered — by
 * category, by difficulty, by the order somebody typed them — so the first
 * twelve of a hundred describe the opening of the set rather than the set.
 */
function sampleOf(questions, n = SAMPLE_QUESTIONS) {
  if (questions.length <= n) return questions;
  const step = questions.length / n;
  return Array.from({ length: n }, (_, i) => questions[Math.floor(i * step)]);
}

/** The first JSON object in a reply, or null. Models wrap, apologise, and fence. */
function parseReply(text) {
  const start = String(text || '').indexOf('{');
  const end = String(text || '').lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(String(text).slice(start, end + 1));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function promptFor(snapshot) {
  const meta = snapshot.meta || {};
  const filedAs = resolveSetTopic(meta.topic);
  const questions = sampleOf(snapshot.questions || [])
    .map((q) => `- ${questionText(q).replace(/\s+/g, ' ').trim().slice(0, MAX_QUESTION_CHARS)}`)
    .filter((line) => line.length > 2);
  return [
    'A question set for a workplace quiz is being filed in a library, the way a bookshop files a book: one shelf each.',
    '',
    'SHELVES — answer with one of these ids:',
    shelfList(),
    '',
    'THE SET:',
    setText(meta, snapshot.categories || []) || '(no description)',
    '',
    'SOME OF ITS QUESTIONS:',
    ...(questions.length ? questions : ['(none)']),
    '',
    filedAs
      ? `ITS AUTHOR FILED IT UNDER: ${setTopicLabel(filedAs)}`
      : 'ITS AUTHOR HAS NOT CHOSEN A SHELF.',
    '',
    'Answer with ONE JSON object and nothing else:',
    `{"topic":"<shelf id>","tags":[${MIN_SUGGESTED_TAGS} to ${MAX_TAGS} short lower-case keywords for what this set is specifically about],"fits":<boolean>}`,
    '"topic" is the shelf you would file it on.',
    '"fits" is false ONLY if the shelf its author chose is plainly the wrong home for this content — not merely because you would have chosen another.',
  ].join('\n');
}

/**
 * Propose a shelf and a few words for the set in `snapshot`.
 *
 * @returns {Promise<null|{topic:string,tags:string[],filedAs:string,mismatch:boolean}>}
 *   `topic` is a shelf id, or '' when the model named none this product knows.
 *   `filedAs` is the shelf the set carried when it was checked ('' = unfiled),
 *   so a surface reading this later can tell a stale suggestion from a live one.
 *   `mismatch` is the contradiction, and only ever where both signals agree.
 *   `null` means nothing was proposed and nothing should be recorded.
 */
async function suggestSetTopic(bedrock, InvokeModelCommand, snapshot, { budget } = {}) {
  // THE BUDGET FIRST, and it is the only guard before the call: everything
  // else that can go wrong — including a client or a snapshot that is not
  // there — lands in the catch below and answers null like every other failure.
  if (typeof budget === 'function' && !budget()) return null;
  let parsed = null;
  try {
    const res = await bedrock.send(new InvokeModelCommand({
      modelId: HAIKU(),
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify({
        anthropic_version: 'bedrock-2023-05-31',
        max_tokens: 200,
        temperature: 0,
        messages: [{ role: 'user', content: promptFor(snapshot) }],
      }),
    }));
    const body = JSON.parse(new TextDecoder().decode(res.body));
    parsed = parseReply((body.content || []).filter((c) => c.type === 'text').map((c) => c.text).join(' '));
  } catch (error) {
    // Named defensively, because a missing snapshot is one of the things that
    // arrives here: a log line must not be the thing that throws.
    console.warn(`⚠️ no topic suggestion for ${(snapshot && snapshot.source && snapshot.source.setId) || 'the set'}: ${error.message}`);
    return null;
  }
  if (!parsed) return null;
  const topic = normalizeSetTopic(parsed.topic) || UNFILED;
  // The SUGGESTION cap (shared/tags.js), not the set's own twelve: these are
  // words offered to a person, and six is where a suggested list stops being
  // a suggestion.
  const tags = normalizeTags(parsed.tags);
  if (!topic && !tags.length) return null;
  const filedAs = resolveSetTopic((snapshot.meta || {}).topic);
  return {
    topic,
    tags,
    filedAs,
    mismatch: Boolean(topic)
      && filedAs !== UNFILED
      && filedAs !== CATCH_ALL
      && topic !== filedAs
      && parsed.fits === false,
  };
}

module.exports = { suggestSetTopic, SAMPLE_QUESTIONS, CATCH_ALL };
