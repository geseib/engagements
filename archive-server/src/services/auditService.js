const { pool } = require('../config/database');

/**
 * Audit service for logging all content access and operations
 */
class AuditService {
  
  /**
   * Log content access
   * @param {Object} accessData - Access details
   */
  async logAccess(accessData) {
    const {
      content_type,
      content_id,
      operation,
      client_name,
      client_environment,
      ip_address,
      user_agent,
      search_query = null,
      results_count = null,
      response_time_ms = null
    } = accessData;
    
    try {
      await pool.query(`
        INSERT INTO content_access_log (
          content_type, content_id, operation, client_name, client_environment,
          ip_address, user_agent, search_query, results_count, response_time_ms
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      `, [
        content_type, content_id, operation, client_name, client_environment,
        ip_address, user_agent, search_query, results_count, response_time_ms
      ]);
      
    } catch (error) {
      console.error('Failed to log access:', error);
      // Don't throw error to avoid disrupting main operation
    }
  }
  
  /**
   * Get access statistics
   * @param {Object} filters - Optional filters
   * @returns {Object} Access statistics
   */
  async getAccessStats(filters = {}) {
    const {
      startDate = null,
      endDate = null,
      contentType = null,
      clientName = null,
      environment = null
    } = filters;
    
    try {
      let whereClause = 'WHERE 1=1';
      const params = [];
      let paramIndex = 1;
      
      if (startDate) {
        whereClause += ` AND accessed_at >= $${paramIndex}`;
        params.push(startDate);
        paramIndex++;
      }
      
      if (endDate) {
        whereClause += ` AND accessed_at <= $${paramIndex}`;
        params.push(endDate);
        paramIndex++;
      }
      
      if (contentType) {
        whereClause += ` AND content_type = $${paramIndex}`;
        params.push(contentType);
        paramIndex++;
      }
      
      if (clientName) {
        whereClause += ` AND client_name = $${paramIndex}`;
        params.push(clientName);
        paramIndex++;
      }
      
      if (environment) {
        whereClause += ` AND client_environment = $${paramIndex}`;
        params.push(environment);
        paramIndex++;
      }
      
      // Get overall statistics
      const statsQuery = `
        SELECT 
          COUNT(*) as total_accesses,
          COUNT(DISTINCT client_name) as unique_clients,
          COUNT(DISTINCT content_id) as unique_content_accessed,
          AVG(response_time_ms) as avg_response_time,
          MAX(response_time_ms) as max_response_time,
          MIN(accessed_at) as first_access,
          MAX(accessed_at) as last_access
        FROM content_access_log
        ${whereClause}
      `;
      
      // Get operation breakdown
      const operationsQuery = `
        SELECT 
          operation,
          COUNT(*) as count,
          COUNT(DISTINCT client_name) as unique_clients,
          AVG(response_time_ms) as avg_response_time
        FROM content_access_log
        ${whereClause}
        GROUP BY operation
        ORDER BY count DESC
      `;
      
      // Get content type breakdown
      const contentTypesQuery = `
        SELECT 
          content_type,
          COUNT(*) as count,
          COUNT(DISTINCT content_id) as unique_items,
          AVG(response_time_ms) as avg_response_time
        FROM content_access_log
        ${whereClause}
        GROUP BY content_type
        ORDER BY count DESC
      `;
      
      // Get client activity
      const clientsQuery = `
        SELECT 
          client_name,
          client_environment,
          COUNT(*) as accesses,
          COUNT(DISTINCT content_id) as unique_content,
          MAX(accessed_at) as last_access,
          AVG(response_time_ms) as avg_response_time
        FROM content_access_log
        ${whereClause}
        GROUP BY client_name, client_environment
        ORDER BY accesses DESC
        LIMIT 20
      `;
      
      // Execute all queries
      const [stats, operations, contentTypes, clients] = await Promise.all([
        pool.query(statsQuery, params),
        pool.query(operationsQuery, params),
        pool.query(contentTypesQuery, params),
        pool.query(clientsQuery, params)
      ]);
      
      return {
        overall: stats.rows[0],
        byOperation: operations.rows,
        byContentType: contentTypes.rows,
        topClients: clients.rows,
        filters
      };
      
    } catch (error) {
      console.error('Get access stats error:', error);
      throw new Error(`Failed to get access statistics: ${error.message}`);
    }
  }
  
  /**
   * Get recent access log entries
   * @param {Object} options - Query options
   * @returns {Array} Recent access entries
   */
  async getRecentAccess(options = {}) {
    const {
      limit = 100,
      offset = 0,
      contentType = null,
      operation = null,
      clientName = null
    } = options;
    
    try {
      let whereClause = 'WHERE 1=1';
      const params = [];
      let paramIndex = 1;
      
      if (contentType) {
        whereClause += ` AND content_type = $${paramIndex}`;
        params.push(contentType);
        paramIndex++;
      }
      
      if (operation) {
        whereClause += ` AND operation = $${paramIndex}`;
        params.push(operation);
        paramIndex++;
      }
      
      if (clientName) {
        whereClause += ` AND client_name = $${paramIndex}`;
        params.push(clientName);
        paramIndex++;
      }
      
      const query = `
        SELECT 
          id,
          content_type,
          content_id,
          operation,
          client_name,
          client_environment,
          ip_address,
          search_query,
          results_count,
          response_time_ms,
          accessed_at
        FROM content_access_log
        ${whereClause}
        ORDER BY accessed_at DESC
        LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
      `;
      
      params.push(limit, offset);
      
      const result = await pool.query(query, params);
      return result.rows;
      
    } catch (error) {
      console.error('Get recent access error:', error);
      throw new Error(`Failed to get recent access: ${error.message}`);
    }
  }
  
  /**
   * Clean up old audit logs
   * @param {number} daysToKeep - Number of days to retain logs
   * @returns {number} Number of deleted records
   */
  async cleanupLogs(daysToKeep = 90) {
    try {
      const result = await pool.query(`
        DELETE FROM content_access_log 
        WHERE accessed_at < NOW() - INTERVAL '${daysToKeep} days'
      `);
      
      console.log(`🧹 Cleaned up ${result.rowCount} old audit log entries`);
      return result.rowCount;
      
    } catch (error) {
      console.error('Cleanup logs error:', error);
      throw new Error(`Failed to cleanup logs: ${error.message}`);
    }
  }
}

// Export singleton instance
const auditService = new AuditService();

// Export both class and convenience function
module.exports = auditService;
module.exports.logAccess = (accessData) => auditService.logAccess(accessData);