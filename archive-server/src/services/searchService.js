const { pool } = require('../config/database');
const { logAccess } = require('./auditService');

/**
 * Search service for full-text search across archived content
 */
class SearchService {
  
  /**
   * Search question sets with full-text search and filters
   * @param {Object} params - Search parameters
   * @returns {Object} Search results with metadata
   */
  async searchQuestionSets(params, clientContext) {
    const {
      query = '',
      gameType = null,
      environment = null,
      category = null,
      difficulty = null,
      limit = 50,
      offset = 0,
      sortBy = 'relevance', // relevance, created_at, title, question_count
      sortOrder = 'desc'
    } = params;
    
    const startTime = Date.now();
    
    try {
      let whereClause = 'WHERE qs.active = true';
      const queryParams = [];
      let paramIndex = 1;
      
      // Add search query if provided
      if (query.trim()) {
        whereClause += ` AND qs.search_vector @@ plainto_tsquery('english', $${paramIndex})`;
        queryParams.push(query.trim());
        paramIndex++;
      }
      
      // Add filters
      if (gameType) {
        whereClause += ` AND qs.game_type = $${paramIndex}`;
        queryParams.push(gameType);
        paramIndex++;
      }
      
      if (environment) {
        whereClause += ` AND e.name = $${paramIndex}`;
        queryParams.push(environment);
        paramIndex++;
      }
      
      if (category) {
        whereClause += ` AND qs.category ILIKE $${paramIndex}`;
        queryParams.push(`%${category}%`);
        paramIndex++;
      }
      
      if (difficulty) {
        whereClause += ` AND qs.difficulty = $${paramIndex}`;
        queryParams.push(difficulty);
        paramIndex++;
      }
      
      // Build ORDER BY clause
      let orderClause;
      if (sortBy === 'relevance' && query.trim()) {
        orderClause = `ORDER BY ts_rank(qs.search_vector, plainto_tsquery('english', $1)) DESC, qs.created_at DESC`;
      } else if (sortBy === 'created_at') {
        orderClause = `ORDER BY qs.created_at ${sortOrder.toUpperCase()}`;
      } else if (sortBy === 'title') {
        orderClause = `ORDER BY qs.title ${sortOrder.toUpperCase()}`;
      } else if (sortBy === 'question_count') {
        orderClause = `ORDER BY qs.question_count ${sortOrder.toUpperCase()}`;
      } else {
        orderClause = `ORDER BY qs.created_at DESC`;
      }
      
      // Main search query
      const searchQuery = `
        SELECT 
          qs.id,
          qs.original_id,
          qs.title,
          qs.description,
          qs.game_type,
          qs.category,
          qs.school,
          qs.difficulty,
          qs.question_count,
          qs.created_by,
          qs.created_at,
          qs.updated_at,
          qs.archived_at,
          e.name as source_environment,
          e.description as environment_description,
          ${query.trim() ? `ts_rank(qs.search_vector, plainto_tsquery('english', $1)) as relevance_score,` : '0 as relevance_score,'}
          (
            SELECT COUNT(*) 
            FROM questions q 
            WHERE q.question_set_id = qs.id AND q.active = true
          ) as actual_question_count
        FROM question_sets qs
        LEFT JOIN environments e ON qs.source_environment_id = e.id
        ${whereClause}
        ${orderClause}
        LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
      `;
      
      queryParams.push(limit, offset);
      
      // Count query for pagination
      const countQuery = `
        SELECT COUNT(*) as total
        FROM question_sets qs
        LEFT JOIN environments e ON qs.source_environment_id = e.id
        ${whereClause}
      `;
      
      // Execute both queries
      const [results, countResult] = await Promise.all([
        pool.query(searchQuery, queryParams),
        pool.query(countQuery, query.trim() ? queryParams.slice(0, -2) : queryParams.slice(0, -2))
      ]);
      
      const responseTime = Date.now() - startTime;
      const totalResults = parseInt(countResult.rows[0].total);
      
      // Log search access
      await logAccess({
        content_type: 'question_set',
        content_id: null,
        operation: 'search',
        search_query: query,
        results_count: results.rows.length,
        response_time_ms: responseTime,
        ...clientContext
      });
      
      return {
        results: results.rows,
        pagination: {
          total: totalResults,
          limit,
          offset,
          pages: Math.ceil(totalResults / limit),
          currentPage: Math.floor(offset / limit) + 1
        },
        searchMetadata: {
          query: query.trim(),
          filters: { gameType, environment, category, difficulty },
          sortBy,
          sortOrder,
          responseTime
        }
      };
      
    } catch (error) {
      console.error('Search question sets error:', error);
      throw new Error(`Search failed: ${error.message}`);
    }
  }
  
  /**
   * Search AI prompts with full-text search and filters
   * @param {Object} params - Search parameters
   * @returns {Object} Search results with metadata
   */
  async searchAIPrompts(params, clientContext) {
    const {
      query = '',
      promptType = null,
      environment = null,
      version = null,
      limit = 50,
      offset = 0,
      sortBy = 'relevance',
      sortOrder = 'desc'
    } = params;
    
    const startTime = Date.now();
    
    try {
      let whereClause = 'WHERE ap.active = true';
      const queryParams = [];
      let paramIndex = 1;
      
      // Add search query if provided
      if (query.trim()) {
        whereClause += ` AND ap.search_vector @@ plainto_tsquery('english', $${paramIndex})`;
        queryParams.push(query.trim());
        paramIndex++;
      }
      
      // Add filters
      if (promptType) {
        whereClause += ` AND ap.prompt_type = $${paramIndex}`;
        queryParams.push(promptType);
        paramIndex++;
      }
      
      if (environment) {
        whereClause += ` AND e.name = $${paramIndex}`;
        queryParams.push(environment);
        paramIndex++;
      }
      
      if (version) {
        whereClause += ` AND ap.version = $${paramIndex}`;
        queryParams.push(version);
        paramIndex++;
      }
      
      // Build ORDER BY clause
      let orderClause;
      if (sortBy === 'relevance' && query.trim()) {
        orderClause = `ORDER BY ts_rank(ap.search_vector, plainto_tsquery('english', $1)) DESC, ap.created_at DESC`;
      } else if (sortBy === 'usage_count') {
        orderClause = `ORDER BY ap.usage_count ${sortOrder.toUpperCase()}`;
      } else if (sortBy === 'last_used') {
        orderClause = `ORDER BY ap.last_used_at ${sortOrder.toUpperCase()} NULLS LAST`;
      } else {
        orderClause = `ORDER BY ap.created_at DESC`;
      }
      
      // Main search query
      const searchQuery = `
        SELECT 
          ap.id,
          ap.original_id,
          ap.name,
          ap.description,
          ap.prompt_type,
          ap.version,
          ap.usage_count,
          ap.last_used_at,
          ap.created_by,
          ap.created_at,
          ap.updated_at,
          ap.archived_at,
          e.name as source_environment,
          e.description as environment_description,
          ${query.trim() ? `ts_rank(ap.search_vector, plainto_tsquery('english', $1)) as relevance_score,` : '0 as relevance_score,'}
          LENGTH(ap.content) as content_length
        FROM ai_prompts ap
        LEFT JOIN environments e ON ap.source_environment_id = e.id
        ${whereClause}
        ${orderClause}
        LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
      `;
      
      queryParams.push(limit, offset);
      
      // Count query
      const countQuery = `
        SELECT COUNT(*) as total
        FROM ai_prompts ap
        LEFT JOIN environments e ON ap.source_environment_id = e.id
        ${whereClause}
      `;
      
      // Execute queries
      const [results, countResult] = await Promise.all([
        pool.query(searchQuery, queryParams),
        pool.query(countQuery, query.trim() ? queryParams.slice(0, -2) : queryParams.slice(0, -2))
      ]);
      
      const responseTime = Date.now() - startTime;
      const totalResults = parseInt(countResult.rows[0].total);
      
      // Log search access
      await logAccess({
        content_type: 'ai_prompt',
        content_id: null,
        operation: 'search',
        search_query: query,
        results_count: results.rows.length,
        response_time_ms: responseTime,
        ...clientContext
      });
      
      return {
        results: results.rows,
        pagination: {
          total: totalResults,
          limit,
          offset,
          pages: Math.ceil(totalResults / limit),
          currentPage: Math.floor(offset / limit) + 1
        },
        searchMetadata: {
          query: query.trim(),
          filters: { promptType, environment, version },
          sortBy,
          sortOrder,
          responseTime
        }
      };
      
    } catch (error) {
      console.error('Search AI prompts error:', error);
      throw new Error(`Search failed: ${error.message}`);
    }
  }
  
  /**
   * Get search suggestions based on partial input
   * @param {string} input - Partial search input
   * @param {string} type - Content type ('question_sets' or 'ai_prompts')
   * @returns {Array} Array of suggestions
   */
  async getSearchSuggestions(input, type = 'question_sets') {
    if (!input || input.length < 2) {
      return [];
    }
    
    try {
      let query;
      if (type === 'question_sets') {
        query = `
          SELECT DISTINCT title as suggestion, 'title' as type
          FROM question_sets 
          WHERE title ILIKE $1 AND active = true
          LIMIT 5
          UNION
          SELECT DISTINCT category as suggestion, 'category' as type
          FROM question_sets 
          WHERE category ILIKE $1 AND active = true AND category IS NOT NULL
          LIMIT 5
        `;
      } else {
        query = `
          SELECT DISTINCT name as suggestion, 'name' as type
          FROM ai_prompts 
          WHERE name ILIKE $1 AND active = true
          LIMIT 5
          UNION
          SELECT DISTINCT prompt_type as suggestion, 'type' as type
          FROM ai_prompts 
          WHERE prompt_type ILIKE $1 AND active = true
          LIMIT 5
        `;
      }
      
      const result = await pool.query(query, [`%${input}%`]);
      return result.rows;
      
    } catch (error) {
      console.error('Get search suggestions error:', error);
      return [];
    }
  }
}

module.exports = new SearchService();