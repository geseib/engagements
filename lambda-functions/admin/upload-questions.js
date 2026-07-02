const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, GetCommand } = require('@aws-sdk/lib-dynamodb');

const client = new DynamoDBClient({});
const db = DynamoDBDocumentClient.from(client);

exports.handler = async (event) => {
  try {
    const { fileName, fileContent, customTitle, customDescription, customInstructions, aiContextInstructions, promptId, engagementType, isAIGenerated } = JSON.parse(event.body);

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
    const setId = setName.toLowerCase().replace(/[^a-z0-9]/g, '');
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

    console.log('📋 Column Mapping:');
    console.log(`  Category: ${categoryIndex >= 0 ? headers[categoryIndex] : 'NOT FOUND'} (index: ${categoryIndex})`);
    console.log(`  Title: ${titleIndex >= 0 ? headers[titleIndex] : 'NOT FOUND'} (index: ${titleIndex})`);
    console.log(`  Detail: ${detailIndex >= 0 ? headers[detailIndex] : 'NOT FOUND'} (index: ${detailIndex})`);

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
    let questionCount = 0;

    for (let i = 1; i < rows.length; i++) {
      try {
        const values = rows[i];
        if (values.length < 2) continue; // Skip empty rows

        // Extract values using mapped indices
        const category = values[categoryIndex]?.replace(/"/g, '')?.trim();
        const questionNumber = questionNumberIndex >= 0 ? values[questionNumberIndex]?.replace(/"/g, '')?.trim() : '';
        const title = values[titleIndex]?.replace(/"/g, '')?.trim();
        const questionDetail = questionDetailIndex >= 0 ? values[questionDetailIndex]?.replace(/"/g, '')?.trim() : '';
        const answerDetails = answerDetailsIndex >= 0 ? values[answerDetailsIndex]?.replace(/"/g, '')?.trim() : '';
        const legacyDetail = detailIndex >= 0 ? values[detailIndex]?.replace(/"/g, '')?.trim() || '' : '';
        const school = schoolIndex >= 0 ? values[schoolIndex]?.replace(/"/g, '')?.trim() || '' : '';
        const questionCustomInstruction = customInstructionIndex >= 0 ? values[customInstructionIndex]?.replace(/"/g, '')?.trim() || '' : '';
        
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
            baseQuestion.OptionA = optionAIndex >= 0 ? values[optionAIndex]?.replace(/"/g, '')?.trim() || '' : '';
            baseQuestion.OptionB = optionBIndex >= 0 ? values[optionBIndex]?.replace(/"/g, '')?.trim() || '' : '';
            baseQuestion.OptionC = optionCIndex >= 0 ? values[optionCIndex]?.replace(/"/g, '')?.trim() || '' : '';
            baseQuestion.OptionD = optionDIndex >= 0 ? values[optionDIndex]?.replace(/"/g, '')?.trim() || '' : '';
            baseQuestion.OptionE = optionEIndex >= 0 ? values[optionEIndex]?.replace(/"/g, '')?.trim() || '' : '';
            baseQuestion.OptionF = optionFIndex >= 0 ? values[optionFIndex]?.replace(/"/g, '')?.trim() || '' : '';
            baseQuestion.CorrectAnswer = correctAnswerIndex >= 0 ? values[correctAnswerIndex]?.replace(/"/g, '')?.trim() || '' : '';
            baseQuestion.Difficulty = difficultyIndex >= 0 ? values[difficultyIndex]?.replace(/"/g, '')?.trim() || 'medium' : 'medium';
          } else if (engagementType === 'poll') {
            const optionsStr = optionsIndex >= 0 ? values[optionsIndex]?.replace(/"/g, '')?.trim() || '' : '';
            baseQuestion.Options = optionsStr ? optionsStr.split('|').map(opt => opt.trim()) : [];
            const allowMultipleStr = allowMultipleIndex >= 0 ? values[allowMultipleIndex]?.replace(/"/g, '')?.trim() || 'false' : 'false';
            baseQuestion.AllowMultiple = allowMultipleStr.toLowerCase() === 'true';
          }

          questions.push(baseQuestion);
          categories.add(category);

          console.log(`  ✅ Question ${questionCount}: ${category} - ${title.substring(0, 50)}...`);
          if (engagementType === 'call-and-answer' && finalQuestionDetail.length > 200) {
            console.log(`    📝 Long detail field (${finalQuestionDetail.length} chars)`);
          }
        }
      } catch (e) {
        console.log(`⚠️ Skipping malformed row ${i}: ${JSON.stringify(values).substring(0, 100)}...`);
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

    // Create set metadata with enhanced information
    await db.send(new PutCommand({
      TableName: process.env.TABLE_NAME,
      Item: {
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
      }
    }));

    // Create categories
    const categoryPromises = Array.from(categories).map((categoryName, idx) => {
      const categoryId = `c${String(idx + 1).padStart(3, '0')}`;
      return db.send(new PutCommand({
        TableName: process.env.TABLE_NAME,
        Item: {
          PK: `SET#${setId}`,
          SK: `CATEGORY#${categoryId}`,
          Name: categoryName,
          Description: `${categoryName} questions`,
          QuestionCount: questions.filter(q => q.Category === categoryName).length
        }
      }));
    });

    await Promise.all(categoryPromises);

    // Create questions with enhanced data - using category-relative numbering
    console.log(`🔄 Creating ${questions.length} questions in database...`);
    
    // Create a mapping of category names to category IDs
    const categoryNameToId = {};
    Array.from(categories).forEach((categoryName, categoryIndex) => {
      categoryNameToId[categoryName] = `c${String(categoryIndex + 1).padStart(3, '0')}`;
    });
    
    const questionPromises = [];
    
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
        CustomInstructions: question.CustomInstructions || '',
        OrderInCategory: categoryRelativeNumber,
        QuestionNumber: question.QuestionNumber || categoryCounters[categoryId], // Use CSV value or category counter
        CategoryQuestionNumber: question.QuestionNumber || categoryCounters[categoryId], // Same as QuestionNumber
        Active: isAIGenerated ? false : true  // AI-generated questions start as inactive
      };

      // Add engagement-type specific fields to database item
      if (engagementType === 'trivia') {
        // Only support OptionA/B/C/D/E/F format (up to 6 options)
        console.log(`🎯 Processing trivia question: ${question.Title}`);
        console.log(`🎯 Options: A="${question.OptionA}", B="${question.OptionB}", C="${question.OptionC}", D="${question.OptionD}"`);
        console.log(`🎯 Correct answer: "${question.CorrectAnswer}"`);
        
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

      questionPromises.push(db.send(new PutCommand({
        TableName: process.env.TABLE_NAME,
        Item: questionItem
      })));
    });

    await Promise.all(questionPromises);

    console.log(`✅ Successfully created question set "${setName}"`);
    console.log(`📊 Final stats: ${questions.length} questions, ${categories.size} categories`);

    return {
      statusCode: 200,
      body: JSON.stringify({
        setName: setName,
        setId: setId,
        questionCount: questions.length,
        categoryCount: categories.size,
        message: `Successfully created question set "${setName}" with ${questions.length} questions across ${categories.size} categories`
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
