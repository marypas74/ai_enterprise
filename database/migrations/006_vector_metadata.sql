-- Migration: Vector Index Status tracking
-- Tracks which attachments have been indexed in the vector database

CREATE TABLE IF NOT EXISTS vector_index_status (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    attachment_id BIGINT UNSIGNED NOT NULL UNIQUE,
    total_chunks INT UNSIGNED NOT NULL DEFAULT 0,
    indexed_chunks INT UNSIGNED NOT NULL DEFAULT 0,
    embedding_model VARCHAR(100) NULL,
    vector_collection VARCHAR(100) NULL,
    status ENUM('pending', 'indexing', 'completed', 'failed') DEFAULT 'pending',
    error TEXT NULL,

    -- Timestamps
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    -- Indexes
    INDEX idx_attachment_id (attachment_id),
    INDEX idx_status (status),

    -- Foreign key
    CONSTRAINT fk_vector_attachment FOREIGN KEY (attachment_id)
        REFERENCES chat_attachments(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
