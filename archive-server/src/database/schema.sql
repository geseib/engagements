-- Content Archive Database Schema
-- PostgreSQL 14+ with full-text search extensions

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- Environments table
CREATE TABLE IF NOT EXISTS environments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(50) UNIQUE NOT NULL,
  description TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Content types table
CREATE TABLE IF NOT EXISTS content_types (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(50) UNIQUE NOT NULL,
  description TEXT,
  schema_version VARCHAR(10) DEFAULT '1.0',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Question sets table
CREATE TABLE IF NOT EXISTS question_sets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  original_id VARCHAR(255), -- Original ID from source system
  title VARCHAR(500) NOT NULL,
  description TEXT,
  game_type VARCHAR(50) NOT NULL, -- trivia, poll, call-and-answer, etc.
  category VARCHAR(255),
  school VARCHAR(255),
  custom_instructions TEXT,
  ai_context_instructions TEXT,
  difficulty VARCHAR(20),
  question_count INTEGER DEFAULT 0,
  active BOOLEAN DEFAULT true,
  created_by VARCHAR(255),
  source_environment_id UUID REFERENCES environments(id),
  content_hash VARCHAR(64), -- SHA-256 hash for deduplication
  metadata JSONB DEFAULT '{}',
  search_vector tsvector, -- Full-text search vector
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  archived_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Questions table (for individual questions within sets)
CREATE TABLE IF NOT EXISTS questions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  question_set_id UUID REFERENCES question_sets(id) ON DELETE CASCADE,
  original_id VARCHAR(255), -- Original ID from source system
  question_number INTEGER,
  title VARCHAR(500) NOT NULL,
  question_detail TEXT, -- For trivia
  detail TEXT, -- For call-and-answer
  category VARCHAR(255),
  school VARCHAR(255),
  custom_instructions TEXT,
  difficulty VARCHAR(20),
  
  -- Trivia-specific fields
  option_a TEXT,
  option_b TEXT,
  option_c TEXT,
  option_d TEXT,
  option_e TEXT,
  option_f TEXT,
  correct_answer VARCHAR(50), -- OptionA, OptionB, etc.
  answer_details TEXT,
  
  -- Poll-specific fields
  options JSONB, -- Array of poll options
  allow_multiple BOOLEAN DEFAULT false,
  
  active BOOLEAN DEFAULT true,
  metadata JSONB DEFAULT '{}',
  search_vector tsvector,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- AI Prompts table
CREATE TABLE IF NOT EXISTS ai_prompts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  original_id VARCHAR(255), -- Original ID from source system
  name VARCHAR(255) NOT NULL,
  description TEXT,
  prompt_type VARCHAR(50) NOT NULL, -- trivia, polls, scenarios, etc.
  content TEXT NOT NULL,
  parameters JSONB DEFAULT '{}',
  version VARCHAR(10) DEFAULT '1.0',
  active BOOLEAN DEFAULT true,
  created_by VARCHAR(255),
  source_environment_id UUID REFERENCES environments(id),
  content_hash VARCHAR(64),
  usage_count INTEGER DEFAULT 0,
  last_used_at TIMESTAMP WITH TIME ZONE,
  search_vector tsvector,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  archived_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Sync operations log
CREATE TABLE IF NOT EXISTS sync_operations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  operation_type VARCHAR(50) NOT NULL, -- upload, download, sync
  source_environment_id UUID REFERENCES environments(id),
  target_environment_id UUID REFERENCES environments(id),
  content_type VARCHAR(50) NOT NULL,
  content_ids JSONB, -- Array of content IDs involved
  status VARCHAR(20) DEFAULT 'pending', -- pending, in_progress, completed, failed
  progress_percent INTEGER DEFAULT 0,
  items_total INTEGER DEFAULT 0,
  items_processed INTEGER DEFAULT 0,
  items_succeeded INTEGER DEFAULT 0,
  items_failed INTEGER DEFAULT 0,
  error_details TEXT,
  initiated_by VARCHAR(255),
  started_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP WITH TIME ZONE,
  metadata JSONB DEFAULT '{}'
);

-- Content access log (audit trail)
CREATE TABLE IF NOT EXISTS content_access_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  content_type VARCHAR(50) NOT NULL,
  content_id UUID NOT NULL,
  operation VARCHAR(50) NOT NULL, -- search, view, download, upload, delete
  client_name VARCHAR(255),
  client_environment VARCHAR(50),
  ip_address INET,
  user_agent TEXT,
  search_query TEXT, -- For search operations
  results_count INTEGER, -- For search operations
  accessed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  response_time_ms INTEGER
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_question_sets_search ON question_sets USING gin(search_vector);
CREATE INDEX IF NOT EXISTS idx_question_sets_environment ON question_sets(source_environment_id);
CREATE INDEX IF NOT EXISTS idx_question_sets_game_type ON question_sets(game_type);
CREATE INDEX IF NOT EXISTS idx_question_sets_hash ON question_sets(content_hash);
CREATE INDEX IF NOT EXISTS idx_question_sets_created ON question_sets(created_at);

CREATE INDEX IF NOT EXISTS idx_questions_set_id ON questions(question_set_id);
CREATE INDEX IF NOT EXISTS idx_questions_search ON questions USING gin(search_vector);
CREATE INDEX IF NOT EXISTS idx_questions_category ON questions(category);

CREATE INDEX IF NOT EXISTS idx_ai_prompts_search ON ai_prompts USING gin(search_vector);
CREATE INDEX IF NOT EXISTS idx_ai_prompts_type ON ai_prompts(prompt_type);
CREATE INDEX IF NOT EXISTS idx_ai_prompts_environment ON ai_prompts(source_environment_id);
CREATE INDEX IF NOT EXISTS idx_ai_prompts_hash ON ai_prompts(content_hash);

CREATE INDEX IF NOT EXISTS idx_sync_operations_status ON sync_operations(status);
CREATE INDEX IF NOT EXISTS idx_sync_operations_started ON sync_operations(started_at);

CREATE INDEX IF NOT EXISTS idx_access_log_content ON content_access_log(content_type, content_id);
CREATE INDEX IF NOT EXISTS idx_access_log_accessed ON content_access_log(accessed_at);
CREATE INDEX IF NOT EXISTS idx_access_log_client ON content_access_log(client_name);

-- Trigram indexes for fuzzy text search
CREATE INDEX IF NOT EXISTS idx_question_sets_title_trgm ON question_sets USING gin(title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_questions_title_trgm ON questions USING gin(title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_ai_prompts_name_trgm ON ai_prompts USING gin(name gin_trgm_ops);

-- Functions for updating search vectors
CREATE OR REPLACE FUNCTION update_question_set_search_vector()
RETURNS TRIGGER AS $$
BEGIN
  NEW.search_vector := 
    setweight(to_tsvector('english', COALESCE(NEW.title, '')), 'A') ||
    setweight(to_tsvector('english', COALESCE(NEW.description, '')), 'B') ||
    setweight(to_tsvector('english', COALESCE(NEW.category, '')), 'C') ||
    setweight(to_tsvector('english', COALESCE(NEW.custom_instructions, '')), 'D');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION update_question_search_vector()
RETURNS TRIGGER AS $$
BEGIN
  NEW.search_vector := 
    setweight(to_tsvector('english', COALESCE(NEW.title, '')), 'A') ||
    setweight(to_tsvector('english', COALESCE(NEW.question_detail, '')), 'A') ||
    setweight(to_tsvector('english', COALESCE(NEW.detail, '')), 'A') ||
    setweight(to_tsvector('english', COALESCE(NEW.category, '')), 'B') ||
    setweight(to_tsvector('english', COALESCE(NEW.answer_details, '')), 'C') ||
    setweight(to_tsvector('english', COALESCE(NEW.option_a, '')), 'D') ||
    setweight(to_tsvector('english', COALESCE(NEW.option_b, '')), 'D') ||
    setweight(to_tsvector('english', COALESCE(NEW.option_c, '')), 'D') ||
    setweight(to_tsvector('english', COALESCE(NEW.option_d, '')), 'D');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION update_ai_prompt_search_vector()
RETURNS TRIGGER AS $$
BEGIN
  NEW.search_vector := 
    setweight(to_tsvector('english', COALESCE(NEW.name, '')), 'A') ||
    setweight(to_tsvector('english', COALESCE(NEW.description, '')), 'B') ||
    setweight(to_tsvector('english', COALESCE(NEW.content, '')), 'C') ||
    setweight(to_tsvector('english', COALESCE(NEW.prompt_type, '')), 'D');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create triggers
DROP TRIGGER IF EXISTS trigger_question_set_search_vector ON question_sets;
CREATE TRIGGER trigger_question_set_search_vector
  BEFORE INSERT OR UPDATE ON question_sets
  FOR EACH ROW EXECUTE FUNCTION update_question_set_search_vector();

DROP TRIGGER IF EXISTS trigger_question_search_vector ON questions;
CREATE TRIGGER trigger_question_search_vector
  BEFORE INSERT OR UPDATE ON questions
  FOR EACH ROW EXECUTE FUNCTION update_question_search_vector();

DROP TRIGGER IF EXISTS trigger_ai_prompt_search_vector ON ai_prompts;
CREATE TRIGGER trigger_ai_prompt_search_vector
  BEFORE INSERT OR UPDATE ON ai_prompts
  FOR EACH ROW EXECUTE FUNCTION update_ai_prompt_search_vector();

-- Update timestamp triggers
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_question_sets_updated_at
  BEFORE UPDATE ON question_sets
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trigger_questions_updated_at
  BEFORE UPDATE ON questions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trigger_ai_prompts_updated_at
  BEFORE UPDATE ON ai_prompts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trigger_environments_updated_at
  BEFORE UPDATE ON environments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();