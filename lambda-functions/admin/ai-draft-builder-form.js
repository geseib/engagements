/**
 * THE AI HELPER THAT FILLS IN A BUILDER FORM.
 *
 * The owner: *"i do wish there was an AI helper that filled out the forms for
 * the user based on some prelim info they offered. So say they only filled on
 * the description box of what they wanted. the AI could come up with a title,
 * categories, Instructions etc. or if the user filled those in the ai would
 * refine (unless locked, a small icon lock/unlock on cells."*
 *
 * Three behaviours, all of them in `shared/field-drafting.js`: FILL an empty
 * field, REFINE one the operator wrote, never touch a LOCKED one.
 *
 * ── WHY THIS IS NOT `ai-draft-set-metadata.js` ─────────────────────────────
 *
 * That endpoint solves the same *shape* of problem and this one reuses
 * everything about it that is reusable — the job factory, the structured-tool
 * call, the "nothing is written, the response is a draft" rule, the console
 * pattern of showing the operator what was filled and what was held. What it
 * cannot share is the three things that define an endpoint:
 *
 *   1. THE FIELDS. It drafts a SAVED SET's four metadata fields. This drafts a
 *      BUILDER FORM's fields, which differ per builder and include none of
 *      those four (`context`, `audience`, `mustHaveCategories`, `topic`,
 *      `customPrompt`). One handler serving both would be a `mode` flag with
 *      two disjoint field lists, two schemas and two prompts behind it.
 *   2. THE MATERIAL. It summarises questions that already exist. Here nothing
 *      exists yet — the material is what the operator typed into the form five
 *      seconds ago. There is no list to read.
 *   3. THE GUARD. It requires an existing SETS row, 404s without one and runs
 *      `requireSetManager` against it. This runs BEFORE any set exists, so that
 *      guard has nothing to check and would refuse every legitimate call.
 *
 * Folding those into one handler would have made both harder to read and would
 * have put a `setId`-shaped hole in the middle of a screen that has no set.
 * What IS shared is shared, in `shared/field-drafting.js`, which the metadata
 * endpoint can adopt later to gain locks without either of them forking.
 *
 * ── NOTHING IS WRITTEN ─────────────────────────────────────────────────────
 *
 * No DynamoDB write beyond the job record itself, no set creation (`setCreation`
 * is absent from the factory config, which makes it structurally incapable
 * rather than switched off), no persisted draft. The response is a proposal the
 * operator accepts field by field in the browser.
 */

const { makeGenerationHandler, CORS } = require('./shared/generation-handler');
const { requireAdmin } = require('./shared/require-admin');
const { formSpec } = require('./shared/builder-form-fields');
const {
  text, normalizeLocked, planFields, draftTargets,
  buildFieldSchema, enforceLocks, buildFieldPrompt,
} = require('./shared/field-drafting');

const json = (statusCode, body) => ({ statusCode, body: JSON.stringify(body), headers: CORS });

/** Read-only steer the model is told about but never proposes. */
const MAX_HINT = 400;

function parseRequest(payload) {
  const p = payload && typeof payload === 'object' ? payload : {};
  const form = formSpec(p.formId);
  // The worker re-parses the stored payload, so an unknown form id has to be
  // survivable here as well as refused at the gate. An empty spec produces an
  // empty plan, which the factory reports as a job that generated nothing —
  // never a crash inside the worker where the operator cannot see it.
  const fields = form ? form.fields : [];
  const current = {};
  for (const spec of fields) current[spec.key] = text(p.current?.[spec.key]);
  const locked = normalizeLocked(p.locked, fields);
  return {
    // One form, one generation. Asking per field would be four Bedrock spends
    // producing four fields that can disagree with each other, which is the
    // same reason ai-draft-set-metadata does all four in one call.
    total: 1,
    config: {
      formId: form ? form.id : '',
      current,
      locked,
      // Read-only context: the topic card the operator picked, how many
      // categories they asked for. Named in the prompt, never proposed.
      hints: (Array.isArray(p.hints) ? p.hints : [])
        .map((h) => text(h)).filter(Boolean).slice(0, 6)
        .map((h) => (h.length > MAX_HINT ? `${h.slice(0, MAX_HINT - 1)}…` : h)),
    },
  };
}

const specOf = (config) => formSpec(config.formId);
const fieldsOf = (config) => (specOf(config) ? specOf(config).fields : []);

// NOTE THE SIGNATURE. The factory calls `buildTool(reqConfig)` with the config
// itself, and `buildPrompt({ config, ... })` with it wrapped. They differ; a
// `{ config }` destructure here would silently see undefined and offer the model
// an empty schema.
function buildTool(config) {
  const fields = fieldsOf(config);
  const plan = planFields(fields, config.current, config.locked);
  const { properties, required } = buildFieldSchema(fields, plan);
  return {
    // extractToolInput() matches on this exact name (shared/structured-generation.js).
    name: 'emit_items',
    description: 'Return the proposed form values as structured data.',
    input_schema: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          description: 'Exactly one object holding the proposed values for the unlocked fields.',
          items: { type: 'object', properties, required },
        },
      },
      required: ['items'],
    },
  };
}

function buildPrompt({ config }) {
  const form = specOf(config);
  if (!form) return 'Return an empty items array by calling the emit_items tool.';
  const plan = planFields(form.fields, config.current, config.locked);
  return buildFieldPrompt({
    form,
    specs: form.fields,
    current: config.current,
    plan,
    extras: config.hints,
  });
}

/**
 * ENFORCEMENT, on the way out.
 *
 * `normalizeItem` runs in the worker on the model's own output, before anything
 * reaches the job record — so a locked field cannot be stored, let alone
 * returned. It is the second of the two server-side points; the first is the
 * schema, which never offered the model a slot for a locked key at all.
 *
 * `config` is threaded through by the factory so this is decided against the
 * SAME locked list the schema was built from, not a re-read of the request.
 */
function makeNormalizeItem(config) {
  const fields = fieldsOf(config);
  return (raw) => {
    const item = enforceLocks(raw, fields, config.locked);
    return Object.keys(item).length > 0 ? item : null;
  };
}

const generate = makeGenerationHandler({
  kind: 'builder-form',
  tokenKind: 'builder-form',
  parseRequest,
  buildTool,
  buildPrompt,
  // The factory calls normalizeItem(raw, config); the closure keeps the locked
  // list and the field specs together so neither can be applied without the other.
  normalizeItem: (raw, config) => makeNormalizeItem(config || { formId: '', locked: [] })(raw),
  // There is exactly one item and it has no title. Without this the generic
  // worker would drop it for want of one and de-dup an array of length 1.
  titleOf: () => 'form draft',
  // NO `setCreation`. This proposes form values for a generation that has not
  // been started yet. Minting a question set here would create one every time
  // somebody asked for help filling in a text box.
});

/**
 * The guard.
 *
 * ADMINS ONLY, at the gate and again here. This route is NOT on
 * `auth/authorizer.js`'s HOST_ADMIN_ROUTES — everything under /admin that is not
 * on that list falls through to admins-only, and the AI routes are excluded
 * there deliberately because reaching one is a Bedrock spend. The handler checks
 * again because the first check lives in a different Lambda and is routed by
 * string prefix.
 *
 * There is no row to guard. Nothing exists yet — that is the whole premise of
 * the screen — so `requireSetManager` has nothing to be applied to. The
 * ownership question arrives later, when `upload-questions` creates the set.
 *
 * The event shape is the part that is easy to get wrong: `CognitoAuthorizer` is
 * a CUSTOM Lambda authorizer despite the name, so the context lands at
 * `event.requestContext.authorizer.lambda` with groups COMMA-JOINED into a
 * string. `require-admin.js` parses it; nothing here parses it again.
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

    const form = formSpec(payload.formId);
    if (!form) return json(400, { error: 'formId must be one of: scenario, trivia, poll' });

    const current = {};
    for (const spec of form.fields) current[spec.key] = text(payload.current?.[spec.key]);
    const locked = normalizeLocked(payload.locked, form.fields);
    const plan = planFields(form.fields, current, locked);

    // TWO REFUSALS, BOTH BEFORE A SINGLE TOKEN IS SPENT.
    //
    // Nothing to work from: a model handed an empty form invents a session
    // nobody asked for, and the operator cannot tell an invention from a
    // proposal. The console disables the button for the same reason; this is
    // the check that survives someone calling the route directly.
    if (!Object.values(current).some(Boolean)) {
      return json(400, {
        error: `Type something first — the ${form.fields.find((f) => f.key === form.seed).label} box is the one to start with. There is nothing here to draft from.`,
      });
    }
    // Nothing to write into: every field locked is a request for a generation
    // whose entire output would be discarded on arrival.
    if (draftTargets(plan).length === 0) {
      return json(400, { error: 'Every field is locked, so there is nothing for the AI to propose. Unlock a field first.' });
    }
  }

  return generate(event, context);
};
