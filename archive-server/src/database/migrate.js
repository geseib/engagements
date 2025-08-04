const fs = require('fs');
const path = require('path');
const { pool } = require('../config/database');

/**
 * Run database migrations
 */
async function migrate() {
  console.log('🔄 Starting database migration...');
  
  try {
    // Read and execute schema
    const schemaPath = path.join(__dirname, 'schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf8');
    
    await pool.query(schema);
    console.log('✅ Database schema created successfully');
    
    // Run seed data if needed
    await seedInitialData();
    
    console.log('✅ Database migration completed');
    
  } catch (error) {
    console.error('❌ Database migration failed:', error);
    throw error;
  }
}

/**
 * Seed initial data
 */
async function seedInitialData() {
  console.log('🌱 Seeding initial data...');
  
  try {
    // Insert default environments
    const environments = [
      { name: 'development', description: 'Development environment' },
      { name: 'test', description: 'Test environment' },
      { name: 'production', description: 'Production environment' },
      { name: 'staging', description: 'Staging environment' }
    ];
    
    for (const env of environments) {
      await pool.query(
        `INSERT INTO environments (name, description) 
         VALUES ($1, $2) 
         ON CONFLICT (name) DO UPDATE SET 
         description = EXCLUDED.description,
         updated_at = CURRENT_TIMESTAMP`,
        [env.name, env.description]
      );
    }
    
    // Insert default content types
    const contentTypes = [
      { name: 'question_set', description: 'Question sets for games' },
      { name: 'ai_prompt', description: 'AI prompts for content generation' }
    ];
    
    for (const type of contentTypes) {
      await pool.query(
        `INSERT INTO content_types (name, description) 
         VALUES ($1, $2) 
         ON CONFLICT (name) DO UPDATE SET 
         description = EXCLUDED.description`,
        [type.name, type.description]
      );
    }
    
    console.log('✅ Initial data seeded successfully');
    
  } catch (error) {
    console.error('❌ Failed to seed initial data:', error);
    throw error;
  }
}

/**
 * Check if migration is needed
 */
async function checkMigrationStatus() {
  try {
    const result = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'environments'
      ) as table_exists
    `);
    
    return result.rows[0].table_exists;
  } catch (error) {
    console.log('Database not initialized, migration needed');
    return false;
  }
}

// Run migration if called directly
if (require.main === module) {
  migrate()
    .then(() => {
      console.log('Migration completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Migration failed:', error);
      process.exit(1);
    });
}

module.exports = {
  migrate,
  seedInitialData,
  checkMigrationStatus
};