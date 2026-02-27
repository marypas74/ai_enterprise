/**
 * ConversationCleanupService — Auto-archive and auto-delete conversations
 * - Archives conversations older than 24 hours
 * - Permanently deletes conversations older than 60 days
 */
import type mysql from 'mysql2/promise';

export class ConversationCleanupService {
  private readonly CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // Run every hour
  private timer: NodeJS.Timeout | null = null;

  /**
   * Start the cleanup timer
   */
  start(db: mysql.Pool): void {
    // Run immediately, then every hour
    this.runCleanup(db).catch(err =>
      console.error(`[ConversationCleanup] Initial cleanup failed: ${err.message}`)
    );
    this.timer = setInterval(() => {
      this.runCleanup(db).catch(err =>
        console.error(`[ConversationCleanup] Cleanup cycle failed: ${err.message}`)
      );
    }, this.CLEANUP_INTERVAL_MS);
    console.log('[ConversationCleanup] Started (1h cycle: archive >24h, delete >60d)');
  }

  /**
   * Stop the cleanup timer
   */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Run a single cleanup cycle
   */
  async runCleanup(db: mysql.Pool): Promise<{ archived: number; deleted: number }> {
    let archived = 0;
    let deleted = 0;

    try {
      // 1. Auto-archive: archive non-archived conversations older than 24 hours
      const [archiveResult] = await db.execute(
        `UPDATE conversations
         SET is_archived = TRUE,
             updated_at = CURRENT_TIMESTAMP
         WHERE is_archived = FALSE
           AND updated_at < DATE_SUB(NOW(), INTERVAL 24 HOUR)`
      ) as any;
      archived = archiveResult.affectedRows || 0;

      // 2. Auto-delete: permanently delete conversations older than 60 days
      //    Messages are cascade-deleted via FK constraint
      const [deleteResult] = await db.execute(
        `DELETE FROM conversations
         WHERE created_at < DATE_SUB(NOW(), INTERVAL 60 DAY)`
      ) as any;
      deleted = deleteResult.affectedRows || 0;

      if (archived > 0 || deleted > 0) {
        console.log(
          `[ConversationCleanup] Cycle complete: ${archived} archived, ${deleted} deleted`
        );
      }
    } catch (error: any) {
      console.error(`[ConversationCleanup] Error: ${error.message}`);
    }

    return { archived, deleted };
  }
}
