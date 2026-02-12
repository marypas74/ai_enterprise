-- Migration: Document Chunks for RAG and Smart Context Injection
-- Stores chunked document content for efficient retrieval

CREATE TABLE IF NOT EXISTS document_chunks (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    attachment_id BIGINT UNSIGNED NOT NULL,
    chunk_index INT UNSIGNED NOT NULL,
    content TEXT NOT NULL,
    char_count INT UNSIGNED NOT NULL,
    metadata JSON NULL,

    -- Timestamps
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    -- Indexes
    INDEX idx_attachment_id (attachment_id),
    INDEX idx_chunk_index (attachment_id, chunk_index),

    -- Full-text index for keyword search (Layer 2)
    FULLTEXT INDEX ft_content (content),

    -- Foreign key
    CONSTRAINT fk_chunk_attachment FOREIGN KEY (attachment_id)
        REFERENCES chat_attachments(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
