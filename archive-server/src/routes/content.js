const express = require('express');
const { body, param, validationResult } = require('express-validator');
const { pool } = require('../config/database');
const { logAccess } = require('../services/auditService');
const crypto = require('crypto');

const router = express.Router();

/**
 * Generate content hash for deduplication
 */
function generateContentHash(content) {
  return crypto.createHash('sha256').update(JSON.stringify(content)).digest('hex');
}

/**
 * @route GET /api/content/question-set/:id
 * @desc Get specific question set with all questions
 * @access Private (mTLS required)
 */
router.get('/question-set/:id', [
  param('id').isUUID().withMessage('Invalid question set ID')
], async (req, res) => {
  try {
    // Validate request
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Invalid parameters',
        details: errors.array()
      });
    }
    
    const questionSetId = req.params.id;
    
    // Get question set with environment info
    const questionSetQuery = `
      SELECT 
        qs.*,
        e.name as source_environment,
        e.description as environment_description
      FROM question_sets qs
      LEFT JOIN environments e ON qs.source_environment_id = e.id
      WHERE qs.id = $1 AND qs.active = true
    `;
    
    // Get all questions for this set
    const questionsQuery = `
      SELECT * FROM questions 
      WHERE question_set_id = $1 AND active = true 
      ORDER BY question_number, created_at
    `;
    
    const [questionSetResult, questionsResult] = await Promise.all([
      pool.query(questionSetQuery, [questionSetId]),
      pool.query(questionsQuery, [questionSetId])
    ]);
    
    if (questionSetResult.rows.length === 0) {
      return res.status(404).json({
        error: 'Question set not found'
      });
    }
    
    const questionSet = questionSetResult.rows[0];
    const questions = questionsResult.rows;
    
    // Log access
    await logAccess({
      content_type: 'question_set',
      content_id: questionSetId,
      operation: 'view',
      ...req.clientContext
    });
    
    res.json({
      success: true,
      data: {
        ...questionSet,
        questions: questions
      },
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Get question set error:', error);
    res.status(500).json({
      error: 'Failed to get question set',
      message: error.message
    });
  }
});

/**
 * @route GET /api/content/ai-prompt/:id
 * @desc Get specific AI prompt
 * @access Private (mTLS required)
 */
router.get('/ai-prompt/:id', [
  param('id').isUUID().withMessage('Invalid AI prompt ID')
], async (req, res) => {
  try {
    // Validate request
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Invalid parameters',
        details: errors.array()
      });
    }
    
    const promptId = req.params.id;
    
    const query = `
      SELECT 
        ap.*,
        e.name as source_environment,
        e.description as environment_description
      FROM ai_prompts ap
      LEFT JOIN environments e ON ap.source_environment_id = e.id
      WHERE ap.id = $1 AND ap.active = true
    `;
    
    const result = await pool.query(query, [promptId]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        error: 'AI prompt not found'
      });
    }
    
    const prompt = result.rows[0];
    
    // Log access
    await logAccess({
      content_type: 'ai_prompt',
      content_id: promptId,
      operation: 'view',
      ...req.clientContext
    });
    
    res.json({
      success: true,
      data: prompt,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Get AI prompt error:', error);
    res.status(500).json({
      error: 'Failed to get AI prompt',
      message: error.message
    });
  }
});

/**
 * @route POST /api/content/upload/question-sets
 * @desc Upload question sets to archive
 * @access Private (mTLS required)
 */
router.post('/upload/question-sets', [
  body('questionSets').isArray({ min: 1 }).withMessage('Question sets must be a non-empty array'),
  body('questionSets.*.title').isString().trim().isLength({ min: 1, max: 500 }),
  body('questionSets.*.game_type').isIn(['trivia', 'poll', 'call-and-answer']),
  body('questionSets.*.questions').isArray({ min: 1 }).withMessage('Each question set must have questions')
], async (req, res) => {
  try {
    // Validate request
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Invalid request data',
        details: errors.array()
      });
    }
    
    const { questionSets } = req.body;
    const client = req.client;
    
    // Get or create environment
    let environmentId;
    try {
      const envResult = await pool.query(
        'SELECT id FROM environments WHERE name = $1',
        [client.environment]
      );
      
      if (envResult.rows.length > 0) {
        environmentId = envResult.rows[0].id;
      } else {
        const newEnvResult = await pool.query(
          'INSERT INTO environments (name, description) VALUES ($1, $2) RETURNING id',
          [client.environment, `Environment: ${client.environment}`]
        );
        environmentId = newEnvResult.rows[0].id;
      }
    } catch (envError) {
      console.error('Environment setup error:', envError);
      return res.status(500).json({
        error: 'Failed to setup environment'
      });
    }
    
    const uploadResults = [];
    
    // Process each question set
    for (const questionSet of questionSets) {
      try {
        const contentHash = generateContentHash(questionSet);
        
        // Check for duplicates
        const existingResult = await pool.query(
          'SELECT id FROM question_sets WHERE content_hash = $1 AND source_environment_id = $2',
          [contentHash, environmentId]
        );
        
        if (existingResult.rows.length > 0) {
          uploadResults.push({
            original_id: questionSet.original_id || questionSet.id,
            status: 'skipped',
            reason: 'duplicate',
            existing_id: existingResult.rows[0].id
          });
          continue;
        }
        
        // Insert question set
        const questionSetInsert = await pool.query(`
          INSERT INTO question_sets (
            original_id, title, description, game_type, category, school,
            custom_instructions, ai_context_instructions, difficulty,
            question_count, created_by, source_environment_id, content_hash, metadata
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
          RETURNING id
        `, [
          questionSet.original_id || questionSet.id,
          questionSet.title,
          questionSet.description || '',
          questionSet.game_type,
          questionSet.category || '',
          questionSet.school || '',
          questionSet.custom_instructions || '',
          questionSet.ai_context_instructions || '',
          questionSet.difficulty || 'medium',
          questionSet.questions.length,
          client.name,
          environmentId,
          contentHash,
          JSON.stringify(questionSet.metadata || {})
        ]);
        
        const newQuestionSetId = questionSetInsert.rows[0].id;
        
        // Insert questions
        let questionNumber = 1;
        for (const question of questionSet.questions) {
          await pool.query(`
            INSERT INTO questions (
              question_set_id, original_id, question_number, title, question_detail, detail,
              category, school, custom_instructions, difficulty, option_a, option_b, option_c,
              option_d, option_e, option_f, correct_answer, answer_details, options, allow_multiple, metadata
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
          `, [
            newQuestionSetId,
            question.id,
            questionNumber++,
            question.title,
            question.questionDetail || question.question_detail,
            question.detail,
            question.category || '',
            question.school || '',
            question.customInstructions || question.custom_instructions || '',
            question.difficulty || 'medium',
            question.optionA || question.option_a,
            question.optionB || question.option_b,
            question.optionC || question.option_c,
            question.optionD || question.option_d,
            question.optionE || question.option_e,
            question.optionF || question.option_f,
            question.correctAnswer || question.correct_answer,
            question.answerDetails || question.answer_details,
            question.options ? JSON.stringify(question.options) : null,
            question.allowMultiple || question.allow_multiple || false,
            JSON.stringify(question.metadata || {})
          ]);
        }
        
        uploadResults.push({
          original_id: questionSet.original_id || questionSet.id,
          status: 'success',
          archive_id: newQuestionSetId,
          questions_count: questionSet.questions.length
        });
        
        // Log upload
        await logAccess({
          content_type: 'question_set',
          content_id: newQuestionSetId,
          operation: 'upload',
          ...req.clientContext
        });
        
      } catch (questionSetError) {
        console.error('Question set upload error:', questionSetError);
        uploadResults.push({
          original_id: questionSet.original_id || questionSet.id,
          status: 'error',
          error: questionSetError.message
        });
      }
    }
    
    res.json({
      success: true,
      data: {
        uploaded: uploadResults.filter(r => r.status === 'success').length,
        skipped: uploadResults.filter(r => r.status === 'skipped').length,
        errors: uploadResults.filter(r => r.status === 'error').length,
        results: uploadResults
      },
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Upload question sets error:', error);
    res.status(500).json({
      error: 'Upload failed',
      message: error.message
    });
  }
});

/**
 * @route POST /api/content/upload/ai-prompts
 * @desc Upload AI prompts to archive
 * @access Private (mTLS required)
 */
router.post('/upload/ai-prompts', [
  body('prompts').isArray({ min: 1 }).withMessage('Prompts must be a non-empty array'),
  body('prompts.*.name').isString().trim().isLength({ min: 1, max: 255 }),
  body('prompts.*.prompt_type').isString().trim().isLength({ min: 1, max: 50 }),
  body('prompts.*.content').isString().trim().isLength({ min: 1 })
], async (req, res) => {
  try {
    // Validate request
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Invalid request data',
        details: errors.array()
      });
    }
    
    const { prompts } = req.body;
    const client = req.client;
    
    // Get or create environment
    let environmentId;
    try {
      const envResult = await pool.query(
        'SELECT id FROM environments WHERE name = $1',
        [client.environment]
      );
      
      if (envResult.rows.length > 0) {
        environmentId = envResult.rows[0].id;
      } else {
        const newEnvResult = await pool.query(
          'INSERT INTO environments (name, description) VALUES ($1, $2) RETURNING id',
          [client.environment, `Environment: ${client.environment}`]
        );
        environmentId = newEnvResult.rows[0].id;
      }
    } catch (envError) {
      console.error('Environment setup error:', envError);
      return res.status(500).json({
        error: 'Failed to setup environment'
      });
    }
    
    const uploadResults = [];
    
    // Process each prompt
    for (const prompt of prompts) {
      try {
        const contentHash = generateContentHash(prompt);
        
        // Check for duplicates
        const existingResult = await pool.query(
          'SELECT id FROM ai_prompts WHERE content_hash = $1 AND source_environment_id = $2',
          [contentHash, environmentId]
        );
        
        if (existingResult.rows.length > 0) {
          uploadResults.push({
            original_id: prompt.original_id || prompt.id,
            status: 'skipped',
            reason: 'duplicate',
            existing_id: existingResult.rows[0].id
          });
          continue;
        }
        
        // Insert AI prompt
        const promptInsert = await pool.query(`
          INSERT INTO ai_prompts (
            original_id, name, description, prompt_type, content, parameters,
            version, created_by, source_environment_id, content_hash, usage_count
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
          RETURNING id
        `, [
          prompt.original_id || prompt.id,
          prompt.name,
          prompt.description || '',
          prompt.prompt_type,
          prompt.content,
          JSON.stringify(prompt.parameters || {}),
          prompt.version || '1.0',
          client.name,
          environmentId,
          contentHash,
          prompt.usage_count || 0
        ]);
        
        const newPromptId = promptInsert.rows[0].id;
        
        uploadResults.push({
          original_id: prompt.original_id || prompt.id,
          status: 'success',
          archive_id: newPromptId
        });
        
        // Log upload
        await logAccess({
          content_type: 'ai_prompt',
          content_id: newPromptId,
          operation: 'upload',
          ...req.clientContext
        });
        
      } catch (promptError) {
        console.error('AI prompt upload error:', promptError);
        uploadResults.push({
          original_id: prompt.original_id || prompt.id,
          status: 'error',
          error: promptError.message
        });
      }
    }
    
    res.json({
      success: true,
      data: {
        uploaded: uploadResults.filter(r => r.status === 'success').length,
        skipped: uploadResults.filter(r => r.status === 'skipped').length,
        errors: uploadResults.filter(r => r.status === 'error').length,
        results: uploadResults
      },
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Upload AI prompts error:', error);
    res.status(500).json({
      error: 'Upload failed',
      message: error.message
    });
  }
});

module.exports = router;