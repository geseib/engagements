const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, GetCommand } = require('@aws-sdk/lib-dynamodb');

const client = new DynamoDBClient({});
const db = DynamoDBDocumentClient.from(client);

exports.handler = async (event) => {
  try {
    const { fileName, fileContent, customTitle, customDescription, customInstructions, aiContextInstructions, promptId, engagementType } = JSON.parse(event.body);

    console.log(`Processing CSV upload: ${fileName}`);
    console.log(`Custom title: ${customTitle}`);
    console.log(`Engagement type: ${engagementType}`);

    // Parse CSV content with better CSV parsing
    const lines = fileContent.split('\n').filter(line => line.trim());
    if (lines.length < 2) {
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

    // Enhanced CSV parsing function
    const parseCSVLine = (line) => {
      const result = [];
      let current = '';
      let inQuotes = false;

      for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"') {
          inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
          result.push(current.trim());
          current = '';
        } else {
          current += char;
        }
      }
      result.push(current.trim());
      return result;
    };

    // Parse header with flexible mapping
    const headers = parseCSVLine(lines[0]).map(h => h.replace(/"/g, '').trim());
    console.log('📋 Detected CSV Headers:', headers);

    // Simple and reliable column mapping - support exact greatest-hits.csv format or generic fallback
    const getColumnIndex = (header) => headers.findIndex(h => h.toLowerCase() === header.toLowerCase());

    // Try greatest-hits.csv format first: Category,Question#,Title,Detail_lesson,School,CustomInstruction
    let categoryIndex = getColumnIndex('Category');
    let questionNumberIndex = getColumnIndex('Question#');
    let titleIndex = getColumnIndex('Title');
    let detailIndex = getColumnIndex('Detail_lesson');
    let schoolIndex = getColumnIndex('School');
    let customInstructionIndex = getColumnIndex('CustomInstruction');

    // Engagement-type specific columns
    let correctAnswerIndex = -1;
    let wrongAnswer1Index = -1;
    let wrongAnswer2Index = -1;
    let wrongAnswer3Index = -1;
    let difficultyIndex = -1;
    let optionsIndex = -1;
    let allowMultipleIndex = -1;

    if (engagementType === 'trivia') {
      correctAnswerIndex = getColumnIndex('CorrectAnswer');
      wrongAnswer1Index = getColumnIndex('WrongAnswer1');
      wrongAnswer2Index = getColumnIndex('WrongAnswer2');
      wrongAnswer3Index = getColumnIndex('WrongAnswer3');
      difficultyIndex = getColumnIndex('Difficulty');
    } else if (engagementType === 'poll') {
      optionsIndex = getColumnIndex('Options');
      allowMultipleIndex = getColumnIndex('AllowMultiple');
    }

    // Fallback to generic column names if exact matches not found
    if (categoryIndex === -1) categoryIndex = headers.findIndex(h => h.toLowerCase().includes('category'));
    if (titleIndex === -1) titleIndex = headers.findIndex(h => h.toLowerCase().includes('title') && !h.toLowerCase().includes('#'));
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

    for (let i = 1; i < lines.length; i++) {
      try {
        const values = parseCSVLine(lines[i]);
        if (values.length < 2) continue; // Skip empty lines

        // Extract values using mapped indices
        const category = values[categoryIndex]?.replace(/"/g, '')?.trim();
        const questionNumber = questionNumberIndex >= 0 ? values[questionNumberIndex]?.replace(/"/g, '')?.trim() : '';
        const title = values[titleIndex]?.replace(/"/g, '')?.trim();
        const detail = detailIndex >= 0 ? values[detailIndex]?.replace(/"/g, '')?.trim() || '' : '';
        const school = schoolIndex >= 0 ? values[schoolIndex]?.replace(/"/g, '')?.trim() || '' : '';
        const questionCustomInstruction = customInstructionIndex >= 0 ? values[customInstructionIndex]?.replace(/"/g, '')?.trim() || '' : '';

        if (title && category) {
          questionCount++;

          const baseQuestion = {
            Title: title,
            Detail: detail,
            Category: category,
            School: school,
            // Use per-question custom instruction if available, otherwise use set-level custom instructions
            CustomInstructions: questionCustomInstruction || customInstructions?.trim() || '',
            Active: true,
            QuestionNumber: questionNumber ? parseInt(questionNumber) : questionCount // Use Question# from CSV if available, otherwise use global count
          };

          // Add engagement-type specific fields
          if (engagementType === 'trivia') {
            baseQuestion.CorrectAnswer = correctAnswerIndex >= 0 ? values[correctAnswerIndex]?.replace(/"/g, '')?.trim() || '' : '';
            baseQuestion.WrongAnswer1 = wrongAnswer1Index >= 0 ? values[wrongAnswer1Index]?.replace(/"/g, '')?.trim() || '' : '';
            baseQuestion.WrongAnswer2 = wrongAnswer2Index >= 0 ? values[wrongAnswer2Index]?.replace(/"/g, '')?.trim() || '' : '';
            baseQuestion.WrongAnswer3 = wrongAnswer3Index >= 0 ? values[wrongAnswer3Index]?.replace(/"/g, '')?.trim() || '' : '';
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
        }
      } catch (e) {
        console.log(`⚠️ Skipping malformed line ${i}: ${lines[i].substring(0, 100)}...`);
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
        active: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        sourceFile: fileName,
        engagementType: engagementType || 'call-and-answer'
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
      
      questionPromises.push(db.send(new PutCommand({
        TableName: process.env.TABLE_NAME,
        Item: {
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
          Active: true
        }
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
