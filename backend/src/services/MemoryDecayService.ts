/**
 * MemoryDecayService — Episodic memory decay and cleanup
 * Gradually reduces importance of older memories and archives expired ones.
 */
import { findMany } from '../database/index.js';
import type mysql from 'mysql2/promise';

export class MemoryDecayService {
  private readonly DECAY_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
  private timer: NodeJS.Timeout | null = null;

  /**
   * Start the decay timer
   */
  start(db: mysql.Pool): void {
    // Run immediately, then every 24h
    this.runDecay(db).catch(err => console.error(`[MemoryDecay] Initial decay failed: ${err.message}`));
    this.timer = setInterval(() => {
      this.runDecay(db).catch(err => console.error(`[MemoryDecay] Decay cycle failed: ${err.message}`));
    }, this.DECAY_INTERVAL_MS);
    console.log('[MemoryDecay] Started memory decay service (24h cycle)');
  }

  /**
   * Stop the decay timer
   */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Run a single decay cycle
   */
  async runDecay(db: mysql.Pool): Promise<{ decayed: number; archived: number }> {
    let decayed = 0;
    let archived = 0;

    try {
      // 1. Decay: reduce importance of observations older than 30 days by 1 point
      const [decayResult] = await db.execute(
        `UPDATE memory_observations
         SET importance = GREATEST(importance - 1, 1),
             updated_at = CURRENT_TIMESTAMP
         WHERE is_archived = FALSE
           AND importance > 1
           AND created_at < DATE_SUB(NOW(), INTERVAL 30 DAY)
           AND updated_at < DATE_SUB(NOW(), INTERVAL 7 DAY)`,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
      ) as any;
      decayed = decayResult.affectedRows || 0;

      // 2. Archive: archive observations with importance = 1 that are older than 90 days
      const [archiveResult] = await db.execute(
        `UPDATE memory_observations
         SET is_archived = TRUE,
             updated_at = CURRENT_TIMESTAMP
         WHERE is_archived = FALSE
           AND importance <= 1
           AND created_at < DATE_SUB(NOW(), INTERVAL 90 DAY)`,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
      ) as any;
      archived = archiveResult.affectedRows || 0;

      // 3. Apply user-specific retention policies
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
      const settings = await findMany<any>(db,
        `SELECT ms.user_id, ms.retention_days
         FROM memory_settings ms
         WHERE ms.retention_days > 0`,
      );

      for (const setting of settings) {
        const [retentionResult] = await db.execute(
          `UPDATE memory_observations
           SET is_archived = TRUE,
               updated_at = CURRENT_TIMESTAMP
           WHERE user_id = ?
             AND is_archived = FALSE
             AND created_at < DATE_SUB(NOW(), INTERVAL ? DAY)`,
          [setting.user_id, setting.retention_days],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
        ) as any;
        archived += retentionResult.affectedRows || 0;
      }

      if (decayed > 0 || archived > 0) {
        console.log(`[MemoryDecay] Cycle complete: ${decayed} decayed, ${archived} archived`);
      }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    } catch (error: any) {
      console.error(`[MemoryDecay] Decay error: ${error.message}`);
    }

    return { decayed, archived };
  }
}
