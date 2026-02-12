-- Migration: Chat Attachments Support
-- Adds support for file attachments in chat conversations

-- Tabella per allegati chat
CREATE TABLE IF NOT EXISTS chat_attachments (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    conversation_id BIGINT UNSIGNED NOT NULL,
    message_id BIGINT UNSIGNED NULL,
    user_id BIGINT UNSIGNED NOT NULL,

    -- File metadata
    file_name VARCHAR(255) NOT NULL,
    original_name VARCHAR(255) NOT NULL,
    file_path TEXT NOT NULL,
    file_size BIGINT UNSIGNED NOT NULL,
    mime_type VARCHAR(100) NOT NULL,

    -- Content classification
    content_type ENUM('document', 'image', 'code', 'data', 'audio', 'video', 'other') DEFAULT 'other',

    -- Processing status
    processing_status ENUM('pending', 'processing', 'completed', 'failed') DEFAULT 'pending',
    processed_content LONGTEXT NULL,
    processing_error TEXT NULL,

    -- Timestamps
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    processed_at TIMESTAMP NULL,

    -- Indexes
    INDEX idx_conversation_id (conversation_id),
    INDEX idx_message_id (message_id),
    INDEX idx_user_id (user_id),
    INDEX idx_processing_status (processing_status),

    -- Foreign keys
    CONSTRAINT fk_attachment_conversation FOREIGN KEY (conversation_id)
        REFERENCES conversations(id) ON DELETE CASCADE,
    CONSTRAINT fk_attachment_message FOREIGN KEY (message_id)
        REFERENCES messages(id) ON DELETE SET NULL,
    CONSTRAINT fk_attachment_user FOREIGN KEY (user_id)
        REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Job queue per processing allegati (per tracking)
CREATE TABLE IF NOT EXISTS attachment_jobs (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    attachment_id BIGINT UNSIGNED NOT NULL,
    job_id VARCHAR(100) NOT NULL,
    status ENUM('queued', 'active', 'completed', 'failed', 'delayed') DEFAULT 'queued',
    attempts INT UNSIGNED DEFAULT 0,
    result LONGTEXT NULL,
    error TEXT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    started_at TIMESTAMP NULL,
    completed_at TIMESTAMP NULL,

    INDEX idx_attachment_id (attachment_id),
    INDEX idx_job_id (job_id),
    INDEX idx_status (status),

    CONSTRAINT fk_job_attachment FOREIGN KEY (attachment_id)
        REFERENCES chat_attachments(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Configurazione tipi file supportati
CREATE TABLE IF NOT EXISTS attachment_config (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    mime_type VARCHAR(100) NOT NULL UNIQUE,
    content_type ENUM('document', 'image', 'code', 'data', 'audio', 'video', 'other') NOT NULL,
    max_size_mb INT UNSIGNED DEFAULT 10,
    processor VARCHAR(50) NOT NULL,
    is_enabled BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Inserimento configurazione default tipi file
INSERT INTO attachment_config (mime_type, content_type, max_size_mb, processor) VALUES
-- Documenti
('application/pdf', 'document', 20, 'pdf-extract'),
('application/msword', 'document', 15, 'office-extract'),
('application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'document', 15, 'office-extract'),
('application/vnd.ms-excel', 'data', 15, 'excel-extract'),
('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'data', 15, 'excel-extract'),
('application/vnd.ms-powerpoint', 'document', 20, 'office-extract'),
('application/vnd.openxmlformats-officedocument.presentationml.presentation', 'document', 20, 'office-extract'),
('text/plain', 'document', 5, 'text-read'),
('text/markdown', 'document', 5, 'text-read'),
('text/csv', 'data', 10, 'csv-parse'),

-- Immagini
('image/jpeg', 'image', 10, 'image-ocr'),
('image/png', 'image', 10, 'image-ocr'),
('image/gif', 'image', 5, 'image-ocr'),
('image/webp', 'image', 10, 'image-ocr'),
('image/svg+xml', 'image', 2, 'text-read'),

-- Codice
('text/javascript', 'code', 2, 'code-read'),
('application/javascript', 'code', 2, 'code-read'),
('text/typescript', 'code', 2, 'code-read'),
('application/json', 'data', 5, 'json-parse'),
('text/html', 'code', 2, 'code-read'),
('text/css', 'code', 2, 'code-read'),
('text/x-python', 'code', 2, 'code-read'),
('text/x-java', 'code', 2, 'code-read'),
('text/x-c', 'code', 2, 'code-read'),
('text/x-yaml', 'data', 2, 'yaml-parse'),
('application/xml', 'data', 5, 'xml-parse'),

-- Audio (per future transcription)
('audio/mpeg', 'audio', 25, 'audio-transcribe'),
('audio/wav', 'audio', 50, 'audio-transcribe'),
('audio/ogg', 'audio', 25, 'audio-transcribe'),

-- Archivi (estrazione contenuto)
('application/zip', 'other', 50, 'archive-list'),
('application/x-tar', 'other', 50, 'archive-list'),
('application/gzip', 'other', 50, 'archive-list')

ON DUPLICATE KEY UPDATE
    content_type = VALUES(content_type),
    max_size_mb = VALUES(max_size_mb),
    processor = VALUES(processor);
