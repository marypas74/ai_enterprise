import type mysql from 'mysql2/promise';
import type { Migration } from '../connection.js';
import { execute } from '../helpers.js';

async function up(pool: mysql.Pool): Promise<void> {
  await execute(
    pool,
    `CREATE TABLE IF NOT EXISTS marketplace_catalog_items (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      source_id VARCHAR(255) NOT NULL,
      type ENUM('skill', 'agent', 'mcp', 'hook') NOT NULL,
      tier ENUM('tier1', 'tier2', 'tier3') NOT NULL,
      name VARCHAR(255) NOT NULL,
      display_name VARCHAR(255),
      description TEXT,
      category VARCHAR(100),
      metadata JSON,
      version VARCHAR(50),
      embedding_indexed BOOLEAN DEFAULT FALSE,
      last_synced_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uk_source_id (source_id),
      INDEX idx_type (type),
      INDEX idx_tier (tier),
      INDEX idx_category (category)
    )`,
  );

  await execute(
    pool,
    `CREATE TABLE IF NOT EXISTS marketplace_installations (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      catalog_item_id BIGINT UNSIGNED NOT NULL,
      installed_by BIGINT UNSIGNED NOT NULL,
      approved_by BIGINT UNSIGNED,
      status ENUM('pending_approval', 'installed', 'disabled', 'failed') NOT NULL,
      target_type ENUM('skill', 'mcp_server', 'hook_handler') NOT NULL,
      target_id BIGINT UNSIGNED,
      installed_version VARCHAR(50),
      config_overrides JSON,
      installed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (catalog_item_id) REFERENCES marketplace_catalog_items(id) ON DELETE CASCADE,
      FOREIGN KEY (installed_by) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL,
      INDEX idx_installed_by (installed_by),
      INDEX idx_status (status)
    )`,
  );

  await execute(
    pool,
    `CREATE TABLE IF NOT EXISTS marketplace_sync_state (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      last_sync_at TIMESTAMP,
      status ENUM('success', 'failed', 'suspended') NOT NULL,
      items_added INT DEFAULT 0,
      items_updated INT DEFAULT 0,
      items_removed INT DEFAULT 0,
      consecutive_failures INT DEFAULT 0,
      error_message TEXT,
      next_check_at TIMESTAMP NULL
    )`,
  );

  await execute(
    pool,
    `CREATE TABLE IF NOT EXISTS marketplace_approval_requests (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      catalog_item_id BIGINT UNSIGNED NOT NULL,
      requested_by BIGINT UNSIGNED NOT NULL,
      status ENUM('pending', 'approved', 'rejected') DEFAULT 'pending',
      admin_notes TEXT,
      requested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      resolved_at TIMESTAMP NULL,
      resolved_by BIGINT UNSIGNED,
      FOREIGN KEY (catalog_item_id) REFERENCES marketplace_catalog_items(id) ON DELETE CASCADE,
      FOREIGN KEY (requested_by) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (resolved_by) REFERENCES users(id) ON DELETE SET NULL,
      INDEX idx_status (status),
      INDEX idx_requested_by (requested_by)
    )`,
  );

  await execute(
    pool,
    `CREATE TABLE IF NOT EXISTS marketplace_kb_documents (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      installation_id BIGINT UNSIGNED NOT NULL,
      document_name VARCHAR(500),
      source_url TEXT,
      chunk_count INT DEFAULT 0,
      indexed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (installation_id) REFERENCES marketplace_installations(id) ON DELETE CASCADE
    )`,
  );
}

export const initialSchema: Migration = {
  name: '001-initial-schema',
  up,
};
