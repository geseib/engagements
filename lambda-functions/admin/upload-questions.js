const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, BatchWriteCommand } = require('@aws-sdk/lib-dynamodb');

const client = new DynamoDBClient({});
const db = DynamoDBDocumentClient.from(client);

const BATCH_LIMIT = 25;          // DynamoDB BatchWriteItem hard limit
const MAX_BATCH_ATTEMPTS = 6;    // retries for UnprocessedItems

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const badRequest = (error) => ({
  statusCode: 400,
  body: JSON.stringify({ error }),
  headers: { 'Access-Control-Allow-Origin': '*' }
});

/**
 * Write items with BatchWrite, honouring the 25-item limit and RETRYING
 * UnprocessedItems with exponential backoff. DynamoDB returns UnprocessedItems
 * on partial throttling without raising an error — dropping them silently
 * loses rows, which is exactly how a large import ends up short.
 */
async function batchPut(items) {
  for (let i = 0; i < items.length; i += BATCH_LIMIT) {
    let pending = items.slice(i, i + BATCH_LIMIT).map((Item) => ({ PutRequest: { Item } }));

    for (let attempt = 0; attempt < MAX_BATCH_ATTEMPTS && pending.length > 0; attempt++) {
      if (attempt > 0) await sleep(50 * 2 ** (attempt - 1));
      const res = await db.send(new BatchWriteCommand({
        RequestItems: { [process.env.TABLE_NAME]: pending }
      }));
      pending = (res?.UnprocessedItems?.[process.env.TABLE_NAME]) || [];
    }

    if (pending.length > 0) {
      throw new Error(`DynamoDB kept throttling ${pending.length} item(s) after ${MAX_BATCH_ATTEMPTS} attempts`);
    }
  }
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

    const { fileName, fileContent, customTitle, customDescription, customInstructions, aiContextInstructions, promptId, engagementType, isAIGenerated } = payload;

    if (typeof fileContent !== 'string' || fileContent.trim() === '') {
      return badRequest('No file content received. Please choose a CSV file and try again.');
    }
    if (typeof fileName !== 'string' || fileName.trim() === '') {
      return badRequest('No file name received. Please choose a CSV file and try again.');
    }

    console.log(`Processing CSV upload: ${fileName}`);
    console.log(`Custom title: ${customTitle}`);
    console.log(`Engagement type: ${engagementType}`);
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

    // Extract set name from custom title or filename
    const setName = customTitle?.trim() || fileName.replace(/\.csv$/i, '');
    let setId = setName.toLowerCase().replace(/[^a-z0-9]/g, '');
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
    if (detailIndex === -1) detailIndex = headers.findIndex(h => h.toLowerCase().includes('detail') || h.toLowerCase().includes('lesson'));
    if (schoolIndex === -1) schoolIndex = headers.findIndex(h => h.toLowerCase().includes('school'));
    if (customInstructionIndex === -1) customInstructionIndex = headers.findIndex(h => h.toLowerCase().includes('instruction'));
    // Optional Image column: Image / ImageUrl / Artwork / Picture
    if (imageIndex === -1) imageIndex = headers.findIndex(h => {
      const hl = h.toLowerCase();
      return hl.includes('image') || hl.includes('artwork') || hl.includes('picture');
    });

    console.log('📋 Column Mapping:');
    console.log(`  Category: ${categoryIndex >= 0 ? headers[categoryIndex] : 'NOT FOUND'} (index: ${categoryIndex})`);
    console.log(`  Title: ${titleIndex >= 0 ? headers[titleIndex] : 'NOT FOUND'} (index: ${titleIndex})`);
    console.log(`  Detail: ${detailIndex >= 0 ? headers[detailIndex] : 'NOT FOUND'} (index: ${detailIndex})`);
    console.log(`  Image: ${imageIndex >= 0 ? headers[imageIndex] : 'NOT FOUND'} (index: ${imageIndex})`);

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
            Image: image, // Optional artwork URL; empty for ordinary text questions
            // Use per-question custom instruction if available, otherwise use set-level custom instructions
            CustomInstructions: questionCustomInstruction || customInstructions?.trim() || '',
            Active: true,
            QuestionNumber: questionNumber ? parseInt(questionNumber) : questionCount // Use Question# from CSV if available, otherwise use global count
          };

          // Remove Prompt field - we use Title and Detail only
          
          // For trivia, store additional answer details if available
          if (engagementType === 'trivia' && finalAnswerDetails) {
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

    // Check if set already exists
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

    const setMetadataItem = {
      PK: 'SETS',
      SK: `SET#${setId}`,
      name: setName,
      description: setDescription,
      customInstruction: customInstructions?.trim() || '',
      aiContextInstruction: aiContextInstructions?.trim() || '',
      promptId: promptId || 'lessons-learned', // AI prompt template ID
      questionCount: questions.length,
      categoryCount: categories.size,
      active: isAIGenerated ? false : true,  // AI-generated content starts as inactive
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      sourceFile: fileName,
      engagementType: engagementType || 'call-and-answer',
      isAIGenerated: isAIGenerated || false
    };

    // Build the category rows
    const categoryItems = Array.from(categories).map((categoryName, idx) => ({
      PK: `SET#${setId}`,
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
        PK: `SET#${setId}`,
        SK: questionId,
        Title: question.Title,
        Detail: question.Detail || '',
        Category: question.Category,
        School: question.School || '',
        Image: question.Image || '', // Optional artwork URL
        CustomInstructions: question.CustomInstructions || '',
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
    const intendedKeys = [...categoryItems, ...questionItems, setMetadataItem]
      .map(({ PK, SK }) => ({ PK, SK }));

    try {
      await batchPut(categoryItems);
      await batchPut(questionItems);
      await batchPut([setMetadataItem]);
    } catch (writeError) {
      console.error(`❌ Import write failed: ${writeError.message}`);
      console.log(`🧹 Rolling back up to ${intendedKeys.length} item(s)`);
      await deleteKeys(intendedKeys);
      return {
        statusCode: 500,
        body: JSON.stringify({
          error: `Upload failed while writing to the database: ${writeError.message}. No partial set was left behind.`
        }),
        headers: { 'Access-Control-Allow-Origin': '*' }
      };
    }

    console.log(`✅ Successfully created question set "${setName}"`);
    console.log(`📊 Final stats: ${questions.length} questions, ${categories.size} categories`);

    return {
      statusCode: 200,
      body: JSON.stringify({
        setName: setName,
        setId: setId,
        questionCount: questions.length,
        categoryCount: categories.size,
        // Rows the importer could not use. Reported so an import that quietly
        // drops half a file is visible instead of looking like a clean success.
        skippedRowCount: skippedRows.length,
        skippedRows: skippedRows.slice(0, 50),
        message: `Successfully created question set "${setName}" with ${questions.length} questions across ${categories.size} categories`
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
