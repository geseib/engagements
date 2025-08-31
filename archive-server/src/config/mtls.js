const fs = require('fs');
const path = require('path');

const mtlsConfig = {
  development: {
    // For development, use self-signed certificates
    serverKey: process.env.MTLS_SERVER_KEY || path.join(__dirname, '../../certs/dev-server-key.pem'),
    serverCert: process.env.MTLS_SERVER_CERT || path.join(__dirname, '../../certs/dev-server-cert.pem'),
    caCert: process.env.MTLS_CA_CERT || path.join(__dirname, '../../certs/dev-ca-cert.pem'),
    requestCert: true,
    rejectUnauthorized: false, // More lenient for development
    allowedClients: [
      'engage2-dev-client',
      'engage2-admin-client'
    ]
  },
  
  test: {
    serverKey: process.env.MTLS_SERVER_KEY || path.join(__dirname, '../../certs/test-server-key.pem'),
    serverCert: process.env.MTLS_SERVER_CERT || path.join(__dirname, '../../certs/test-server-cert.pem'),
    caCert: process.env.MTLS_CA_CERT || path.join(__dirname, '../../certs/test-ca-cert.pem'),
    requestCert: true,
    rejectUnauthorized: true,
    allowedClients: [
      'engage2-test-client',
      'engage2-admin-client'
    ]
  },
  
  production: {
    serverKey: process.env.MTLS_SERVER_KEY,
    serverCert: process.env.MTLS_SERVER_CERT,
    caCert: process.env.MTLS_CA_CERT,
    requestCert: true,
    rejectUnauthorized: true,
    allowedClients: process.env.MTLS_ALLOWED_CLIENTS ? 
      process.env.MTLS_ALLOWED_CLIENTS.split(',') : 
      ['engage2-prod-client', 'engage2-admin-client']
  }
};

const environment = process.env.NODE_ENV || 'development';
const config = mtlsConfig[environment];

if (!config) {
  throw new Error(`mTLS configuration not found for environment: ${environment}`);
}

/**
 * Load SSL certificates for mTLS
 * @returns {Object} SSL options for HTTPS server
 */
function loadCertificates() {
  try {
    const sslOptions = {
      key: fs.readFileSync(config.serverKey),
      cert: fs.readFileSync(config.serverCert),
      ca: fs.readFileSync(config.caCert),
      requestCert: config.requestCert,
      rejectUnauthorized: config.rejectUnauthorized
    };
    
    console.log(`✅ Loaded mTLS certificates for ${environment} environment`);
    return sslOptions;
    
  } catch (error) {
    console.error('❌ Failed to load mTLS certificates:', error.message);
    
    if (environment === 'production') {
      throw error;
    } else {
      console.warn('⚠️  Running without mTLS in development mode');
      return null;
    }
  }
}

/**
 * Validate client certificate
 * @param {Object} req - Express request object
 * @returns {Object} Client validation result
 */
function validateClientCertificate(req) {
  if (!req.socket.authorized) {
    return {
      valid: false,
      error: 'Client certificate not authorized',
      details: req.socket.authorizationError
    };
  }
  
  const clientCert = req.socket.getPeerCertificate();
  
  if (!clientCert || !clientCert.subject) {
    return {
      valid: false,
      error: 'No client certificate provided'
    };
  }
  
  const clientName = clientCert.subject.CN;
  
  if (!config.allowedClients.includes(clientName)) {
    return {
      valid: false,
      error: `Client '${clientName}' not in allowed clients list`,
      allowedClients: config.allowedClients
    };
  }
  
  return {
    valid: true,
    clientName,
    certificate: clientCert,
    environment: determineClientEnvironment(clientName)
  };
}

/**
 * Determine client environment from certificate name
 * @param {string} clientName - Client certificate common name
 * @returns {string} Environment name
 */
function determineClientEnvironment(clientName) {
  if (clientName.includes('dev')) return 'development';
  if (clientName.includes('test')) return 'test';
  if (clientName.includes('prod')) return 'production';
  if (clientName.includes('admin')) return 'admin';
  return 'unknown';
}

module.exports = {
  config,
  loadCertificates,
  validateClientCertificate,
  determineClientEnvironment
};