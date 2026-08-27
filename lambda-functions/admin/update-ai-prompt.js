const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand, QueryCommand, DeleteCommand } = require('@aws-sdk/lib-dynamodb');
const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { normalizeGameType } = require('./shared/game-types');
const { normalizeOutputSections, inferPromptType } = require('./shared/prompt-shape');
const {
  assertTemplateVariablesExist, assertNoBracketDirections, assertReceivesResponses,
} = require('./shared/template-variable-usage');
const {
  findPromptForCaller, canManagePrompt, promptKey, promptBodyKey,
} = require('./shared/prompt-access');
const { requestedScope, callerUserId } = require('./shared/question-set-access');
const tenant = require('./shared/tenant');
const {
  ENCRYPTED_FIELDS, encryptValue, decryptValue, decryptItem,
} = require('./shared/tenant-crypto');

const tableName = process.env.TABLE_NAME;
const aiPromptsBucket = process.env.AI_PROMPTS_BUCKET;

/**
 * THE THREE LEGAL STATUSES.
 *
 * `status` was written verbatim into both the DynamoDB row and the S3 object's
 * metadata, with nothing checking it. Every consumer compares it for EXACT
 * equality — `get-ai-prompts.js:64-67` filters on it, the library's status
 * select offers these three strings, and `AdminPage.js:238` keeps only
 * `status === 'active'` for the question-set prompt picker — so a value outside
 * this list is not a cosmetic defect. The prompt vanishes from every filter and
 * every picker while still existing, still being resolvable by id, and possibly
 * still being the game-type default that runs for every set of its type. No
 * surface anywhere reports that state.
 *
 * The list is the editor's own select (`AIPromptManager.jsx:613-615`) plus
 * `delete-ai-prompt.js:214`, which is what writes `archived`. It is checked
 * here rather than in the UI because both AI helpers and the library's status
 * chip land on this route, and the UI is not the wall.
 */
const PROMPT_STATUSES = ['active', 'draft', 'archived'];

const dynamoClient = new DynamoDBClient({});
const dynamodb = DynamoDBDocumentClient.from(dynamoClient, {
  marshallOptions: {
    removeUndefinedValues: true
  }
});

const s3Client = new S3Client({});

exports.handler = async (event) => {
  try {
    // Handle CORS preflight
    if (event.requestContext?.http?.method === 'OPTIONS') {
      return {
        statusCode: 200,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Allow-Methods': 'PUT, OPTIONS'
        },
        body: ''
      };
    }

    const promptId = event.pathParameters?.promptId;
    if (!promptId) {
      throw new Error('promptId is required in path parameters');
    }

    if (!event.body) {
      throw new Error('Request body is required');
    }

    const updateData = JSON.parse(event.body);
    const {
      name,
      description,
      category,
      scenario,
      template: rawTemplate,
      instructions,
      outputFormat,
      // Declared output shape. Omit to leave whatever the prompt already has;
      // send [] or null to clear it and go back to the system default triad.
      outputSections: rawOutputSections,
      isDefault,
      status,
      questionSetIds,
      tags,
      createNewVersion = false
    } = updateData;

    /*
      A LEGACY `template` OUTRANKS BOTH HALVES — get-ai-summary.js takes
      `promptData.template` outright and never reads instructions or
      outputFormat when it is set. So an update that rewrites both halves but
      not the template has not changed what runs: the dev repair of the Art &
      Creative Titles prompt passed every guard and would still have served
      the old bracketed layout, because the old text survived in `template`.
      When a caller supplies BOTH halves they are plainly authoring the
      two-field shape, so the stale single-field one is cleared for them —
      exactly as if they had sent template: ''. A caller that supplies
      `template` explicitly still wins unchanged.
    */
    const template = (rawTemplate === undefined
      && instructions !== undefined && outputFormat !== undefined)
      ? '' : rawTemplate;

    /*
      WHAT USED TO REACH CLOUDWATCH HERE WAS THE WHOLE EVENT — same habit
      create-ai-prompt.js:33 shipped with and fixed for the same reason: an
      edit to an org's Workie carries the identical prose this handler is about
      to make ciphertext in DynamoDB and S3 (see the encryption block below). A
      log line that dumped the raw event put those sentences in CloudWatch
      instead, in the clear, readable with no `kms:Decrypt` and therefore no
      CloudTrail record of having been read — defeating the exact property
      tenant-crypto.js's header exists to guarantee, on every single edit,
      whether or not anything else in this handler is fixed.

      LOG ENOUGH TO TRACE A REQUEST, NEVER WHAT IT SAYS.
    */
    const proseLength = (v) => (typeof v === 'string' ? v.length : 0);
    console.log('✏️ Update AI Prompt', JSON.stringify({
      promptId,
      method: event.requestContext?.http?.method,
      path: event.requestContext?.http?.path,
      sub: callerUserId(event) || null,
      orgId: tenant.callerOrgId(event) || null,
      createNewVersion,
      lengths: {
        name: proseLength(name),
        description: proseLength(description),
        scenario: proseLength(scenario),
        template: proseLength(template),
        instructions: proseLength(instructions),
        outputFormat: proseLength(outputFormat),
      },
    }));

    // WHICH LIBRARY, THEN WHO. `findPromptForCaller` searches only the scopes
    // this caller may READ — their own org, then platform, then public — so a
    // Workie in another organisation is ABSENT rather than forbidden and this
    // route 404s on it exactly as it would on a promptId that never existed.
    // See shared/prompt-access.js.
    const found = await findPromptForCaller(
      dynamodb, tableName, event, promptId, requestedScope(event), GetCommand
    );

    if (!found) {
      return {
        statusCode: 404,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Allow-Methods': 'PUT, OPTIONS'
        },
        body: JSON.stringify({ error: `AI prompt not found: ${promptId}` })
      };
    }

    // 403 before any read of the CONTENT, let alone any write. Checked on the
    // RAW row: scope/orgId/createdBy are never encrypted (ENCRYPTED_FIELDS.prompt
    // does not name them), so authorisation never needs a KMS call, and a
    // caller who is about to be refused never gets their target decrypted.
    if (!canManagePrompt(event, found.item)) {
      const groups = tenant.callerGroups(event);
      console.warn(
        `🚫 refused to let groups [${groups.join(', ') || 'none'}] `
        + `(org: ${tenant.callerOrgId(event) || 'none'}/${tenant.callerOrgRole(event) || '-'}) update `
        + `Workie "${promptId}" in ${found.ref.scope}${found.ref.orgId ? `/${found.ref.orgId}` : ''}`
      );
      return {
        statusCode: 403,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Allow-Methods': 'PUT, OPTIONS'
        },
        body: JSON.stringify({
          error: 'This Workie belongs to someone else. You can only change Workies you created.'
        })
      };
    }

    const ref = found.ref;
    // ORG SCOPE ONLY — platform and public Workies are deliberately plaintext,
    // the same rule create-ai-prompt.js and edit-question-set.js both give: the
    // shared libraries must stay readable by every organisation, and there is
    // no org to key them to.
    const cryptoOrgId = ref.scope === tenant.ORG ? String(ref.orgId || '') : '';

    // THE ROW, IN THE CLEAR. `found.item` is what was actually read off the
    // table — ciphertext for an org Workie — and every fallback below
    // (`currentPrompt.name`, `.description`, …) has to read a real sentence,
    // not an envelope, or a merge with no S3 content to fall back on would
    // splice `{v,iv,tag,ct}` into the document this handler is about to save.
    const currentPrompt = cryptoOrgId
      ? await decryptItem(cryptoOrgId, 'prompt', found.item)
      : found.item;
    const timestamp = new Date().toISOString();

    // Distinguish "not supplied" from "cleared" — the same null-means-skip trap
    // that made question-set edits silently no-op (see the rounds/personas
    // cleanup design, R2). undefined = leave alone; anything else = replace,
    // and an empty/invalid declaration clears back to the default triad.
    const outputSectionsSupplied = rawOutputSections !== undefined;
    const outputSections = outputSectionsSupplied ? normalizeOutputSections(rawOutputSections) : null;
    if (outputSectionsSupplied && rawOutputSections && !outputSections) {
      throw new Error('outputSections must be 1-8 entries of { heading, guidance }, each heading unique, single-line plain text without markdown syntax');
    }

    // See PROMPT_STATUSES. `undefined` means "not supplied", same convention as
    // every other field here; anything else has to be one of the three.
    if (status !== undefined && !PROMPT_STATUSES.includes(status)) {
      throw new Error(
        `status must be one of ${PROMPT_STATUSES.join(', ')} — received ${JSON.stringify(status)}`
      );
    }

    /*
      THERE IS NO ORG-LEVEL DEFAULT — the same rule create-ai-prompt.js enforces
      at creation (shared/tenant.js:114-131, prompt-access.js header). Without
      this, flipping `isDefault` back on through an EDIT would reopen exactly the
      hole creation already closes: `findDefaultPromptId` (game/get-ai-summary.js)
      is a Scan against the bare `AIPROMPTS` partition, so a stamped
      `isDefault: true` on an org row is a claim nothing in the product can
      honour, and the default-management block below writes its GAMETYPE#…
      pointer at the literal 'AIPROMPTS' regardless of which row triggered it.
      Only the ATTEMPT to turn it on is refused — `isDefault: false` always goes
      through, so a caller can still unset one that was, somehow, once true —
      and this is returned before the S3 read so there is no wasted GetObject on
      a request already being refused.
    */
    if (isDefault === true && ref.scope !== tenant.PLATFORM) {
      return {
        statusCode: 400,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Allow-Methods': 'PUT, OPTIONS'
        },
        body: JSON.stringify({
          error: 'A Workie owned by an organisation cannot be a default. '
            + "The default Workie for a game type is Engage's house choice; "
            + "your organisation's Workie is chosen by naming it on a question set."
        })
      };
    }

    // Get current content from S3
    let currentContent = null;
    try {
      const s3Response = await s3Client.send(new GetObjectCommand({
        Bucket: aiPromptsBucket,
        Key: currentPrompt.s3Key
      }));
      const parsedBody = JSON.parse(await s3Response.Body.transformToString());
      // An org body was wrapped WHOLE before PutObject (create-ai-prompt.js) —
      // one envelope around the whole document, not a field at a time, because
      // it is read back whole, by one reader. `decryptValue` returns anything
      // that is not an envelope unchanged, so a platform body and a pre-cipher
      // org body (written before this landed) both pass straight through.
      currentContent = cryptoOrgId ? await decryptValue(cryptoOrgId, parsedBody) : parsedBody;
    } catch (s3Error) {
      console.warn(`⚠️ Could not fetch current content from S3: ${s3Error.message}`);
    }

    /*
      A PARTIAL UPDATE MUST NOT BE ABLE TO EMPTY THE PROMPT.

      The read above is best-effort by design: it warns and carries on. That was
      survivable while the only caller was the editor form, which resends both
      halves on every save — a failed read cost the record's untouched extras
      and nothing that decides what the model reads.

      The status chip in the prompt library sends `{ status }` and NOTHING ELSE.
      On a failed read the merge below would then write an S3 object carrying no
      template, no instructions and no outputFormat, and set `s3Key` to point at
      it. `isUsableSummaryPrompt` rejects that shape (get-ai-summary.js:412-431),
      so every question set pinned to the prompt silently falls back to the
      game-type default and the screen still shows a healthy row. A one-click
      state change must never be able to do that, so it refuses instead.

      Gated on `s3Key` because a row that never had stored content — the
      generation prompts `populate-generation-prompts.js:497` writes straight to
      DynamoDB — has nothing to lose, and refusing those would make them
      permanently uneditable through this route.
    */
    const promptBodySupplied = template !== undefined
      || instructions !== undefined
      || outputFormat !== undefined;
    if (currentPrompt.s3Key && !currentContent && !promptBodySupplied) {
      throw new Error(
        `Cannot apply a partial update to ${promptId}: its stored content at ${currentPrompt.s3Key} `
        + 'could not be read, and this request supplies no replacement, so saving it would leave the '
        + 'prompt with no text at all. Nothing was changed.'
      );
    }

    // Same gate as create-ai-prompt.js, and for the same reason — the advisor's
    // "apply improved prompt" lands here rather than there.
    //
    // Only the fields this request actually SUPPLIED are checked. Validating
    // untouched ones would make a prompt authored before the gate existed
    // permanently uneditable, including by the edit that would have fixed it.
    const effectivePromptType = currentPrompt.promptType
      || inferPromptType(currentContent || currentPrompt);
    if (effectivePromptType === 'analysis') {
      const supplied = {};
      if (template !== undefined) supplied.template = template;
      if (instructions !== undefined) supplied.instructions = instructions;
      if (outputFormat !== undefined) supplied.outputFormat = outputFormat;
      assertTemplateVariablesExist(supplied);
    }

    /*
      THE TWO GUARDS FROM THE LP FAILURE — see template-variable-usage.js for
      the incident and create-ai-prompt.js for the create-side twin. Scope here
      is explicitly-stored analysis prompts, and only on requests that touch
      content: a metadata-only edit (name, status, archive) of a legacy broken
      prompt still saves, but any content edit must leave the prompt clean.

      Brackets are judged on the SUPPLIED fields (the same scoping as the gate
      above — an untouched legacy field must not make the prompt uneditable).
      The response check is judged on what the prompt will BE after the merge:
      a single field may legitimately carry no response variable so long as
      another one does.
    */
    const touchesContent = template !== undefined || instructions !== undefined
      || outputFormat !== undefined || rawOutputSections !== undefined;
    if (currentPrompt.promptType === 'analysis' && touchesContent) {
      const suppliedContent = {};
      if (template !== undefined) suppliedContent.template = template;
      if (instructions !== undefined) suppliedContent.instructions = instructions;
      if (outputFormat !== undefined) suppliedContent.outputFormat = outputFormat;
      if (outputSectionsSupplied) {
        (outputSections || []).forEach((s, i) => {
          if (s && typeof s.guidance === 'string') suppliedContent[`outputSections[${i}].guidance`] = s.guidance;
        });
      }
      assertNoBracketDirections(suppliedContent);

      const base = currentContent || currentPrompt || {};
      const mergedSections = outputSectionsSupplied
        ? (outputSections || [])
        : (Array.isArray(base.outputSections) ? base.outputSections : []);
      const merged = {
        template: template !== undefined ? template : (base.template || ''),
        instructions: instructions !== undefined ? instructions : (base.instructions || ''),
        outputFormat: outputFormat !== undefined ? outputFormat : (base.outputFormat || ''),
      };
      mergedSections.forEach((s, i) => {
        if (s && typeof s.guidance === 'string') merged[`section${i}`] = s.guidance;
      });
      assertReceivesResponses(merged);
    }

    /*
      NOT EVERY PROMPT HAS AN S3 OBJECT, AND THE ONES THAT DO NOT MUST NOT GROW ONE HERE.

      `populate-generation-prompts.js:497` writes the whole generation prompt —
      basePrompt, the four templates, defaultSettings — straight into the
      DynamoDB row and never touches the bucket. Those rows carry no `s3Key`.
      The guard above already knows that (it is gated on `s3Key` precisely so a
      keyless row is not refused for having nothing to read), but everything
      below it assumed a key existed anyway, and there were two ways that fell
      over the moment a caller sent `{ status }` to a keyless row:

        1. `newS3Key` stayed `undefined`, and `PutObjectCommand` rejects a
           missing Key client-side. A plain 500 on a one-click state change.
        2. Even past that, `s3Key = :s3Key` with an undefined value is dropped
           by `removeUndefinedValues`, leaving the UpdateExpression referring to
           a value that is not in ExpressionAttributeValues — a ValidationException.

      Neither was reachable while the only screens sending a status-only PUT
      were the summary library's chip (S3-backed rows, every one) and the editor
      form. `tests/ai-prompt-status-update.js` said so in as many words: "what a
      keyless row does past this point is not decided here… a shape no UI sends
      to this route (the generation library passes no status handler)". The
      generation library has one now, so it is decided here.

      A row with no stored body has nothing to version and nothing to rebuild:
      skip S3 entirely and let the DynamoDB write carry the change. Minting a
      key for it would be worse than the crash — the object would be built from
      `currentContent`, which is null, so the row would end up claiming stored
      content that holds none of its actual prompt text.
    */
    const promptHasS3Body = Boolean(currentPrompt.s3Key) || promptBodySupplied;

    /*
      `version` is a NUMBER on every row create-ai-prompt.js writes and the
      STRING '1.0.0' on every row populate-generation-prompts.js writes.
      `'1.0.0' + 1` is the string `'1.0.01'`, which was then baked into a
      filename and stored back on the row as its version. Coerced, with a
      non-numeric version restarting at 1 rather than producing `NaN`.
    */
    const bumpedVersion = (Number.isFinite(Number(currentPrompt.version))
      ? Number(currentPrompt.version)
      : 0) + 1;

    let newVersion = currentPrompt.version;
    let newS3Key = currentPrompt.s3Key;

    // If creating new version or if default prompt is being edited. A prompt
    // whose body lives in S3 but which somehow has no key yet is versioned too,
    // because otherwise there is nowhere to put the text this request supplied.
    if (promptHasS3Body && (createNewVersion || currentPrompt.isDefault || !currentPrompt.s3Key)) {
      newVersion = bumpedVersion;
      // SCOPED, like create-ai-prompt.js's s3Key. A hand-built platform-shaped
      // path here would mint this new version of an organisation's Workie into
      // the shared bucket namespace every organisation's Workies sit outside
      // of, and orphan the org-scoped object this version is meant to replace.
      newS3Key = promptBodyKey(ref, currentPrompt.gameType, newVersion);
      console.log(`🔄 Creating new version: ${newVersion}`);
    }

    // Prepare updated content
    const updatedContent = {
      ...currentContent,
      id: promptId,
      version: newVersion,
      name: name !== undefined ? name : currentContent?.name || currentPrompt.name,
      description: description !== undefined ? description : currentContent?.description || currentPrompt.description,
      category: category !== undefined ? category : currentContent?.category || currentPrompt.category,
      scenario: scenario !== undefined ? scenario : currentContent?.scenario || currentPrompt.scenario,
      // Support both old and new formats
      ...(template !== undefined && { template }),
      ...(instructions !== undefined && { instructions }),
      ...(outputFormat !== undefined && { outputFormat }),
      // Preserve existing values if not being updated
      ...(template === undefined && currentContent?.template && { template: currentContent.template }),
      ...(instructions === undefined && currentContent?.instructions && { instructions: currentContent.instructions }),
      ...(outputFormat === undefined && currentContent?.outputFormat && { outputFormat: currentContent.outputFormat }),
      ...(outputSectionsSupplied
        ? (outputSections ? { outputSections } : { outputSections: undefined })
        : (currentContent?.outputSections ? { outputSections: currentContent.outputSections } : {})),
      isDefault: isDefault !== undefined ? isDefault : currentContent?.isDefault || currentPrompt.isDefault,
      status: status !== undefined ? status : currentContent?.status || currentPrompt.status,
      questionSetIds: questionSetIds !== undefined ? questionSetIds : currentContent?.questionSetIds || currentPrompt.questionSetIds || [],
      tags: tags !== undefined ? tags : currentContent?.tags || currentPrompt.tags || [],
      updatedAt: timestamp,
      metadata: {
        ...currentContent?.metadata,
        lastModifiedBy: 'admin-interface',
        updateReason: createNewVersion ? 'new-version' : 'edit',
        format: (instructions !== undefined || outputFormat !== undefined) ? 'structured' : 
                currentContent?.metadata?.format || 'legacy'
      }
    };

    // Save updated content to S3 — only for prompts that keep a body there.
    // See `promptHasS3Body`: a generation row's text is on the DynamoDB row, so
    // there is no object to rewrite and no key to rewrite it at.
    if (promptHasS3Body) {
      console.log(`💾 Saving updated content to S3: ${newS3Key}`);
      // ORG BODIES ARE ENCRYPTED BEFORE PutObject, exactly as create-ai-prompt.js
      // does it: the whole document as ONE envelope, because it is read back
      // whole, by one reader, and a per-field envelope inside a JSON document
      // buys nothing. Platform and public bodies stay plaintext by the same
      // decision upload-questions.js states for the shared libraries.
      const newS3Body = cryptoOrgId
        ? JSON.stringify(await encryptValue(cryptoOrgId, updatedContent))
        : JSON.stringify(updatedContent, null, 2);
      await s3Client.send(new PutObjectCommand({
        Bucket: aiPromptsBucket,
        Key: newS3Key,
        Body: newS3Body,
        ContentType: 'application/json',
        Metadata: {
          promptId: promptId,
          gameType: currentPrompt.gameType,
          version: newVersion.toString(),
          status: updatedContent.status
        }
      }));
    } else {
      console.log(`💾 ${promptId} keeps its body on the DynamoDB row; no S3 object to write.`);
    }

    /*
      WHAT GETS WRITTEN AS CIPHERTEXT — the DynamoDB half. `encryptItem` takes a
      whole row and there is no row in an UpdateExpression, so encryption
      happens per VALUE here, exactly as edit-question-set.js does it for sets.

      The field list is READ FROM tenant-crypto, never restated — a local copy
      would drift the moment a field is added to the boundary, and the way that
      drift presents is a new field shipping in plaintext with every test still
      green.

      ONLY ORG SCOPE: platform and public Workies are the libraries every
      organisation reads, and there is no org whose key they could be written
      under.

      `category` is deliberately NOT in ENCRYPTED_FIELDS.prompt — see
      tenant-crypto.js: get-ai-prompts.js matches it with a FilterExpression
      equality test, which an envelope can never satisfy. Routing every field
      through this one helper, rather than hand-picking which ones to encrypt,
      is what keeps `category` plaintext without a second list to keep in sync
      with the first.
    */
    const encryptedPromptFields = new Set(ENCRYPTED_FIELDS.prompt);
    const store = async (field, value) => (
      cryptoOrgId && encryptedPromptFields.has(field) ? encryptValue(cryptoOrgId, value) : value
    );

    // Update DynamoDB metadata
    const updateExpression = [];
    const expressionAttributeValues = {};
    const expressionAttributeNames = {};

    if (name !== undefined) {
      updateExpression.push('#name = :name');
      expressionAttributeNames['#name'] = 'name';
      expressionAttributeValues[':name'] = await store('name', name);
    }

    if (description !== undefined) {
      updateExpression.push('description = :description');
      expressionAttributeValues[':description'] = await store('description', description);
    }

    if (category !== undefined) {
      updateExpression.push('category = :category');
      expressionAttributeValues[':category'] = await store('category', category);
    }

    if (scenario !== undefined) {
      updateExpression.push('scenario = :scenario');
      expressionAttributeValues[':scenario'] = await store('scenario', scenario);
    }

    if (isDefault !== undefined) {
      updateExpression.push('isDefault = :isDefault');
      expressionAttributeValues[':isDefault'] = isDefault;
    }

    if (status !== undefined) {
      updateExpression.push('#status = :status');
      expressionAttributeNames['#status'] = 'status';
      expressionAttributeValues[':status'] = status;
    }

    if (questionSetIds !== undefined) {
      updateExpression.push('questionSetIds = :questionSetIds');
      expressionAttributeValues[':questionSetIds'] = questionSetIds;
    }

    if (tags !== undefined) {
      updateExpression.push('tags = :tags');
      expressionAttributeValues[':tags'] = await store('tags', tags);
    }

    if (outputSectionsSupplied) {
      // Mirror of the S3 copy, so the admin picker can show the shape from the
      // list response. A cleared shape writes an empty list rather than a
      // REMOVE, which keeps this in one SET expression and still normalises to
      // "no declaration" (normalizeOutputSections rejects an empty array).
      updateExpression.push('outputSections = :outputSections');
      expressionAttributeValues[':outputSections'] = await store('outputSections', outputSections || []);
    }

    // Always update these fields
    updateExpression.push('updatedAt = :updatedAt');
    expressionAttributeValues[':updatedAt'] = timestamp;

    /*
      VERSION AND s3Key MOVE TOGETHER, AND ONLY WHEN THERE IS AN OBJECT BEHIND THEM.

      For a keyless row both of these are `undefined`, and `undefined` is not a
      no-op here: the document client is built with `removeUndefinedValues`, so
      the value is dropped from ExpressionAttributeValues while `= :s3Key`
      remains in the expression — DynamoDB then refuses the whole write with
      "an expression attribute value used in expression is not defined". The
      status change would fail with a message about an attribute nobody sent.
    */
    if (promptHasS3Body) {
      updateExpression.push('version = :version');
      expressionAttributeValues[':version'] = newVersion;

      updateExpression.push('s3Key = :s3Key');
      expressionAttributeValues[':s3Key'] = newS3Key;
    }

    // Needed by the `REMOVE #ttl` clause below — `ttl` is a DynamoDB reserved word.
    expressionAttributeNames['#ttl'] = 'ttl';

    // Handle default prompt management for both setting and unsetting defaults.
    //
    // `ref.scope === 'platform'` is guaranteed by the refusal above whenever
    // `isDefault === true`, and this block queries and writes the BARE
    // partition by literal, three times, anyway: a future edit that relaxes
    // that refusal must trip over this line rather than quietly start sweeping
    // an organisation's own Workies for a "default" that can only ever be
    // Engage's. Mirrors the same redundancy in create-ai-prompt.js, same reason.
    if (isDefault !== undefined) {
      if (isDefault === true) {
        console.log(`🏷️ Setting as default prompt for ${currentPrompt.gameType}/${updatedContent.category}`);
        
        try {
          // First, clear isDefault from all other prompts in the same category
          console.log(`🧹 Clearing default status from other prompts in ${currentPrompt.gameType}/${updatedContent.category}`);
          
          const { Items: allPrompts } = await dynamodb.send(new QueryCommand({
            TableName: tableName,
            KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
            ExpressionAttributeValues: {
              ':pk': 'AIPROMPTS',
              ':sk': 'AIPROMPT#'
            }
          }));

          // One default per GAME TYPE, not per game type + category — see the
          // matching note in create-ai-prompt.js (D17). Matched on the
          // normalized type so legacy `callandanswer` rows are cleared too,
          // which a FilterExpression cannot express.
          const targetType = normalizeGameType(currentPrompt.gameType);
          const existingPrompts = (allPrompts || []).filter(p =>
            p.promptId !== promptId && normalizeGameType(p.gameType) === targetType);

          // Clear default status from other prompts
          const clearDefaultPromises = existingPrompts
            .filter(prompt => prompt.isDefault && prompt.promptId)
            .map(prompt =>
              dynamodb.send(new UpdateCommand({
                TableName: tableName,
                Key: {
                  PK: 'AIPROMPTS',
                  SK: `AIPROMPT#${prompt.promptId}`
                },
                UpdateExpression: 'SET isDefault = :false',
                ExpressionAttributeValues: {
                  ':false': false
                }
              }))
            );
          
          if (clearDefaultPromises.length > 0) {
            await Promise.all(clearDefaultPromises);
            console.log(`✅ Cleared default status from ${clearDefaultPromises.length} other prompts`);
          }

          // Create/update the default prompt lookup
          const defaultLookupKey = `GAMETYPE#${currentPrompt.gameType}#CATEGORY#${updatedContent.category}`;
          await dynamodb.send(new PutCommand({
            TableName: tableName,
            Item: {
              PK: 'AIPROMPTS',
              SK: defaultLookupKey,
              defaultPrompt: `PROMPT#${promptId}`,
              gameType: currentPrompt.gameType,
              category: updatedContent.category,
              promptId,
              updatedAt: timestamp
              // NO `ttl`. The table's TimeToLiveSpecification exists for
              // GAME#/PLAYER# session records; AI prompts are configuration and
              // must never expire. See create-ai-prompt.js for the full note.
            }
          }));

          console.log(`✅ Updated default prompt for ${currentPrompt.gameType}/${updatedContent.category}: ${promptId}`);
        } catch (error) {
          console.error('⚠️ Error managing default prompt lookup:', error);
          // Continue anyway - the prompt was still updated successfully
        }
      } else if (isDefault === false && currentPrompt.isDefault === true) {
        // If we're unsetting a default, remove the default lookup (no default for this category)
        console.log(`🗑️ Removing default status from ${currentPrompt.gameType}/${updatedContent.category}`);
        
        try {
          const defaultLookupKey = `GAMETYPE#${currentPrompt.gameType}#CATEGORY#${updatedContent.category}`;
          
          await dynamodb.send(new DeleteCommand({
            TableName: tableName,
            Key: {
              PK: 'AIPROMPTS',
              SK: defaultLookupKey
            }
          }));
          
          console.log(`✅ Removed default lookup for ${currentPrompt.gameType}/${updatedContent.category}`);
        } catch (error) {
          console.error('⚠️ Error removing default lookup:', error);
        }
      }
    }

    if (updateExpression.length > 0) {
      console.log(`💾 Updating DynamoDB metadata`);
      await dynamodb.send(new UpdateCommand({
        TableName: tableName,
        // The row that was FOUND, not a rebuilt platform key — an org's Workie
        // is updated in its own partition or this upserts a second, empty,
        // platform-scoped row under the same promptId.
        Key: promptKey(ref),
        // `REMOVE ttl` self-heals: any prompt row still carrying the old
        // now+365d stamp loses it the next time anyone saves the prompt, so the
        // one-off sweep in scripts/cull-ai-prompts.js is a floor, not a
        // dependency. Removing an absent attribute is a no-op in DynamoDB.
        UpdateExpression: `SET ${updateExpression.join(', ')} REMOVE #ttl`,
        ExpressionAttributeValues: expressionAttributeValues,
        ...(Object.keys(expressionAttributeNames).length > 0 && { ExpressionAttributeNames: expressionAttributeNames })
      }));
    }

    const result = {
      promptId,
      version: newVersion,
      s3Key: newS3Key,
      // THE OTHER HALF OF THE REFERENCE, echoed back for the same reason
      // create-ai-prompt.js's response carries it: a promptId alone no longer
      // names one partition.
      scope: ref.scope,
      orgId: ref.orgId || null,
      status: 'updated',
      message: createNewVersion ? 'New version created successfully' : 'AI prompt updated successfully'
    };

    console.log(`✅ Successfully updated AI prompt: ${promptId}`);

    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'PUT, OPTIONS'
      },
      body: JSON.stringify(result)
    };

  } catch (error) {
    console.error('❌ Error updating AI prompt:', error);
    return {
      statusCode: 500,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'PUT, OPTIONS'
      },
      body: JSON.stringify({
        error: 'Failed to update AI prompt',
        message: error.message
      })
    };
  }
};