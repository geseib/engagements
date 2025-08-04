const express = require('express');
const https = require('https');
const helmet = require('helmet');
const morgan = require('morgan');
const cors = require('cors');
const compression = require('compression');
const rateLimit = require('express-rate-limit');

// Import configuration
const { loadCertificates } = require('./config/mtls');
const { pool } = require('./config/database');
const { migrate, checkMigrationStatus } = require('./database/migrate');

// Import middleware
const { requireMTLS, logClientAccess, addClientContext } = require('./middleware/mtls');

// Import routes
const searchRoutes = require('./routes/search');
const contentRoutes = require('./routes/content');

// Create Express app
const app = express();

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"]
    }
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  }
}));

// Compression middleware
app.use(compression());

// CORS configuration
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : ['https://localhost:3000'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Logging middleware
app.use(morgan('combined', {
  stream: {
    write: (message) => console.log(message.trim())
  }
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: process.env.NODE_ENV === 'production' ? 1000 : 10000, // Requests per window
  message: {
    error: 'Too many requests from this client',
    code: 'RATE_LIMIT_EXCEEDED'
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    // Use client certificate name for rate limiting
    return req.client?.name || req.ip;
  }
});

app.use(limiter);

// Trust proxy (for getting real client IP)
app.set('trust proxy', 1);

// mTLS authentication middleware
app.use(requireMTLS);
app.use(addClientContext);
app.use(logClientAccess);

// Health check endpoint (before authentication for load balancers)
app.get('/health', async (req, res) => {
  try {
    // Check database connection
    await pool.query('SELECT 1');
    
    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version || '1.0.0',
      environment: process.env.NODE_ENV || 'development',
      uptime: process.uptime()
    });
  } catch (error) {
    console.error('Health check failed:', error);
    res.status(503).json({
      status: 'unhealthy',
      error: 'Database connection failed',
      timestamp: new Date().toISOString()
    });
  }
});

// API routes
app.use('/api/search', searchRoutes);
app.use('/api/content', contentRoutes);

// System info endpoint
app.get('/api/info', (req, res) => {
  res.json({
    service: 'Engage2 Content Archive Server',
    version: process.env.npm_package_version || '1.0.0',
    environment: process.env.NODE_ENV || 'development',
    client: {
      name: req.client.name,
      environment: req.client.environment
    },
    timestamp: new Date().toISOString()
  });
});

// Environments endpoint
app.get('/api/environments', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        e.name,
        e.description,
        COUNT(qs.id) as question_sets_count,
        COUNT(ap.id) as ai_prompts_count
      FROM environments e
      LEFT JOIN question_sets qs ON e.id = qs.source_environment_id AND qs.active = true
      LEFT JOIN ai_prompts ap ON e.id = ap.source_environment_id AND ap.active = true
      GROUP BY e.id, e.name, e.description
      ORDER BY e.name
    `);
    
    res.json({
      success: true,
      data: result.rows,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Get environments error:', error);
    res.status(500).json({
      error: 'Failed to get environments',
      message: error.message
    });
  }
});

// Statistics endpoint
app.get('/api/stats', async (req, res) => {
  try {
    const statsQueries = await Promise.all([
      pool.query('SELECT COUNT(*) as total FROM question_sets WHERE active = true'),
      pool.query('SELECT COUNT(*) as total FROM ai_prompts WHERE active = true'),
      pool.query('SELECT COUNT(*) as total FROM environments'),
      pool.query(`
        SELECT 
          COUNT(*) as total_questions,
          AVG(CASE WHEN qs.game_type = 'trivia' THEN qs.question_count END) as avg_trivia_questions,
          AVG(CASE WHEN qs.game_type = 'poll' THEN qs.question_count END) as avg_poll_questions,
          AVG(CASE WHEN qs.game_type = 'call-and-answer' THEN qs.question_count END) as avg_scenario_questions
        FROM question_sets qs WHERE qs.active = true
      `),
      pool.query(`
        SELECT 
          qs.game_type,
          COUNT(*) as count
        FROM question_sets qs 
        WHERE qs.active = true 
        GROUP BY qs.game_type 
        ORDER BY count DESC
      `),
      pool.query(`
        SELECT 
          e.name as environment,
          COUNT(qs.id) as question_sets,
          COUNT(ap.id) as ai_prompts
        FROM environments e
        LEFT JOIN question_sets qs ON e.id = qs.source_environment_id AND qs.active = true
        LEFT JOIN ai_prompts ap ON e.id = ap.source_environment_id AND ap.active = true
        GROUP BY e.id, e.name
        ORDER BY (COUNT(qs.id) + COUNT(ap.id)) DESC
      `)
    ]);
    
    const [
      questionSetsCount,
      aiPromptsCount,
      environmentsCount,
      questionStats,
      gameTypeBreakdown,
      environmentBreakdown
    ] = statsQueries;
    
    res.json({
      success: true,
      data: {
        overview: {
          question_sets: parseInt(questionSetsCount.rows[0].total),
          ai_prompts: parseInt(aiPromptsCount.rows[0].total),
          environments: parseInt(environmentsCount.rows[0].total),
          total_questions: parseInt(questionStats.rows[0].total_questions)
        },
        averages: {
          trivia_questions_per_set: parseFloat(questionStats.rows[0].avg_trivia_questions) || 0,
          poll_questions_per_set: parseFloat(questionStats.rows[0].avg_poll_questions) || 0,
          scenario_questions_per_set: parseFloat(questionStats.rows[0].avg_scenario_questions) || 0
        },
        breakdown: {
          by_game_type: gameTypeBreakdown.rows,
          by_environment: environmentBreakdown.rows
        }
      },
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Get stats error:', error);
    res.status(500).json({
      error: 'Failed to get statistics',
      message: error.message
    });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: 'Not found',
    path: req.path,
    method: req.method
  });
});

// Graceful shutdown handling
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  server.close(() => {
    console.log('Process terminated');
    pool.end();
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully');
  server.close(() => {
    console.log('Process terminated');
    pool.end();
    process.exit(0);
  });
});

// Start server
async function startServer() {
  try {
    // Check and run migrations if needed
    const migrationNeeded = !(await checkMigrationStatus());
    if (migrationNeeded) {
      console.log('🔄 Running database migrations...');
      await migrate();
    }
    
    const port = process.env.PORT || 3443;
    
    // Load SSL certificates for mTLS
    const sslOptions = loadCertificates();
    
    let server;
    
    if (sslOptions) {
      // Start HTTPS server with mTLS
      server = https.createServer(sslOptions, app);
      server.listen(port, () => {
        console.log(`🔐 Archive server running on HTTPS port ${port} with mTLS`);
        console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
        console.log(`📊 Health check: https://localhost:${port}/health`);
      });
    } else {
      // Start HTTP server (development only)
      server = app.listen(port, () => {
        console.log(`⚠️  Archive server running on HTTP port ${port} (development mode)`);
        console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
        console.log(`📊 Health check: http://localhost:${port}/health`);
      });
    }
    
    // Store server reference for graceful shutdown
    global.server = server;
    
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

// Start the server
startServer();

module.exports = app;