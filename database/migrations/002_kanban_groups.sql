-- Migration: Add Kanban permissions to groups and create test groups/users
-- Run this after init.sql

USE enterprise_ai_chat;

-- ============================================
-- ADD KANBAN PERMISSION TO GROUPS
-- ============================================

-- Add kanban_enabled column to groups table
ALTER TABLE `groups` ADD COLUMN IF NOT EXISTS kanban_enabled BOOLEAN DEFAULT FALSE;

-- Enable Kanban for existing groups (admin access)
UPDATE `groups` SET kanban_enabled = TRUE WHERE name IN ('Default', 'Premium');

-- ============================================
-- CREATE 3 TEST GROUPS WITH KANBAN ACCESS
-- ============================================

-- 1. Developers Group - Full Kanban access
INSERT INTO `groups` (name, description, max_tokens_per_month, allowed_models, is_active, kanban_enabled) VALUES
('Developers', 'Development team with full Kanban access for task management', 10000000,
 '["gpt-4o", "claude-sonnet-4-20250514", "codellama", "deepseek-coder-v2"]', TRUE, TRUE)
ON DUPLICATE KEY UPDATE kanban_enabled = TRUE;

-- 2. Project Managers Group - Full Kanban access + extended limits
INSERT INTO `groups` (name, description, max_tokens_per_month, allowed_models, is_active, kanban_enabled) VALUES
('Project Managers', 'Project managers with full Kanban access and extended token limits', 15000000,
 '["gpt-4o", "gpt-4-turbo", "claude-sonnet-4-20250514", "claude-3-opus-20240229", "gemini-2.0-flash"]', TRUE, TRUE)
ON DUPLICATE KEY UPDATE kanban_enabled = TRUE;

-- 3. QA Team Group - Limited Kanban access (can view and update status, no create)
INSERT INTO `groups` (name, description, max_tokens_per_month, allowed_models, is_active, kanban_enabled) VALUES
('QA Team', 'Quality Assurance team with Kanban view and status update access', 5000000,
 '["gpt-4o-mini", "gpt-3.5-turbo", "claude-3-haiku-20240307"]', TRUE, TRUE)
ON DUPLICATE KEY UPDATE kanban_enabled = TRUE;

-- ============================================
-- CREATE TEST USERS FOR EACH GROUP
-- ============================================

-- Password hash for 'test123' (bcrypt with 10 rounds)
-- $2b$10$7dKPQqXWZRY5.KzJhHtNFekXqtT5QxIEBPr.Mn3yWf1qMKrKQdZ5e

-- Developers Group Users
INSERT INTO users (email, password_hash, name, role, is_active) VALUES
('dev1@enterprise.local', '$2b$10$ytKtSoYrw9giANrh/AVfCOGPDxWmVhMKY0z4MJyUsbOggyGXch74a', 'Marco Developer', 'user', TRUE),
('dev2@enterprise.local', '$2b$10$ytKtSoYrw9giANrh/AVfCOGPDxWmVhMKY0z4MJyUsbOggyGXch74a', 'Sara Developer', 'user', TRUE),
('dev.lead@enterprise.local', '$2b$10$ytKtSoYrw9giANrh/AVfCOGPDxWmVhMKY0z4MJyUsbOggyGXch74a', 'Alessandro Dev Lead', 'user', TRUE)
ON DUPLICATE KEY UPDATE name = VALUES(name);

-- Project Managers Group Users
INSERT INTO users (email, password_hash, name, role, is_active) VALUES
('pm1@enterprise.local', '$2b$10$ytKtSoYrw9giANrh/AVfCOGPDxWmVhMKY0z4MJyUsbOggyGXch74a', 'Giulia PM', 'user', TRUE),
('pm2@enterprise.local', '$2b$10$ytKtSoYrw9giANrh/AVfCOGPDxWmVhMKY0z4MJyUsbOggyGXch74a', 'Francesco PM', 'user', TRUE)
ON DUPLICATE KEY UPDATE name = VALUES(name);

-- QA Team Users
INSERT INTO users (email, password_hash, name, role, is_active) VALUES
('qa1@enterprise.local', '$2b$10$ytKtSoYrw9giANrh/AVfCOGPDxWmVhMKY0z4MJyUsbOggyGXch74a', 'Chiara QA', 'user', TRUE),
('qa2@enterprise.local', '$2b$10$ytKtSoYrw9giANrh/AVfCOGPDxWmVhMKY0z4MJyUsbOggyGXch74a', 'Luca QA', 'user', TRUE),
('qa.lead@enterprise.local', '$2b$10$ytKtSoYrw9giANrh/AVfCOGPDxWmVhMKY0z4MJyUsbOggyGXch74a', 'Elena QA Lead', 'user', TRUE)
ON DUPLICATE KEY UPDATE name = VALUES(name);

-- Assign users to their respective groups
-- First, get the group IDs
SET @dev_group_id = (SELECT id FROM `groups` WHERE name = 'Developers' LIMIT 1);
SET @pm_group_id = (SELECT id FROM `groups` WHERE name = 'Project Managers' LIMIT 1);
SET @qa_group_id = (SELECT id FROM `groups` WHERE name = 'QA Team' LIMIT 1);

-- Assign Developers to Developers group
INSERT IGNORE INTO user_groups (user_id, group_id)
SELECT u.id, @dev_group_id FROM users u
WHERE u.email IN ('dev1@enterprise.local', 'dev2@enterprise.local', 'dev.lead@enterprise.local');

-- Assign Project Managers to PM group
INSERT IGNORE INTO user_groups (user_id, group_id)
SELECT u.id, @pm_group_id FROM users u
WHERE u.email IN ('pm1@enterprise.local', 'pm2@enterprise.local');

-- Assign QA Team to QA group
INSERT IGNORE INTO user_groups (user_id, group_id)
SELECT u.id, @qa_group_id FROM users u
WHERE u.email IN ('qa1@enterprise.local', 'qa2@enterprise.local', 'qa.lead@enterprise.local');

-- ============================================
-- CREATE TEST PROJECT WITH SAMPLE TASKS
-- ============================================

-- Create a test project
INSERT INTO projects (name, description, owner_id, color, is_public) VALUES
('Enterprise AI Integration', 'Main project for Enterprise AI Chat integration and development', 1, '#3B82F6', TRUE)
ON DUPLICATE KEY UPDATE description = VALUES(description);

SET @project_id = (SELECT id FROM projects WHERE name = 'Enterprise AI Integration' LIMIT 1);

-- Add project members (all test users can access)
INSERT IGNORE INTO project_members (project_id, user_id, role)
SELECT @project_id, u.id,
  CASE
    WHEN u.email LIKE '%lead%' OR u.email LIKE 'pm%' THEN 'admin'
    ELSE 'member'
  END
FROM users u
WHERE u.email LIKE '%@enterprise.local' AND u.email != 'admin@enterprise.local';

-- Create a default Kanban board for the project
INSERT INTO kanban_boards (project_id, name, description, is_default) VALUES
(@project_id, 'Development Board', 'Main development workflow', TRUE)
ON DUPLICATE KEY UPDATE description = VALUES(description);

SET @board_id = (SELECT id FROM kanban_boards WHERE project_id = @project_id LIMIT 1);

-- Create standard Kanban columns
INSERT INTO kanban_columns (board_id, name, color, wip_limit, sort_order) VALUES
(@board_id, 'Backlog', '#6B7280', 0, 0),
(@board_id, 'To Do', '#3B82F6', 5, 1),
(@board_id, 'In Progress', '#F59E0B', 3, 2),
(@board_id, 'Review', '#8B5CF6', 2, 3),
(@board_id, 'Done', '#10B981', 0, 4)
ON DUPLICATE KEY UPDATE color = VALUES(color);

-- Get column IDs
SET @backlog_id = (SELECT id FROM kanban_columns WHERE board_id = @board_id AND name = 'Backlog' LIMIT 1);
SET @todo_id = (SELECT id FROM kanban_columns WHERE board_id = @board_id AND name = 'To Do' LIMIT 1);
SET @progress_id = (SELECT id FROM kanban_columns WHERE board_id = @board_id AND name = 'In Progress' LIMIT 1);
SET @review_id = (SELECT id FROM kanban_columns WHERE board_id = @board_id AND name = 'Review' LIMIT 1);
SET @done_id = (SELECT id FROM kanban_columns WHERE board_id = @board_id AND name = 'Done' LIMIT 1);

-- Create sample tasks (real development tasks, not demo)
INSERT INTO kanban_cards (column_id, title, description, priority, created_by, assigned_to, due_date, sort_order) VALUES
-- Backlog tasks
(@backlog_id, 'Implement OAuth2 SSO integration', 'Add support for enterprise SSO via OAuth2/OIDC providers (Azure AD, Okta, etc.)', 'high', 1, NULL, DATE_ADD(CURDATE(), INTERVAL 30 DAY), 0),
(@backlog_id, 'Add dark mode support', 'Implement system-wide dark mode toggle with persistent user preference', 'medium', 1, NULL, NULL, 1),
(@backlog_id, 'Mobile responsive improvements', 'Improve mobile experience for the admin console', 'low', 1, NULL, NULL, 2),

-- To Do tasks
(@todo_id, 'Fix Kanban drag and drop on Firefox', 'Drag and drop has issues on Firefox browser - investigate and fix', 'high', 1,
 (SELECT id FROM users WHERE email = 'dev1@enterprise.local' LIMIT 1), DATE_ADD(CURDATE(), INTERVAL 7 DAY), 0),
(@todo_id, 'Add task time tracking', 'Implement time tracking feature for Kanban cards with start/stop timer', 'medium', 1,
 (SELECT id FROM users WHERE email = 'dev2@enterprise.local' LIMIT 1), DATE_ADD(CURDATE(), INTERVAL 14 DAY), 1),

-- In Progress tasks
(@progress_id, 'VS Code Extension Kanban integration', 'Complete Kanban board integration in the VS Code extension', 'urgent', 1,
 (SELECT id FROM users WHERE email = 'dev.lead@enterprise.local' LIMIT 1), DATE_ADD(CURDATE(), INTERVAL 3 DAY), 0),
(@progress_id, 'API rate limiting implementation', 'Add per-user and per-group rate limiting for API calls', 'high', 1,
 (SELECT id FROM users WHERE email = 'dev1@enterprise.local' LIMIT 1), DATE_ADD(CURDATE(), INTERVAL 5 DAY), 1),

-- Review tasks
(@review_id, 'User groups permission system', 'Review and test the new group-based permission system for Kanban access', 'high', 1,
 (SELECT id FROM users WHERE email = 'qa.lead@enterprise.local' LIMIT 1), DATE_ADD(CURDATE(), INTERVAL 2 DAY), 0),

-- Done tasks
(@done_id, 'Initial Kanban board implementation', 'Basic Kanban board with columns and cards', 'high', 1, 1, CURDATE(), 0),
(@done_id, 'Login/Authentication system', 'JWT-based authentication with refresh tokens', 'urgent', 1, 1, DATE_SUB(CURDATE(), INTERVAL 7 DAY), 1)
ON DUPLICATE KEY UPDATE title = VALUES(title);

-- Create project labels for categorization
INSERT INTO kanban_labels (project_id, name, color) VALUES
(@project_id, 'bug', '#EF4444'),
(@project_id, 'feature', '#3B82F6'),
(@project_id, 'enhancement', '#8B5CF6'),
(@project_id, 'documentation', '#10B981'),
(@project_id, 'priority', '#F59E0B'),
(@project_id, 'blocked', '#6B7280')
ON DUPLICATE KEY UPDATE color = VALUES(color);

-- ============================================
-- VERIFY DATA INTEGRITY
-- ============================================

-- Show summary of created data
SELECT 'Groups with Kanban Access:' as info;
SELECT id, name, kanban_enabled, max_tokens_per_month FROM `groups` WHERE kanban_enabled = TRUE;

SELECT 'Test Users per Group:' as info;
SELECT g.name as group_name, u.email, u.name as user_name
FROM user_groups ug
JOIN users u ON ug.user_id = u.id
JOIN `groups` g ON ug.group_id = g.id
WHERE g.name IN ('Developers', 'Project Managers', 'QA Team')
ORDER BY g.name, u.email;

SELECT 'Project and Tasks Summary:' as info;
SELECT p.name as project,
       (SELECT COUNT(*) FROM kanban_cards kc
        JOIN kanban_columns col ON kc.column_id = col.id
        JOIN kanban_boards b ON col.board_id = b.id
        WHERE b.project_id = p.id) as total_tasks
FROM projects p WHERE p.name = 'Enterprise AI Integration';
