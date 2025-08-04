const express = require('express');
const { body, query, validationResult } = require('express-validator');
const searchService = require('../services/searchService');
const { logAccess } = require('../services/auditService');

const router = express.Router();

/**
 * @route GET /api/search/question-sets
 * @desc Search question sets with full-text search and filters
 * @access Private (mTLS required)
 */
router.get('/question-sets', [
  query('q').optional().isString().trim().isLength({ max: 500 }),
  query('gameType').optional().isIn(['trivia', 'poll', 'call-and-answer']),
  query('environment').optional().isString().trim().isLength({ max: 50 }),
  query('category').optional().isString().trim().isLength({ max: 255 }),
  query('difficulty').optional().isIn(['easy', 'medium', 'hard']),
  query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
  query('offset').optional().isInt({ min: 0 }).toInt(),
  query('sortBy').optional().isIn(['relevance', 'created_at', 'title', 'question_count']),
  query('sortOrder').optional().isIn(['asc', 'desc'])
], async (req, res) => {
  try {
    // Validate request
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Invalid query parameters',
        details: errors.array()
      });
    }
    
    const searchParams = {
      query: req.query.q || '',
      gameType: req.query.gameType,
      environment: req.query.environment,
      category: req.query.category,
      difficulty: req.query.difficulty,
      limit: req.query.limit || 50,
      offset: req.query.offset || 0,
      sortBy: req.query.sortBy || 'relevance',
      sortOrder: req.query.sortOrder || 'desc'
    };
    
    const results = await searchService.searchQuestionSets(searchParams, req.clientContext);
    
    res.json({
      success: true,
      data: results,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Search question sets error:', error);
    res.status(500).json({
      error: 'Search failed',
      message: error.message
    });
  }
});

/**
 * @route GET /api/search/ai-prompts
 * @desc Search AI prompts with full-text search and filters
 * @access Private (mTLS required)
 */
router.get('/ai-prompts', [
  query('q').optional().isString().trim().isLength({ max: 500 }),
  query('promptType').optional().isString().trim().isLength({ max: 50 }),
  query('environment').optional().isString().trim().isLength({ max: 50 }),
  query('version').optional().isString().trim().isLength({ max: 10 }),
  query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
  query('offset').optional().isInt({ min: 0 }).toInt(),
  query('sortBy').optional().isIn(['relevance', 'created_at', 'usage_count', 'last_used']),
  query('sortOrder').optional().isIn(['asc', 'desc'])
], async (req, res) => {
  try {
    // Validate request
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Invalid query parameters',
        details: errors.array()
      });
    }
    
    const searchParams = {
      query: req.query.q || '',
      promptType: req.query.promptType,
      environment: req.query.environment,
      version: req.query.version,
      limit: req.query.limit || 50,
      offset: req.query.offset || 0,
      sortBy: req.query.sortBy || 'relevance',
      sortOrder: req.query.sortOrder || 'desc'
    };
    
    const results = await searchService.searchAIPrompts(searchParams, req.clientContext);
    
    res.json({
      success: true,
      data: results,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Search AI prompts error:', error);
    res.status(500).json({
      error: 'Search failed',
      message: error.message
    });
  }
});

/**
 * @route GET /api/search/suggestions
 * @desc Get search suggestions for autocomplete
 * @access Private (mTLS required)
 */
router.get('/suggestions', [
  query('input').isString().trim().isLength({ min: 2, max: 100 }),
  query('type').optional().isIn(['question_sets', 'ai_prompts'])
], async (req, res) => {
  try {
    // Validate request
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Invalid query parameters',
        details: errors.array()
      });
    }
    
    const suggestions = await searchService.getSearchSuggestions(
      req.query.input,
      req.query.type || 'question_sets'
    );
    
    res.json({
      success: true,
      data: suggestions,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Get suggestions error:', error);
    res.status(500).json({
      error: 'Failed to get suggestions',
      message: error.message
    });
  }
});

/**
 * @route GET /api/search/stats
 * @desc Get search statistics and popular queries
 * @access Private (mTLS required)
 */
router.get('/stats', async (req, res) => {
  try {
    // This would be implemented to show search analytics
    // For now, return basic structure
    res.json({
      success: true,
      data: {
        totalSearches: 0,
        popularQueries: [],
        searchTrends: [],
        responseTimeMetrics: {
          average: 0,
          p95: 0,
          p99: 0
        }
      },
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Get search stats error:', error);
    res.status(500).json({
      error: 'Failed to get search statistics',
      message: error.message
    });
  }
});

module.exports = router;