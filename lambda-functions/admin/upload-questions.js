const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, BatchWriteCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const {
  BATCH_LIMIT,
  batchPutItems,
  copyPartition,
  knownVersions,
  nextVersion,
  queryPartition,
  setPartition,
  toVersion,
} = require('./shared/set-version');
const { normalizeTags } = require('./shared/tags');
const { ownerStamp, requireSetManager } = require('./shared/question-set-access');

const client = new DynamoDBClient({});
const db = DynamoDBDocumentClient.from(client);

const badRequest = (error) => ({
  statusCode: 400,
  body: JSON.stringify({ error }),
  headers: { 'Access-Control-Allow-Origin': '*' }
});

const notFound = (error) => ({
  statusCode: 404,
  body: JSON.stringify({ error }),
  headers: { 'Access-Control-Allow-Origin': '*' }
});

/**
 * Write items with BatchWrite, honouring the 25-item limit and RETRYING
 * UnprocessedItems with exponential backoff. DynamoDB returns UnprocessedItems
 * on partial throttling without raising an error — dropping them silently
 * loses rows, which is exactly how a large import ends up short.
 *
 * The implementation lives in shared/set-version.js so the importer, the
 * legacy->v1 snapshot and the migration script all share ONE retry policy.
 */
const batchPut = (items) => batchPutItems(db, process.env.TABLE_NAME, items);

/**
 * Turn a CSV Image cell into the value stored on the question row.
 *
 * The CSV carries a BARE FILENAME — `the-enigmatic-smile.jpg` — and the importer
 * expands it to the set-scoped media key `sets/<setId>/<filename>`, so an author
 * never types a prefix and every image is findable from the set id alone.
 *
 * A KEY is stored, never a full URL. Baking `https://<env>-cdn/...` into the row
 * would make a table restored into another tier point at the wrong environment's
 * bucket — the frontend prepends the media base from config at render time.
 *
 * The prefix uses the SET id and never the version number. Media is per-set and
 * shared across versions on purpose: a CSV edit almost always keeps the artwork,
 * and per-version media would mean re-uploading every image to fix one typo. A
 * replace therefore leaves stored image keys pointing at the same prefix.
 *
 * Three rules, and the first two must not be removed:
 *   https?://…            -> stored as-is   (legacy hot-linked Wikimedia rows)
 *   /…                    -> stored as-is   (repo assets, /assets/art/…)
 *   anything else         -> sets/<setId>/<filename>
 *
 * Idempotent: a value that already carries the set's prefix is left alone, so a
 * downloaded CSV — which contains the stored value — can be re-uploaded without
 * growing `sets/x/sets/x/…`.
 */
function toMediaKey(rawImage, setId) {
  const image = String(rawImage ?? '').trim();
  if (!image) return '';
  if (/^https?:\/\//i.test(image)) return image;   // absolute URL — legacy rows
  if (image.startsWith('/')) return image;         // repo asset — served by the app
  const prefix = `sets/${setId}/`;
  if (image.startsWith(prefix)) return image;      // already keyed — do not double-prefix
  // Guard against a hand-written `sets/<other>/file.jpg` too: only the basename
  // is meaningful, and re-keying it to THIS set is what the author meant.
  const fileName = image.split('/').pop();
  return `${prefix}${fileName}`;
}

/** Best-effort removal of rows written by a failed import, so it leaves no orphans. */
async function deleteKeys(keys) {
  for (let i = 0; i < keys.length; i += BATCH_LIMIT) {
    const chunk = keys.slice(i, i + BATCH_LIMIT).map((Key) => ({ DeleteRequest: { Key } }));
    try {
      await db.send(new BatchWriteCommand({
        RequestItems: { [process.env.TABLE_NAME]: chunk }
      }));
    } catch (e) {
      console.error(`⚠️ Rollback batch failed (orphans may remain): ${e.message}`);
    }
  }
}

exports.handler = async (event) => {
  try {
    let payload;
    try {
      payload = JSON.parse(event?.body || '{}');
    } catch (e) {
      return badRequest('Request body is not valid JSON.');
    }

    const { fileName, fileContent, customTitle, customDescription, customInstructions, aiContextInstructions, promptId, isAIGenerated } = payload;

    // REPLACE. When present, this import does not create a set — it writes a
    // NEW VERSION of an existing one and flips activeVersion to it. See
    // docs/superpowers/specs/2026-08-08-question-set-versioning-design.md.
    const replaceSetId = String(payload.replaceSetId ?? '').trim();
    const isReplace = replaceSetId !== '';
    let engagementType = payload.engagementType;

    if (typeof fileContent !== 'string' || fileContent.trim() === '') {
      return badRequest('No file content received. Please choose a CSV file and try again.');
    }
    if (typeof fileName !== 'string' || fileName.trim() === '') {
      return badRequest('No file name received. Please choose a CSV file and try again.');
    }

    // On a REPLACE the target set is read BEFORE the CSV is parsed, because the
    // parse is engagement-type specific: which columns are read (OptionA..F and
    // CorrectAnswer for trivia, Options/AllowMultiple for a poll) depends on it.
    // A replace that omitted engagementType would silently reparse a trivia set
    // as call-and-answer and drop every option — so the existing set's type is
    // the default, and only an explicit value overrides it.
    let existingMeta;
    if (isReplace) {
      const res = await db.send(new GetCommand({
        TableName: process.env.TABLE_NAME,
        Key: { PK: 'SETS', SK: `SET#${replaceSetId}` }
      }));
      existingMeta = res.Item;
      if (!existingMeta) {
        return notFound(`Question set "${replaceSetId}" does not exist, so there is nothing to replace.`);
      }
      // A REPLACE IS AN EDIT, and the most consequential one in the product: it
      // writes a new version of an existing set and flips the live pointer to
      // it, so it changes what every future game plays. It therefore takes the
      // SAME ownership check as edit and delete — a host may replace only a set
      // they created. Checked here, before the CSV is even parsed, so a refused
      // replace costs nothing and touches nothing.
      //
      // The plain-create branch below needs no such check: it refuses to write
      // over any set that already exists, so it can only ever add a new row.
      const denied = requireSetManager(event, existingMeta, 'replace');
      if (denied) return denied;

      if (engagementType === undefined || engagementType === null || String(engagementType).trim() === '') {
        engagementType = existingMeta.engagementType || 'call-and-answer';
        console.log(`↻ Replace: inheriting engagement type "${engagementType}" from the existing set`);
      }
    }

    console.log(`Processing CSV upload: ${fileName}`);
    console.log(`Custom title: ${customTitle}`);
    console.log(`Engagement type: ${engagementType}`);
    console.log(`Replace target: ${isReplace ? replaceSetId : '(new set)'}`);
    console.log(`CSV content length: ${fileContent.length} characters`);

    // Survey uploads (JSON template) are not yet supported: surveys have no
    // game-side support (host/player pages and game lambdas only play
    // call-and-answer, trivia, poll and wavelength sets), so importing a
    // survey would create a set that can never be played.
    const isJsonFile = typeof fileName === 'string' && /\.json$/i.test(fileName);
    const looksLikeJson = typeof fileContent === 'string' && /^[\[{]/.test(fileContent.trim());
    if (engagementType === 'survey' || isJsonFile || looksLikeJson) {
      console.log('⚠️ Survey/JSON upload detected - not yet supported');
      return {
        statusCode: 400,
        body: JSON.stringify({
          error: 'Survey upload is not yet supported. Survey JSON templates can be downloaded and edited, but surveys cannot be imported as playable question sets until game sessions support the survey engagement type.'
        }),
        headers: { 'Access-Control-Allow-Origin': '*' }
      };
    }

    // Parse CSV content with proper multi-line field support
    // First, we need to properly parse CSV with quoted fields that may contain newlines
    const parseCSV = (csvContent) => {
      const rows = [];
      let currentRow = [];
      let currentField = '';
      let inQuotes = false;
      let i = 0;
      
      while (i < csvContent.length) {
        const char = csvContent[i];
        const nextChar = i + 1 < csvContent.length ? csvContent[i + 1] : null;
        
        if (char === '"') {
          if (inQuotes && nextChar === '"') {
            // Escaped quote
            currentField += '"';
            i += 2;
            continue;
          } else {
            // Toggle quote state
            inQuotes = !inQuotes;
            i++;
            continue;
          }
        }
        
        if (!inQuotes && char === ',') {
          // End of field
          currentRow.push(currentField.trim());
          currentField = '';
          i++;
          continue;
        }
        
        if (!inQuotes && char === '\n') {
          // End of row
          currentRow.push(currentField.trim());
          if (currentRow.some(field => field !== '')) {
            rows.push(currentRow);
          }
          currentRow = [];
          currentField = '';
          i++;
          continue;
        }
        
        // Regular character (including newlines within quotes)
        currentField += char;
        i++;
      }
      
      // Don't forget the last field and row
      if (currentField !== '' || currentRow.length > 0) {
        currentRow.push(currentField.trim());
        if (currentRow.some(field => field !== '')) {
          rows.push(currentRow);
        }
      }
      
      return rows;
    };
    
    const rows = parseCSV(fileContent);
    console.log(`📊 Parsed ${rows.length} rows from CSV`);
    
    if (rows.length < 2) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'CSV file must have at least a header and one data row' }),
        headers: { 'Access-Control-Allow-Origin': '*' }
      };
    }

    // Extract set name from custom title or filename.
    //
    // A REPLACE keeps the target set's id and name: the whole reason to replace
    // rather than delete-and-reupload is that the id, and everything hanging off
    // it (prompt, persona, instructions, round noun, games that reference it),
    // survives.
    const setName = isReplace
      ? (existingMeta.name || existingMeta.Name || replaceSetId)
      : (customTitle?.trim() || fileName.replace(/\.csv$/i, ''));
    let setId = isReplace ? replaceSetId : setName.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!setId) {
      // A title with no ASCII alphanumerics (e.g. "日本語セット") used to slug to
      // the empty string, producing the bare keys PK/SK "SET#" — every such set
      // collided with every other one. Fall back to a deterministic hex slug of
      // the name so the same title still maps to the same id.
      setId = 'set' + Buffer.from(setName, 'utf8').toString('hex').slice(0, 32);
      console.log(`ℹ️ Title has no ASCII alphanumerics; derived setId "${setId}"`);
    }
    const setDescription = customDescription?.trim() || `Imported from ${fileName}`;

    // Parse header with flexible mapping
    const headers = rows[0].map(h => h.replace(/"/g, '').trim());
    console.log('📋 Detected CSV Headers:', headers);

    // Simple and reliable column mapping - support exact greatest-hits.csv format or generic fallback
    const getColumnIndex = (header) => headers.findIndex(h => h.toLowerCase() === header.toLowerCase());

    // Try new format first: Category,Question#,Title,QuestionDetail,AnswerDetails,School
    let categoryIndex = getColumnIndex('Category');
    let questionNumberIndex = getColumnIndex('Question#');
    let titleIndex = getColumnIndex('Title');
    let questionDetailIndex = getColumnIndex('QuestionDetail');
    let answerDetailsIndex = getColumnIndex('AnswerDetails');
    let detailIndex = getColumnIndex('Detail_lesson'); // Legacy support
    let schoolIndex = getColumnIndex('School');
    let customInstructionIndex = getColumnIndex('CustomInstruction');
    let imageIndex = getColumnIndex('Image'); // Optional artwork/image URL ("Art Title" sets)
    // Optional Tags column. Every AI builder now suggests tags, and until this
    // existed they were displayed, edited and then silently dropped at import.
    let tagsIndex = getColumnIndex('Tags');

    // Engagement-type specific columns
    let correctAnswerIndex = -1;
    let difficultyIndex = -1;
    let optionsIndex = -1;
    let allowMultipleIndex = -1;
    
    // Option format indices (for OptionA/B/C/D CSV format)
    let optionAIndex = -1;
    let optionBIndex = -1;
    let optionCIndex = -1;
    let optionDIndex = -1;
    let optionEIndex = -1;
    let optionFIndex = -1;

    if (engagementType === 'trivia') {
      correctAnswerIndex = getColumnIndex('CorrectAnswer');
      optionAIndex = getColumnIndex('OptionA');
      optionBIndex = getColumnIndex('OptionB');
      optionCIndex = getColumnIndex('OptionC');
      optionDIndex = getColumnIndex('OptionD');
      optionEIndex = getColumnIndex('OptionE');
      optionFIndex = getColumnIndex('OptionF');
      difficultyIndex = getColumnIndex('Difficulty');
    } else if (engagementType === 'poll') {
      optionsIndex = getColumnIndex('Options');
      allowMultipleIndex = getColumnIndex('AllowMultiple');
    }

    // Fallback to generic column names if exact matches not found
    if (categoryIndex === -1) categoryIndex = headers.findIndex(h => h.toLowerCase().includes('category'));
    if (titleIndex === -1) titleIndex = headers.findIndex(h => h.toLowerCase().includes('title') && !h.toLowerCase().includes('#'));
    if (questionDetailIndex === -1) questionDetailIndex = headers.findIndex(h => h.toLowerCase().includes('questiondetail'));
    if (answerDetailsIndex === -1) answerDetailsIndex = headers.findIndex(h => h.toLowerCase().includes('answerdetails'));
    // The loose `includes('detail')` fallback also matches "AnswerDetails". That
    // was harmless while AnswerDetails was trivia-only; it is a SPOILER now that
    // art sets keep the real title there, because Detail is shown to players
    // during ASK. Never let the reveal column become the question detail.
    if (detailIndex === -1) detailIndex = headers.findIndex((h, i) => {
      if (i === answerDetailsIndex || i === questionDetailIndex) return false;
      const hl = h.toLowerCase();
      return hl.includes('detail') || hl.includes('lesson');
    });
    if (schoolIndex === -1) schoolIndex = headers.findIndex(h => h.toLowerCase().includes('school'));
    if (customInstructionIndex === -1) customInstructionIndex = headers.findIndex(h => h.toLowerCase().includes('instruction'));
    // Optional Image column: Image / ImageUrl / Artwork / Picture
    if (imageIndex === -1) imageIndex = headers.findIndex(h => {
      const hl = h.toLowerCase();
      return hl.includes('image') || hl.includes('artwork') || hl.includes('picture');
    });
    // Tags / Keywords / Labels. Deliberately an EXACT-ish match rather than a
    // loose `includes` — a loose match on "tag" would also claim a column like
    // "Stage", and the instruction fallback below must not claim "Tags" either.
    if (tagsIndex === -1) tagsIndex = headers.findIndex(h => {
      const hl = h.toLowerCase().trim();
      return hl === 'tags' || hl === 'tag' || hl === 'keywords' || hl === 'labels';
    });

    console.log('📋 Column Mapping:');
    console.log(`  Category: ${categoryIndex >= 0 ? headers[categoryIndex] : 'NOT FOUND'} (index: ${categoryIndex})`);
    console.log(`  Title: ${titleIndex >= 0 ? headers[titleIndex] : 'NOT FOUND'} (index: ${titleIndex})`);
    console.log(`  Detail: ${detailIndex >= 0 ? headers[detailIndex] : 'NOT FOUND'} (index: ${detailIndex})`);
    console.log(`  Image: ${imageIndex >= 0 ? headers[imageIndex] : 'NOT FOUND'} (index: ${imageIndex})`);
    console.log(`  Tags: ${tagsIndex >= 0 ? headers[tagsIndex] : 'NOT FOUND'} (index: ${tagsIndex})`);

    // Check required columns
    if (categoryIndex === -1 || titleIndex === -1) {
      const missing = [];
      if (categoryIndex === -1) missing.push('Category');
      if (titleIndex === -1) missing.push('Title');

      return {
        statusCode: 400,
        body: JSON.stringify({
          error: `Missing required columns: ${missing.join(', ')}. \nDetected headers: [${headers.join(', ')}]\nRequired: Category column (category/type/subject) and Title column (title/prompt/question)`
        }),
        headers: { 'Access-Control-Allow-Origin': '*' }
      };
    }

    // Parse questions with mapped columns
    const questions = [];
    const categories = new Set();
    const skippedRows = [];
    let questionCount = 0;

    // Read one already-parsed cell. Deliberately NO `.replace(/"/g, '')` here:
    // parseCSV has already consumed the CSV quoting and turned `""` back into a
    // literal `"`, so stripping quotes a second time silently deletes quote
    // characters that are part of the author's text (e.g. THE "RIGHT" CALL).
    const cell = (values, idx) => (idx >= 0 ? (values[idx] ?? '').trim() : '');

    for (let i = 1; i < rows.length; i++) {
      const values = rows[i];
      try {
        if (values.length < 2) { // Skip empty rows
          skippedRows.push({ row: i + 1, reason: 'too few columns' });
          continue;
        }

        // Extract values using mapped indices
        const category = cell(values, categoryIndex);
        const questionNumber = cell(values, questionNumberIndex);
        const title = cell(values, titleIndex);
        const questionDetail = cell(values, questionDetailIndex);
        const answerDetails = cell(values, answerDetailsIndex);
        const legacyDetail = cell(values, detailIndex);
        const school = cell(values, schoolIndex);
        const questionCustomInstruction = cell(values, customInstructionIndex);
        const image = cell(values, imageIndex);
        const tagsCell = cell(values, tagsIndex);

        // Use new fields if available, otherwise fall back to legacy
        const finalQuestionDetail = questionDetail || legacyDetail || ''; // Use question detail or legacy detail for trivia
        const finalAnswerDetails = answerDetails || ''; // Use answer details for additional info

        if (title && category) {
          questionCount++;

          const baseQuestion = {
            Title: title,
            Detail: finalQuestionDetail, // For trivia, this should be the question detail/explanation
            Category: category,
            School: school,
            // A bare CSV filename becomes the set-scoped media key
            // `sets/<setId>/<filename>`; absolute URLs and /-rooted repo assets
            // are stored untouched. See toMediaKey().
            Image: toMediaKey(image, setId),
            // Use per-question custom instruction if available, otherwise use set-level custom instructions
            CustomInstructions: questionCustomInstruction || customInstructions?.trim() || '',
            // Pipe-separated, matching the Options column's convention.
            // normalizeTags also accepts a comma string, so a hand-edited CSV
            // using commas inside a quoted cell still works.
            Tags: normalizeTags(tagsCell.includes('|') ? tagsCell.split('|') : tagsCell),
            Active: true,
            QuestionNumber: questionNumber ? parseInt(questionNumber) : questionCount // Use Question# from CSV if available, otherwise use global count
          };

          // Remove Prompt field - we use Title and Detail only

          // AnswerDetails is the REVEAL: the fact that only makes sense once the
          // round is over. For trivia that is why the answer is right; for an
          // art-title round it is the real title of the work plus a point of
          // trivia about the piece or the artist.
          //
          // This used to be gated to trivia, which is why an art round had
          // nowhere to keep the real title — the teaser lives in Title, the
          // artist in School, and Detail must stay blank because Detail is shown
          // to players and would spoil the round before anyone answers.
          // AnswerDetails is carried by NO player or host payload
          // (game/get-question.js, game/get-game-state.js) and is read only by
          // game/get-ai-summary.js, which runs at RESULTS. That is precisely the
          // property the reveal needs, so the gate is lifted for every type.
          if (finalAnswerDetails) {
            baseQuestion.AnswerDetails = finalAnswerDetails;
          }

          // Add engagement-type specific fields
          if (engagementType === 'trivia') {
            // Only support OptionA/B/C/D/E/F format (up to 6 options)
            baseQuestion.OptionA = cell(values, optionAIndex);
            baseQuestion.OptionB = cell(values, optionBIndex);
            baseQuestion.OptionC = cell(values, optionCIndex);
            baseQuestion.OptionD = cell(values, optionDIndex);
            baseQuestion.OptionE = cell(values, optionEIndex);
            baseQuestion.OptionF = cell(values, optionFIndex);
            baseQuestion.CorrectAnswer = cell(values, correctAnswerIndex);
            baseQuestion.Difficulty = cell(values, difficultyIndex) || 'medium';
          } else if (engagementType === 'poll') {
            const optionsStr = cell(values, optionsIndex);
            baseQuestion.Options = optionsStr ? optionsStr.split('|').map(opt => opt.trim()) : [];
            baseQuestion.AllowMultiple = cell(values, allowMultipleIndex).toLowerCase() === 'true';
          }

          questions.push(baseQuestion);
          categories.add(category);

          console.log(`  ✅ Question ${questionCount}: ${category} - ${title.substring(0, 50)}...`);
          if (engagementType === 'call-and-answer' && finalQuestionDetail.length > 200) {
            console.log(`    📝 Long detail field (${finalQuestionDetail.length} chars)`);
          }
        } else {
          // A row that parsed fine but is unusable. Previously dropped in total
          // silence, so an import could report "3 questions" for a 5-row file.
          const missing = [!category && 'Category', !title && 'Title'].filter(Boolean).join(' + ');
          skippedRows.push({ row: i + 1, reason: `missing ${missing}` });
          console.log(`⚠️ Row ${i + 1} skipped: missing ${missing}`);
        }
      } catch (e) {
        // `values` is declared outside the try on purpose: it used to be a
        // `const` inside it, so this handler threw ReferenceError and turned a
        // skippable row into a 500 for the whole import.
        skippedRows.push({ row: i + 1, reason: `malformed row: ${e.message}` });
        console.log(`⚠️ Skipping malformed row ${i + 1}: ${JSON.stringify(values).substring(0, 100)}...`);
      }
    }

    if (questions.length === 0) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'No valid questions found in CSV' }),
        headers: { 'Access-Control-Allow-Origin': '*' }
      };
    }

    console.log(`✅ Successfully parsed ${questions.length} questions in ${categories.size} categories`);

    // Everything above this line is validation. Nothing has been written yet,
    // and nothing below writes anything the live set can see until the single
    // activeVersion flip at the very end — that is the atomicity the design
    // depends on. A failure anywhere before the flip leaves an orphaned version
    // and a fully intact live set.

    if (!isReplace) {
      // Check if set already exists. A plain import still refuses to touch an
      // existing set: overwriting one by accident (same title -> same slug) is
      // exactly the data loss versioning exists to prevent. Replacing is opt-in
      // and explicit, via replaceSetId.
      const existingSet = await db.send(new GetCommand({
        TableName: process.env.TABLE_NAME,
        Key: { PK: 'SETS', SK: `SET#${setId}` }
      }));

      if (existingSet.Item) {
        return {
          statusCode: 400,
          body: JSON.stringify({ error: `Question set "${setName}" already exists. Please use a different title or delete the existing set first.` }),
          headers: { 'Access-Control-Allow-Origin': '*' }
        };
      }
    }

    // ---- REPLACE: work out which version to write ---------------------------
    //
    // A set that has never been versioned still holds its content in the legacy
    // `SET#<id>` partition. Snapshot that to #v1 FIRST, so the version this
    // replace supersedes actually exists and rolling back is a promote rather
    // than a restore. The snapshot is a copy; the legacy rows stay put, exactly
    // as the migration script leaves them.
    let targetVersion = null;
    let snapshotted = 0;
    if (isReplace) {
      const alreadyVersioned = toVersion(existingMeta.activeVersion) !== null
        || knownVersions(existingMeta).length > 0;

      if (!alreadyVersioned) {
        const legacyPk = setPartition(setId, null);
        const { items: legacyItems } = await queryPartition(db, process.env.TABLE_NAME, legacyPk);
        if (legacyItems.length > 0) {
          snapshotted = await copyPartition(db, process.env.TABLE_NAME, legacyPk, setPartition(setId, 1));
          console.log(`📸 Snapshotted ${snapshotted} legacy row(s) of "${setId}" to v1 before replacing`);
          existingMeta = {
            ...existingMeta,
            versions: [{
              version: 1,
              createdAt: existingMeta.createdAt || new Date().toISOString(),
              questionCount: existingMeta.questionCount || 0,
              categoryCount: existingMeta.categoryCount || 0,
              sourceFile: existingMeta.sourceFile || '',
              note: 'snapshot of the pre-versioning content'
            }]
          };
        }
      }

      targetVersion = nextVersion(existingMeta);
      console.log(`↻ Replacing set "${setId}" — writing version v${targetVersion}`);
    }

    // Content partition for THIS import. A plain import keeps writing to the
    // legacy `SET#<id>` layout (a new set is version-less until it is migrated
    // or first replaced); a replace writes to `SET#<id>#v<n>`.
    const contentPk = setPartition(setId, targetVersion);

    const setMetadataItem = {
      PK: 'SETS',
      SK: `SET#${setId}`,
      name: setName,
      description: setDescription,
      customInstruction: customInstructions?.trim() || '',
      aiContextInstruction: aiContextInstructions?.trim() || '',
      // AI prompt template ID — written ONLY when the importer picked one.
      //
      // This used to hardcode `promptId || 'lessons-learned'` for every set
      // regardless of engagement type, which is how a call-and-answer
      // lessons-learned prompt ended up attached to 14 trivia and wavelength
      // sets, including the art set. Leaving it unset is strictly better than
      // guessing: get-ai-summary.js resolves a per-game-type default at run time
      // (findDefaultPromptId) using the set's actual engagement type, so an
      // unset set always gets a type-appropriate prompt and automatically
      // follows the default if it is later re-pointed. A stamped id freezes one
      // wrong choice at import time and becomes a dangling reference the moment
      // that prompt is deleted.
      ...(String(promptId ?? '').trim() ? { promptId: String(promptId).trim() } : {}),
      questionCount: questions.length,
      categoryCount: categories.size,
      active: isAIGenerated ? false : true,  // AI-generated content starts as inactive
      createdAt: new Date().toISOString(),
      // WHO MADE IT — `createdBy` (Cognito sub) plus `createdByName` for
      // display. This is the field the edit and delete rules read; without it a
      // host could create a set and then be unable to touch it, since an
      // ownerless set is admin-only by design. `{}` when the caller cannot be
      // identified, which records no owner rather than an owner of ''.
      // See shared/question-set-access.js for the whole rule.
      //
      // A REPLACE never reaches this object — it updates the existing metadata
      // row through the flip below — so replacing a set deliberately leaves its
      // original creator in place instead of transferring it to whoever last
      // uploaded a CSV.
      ...ownerStamp(event),
      updatedAt: new Date().toISOString(),
      sourceFile: fileName,
      engagementType: engagementType || 'call-and-answer',
      isAIGenerated: isAIGenerated || false,
      // Lets every set picker mark sets that carry artwork without reading all
      // their questions first. Art Title rounds are ordinary call-and-answer
      // sets with an Image column, so nothing else distinguishes them in a list.
      hasImages: questions.some((q) => (q.Image || '').trim().length > 0)
    };

    // Build the category rows
    const categoryItems = Array.from(categories).map((categoryName, idx) => ({
      PK: contentPk,
      SK: `CATEGORY#c${String(idx + 1).padStart(3, '0')}`,
      Name: categoryName,
      Description: `${categoryName} questions`,
      QuestionCount: questions.filter(q => q.Category === categoryName).length
    }));

    // Create questions with enhanced data - using category-relative numbering
    console.log(`🔄 Creating ${questions.length} questions in database...`);

    // Create a mapping of category names to category IDs
    const categoryNameToId = {};
    Array.from(categories).forEach((categoryName, categoryIndex) => {
      categoryNameToId[categoryName] = `c${String(categoryIndex + 1).padStart(3, '0')}`;
    });

    const questionItems = [];

    // Process questions grouped by category to ensure proper category-relative numbering
    const categoryCounters = {};

    questions.forEach((question) => {
      const categoryId = categoryNameToId[question.Category];
      
      // Initialize counter for this category if it doesn't exist
      if (!categoryCounters[categoryId]) {
        categoryCounters[categoryId] = 0;
      }
      
      // Increment counter for this category
      categoryCounters[categoryId]++;
      
      // Always use the category counter to ensure proper category-relative numbering
      const categoryRelativeNumber = String(categoryCounters[categoryId]).padStart(3, '0');
      
      const questionId = `QUESTION#${categoryId}#${categoryRelativeNumber}`;
      
      console.log(`📝 Creating ${questionId} - ${question.Title.substring(0, 50)}...`);
      
      // Base question item
      const questionItem = {
        PK: contentPk,
        SK: questionId,
        Title: question.Title,
        Detail: question.Detail || '',
        Category: question.Category,
        School: question.School || '',
        Image: question.Image || '', // Optional artwork URL
        // The reveal, withheld until RESULTS. Read only by
        // game/get-ai-summary.js; carried by no player or host payload.
        // This whitelist previously dropped it even for trivia, so the
        // AnswerDetails column has never reached the table from a CSV import —
        // parsed at line ~297, assembled onto baseQuestion, then silently lost
        // here. Written only when non-empty so ordinary sets are unchanged.
        ...(question.AnswerDetails ? { AnswerDetails: question.AnswerDetails } : {}),
        CustomInstructions: question.CustomInstructions || '',
        Tags: question.Tags || [],
        OrderInCategory: categoryRelativeNumber,
        QuestionNumber: question.QuestionNumber || categoryCounters[categoryId], // Use CSV value or category counter
        CategoryQuestionNumber: question.QuestionNumber || categoryCounters[categoryId], // Same as QuestionNumber
        Active: isAIGenerated ? false : true  // AI-generated questions start as inactive
      };

      // Add engagement-type specific fields to database item
      if (engagementType === 'trivia') {
        // Only support OptionA/B/C/D/E/F format (up to 6 options)
        console.log(`🎯 Trivia "${question.Title}" → correct answer "${question.CorrectAnswer}"`);

        questionItem.optionA = question.OptionA || '';
        questionItem.optionB = question.OptionB || '';
        questionItem.optionC = question.OptionC || '';
        questionItem.optionD = question.OptionD || '';
        questionItem.optionE = question.OptionE || '';
        questionItem.optionF = question.OptionF || '';
        questionItem.correctAnswer = question.CorrectAnswer || '';
        questionItem.difficulty = question.Difficulty || 'medium';
        questionItem.points = 10;
      } else if (engagementType === 'poll') {
        // Store poll options
        questionItem.options = question.Options || [];
        questionItem.allowMultiple = question.AllowMultiple || false;
      }

      questionItems.push(questionItem);
    });

    // Write order matters. Content rows go first and the SETS metadata row goes
    // LAST, so a set only ever becomes visible in the admin list once all of its
    // questions are actually in the table. Previously metadata was written
    // first, and any failure mid-import left a browsable set with missing
    // questions. If anything does fail, roll back everything we wrote so the
    // import leaves no orphan rows behind for a later re-import to merge with.
    // Roll back against every key we INTENDED to write, not just the batches
    // that came back clean: BatchWriteItem is not atomic, so the call that
    // throws may already have applied some of its items. Deleting a key that
    // was never written is a harmless no-op.
    //
    // A REPLACE writes only content rows here. Its metadata row already exists
    // and must NOT be overwritten — the set's promptId, personaId,
    // customInstruction, aiContextInstruction, roundNoun, active flag and
    // Quickstart badge all live there, and a wholesale Put would silently reset
    // every one of them to this request's defaults. The flip below is a
    // targeted UpdateCommand instead.
    const intendedKeys = [...categoryItems, ...questionItems, ...(isReplace ? [] : [setMetadataItem])]
      .map(({ PK, SK }) => ({ PK, SK }));

    try {
      await batchPut(categoryItems);
      await batchPut(questionItems);
      if (!isReplace) await batchPut([setMetadataItem]);
    } catch (writeError) {
      console.error(`❌ Import write failed: ${writeError.message}`);
      console.log(`🧹 Rolling back up to ${intendedKeys.length} item(s)`);
      await deleteKeys(intendedKeys);
      return {
        statusCode: 500,
        body: JSON.stringify({
          error: isReplace
            ? `Replace failed while writing v${targetVersion}: ${writeError.message}. The live set is untouched and still on version ${toVersion(existingMeta.activeVersion) ?? 'legacy'}.`
            : `Upload failed while writing to the database: ${writeError.message}. No partial set was left behind.`
        }),
        headers: { 'Access-Control-Allow-Origin': '*' }
      };
    }

    // ---- THE FLIP ----------------------------------------------------------
    //
    // One attribute write, and the only moment the live set changes. Everything
    // above it wrote to a partition nothing reads yet. There is no half-flipped
    // state: either activeVersion still names the old version and the new one is
    // an unreferenced orphan, or it names the new one and every row is present.
    //
    // versions[] is appended in the SAME update, so the list and the pointer can
    // never disagree. list_append needs an existing list, so if_not_exists seeds
    // one for a set that has never carried the attribute.
    if (isReplace) {
      const versionEntry = {
        version: targetVersion,
        createdAt: new Date().toISOString(),
        questionCount: questions.length,
        categoryCount: categories.size,
        sourceFile: fileName,
        note: ''
      };
      // The snapshot entry (legacy -> v1) only exists in memory until now; if it
      // was taken, seed versions[] with it rather than an empty list.
      const seed = Array.isArray(existingMeta.versions) ? existingMeta.versions : [];

      try {
        await db.send(new UpdateCommand({
          TableName: process.env.TABLE_NAME,
          Key: { PK: 'SETS', SK: `SET#${setId}` },
          // Every attribute is aliased through ExpressionAttributeNames, the
          // same blanket rule edit-question-set.js uses: DynamoDB's reserved-word
          // list is long and dull, and one rule beats a per-field judgement call
          // that only fails in production.
          UpdateExpression:
            'SET #activeVersion = :v, '
            + '#versions = list_append(if_not_exists(#versions, :seed), :entry), '
            + '#questionCount = :qc, #categoryCount = :cc, #hasImages = :hi, '
            + '#sourceFile = :src, #updatedAt = :now, #engagementType = :et',
          ExpressionAttributeNames: {
            '#activeVersion': 'activeVersion',
            '#versions': 'versions',
            '#questionCount': 'questionCount',
            '#categoryCount': 'categoryCount',
            '#hasImages': 'hasImages',
            '#sourceFile': 'sourceFile',
            '#updatedAt': 'updatedAt',
            '#engagementType': 'engagementType'
          },
          ExpressionAttributeValues: {
            ':v': targetVersion,
            ':seed': seed,
            ':entry': [versionEntry],
            ':qc': questions.length,
            ':cc': categories.size,
            ':hi': setMetadataItem.hasImages,
            ':src': fileName,
            ':now': versionEntry.createdAt,
            // The rows just written were parsed for this type, so the recorded
            // type must agree with them or the game reads fields that are not
            // there. On a replace this is the existing type unless the caller
            // explicitly changed it.
            ':et': engagementType || 'call-and-answer'
          }
        }));
      } catch (flipError) {
        // The new version is written but unreferenced. The live set is exactly
        // as it was, which is the failure mode the design is built around.
        console.error(`❌ activeVersion flip failed: ${flipError.message}`);
        return {
          statusCode: 500,
          body: JSON.stringify({
            error: `v${targetVersion} was written but could not be activated: ${flipError.message}. `
              + `The live set is unchanged; retry the replace, or promote v${targetVersion} directly.`,
            setId,
            version: targetVersion,
            activated: false
          }),
          headers: { 'Access-Control-Allow-Origin': '*' }
        };
      }
    }

    console.log(isReplace
      ? `✅ Replaced question set "${setName}" — now on v${targetVersion}`
      : `✅ Successfully created question set "${setName}"`);
    console.log(`📊 Final stats: ${questions.length} questions, ${categories.size} categories`);

    return {
      statusCode: 200,
      body: JSON.stringify({
        setName: setName,
        setId: setId,
        // null for a plain import: a brand-new set is unversioned until it is
        // migrated or first replaced, exactly like every set that exists today.
        version: targetVersion,
        replaced: isReplace,
        snapshottedLegacyRows: snapshotted || undefined,
        questionCount: questions.length,
        categoryCount: categories.size,
        // Rows the importer could not use. Reported so an import that quietly
        // drops half a file is visible instead of looking like a clean success.
        skippedRowCount: skippedRows.length,
        skippedRows: skippedRows.slice(0, 50),
        message: isReplace
          ? `Replaced question set "${setName}" with ${questions.length} questions across ${categories.size} categories (now version ${targetVersion})`
            + (skippedRows.length ? ` (${skippedRows.length} row(s) skipped)` : '')
          : `Successfully created question set "${setName}" with ${questions.length} questions across ${categories.size} categories`
            + (skippedRows.length ? ` (${skippedRows.length} row(s) skipped)` : '')
      }),
      headers: { 'Access-Control-Allow-Origin': '*' }
    };

  } catch (error) {
    console.error('Upload error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: `Upload failed: ${error.message}` }),
      headers: { 'Access-Control-Allow-Origin': '*' }
    };
  }
};
