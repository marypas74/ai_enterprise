import mysql from 'mysql2/promise';
import { findOne, findMany, insertOne, updateOne } from '../../database/index.js';

// Types
export interface MemoryObservation {
  id: number;
  user_id: number;
  conversation_id: number | null;
  observation_type: string;
  content: string;
  source_message_id: number | null;
  tags: string[] | null;
  importance: number;
  is_archived: boolean;
  created_at: string;
  updated_at: string;
}

export interface MemorySummary {
  id: number;
  user_id: number;
  conversation_id: number;
  summary: string;
  key_observations: number[] | null;
  tokens_saved: number;
  created_at: string;
}

export interface MemorySettings {
  user_id: number;
  auto_capture: boolean;
  inject_context: boolean;
  max_context_observations: number;
  importance_threshold: number;
  retention_days: number;
}

export interface ObservationFilters {
  observation_type?: string;
  is_archived?: boolean;
  min_importance?: number;
  from_date?: string;
  to_date?: string;
  tags?: string[];
  limit?: number;
  offset?: number;
}

// Auto-capture patterns for extracting observations from conversations
const DECISION_PATTERNS = [
  /(?:decid|scelgo|scegliamo|usiamo|uso|adott|prefer|optiam)/i,
  /(?:let's use|we'll go with|decided to|choosing|i'll use|going with)/i,
];

const ERROR_PATTERNS = [
  /(?:errore|bug|fix|problema|crash|fail|broken)/i,
  /(?:error|bug|fix|issue|crash|fail|broken|exception)/i,
];

const PATTERN_PATTERNS = [
  /(?:pattern|convenzione|standard|best practice|regola|sempre|mai)/i,
  /(?:pattern|convention|standard|best practice|rule|always|never)/i,
];

const PREFERENCE_PATTERNS = [
  /(?:preferisco|mi piace|non mi piace|voglio|evitare)/i,
  /(?:i prefer|i like|i don't like|i want|avoid)/i,
];

export class MemoryService {
  constructor(private db: mysql.Pool) {}

  // Save a new observation
  async captureObservation(
    userId: number,
    content: string,
    type: string = 'insight',
    conversationId?: number,
    sourceMessageId?: number,
    tags?: string[],
    importance: number = 5
  ): Promise<number> {
    return insertOne(
      this.db,
      `INSERT INTO memory_observations (user_id, conversation_id, observation_type, content, source_message_id, tags, importance)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [userId, conversationId || null, type, content, sourceMessageId || null, tags ? JSON.stringify(tags) : null, importance]
    );
  }

  // Analyze a conversation exchange and extract observations automatically
  async autoCapture(
    userId: number,
    conversationId: number,
    userMessage: string,
    assistantResponse: string
  ): Promise<number[]> {
    const settings = await this.getSettings(userId);
    if (!settings.auto_capture) return [];

    const ids: number[] = [];
    const combined = `${userMessage}\n${assistantResponse}`;

    // Check for decisions
    if (DECISION_PATTERNS.some(p => p.test(combined))) {
      // Extract a concise observation from the exchange
      const snippet = this.extractSnippet(assistantResponse, 200);
      if (snippet.length > 20) {
        const id = await this.captureObservation(userId, snippet, 'decision', conversationId, undefined, undefined, 6);
        ids.push(id);
      }
    }

    // Check for error resolutions
    if (ERROR_PATTERNS.some(p => p.test(userMessage)) && assistantResponse.length > 100) {
      const snippet = this.extractSnippet(assistantResponse, 200);
      if (snippet.length > 20) {
        const id = await this.captureObservation(userId, snippet, 'error', conversationId, undefined, undefined, 7);
        ids.push(id);
      }
    }

    // Check for patterns/conventions
    if (PATTERN_PATTERNS.some(p => p.test(combined))) {
      const snippet = this.extractSnippet(assistantResponse, 200);
      if (snippet.length > 20) {
        const id = await this.captureObservation(userId, snippet, 'pattern', conversationId, undefined, undefined, 6);
        ids.push(id);
      }
    }

    // Check for preferences
    if (PREFERENCE_PATTERNS.some(p => p.test(userMessage))) {
      const snippet = this.extractSnippet(userMessage, 150);
      if (snippet.length > 10) {
        const id = await this.captureObservation(userId, snippet, 'preference', conversationId, undefined, undefined, 5);
        ids.push(id);
      }
    }

    return ids;
  }

  // Full-text search across observations
  async searchMemories(
    userId: number,
    query: string,
    filters?: ObservationFilters
  ): Promise<MemoryObservation[]> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    const params: any[] = [userId];
    let where = 'WHERE o.user_id = ?';

    if (query && query.trim()) {
      where += ' AND MATCH(o.content) AGAINST(? IN BOOLEAN MODE)';
      params.push(query);
    }

    if (filters?.observation_type) {
      where += ' AND o.observation_type = ?';
      params.push(filters.observation_type);
    }

    if (filters?.is_archived !== undefined) {
      where += ' AND o.is_archived = ?';
      params.push(filters.is_archived);
    }

    if (filters?.min_importance) {
      where += ' AND o.importance >= ?';
      params.push(filters.min_importance);
    }

    if (filters?.from_date) {
      where += ' AND o.created_at >= ?';
      params.push(filters.from_date);
    }

    if (filters?.to_date) {
      where += ' AND o.created_at <= ?';
      params.push(filters.to_date);
    }

    const limit = filters?.limit || 50;
    const offset = filters?.offset || 0;

    return findMany<MemoryObservation>(
      this.db,
      `SELECT o.* FROM memory_observations o ${where}
       ORDER BY o.importance DESC, o.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );
  }

  // Get recent observations for a user
  async getRecentObservations(
    userId: number,
    limit: number = 20,
    minImportance: number = 1
  ): Promise<MemoryObservation[]> {
    return findMany<MemoryObservation>(
      this.db,
      `SELECT * FROM memory_observations
       WHERE user_id = ? AND is_archived = FALSE AND importance >= ?
       ORDER BY created_at DESC LIMIT ?`,
      [userId, minImportance, limit]
    );
  }

  // Build context string to inject into new chat sessions
  async getContextForNewChat(userId: number): Promise<string | null> {
    const settings = await this.getSettings(userId);
    if (!settings.inject_context) return null;

    const observations = await findMany<MemoryObservation>(
      this.db,
      `SELECT * FROM memory_observations
       WHERE user_id = ? AND is_archived = FALSE AND importance >= ?
       ORDER BY importance DESC, updated_at DESC
       LIMIT ?`,
      [userId, settings.importance_threshold, settings.max_context_observations]
    );

    if (observations.length === 0) return null;

    const lines = observations.map(o => {
      const typeLabel = o.observation_type.charAt(0).toUpperCase() + o.observation_type.slice(1);
      return `- [${typeLabel}] ${o.content}`;
    });

    return `The following observations are from previous sessions with this user:\n${lines.join('\n')}`;
  }

  // Get a single observation
  async getObservation(userId: number, observationId: number): Promise<MemoryObservation | null> {
    return findOne<MemoryObservation>(
      this.db,
      'SELECT * FROM memory_observations WHERE id = ? AND user_id = ?',
      [observationId, userId]
    );
  }

  // Update an observation
  async updateObservation(
    userId: number,
    observationId: number,
    updates: { content?: string; tags?: string[]; importance?: number; is_archived?: boolean; observation_type?: string }
  ): Promise<boolean> {
    const sets: string[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    const params: any[] = [];

    if (updates.content !== undefined) { sets.push('content = ?'); params.push(updates.content); }
    if (updates.tags !== undefined) { sets.push('tags = ?'); params.push(JSON.stringify(updates.tags)); }
    if (updates.importance !== undefined) { sets.push('importance = ?'); params.push(updates.importance); }
    if (updates.is_archived !== undefined) { sets.push('is_archived = ?'); params.push(updates.is_archived); }
    if (updates.observation_type !== undefined) { sets.push('observation_type = ?'); params.push(updates.observation_type); }

    if (sets.length === 0) return false;

    params.push(observationId, userId);
    const affected = await updateOne(
      this.db,
      `UPDATE memory_observations SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`,
      params
    );
    return affected > 0;
  }

  // Delete an observation
  async deleteObservation(userId: number, observationId: number): Promise<boolean> {
    const affected = await updateOne(
      this.db,
      'DELETE FROM memory_observations WHERE id = ? AND user_id = ?',
      [observationId, userId]
    );
    return affected > 0;
  }

  // Bulk operations
  async bulkArchive(userId: number, ids: number[]): Promise<number> {
    if (ids.length === 0) return 0;
    const placeholders = ids.map(() => '?').join(',');
    return updateOne(
      this.db,
      `UPDATE memory_observations SET is_archived = TRUE WHERE user_id = ? AND id IN (${placeholders})`,
      [userId, ...ids]
    );
  }

  async bulkDelete(userId: number, ids: number[]): Promise<number> {
    if (ids.length === 0) return 0;
    const placeholders = ids.map(() => '?').join(',');
    return updateOne(
      this.db,
      `DELETE FROM memory_observations WHERE user_id = ? AND id IN (${placeholders})`,
      [userId, ...ids]
    );
  }

  // Conversation summaries
  async saveSummary(
    userId: number,
    conversationId: number,
    summary: string,
    keyObservationIds?: number[],
    tokensSaved: number = 0
  ): Promise<number> {
    return insertOne(
      this.db,
      `INSERT INTO memory_summaries (user_id, conversation_id, summary, key_observations, tokens_saved)
       VALUES (?, ?, ?, ?, ?)`,
      [userId, conversationId, summary, keyObservationIds ? JSON.stringify(keyObservationIds) : null, tokensSaved]
    );
  }

  async getSummaries(userId: number, limit: number = 20, offset: number = 0): Promise<MemorySummary[]> {
    return findMany<MemorySummary>(
      this.db,
      `SELECT s.*, c.title as conversation_title
       FROM memory_summaries s
       LEFT JOIN conversations c ON s.conversation_id = c.id
       WHERE s.user_id = ?
       ORDER BY s.created_at DESC LIMIT ? OFFSET ?`,
      [userId, limit, offset]
    );
  }

  // User settings
  async getSettings(userId: number): Promise<MemorySettings> {
    const existing = await findOne<MemorySettings>(
      this.db,
      'SELECT * FROM memory_settings WHERE user_id = ?',
      [userId]
    );

    if (existing) return existing;

    // Return defaults (don't insert yet — lazy creation on first update)
    return {
      user_id: userId,
      auto_capture: true,
      inject_context: true,
      max_context_observations: 10,
      importance_threshold: 3,
      retention_days: 365
    };
  }

  async updateSettings(userId: number, updates: Partial<Omit<MemorySettings, 'user_id'>>): Promise<void> {
    const existing = await findOne<MemorySettings>(
      this.db,
      'SELECT * FROM memory_settings WHERE user_id = ?',
      [userId]
    );

    if (existing) {
      const sets: string[] = [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
      const params: any[] = [];
      if (updates.auto_capture !== undefined) { sets.push('auto_capture = ?'); params.push(updates.auto_capture); }
      if (updates.inject_context !== undefined) { sets.push('inject_context = ?'); params.push(updates.inject_context); }
      if (updates.max_context_observations !== undefined) { sets.push('max_context_observations = ?'); params.push(updates.max_context_observations); }
      if (updates.importance_threshold !== undefined) { sets.push('importance_threshold = ?'); params.push(updates.importance_threshold); }
      if (updates.retention_days !== undefined) { sets.push('retention_days = ?'); params.push(updates.retention_days); }

      if (sets.length > 0) {
        params.push(userId);
        await updateOne(this.db, `UPDATE memory_settings SET ${sets.join(', ')} WHERE user_id = ?`, params);
      }
    } else {
      await insertOne(
        this.db,
        `INSERT INTO memory_settings (user_id, auto_capture, inject_context, max_context_observations, importance_threshold, retention_days)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          userId,
          updates.auto_capture ?? true,
          updates.inject_context ?? true,
          updates.max_context_observations ?? 10,
          updates.importance_threshold ?? 3,
          updates.retention_days ?? 365
        ]
      );
    }
  }

  // Statistics
  async getStats(userId: number): Promise<{
    total: number;
    by_type: Record<string, number>;
    archived: number;
    summaries: number;
    avg_importance: number;
    recent_7d: number;
  }> {
    const [totalRow] = await this.db.execute(
      'SELECT COUNT(*) as cnt FROM memory_observations WHERE user_id = ? AND is_archived = FALSE',
      [userId]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    ) as any;
    const total = totalRow[0]?.cnt || 0;

    const [archivedRow] = await this.db.execute(
      'SELECT COUNT(*) as cnt FROM memory_observations WHERE user_id = ? AND is_archived = TRUE',
      [userId]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    ) as any;
    const archived = archivedRow[0]?.cnt || 0;

    const byTypeRows = await findMany<{ observation_type: string; cnt: number }>(
      this.db,
      'SELECT observation_type, COUNT(*) as cnt FROM memory_observations WHERE user_id = ? AND is_archived = FALSE GROUP BY observation_type',
      [userId]
    );
    const by_type: Record<string, number> = {};
    for (const row of byTypeRows) {
      by_type[row.observation_type] = row.cnt;
    }

    const [summariesRow] = await this.db.execute(
      'SELECT COUNT(*) as cnt FROM memory_summaries WHERE user_id = ?',
      [userId]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    ) as any;
    const summaries = summariesRow[0]?.cnt || 0;

    const [avgRow] = await this.db.execute(
      'SELECT AVG(importance) as avg_imp FROM memory_observations WHERE user_id = ? AND is_archived = FALSE',
      [userId]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    ) as any;
    const avg_importance = Math.round((avgRow[0]?.avg_imp || 0) * 10) / 10;

    const [recentRow] = await this.db.execute(
      'SELECT COUNT(*) as cnt FROM memory_observations WHERE user_id = ? AND created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)',
      [userId]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    ) as any;
    const recent_7d = recentRow[0]?.cnt || 0;

    return { total, by_type, archived, summaries, avg_importance, recent_7d };
  }

  // Archive old observations past retention period
  async archiveOld(userId: number): Promise<number> {
    const settings = await this.getSettings(userId);
    return updateOne(
      this.db,
      `UPDATE memory_observations SET is_archived = TRUE
       WHERE user_id = ? AND is_archived = FALSE
       AND created_at < DATE_SUB(NOW(), INTERVAL ? DAY)`,
      [userId, settings.retention_days]
    );
  }

  // Helper: extract a concise snippet from text
  private extractSnippet(text: string, maxLen: number): string {
    // Take the first meaningful paragraph or sentence
    const lines = text.split('\n').filter(l => l.trim().length > 0);
    let snippet = '';
    for (const line of lines) {
      // Skip code blocks and markdown headers
      if (line.startsWith('```') || line.startsWith('#')) continue;
      snippet = line.trim();
      break;
    }
    if (snippet.length > maxLen) {
      snippet = snippet.substring(0, maxLen).replace(/\s+\S*$/, '...');
    }
    return snippet;
  }
}
