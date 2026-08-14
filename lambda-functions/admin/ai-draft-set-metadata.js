/**
 * AI DRAFTING FOR A QUESTION SET'S OWN METADATA.
 *
 * WHY THIS EXISTS, and why it is not a convenience feature. The owner:
 * *"there is no ai button to update fix the question set fields."* A set's
 * `name`, `description`, `customInstruction` and `aiContextInstruction` are
 * exactly what `QuestionsPanel.buildAiContext()` sends to
 * `admin/ai-generate-questions` as `context.title`, `context.description`,
 * `context.customInstructions` and `context.aiContextInstructions`. A thin
 * description is therefore not a cosmetic problem: it silently degrades every
 * question drafted for the set afterwards. This endpoint fixes the INPUT to the
 * generator we already built.
 *
 * ── WHAT IT DRAFTS FROM ────────────────────────────────────────────────────
 *
 * THE SET'S OWN QUESTIONS, sent by the caller. The console shows the author the
 * very list it sends (QuestionSetEditor's "Drafted from these questions"), the
 * same shown-equals-sent discipline the sibling browser has: a screen that
 * claims the model was given a list it was not given is worse than no screen.
 * The questions are not re-read here for that reason — re-reading them would
 * make the screen a claim about a DIFFERENT list.
 *
 * The SETS row IS read, for two things the caller must not be trusted with:
 * whether the set exists at all (404), and who may manage it
 * (`shared/question-set-access.js`).
 *
 * ── ONE CALL, FOUR FIELDS ──────────────────────────────────────────────────
 *
 * All four fields come out of ONE generation, not four. They are one voice: a
 * description written without knowing the participant instruction, and an AI
 * context written without knowing the description, contradict each other — and
 * a set whose metadata contradicts itself is precisely the degraded generator
 * input this endpoint exists to repair. Four calls would also be four Bedrock
 * spends for one screen.
 *
 * Accepting them is per field, and it is the human's: see the console. Nothing
 * here writes anything. The response is a DRAFT.
 *
 * ── WHY THE JOB, FOR SOMETHING THIS SMALL ──────────────────────────────────
 *
 * Measured rather than assumed. The output is four prose fields — roughly
 * 10 + 100 + 50 + 150 ≈ 350 output tokens — which at the ~45 output tokens/sec
 * this account measures from Sonnet is about 8 seconds. That fits inside API
 * Gateway's 30s ceiling with room, so a synchronous route would USUALLY work.
 *
 * "Usually" is the problem, and the header of ai-generate-questions.js records
 * what that costs: the failure is not a slow answer, it is API Gateway
 * returning its own non-JSON 503 while the Lambda is still working, which the
 * client cannot tell apart from anything else. Three things stack on top of the
 * 8 seconds and each of them is ordinary: a cold start on a 1024MB function,
 * `retryWithBackoff`'s two throttle retries (each a full second of sleep plus a
 * full re-generation), and the Haiku fallback after a Sonnet error — which is a
 * SECOND complete generation. One throttle plus one fallback is three
 * generations and two sleeps, comfortably past 30 seconds, on a route whose
 * happy path is 8. The job pattern removes the ceiling instead of budgeting
 * against it, the client half already exists (utils/aiBatchClient.js), and it
 * is what every other builder here does. Reuse beat the 22 seconds of headroom.
 */

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand } = require('@aws-sdk/lib-dynamodb');

const { makeGenerationHandler, CORS } = require('./shared/generation-handler');
const { requireAdmin } = require('./shared/require-admin');
const { requireSetManager } = require('./shared/question-set-access');
const { normalizeGameType } = require('./shared/game-types');

/**
 * The four fields this endpoint drafts, and the ONLY four.
 *
 * `engagementType`, `promptId`, `personaId`, `roundKind` and `roundNoun` are
 * also set metadata and are deliberately absent: they are enums and pointers
 * whose wrong value silently changes which phases a session runs and which
 * prompt resolves. A model guessing at those is a different feature with a
 * different failure mode. These four are prose about the set's own content,
 * which is what a model that has read the content can actually improve.
 */
const DRAFT_FIELDS = ['name', 'description', 'customInstruction', 'aiContextInstruction'];

/** Hard ceilings, restated in the schema and in the prompt so they agree. */
const LIMITS = {
  name: 80,
  description: 400,
  customInstruction: 200,
  aiContextInstruction: 700,
};

/**
 * How many of the set's questions reach the prompt.
 *
 * A 400-question set would otherwise put ~25k tokens of input in front of a
 * 1500-token answer for no gain — sixty questions already establish the voice,
 * the vocabulary and the shape. The CONSOLE APPLIES THE SAME TWO CAPS AND SHOWS
 * WHAT IT SENDS, which is why both are exported and not private: a server-side
 * truncation the screen did not know about would quietly break
 * shown-equals-sent, which is the one property this screen is built around.
 *
 * The console mirrors these numbers in `QuestionSetEditor.jsx` (AI_MAX_QUESTIONS
 * / AI_MAX_DETAIL). They are duplicated rather than imported because the lambda
 * bundle is CommonJS and unreachable from the frontend ESM build — the same
 * deliberate duplication `edit-question-set.js` makes for GAME_TYPE_IDS.
 */
const MAX_QUESTIONS = 60;
const MAX_DETAIL = 240;

const text = (value) => String(value ?? '').trim();
const clip = (value, max) => {
  const v = text(value);
  return v.length > max ? `${v.slice(0, max - 1)}…` : v;
};

/** The author's current field values, in the shape the tool emits. */
function currentOf(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const out = {};
  for (const field of DRAFT_FIELDS) out[field] = text(source[field]);
  return out;
}

/** The caller's questions, normalised and capped. Never re-read from the table. */
function questionList(raw) {
  return (Array.isArray(raw) ? raw : [])
    .map((q) => ({
      title: text(q?.title),
      category: text(q?.category),
      detail: clip(q?.detail, MAX_DETAIL),
      customInstructions: clip(q?.customInstructions, MAX_DETAIL),
    }))
    .filter((q) => q.title || q.detail)
    .slice(0, MAX_QUESTIONS);
}

function parseRequest(payload) {
  const p = payload && typeof payload === 'object' ? payload : {};
  const questions = questionList(p.questions);
  return {
    // Exactly one metadata object, always. There is no "count" to ask for.
    total: 1,
    config: {
      setId: text(p.setId),
      engagementType: normalizeGameType(p.engagementType),
      current: currentOf(p.current),
      questions,
      // What the set really holds, so the prompt can say honestly that it is
      // looking at a sample rather than the whole thing.
      //
      // The guard is `> 0`, not `Number.isFinite`. `Number(null)` and
      // `Number('')` are both 0 and both finite, so a caller that sends
      // `totalQuestions: null` alongside forty questions would have told the
      // model "a set of 0 questions" immediately above a list of forty — a
      // prompt that contradicts itself in its second line. Anything that is not
      // a positive number falls back to what was actually sent.
      totalQuestions: Number(p.totalQuestions) > 0
        ? Math.floor(Number(p.totalQuestions))
        : questions.length,
      categories: (Array.isArray(p.categories) ? p.categories : [])
        .map(text).filter(Boolean).slice(0, 24),
      // Optional steer from the author ("say it is for new managers"). The
      // questions remain the material; this only aims the summary.
      brief: clip(p.brief, 500),
    },
  };
}

const FIELD_LABELS = {
  name: 'Title',
  description: 'Description',
  customInstruction: 'Custom instruction (shown to participants)',
  aiContextInstruction: 'AI context instruction',
};

function buildTool() {
  return {
    // extractToolInput() matches on this exact name (shared/structured-generation.js).
    name: 'emit_items',
    description: 'Return the drafted question-set metadata as structured data.',
    input_schema: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          description: 'Exactly one drafted metadata object for this question set.',
          items: {
            type: 'object',
            properties: {
              name: {
                type: 'string',
                description: `What this set is called. 2-6 words, no colon subtitle, ${LIMITS.name} characters maximum.`,
              },
              description: {
                type: 'string',
                description: `What the set is about and who it is for, 1-3 sentences, ${LIMITS.description} characters maximum.`,
              },
              customInstruction: {
                type: 'string',
                description: `The instruction shown to participants, addressed to them, 1-2 sentences, ${LIMITS.customInstruction} characters maximum.`,
              },
              aiContextInstruction: {
                type: 'string',
                description: `Background for the AI that writes and analyses this set: domain, audience, vocabulary, what to avoid. 2-5 sentences, ${LIMITS.aiContextInstruction} characters maximum.`,
              },
            },
            required: DRAFT_FIELDS,
          },
        },
      },
      required: ['items'],
    },
  };
}

function buildPrompt({ config }) {
  const { current, questions, engagementType, totalQuestions, categories, brief } = config;

  let p = 'You are helping the author of an EXISTING question set describe it accurately.\n\n';
  p += `THE SET: "${current.name || 'untitled'}" — a ${engagementType} set of ${totalQuestions} questions`;
  p += categories.length ? ` in these categories: ${categories.join(', ')}.\n` : '.\n';

  p += '\nWHAT THE AUTHOR HAS WRITTEN SO FAR:\n';
  for (const field of DRAFT_FIELDS) {
    p += `- ${FIELD_LABELS[field]}: ${current[field] || '(blank)'}\n`;
  }

  // THE MATERIAL. Everything the draft says has to be true of these, and these
  // are the questions the author is looking at while they read the draft.
  if (questions.length > 0) {
    p += '\nTHE QUESTIONS THEMSELVES — this is the material you are summarising, and'
      + ' everything you write must be true of it:\n';
    for (const q of questions) {
      p += `- ${q.category ? `[${q.category}] ` : ''}${q.title}\n`;
      if (q.detail) p += `  ${q.detail}\n`;
      if (q.customInstructions) p += `  Instruction: ${q.customInstructions}\n`;
    }
    if (totalQuestions > questions.length) {
      p += `(${questions.length} of ${totalQuestions} questions shown — describe the set, not just this sample.)\n`;
    }
  } else {
    // Honest about it rather than inventing. A set with no questions can still
    // be described from what the author has already typed.
    p += '\nTHIS SET HAS NO QUESTIONS YET. Work from what the author has written above,'
      + ' and do not invent content the set does not contain.\n';
  }

  if (brief) p += `\nWHAT THE AUTHOR ASKED FOR: ${brief}\n`;

  p += `
WHAT EACH FIELD IS FOR (hard limits, not targets):
- name: what this set is called. 2-6 words, no colon subtitle, ${LIMITS.name} characters maximum.
- description: what the set is about and who it is for, 1-3 sentences, ${LIMITS.description} characters maximum. A host reads it when choosing a set.
- customInstruction: shown to PARTICIPANTS during the session. Address them directly and tell them how to answer. 1-2 sentences, ${LIMITS.customInstruction} characters maximum. It is an instruction to a person, not a description of the set.
- aiContextInstruction: the background the AI is given when it writes MORE questions for this set and when it summarises a session. Name the domain, the audience, the vocabulary these questions use, and what the AI should avoid. 2-5 sentences, ${LIMITS.aiContextInstruction} characters maximum. THIS FIELD CONDITIONS EVERY QUESTION WRITTEN FOR THIS SET LATER, so it must be concrete: a vague one quietly degrades everything generated afterwards.

WHERE THE AUTHOR HAS ALREADY WRITTEN SOMETHING, keep their intent, their terminology and their voice, and improve on it. Do not contradict them, and do not replace a specific statement of theirs with a general one. Where a field is blank, write it from the questions.

Write only what the content needs; do not pad to reach a limit.

Return exactly ONE item by calling the emit_items tool. Do not write prose.`;

  return p;
}

/**
 * Trim and clip. Returns null only when the model produced nothing usable at
 * all — a single blank field is not a failed draft, it is a field the console
 * will simply not offer.
 */
function normalizeItem(raw) {
  const item = {};
  for (const field of DRAFT_FIELDS) item[field] = clip(raw?.[field], LIMITS[field]);
  return DRAFT_FIELDS.some((f) => item[f]) ? item : null;
}

const generate = makeGenerationHandler({
  kind: 'set-metadata',
  tokenKind: 'set-metadata',
  parseRequest,
  buildTool,
  buildPrompt,
  normalizeItem,
  // The generic worker drops an item with no title and de-dups on it. There is
  // only ever one item here, and a draft whose `name` came back blank is still
  // a usable draft of the other three fields — so it must not be discarded for
  // want of a title.
  titleOf: (item) => item?.name || 'question set metadata',
  // NO `setCreation`. This drafts four METADATA FIELDS for a set the operator
  // is already editing. The whole-set generators create a draft set when their
  // worker finishes (shared/generated-set.js); doing it here would mint an
  // empty set every time somebody asked for help with a description.
});

const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const json = (statusCode, body) => ({ statusCode, body: JSON.stringify(body), headers: CORS });

/**
 * The guards, outside the factory.
 *
 * 1. ADMINS ONLY, in the handler as well as at the gate. The route is NOT in
 *    `auth/authorizer.js`'s HOST_ADMIN_ROUTES, so anything under `admin` falls
 *    through to admins-only there — deliberately, because AI routes spend
 *    Bedrock budget (authorizer.js:126-128). This second check is the same
 *    defence-in-depth `require-admin.js` exists for: the first one lives in a
 *    different lambda and is routed by string prefix.
 *
 * 2. THE ROW. `requireSetManager` decides which SET a caller who got through
 *    may act on. Today it can never refuse an admin, so it is strictly weaker
 *    than the check above — it is here so that opening this route to hosts
 *    stays a one-line edit in authorizer.js rather than a security review, and
 *    so there is exactly ONE ownership derivation in this codebase.
 *
 * The event shape is the part that is easy to get wrong: `CognitoAuthorizer` is
 * a CUSTOM Lambda authorizer despite the name, so the context arrives at
 * `event.requestContext.authorizer.lambda` with groups COMMA-JOINED into a
 * string. Both modules above parse it; nothing here parses it again.
 */
exports.handler = async (event, context) => {
  // The self-invoked worker is not an HTTP request and carries no authorizer
  // context. It is only ever invoked by this function's own role.
  if (event && event.__workerMode === true) return generate(event, context);

  const method = event?.requestContext?.http?.method || event?.httpMethod;
  if (method === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };

  const refused = requireAdmin(event);
  if (refused) return refused;

  const jobIdParam = event?.pathParameters?.jobId || event?.queryStringParameters?.jobId;
  const isStart = method !== 'GET' && !jobIdParam;

  if (isStart) {
    let payload = {};
    try { payload = JSON.parse(event?.body || '{}'); } catch (error) { payload = {}; }
    const setId = text(payload.setId);
    if (!setId) return json(400, { error: 'setId is required' });

    const existing = await db.send(new GetCommand({
      TableName: process.env.TABLE_NAME,
      Key: { PK: 'SETS', SK: `SET#${setId}` },
    }));
    if (!existing.Item) return json(404, { error: `Question set "${setId}" was not found.` });

    const denied = requireSetManager(event, existing.Item, 'draft metadata for');
    if (denied) return denied;
  }

  return generate(event, context);
};

// Exported for the tests and for the console, which applies the same caps so
// that what it shows is what it sends.
exports.DRAFT_FIELDS = DRAFT_FIELDS;
exports.LIMITS = LIMITS;
exports.MAX_QUESTIONS = MAX_QUESTIONS;
exports.MAX_DETAIL = MAX_DETAIL;
