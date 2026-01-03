-- ============================================
-- AUTO-CLAUDE MULTI-AGENT ORCHESTRATION SYSTEM
-- Migration: 003_auto_claude.sql
-- ============================================

-- Agent Sessions (runtime instances of agents)
CREATE TABLE IF NOT EXISTS agent_sessions (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    agent_id BIGINT UNSIGNED NULL,
    user_id BIGINT UNSIGNED NOT NULL,
    name VARCHAR(200) NOT NULL,
    status ENUM('pending', 'initializing', 'running', 'paused', 'completed', 'failed', 'cancelled') DEFAULT 'pending',
    model_id BIGINT UNSIGNED NOT NULL,
    system_prompt TEXT,
    task_specification TEXT NOT NULL,
    worktree_path TEXT,
    worktree_branch VARCHAR(255),
    terminal_slot INT UNSIGNED DEFAULT 0,
    iteration_count INT UNSIGNED DEFAULT 0,
    max_iterations INT UNSIGNED DEFAULT 50,
    timeout_seconds INT UNSIGNED DEFAULT 3600,
    parent_session_id BIGINT UNSIGNED NULL,
    config JSON,
    metrics JSON,
    started_at TIMESTAMP NULL,
    completed_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (model_id) REFERENCES ai_models(id),
    FOREIGN KEY (parent_session_id) REFERENCES agent_sessions(id) ON DELETE SET NULL,
    INDEX idx_user_id (user_id),
    INDEX idx_status (status),
    INDEX idx_terminal_slot (terminal_slot),
    INDEX idx_parent_session (parent_session_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Agent Session Logs (terminal output, actions, decisions)
CREATE TABLE IF NOT EXISTS agent_session_logs (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    session_id BIGINT UNSIGNED NOT NULL,
    log_type ENUM('stdout', 'stderr', 'action', 'decision', 'tool_call', 'tool_result', 'error', 'warning', 'info', 'qa_iteration') NOT NULL,
    content TEXT NOT NULL,
    metadata JSON,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (session_id) REFERENCES agent_sessions(id) ON DELETE CASCADE,
    INDEX idx_session_id (session_id),
    INDEX idx_log_type (log_type),
    INDEX idx_timestamp (timestamp)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Agent Task Queue (for orchestration)
CREATE TABLE IF NOT EXISTS agent_task_queue (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    session_id BIGINT UNSIGNED NOT NULL,
    task_type ENUM('execute_command', 'edit_file', 'read_file', 'git_operation', 'ai_request', 'qa_check', 'merge_resolve') NOT NULL,
    priority INT DEFAULT 0,
    payload JSON NOT NULL,
    status ENUM('pending', 'processing', 'completed', 'failed', 'skipped') DEFAULT 'pending',
    result JSON,
    error_message TEXT,
    retry_count INT UNSIGNED DEFAULT 0,
    max_retries INT UNSIGNED DEFAULT 3,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    started_at TIMESTAMP NULL,
    completed_at TIMESTAMP NULL,
    FOREIGN KEY (session_id) REFERENCES agent_sessions(id) ON DELETE CASCADE,
    INDEX idx_session_id (session_id),
    INDEX idx_status (status),
    INDEX idx_priority (priority)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Git Worktrees Management
CREATE TABLE IF NOT EXISTS git_worktrees (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    session_id BIGINT UNSIGNED NOT NULL,
    repository_path TEXT NOT NULL,
    worktree_path TEXT NOT NULL,
    branch_name VARCHAR(255) NOT NULL,
    base_branch VARCHAR(255) DEFAULT 'main',
    status ENUM('creating', 'active', 'merging', 'merged', 'conflict', 'deleted') DEFAULT 'creating',
    last_commit_sha VARCHAR(40),
    conflict_files JSON,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (session_id) REFERENCES agent_sessions(id) ON DELETE CASCADE,
    INDEX idx_session_id (session_id),
    INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Merge Conflict Resolution History
CREATE TABLE IF NOT EXISTS merge_conflict_resolutions (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    worktree_id BIGINT UNSIGNED NOT NULL,
    file_path TEXT NOT NULL,
    conflict_content TEXT,
    resolution_tier ENUM('automated', 'ai_assisted', 'manual') NOT NULL,
    resolution_model_id BIGINT UNSIGNED NULL,
    resolved_content TEXT,
    resolution_rationale TEXT,
    approved_by BIGINT UNSIGNED NULL,
    status ENUM('pending', 'resolved', 'rejected', 'escalated') DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    resolved_at TIMESTAMP NULL,
    FOREIGN KEY (worktree_id) REFERENCES git_worktrees(id) ON DELETE CASCADE,
    FOREIGN KEY (resolution_model_id) REFERENCES ai_models(id),
    FOREIGN KEY (approved_by) REFERENCES users(id),
    INDEX idx_worktree_id (worktree_id),
    INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Kanban Card Agent Assignments
CREATE TABLE IF NOT EXISTS kanban_card_agents (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    card_id BIGINT UNSIGNED NOT NULL,
    session_id BIGINT UNSIGNED NOT NULL,
    status ENUM('assigned', 'in_progress', 'completed', 'failed') DEFAULT 'assigned',
    auto_update_card BOOLEAN DEFAULT TRUE,
    assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP NULL,
    FOREIGN KEY (card_id) REFERENCES kanban_cards(id) ON DELETE CASCADE,
    FOREIGN KEY (session_id) REFERENCES agent_sessions(id) ON DELETE CASCADE,
    UNIQUE KEY uk_card_session (card_id, session_id),
    INDEX idx_card_id (card_id),
    INDEX idx_session_id (session_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Agent Templates (reusable agent configurations)
CREATE TABLE IF NOT EXISTS agent_templates (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT UNSIGNED NULL,
    name VARCHAR(200) NOT NULL,
    description TEXT,
    model_id BIGINT UNSIGNED NOT NULL,
    system_prompt TEXT NOT NULL,
    default_config JSON,
    tools JSON,
    max_iterations INT UNSIGNED DEFAULT 50,
    timeout_seconds INT UNSIGNED DEFAULT 3600,
    category ENUM('development', 'testing', 'documentation', 'research', 'automation', 'custom') DEFAULT 'custom',
    is_public BOOLEAN DEFAULT FALSE,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (model_id) REFERENCES ai_models(id),
    INDEX idx_user_id (user_id),
    INDEX idx_category (category),
    INDEX idx_is_public (is_public)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Agent Execution History (for analytics and auditing)
CREATE TABLE IF NOT EXISTS agent_execution_history (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    session_id BIGINT UNSIGNED NOT NULL,
    action_type VARCHAR(100) NOT NULL,
    action_description TEXT,
    input_data JSON,
    output_data JSON,
    tokens_input INT UNSIGNED DEFAULT 0,
    tokens_output INT UNSIGNED DEFAULT 0,
    cost_usd DECIMAL(10, 6) DEFAULT 0,
    duration_ms INT UNSIGNED DEFAULT 0,
    success BOOLEAN DEFAULT TRUE,
    error_message TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (session_id) REFERENCES agent_sessions(id) ON DELETE CASCADE,
    INDEX idx_session_id (session_id),
    INDEX idx_action_type (action_type),
    INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================
-- DEFAULT AGENT TEMPLATES
-- ============================================

-- Insert default system templates after tables are created
INSERT INTO agent_templates (user_id, name, description, model_id, system_prompt, default_config, tools, category, is_public, is_active)
SELECT
    NULL,
    'Developer Agent',
    'General-purpose development agent for coding tasks, bug fixes, and feature implementation',
    (SELECT id FROM ai_models WHERE model_id = 'claude-sonnet-4-20250514' LIMIT 1),
    'You are an expert software developer. You write clean, efficient, and well-documented code. You follow best practices and design patterns. When given a task, you:
1. Analyze the requirements carefully
2. Plan your approach before coding
3. Implement the solution step by step
4. Test your changes
5. Document your work

You have access to the file system and can read, write, and edit files. You can also run shell commands to test your changes.',
    '{"auto_commit": true, "run_tests": true, "lint_check": true}',
    '["read_file", "write_file", "edit_file", "run_command", "git_commit"]',
    'development',
    TRUE,
    TRUE
WHERE EXISTS (SELECT 1 FROM ai_models WHERE model_id = 'claude-sonnet-4-20250514');

INSERT INTO agent_templates (user_id, name, description, model_id, system_prompt, default_config, tools, category, is_public, is_active)
SELECT
    NULL,
    'QA Tester Agent',
    'Quality assurance agent for testing, validation, and bug detection',
    (SELECT id FROM ai_models WHERE model_id = 'claude-sonnet-4-20250514' LIMIT 1),
    'You are a QA testing expert. Your job is to:
1. Review code changes for potential issues
2. Write and run tests
3. Identify edge cases and bugs
4. Validate that requirements are met
5. Report findings clearly

Be thorough and methodical in your testing approach.',
    '{"strict_mode": true, "coverage_threshold": 80}',
    '["read_file", "run_command", "run_tests"]',
    'testing',
    TRUE,
    TRUE
WHERE EXISTS (SELECT 1 FROM ai_models WHERE model_id = 'claude-sonnet-4-20250514');

INSERT INTO agent_templates (user_id, name, description, model_id, system_prompt, default_config, tools, category, is_public, is_active)
SELECT
    NULL,
    'Documentation Agent',
    'Agent specialized in writing and updating documentation',
    (SELECT id FROM ai_models WHERE model_id = 'claude-sonnet-4-20250514' LIMIT 1),
    'You are a technical writer. Your job is to:
1. Read and understand code
2. Write clear, comprehensive documentation
3. Create helpful README files
4. Document APIs and interfaces
5. Keep documentation up to date

Write for both beginners and experienced developers.',
    '{"format": "markdown", "include_examples": true}',
    '["read_file", "write_file", "edit_file"]',
    'documentation',
    TRUE,
    TRUE
WHERE EXISTS (SELECT 1 FROM ai_models WHERE model_id = 'claude-sonnet-4-20250514');

INSERT INTO agent_templates (user_id, name, description, model_id, system_prompt, default_config, tools, category, is_public, is_active)
SELECT
    NULL,
    'Research Agent',
    'Agent for researching codebases, analyzing patterns, and providing insights',
    (SELECT id FROM ai_models WHERE model_id = 'claude-sonnet-4-20250514' LIMIT 1),
    'You are a code research expert. Your job is to:
1. Explore and understand codebases
2. Identify patterns and anti-patterns
3. Analyze dependencies and architecture
4. Provide actionable insights
5. Answer questions about the code

Be thorough in your exploration and clear in your explanations.',
    '{"deep_analysis": true}',
    '["read_file", "run_command", "search_code"]',
    'research',
    TRUE,
    TRUE
WHERE EXISTS (SELECT 1 FROM ai_models WHERE model_id = 'claude-sonnet-4-20250514');

-- ============================================
-- VIEWS FOR DASHBOARD
-- ============================================

CREATE OR REPLACE VIEW v_agent_dashboard AS
SELECT
    COUNT(*) as total_sessions,
    SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) as running_sessions,
    SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed_sessions,
    SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed_sessions,
    SUM(CASE WHEN status = 'paused' THEN 1 ELSE 0 END) as paused_sessions,
    SUM(iteration_count) as total_iterations,
    AVG(iteration_count) as avg_iterations
FROM agent_sessions
WHERE created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY);

CREATE OR REPLACE VIEW v_terminal_slots AS
SELECT
    terminal_slot,
    id as session_id,
    name as session_name,
    status,
    iteration_count,
    started_at
FROM agent_sessions
WHERE status IN ('running', 'paused', 'initializing')
ORDER BY terminal_slot;
