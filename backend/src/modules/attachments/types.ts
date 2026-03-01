/**
 * Shared types for the attachments module
 */

export interface AttachmentConfig {
  mime_type: string;
  content_type: string;
  max_size_mb: number;
  processor: string;
  is_enabled: boolean;
}

export interface ChatAttachment {
  id: number;
  conversation_id: number;
  message_id: number | null;
  user_id: number;
  file_name: string;
  original_name: string;
  file_path: string;
  file_size: number;
  mime_type: string;
  content_type: string;
  processing_status: 'pending' | 'processing' | 'completed' | 'failed';
  processed_content: string | null;
  processing_error: string | null;
  created_at: Date;
  processed_at: Date | null;
}

/**
 * Helper: Detect content type from MIME
 */
export function detectContentType(mimeType: string): string {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('audio/')) return 'audio';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.includes('pdf') || mimeType.includes('document') || mimeType.includes('msword')) return 'document';
  if (mimeType.includes('spreadsheet') || mimeType.includes('excel') || mimeType === 'text/csv') return 'data';
  if (mimeType.includes('javascript') || mimeType.includes('typescript') || mimeType.includes('python') ||
    mimeType.includes('java') || mimeType.includes('json') || mimeType.includes('xml') ||
    mimeType.includes('yaml') || mimeType.includes('html') || mimeType.includes('css')) return 'code';
  if (mimeType.startsWith('text/')) return 'document';
  return 'other';
}
