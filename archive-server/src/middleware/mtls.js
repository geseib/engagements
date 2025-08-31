const { validateClientCertificate } = require('../config/mtls');

/**
 * Middleware to validate mTLS client certificates
 */
function requireMTLS(req, res, next) {
  // Skip mTLS validation in development if not configured
  if (process.env.NODE_ENV === 'development' && !req.socket.encrypted) {
    console.warn('⚠️  mTLS validation skipped in development mode');
    req.client = {
      name: 'dev-client',
      environment: 'development',
      certificate: null
    };
    return next();
  }
  
  // Validate client certificate
  const validation = validateClientCertificate(req);
  
  if (!validation.valid) {
    console.error('❌ mTLS validation failed:', validation.error);
    return res.status(401).json({
      error: 'Client certificate validation failed',
      details: validation.error,
      code: 'MTLS_VALIDATION_FAILED'
    });
  }
  
  // Add client info to request
  req.client = {
    name: validation.clientName,
    environment: validation.environment,
    certificate: validation.certificate
  };
  
  console.log(`✅ mTLS validation successful for client: ${validation.clientName} (${validation.environment})`);
  next();
}

/**
 * Middleware to log client access
 */
function logClientAccess(req, res, next) {
  const startTime = Date.now();
  
  // Store original end function
  const originalEnd = res.end;
  
  // Override end function to log response time
  res.end = function(...args) {
    const responseTime = Date.now() - startTime;
    
    // Log access details
    console.log(`📊 Client Access: ${req.client?.name || 'unknown'} ${req.method} ${req.path} - ${res.statusCode} (${responseTime}ms)`);
    
    // Call original end function
    originalEnd.apply(this, args);
  };
  
  next();
}

/**
 * Middleware to restrict access by environment
 */
function restrictByEnvironment(allowedEnvironments = []) {
  return (req, res, next) => {
    if (!req.client || !req.client.environment) {
      return res.status(401).json({
        error: 'Client environment not determined',
        code: 'ENVIRONMENT_UNKNOWN'
      });
    }
    
    // Admin clients can access any environment
    if (req.client.environment === 'admin') {
      return next();
    }
    
    if (!allowedEnvironments.includes(req.client.environment)) {
      return res.status(403).json({
        error: `Access denied for environment: ${req.client.environment}`,
        allowedEnvironments,
        code: 'ENVIRONMENT_RESTRICTED'
      });
    }
    
    next();
  };
}

/**
 * Middleware to add client info to database queries
 */
function addClientContext(req, res, next) {
  req.clientContext = {
    client_name: req.client?.name || 'unknown',
    client_environment: req.client?.environment || 'unknown',
    ip_address: req.ip || req.connection.remoteAddress,
    user_agent: req.get('User-Agent') || 'unknown'
  };
  
  next();
}

module.exports = {
  requireMTLS,
  logClientAccess,
  restrictByEnvironment,
  addClientContext
};