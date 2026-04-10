import { FastifyInstance } from 'fastify';
import { findMany, insertOne, findOne } from '../../database/index.js';

/**
 * BiasMonitorService — GAP-11: Monitoraggio bias AI
 *
 * Servizio periodico che ogni 24h aggrega metriche dai log delle decisioni AI
 * e dal feedback utente per individuare anomalie di bias per modello/provider.
 */
export class BiasMonitorService {
  private initialTimerId: ReturnType<typeof setTimeout> | null = null;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private readonly INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 ore

  constructor(private readonly fastify: FastifyInstance) {}

  start(): void {
    // Prima esecuzione dopo 5 minuti dal boot
    this.initialTimerId = setTimeout(() => {
      this.initialTimerId = null;
      this.runMonitoringCycle().catch(err =>
        this.fastify.log.error({ err }, '[BiasMonitor] Initial cycle failed')
      );
    }, 5 * 60 * 1000);

    this.intervalId = setInterval(() => {
      this.runMonitoringCycle().catch(err =>
        this.fastify.log.error({ err }, '[BiasMonitor] Cycle failed')
      );
    }, this.INTERVAL_MS);

    this.fastify.log.info('[BiasMonitor] Service started (24h interval)');
  }

  stop(): void {
    if (this.initialTimerId) {
      clearTimeout(this.initialTimerId);
      this.initialTimerId = null;
    }
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  async runMonitoringCycle(): Promise<void> {
    const enabled = await findOne<{ setting_value: string }>(
      this.fastify.db,
      `SELECT setting_value FROM system_settings WHERE setting_key = 'bias_monitoring_enabled'`
    );
    if (enabled?.setting_value !== 'true') return;

    this.fastify.log.info('[BiasMonitor] Running monitoring cycle...');

    const periodEnd = new Date();
    const periodStart = new Date(periodEnd.getTime() - this.INTERVAL_MS);

    // Format dates as MySQL DATETIME (MariaDB rejects ISO 8601 with 'T' and 'Z')
    const toMySQLDatetime = (d: Date) =>
      d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0') + ' ' +
      String(d.getHours()).padStart(2, '0') + ':' +
      String(d.getMinutes()).padStart(2, '0') + ':' +
      String(d.getSeconds()).padStart(2, '0');
    const periodStartStr = toMySQLDatetime(periodStart);
    const periodEndStr = toMySQLDatetime(periodEnd);

    // Aggregate decision log stats per model (includes refusal/error counts)
    const modelStats = await findMany<{
      ai_model: string;
      ai_provider: string;
      total_requests: number;
      avg_latency_ms: number;
      flagged_count: number;
      refusal_count: number;
      error_count: number;
    }>(
      this.fastify.db,
      `SELECT ai_model, ai_provider,
              COUNT(*) as total_requests,
              ROUND(AVG(latency_ms)) as avg_latency_ms,
              SUM(CASE WHEN safety_flags IS NOT NULL AND JSON_LENGTH(safety_flags) > 0 THEN 1 ELSE 0 END) as flagged_count,
              SUM(CASE WHEN tokens_output = 0 AND latency_ms > 0 THEN 1 ELSE 0 END) as refusal_count,
              SUM(CASE WHEN latency_ms = 0 OR tokens_output IS NULL THEN 1 ELSE 0 END) as error_count
       FROM ai_decision_log
       WHERE created_at BETWEEN ? AND ?
       GROUP BY ai_model, ai_provider`,
      [periodStartStr, periodEndStr]
    );

    // Batch feedback query — single query for all models (eliminates N+1)
    const feedbackByModel = await findMany<{ ai_model: string; positive: number; negative: number }>(
      this.fastify.db,
      `SELECT m.ai_model,
              SUM(CASE WHEN rf.rating = 1 THEN 1 ELSE 0 END) as positive,
              SUM(CASE WHEN rf.rating = -1 THEN 1 ELSE 0 END) as negative
       FROM response_feedback rf
       JOIN messages m ON rf.message_id = m.id
       WHERE m.ai_model IS NOT NULL AND rf.created_at BETWEEN ? AND ?
       GROUP BY m.ai_model`,
      [periodStartStr, periodEndStr]
    );
    const feedbackMap = new Map(feedbackByModel.map(f => [f.ai_model, f]));

    for (const stat of modelStats) {
      const feedback = feedbackMap.get(stat.ai_model);
      const positive = feedback?.positive || 0;
      const negative = feedback?.negative || 0;

      await insertOne(this.fastify.db,
        `INSERT INTO bias_monitoring_log
         (period_start, period_end, ai_model, ai_provider, total_requests, refusal_count, error_count,
          avg_latency_ms, negative_feedback_count, positive_feedback_count, flagged_content_count)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [periodStartStr, periodEndStr,
         stat.ai_model, stat.ai_provider, stat.total_requests,
         stat.refusal_count || 0, stat.error_count || 0,
         stat.avg_latency_ms, negative, positive, stat.flagged_count]
      );

      // Alert on anomalies
      const totalFeedback = positive + negative;
      if (totalFeedback > 10 && negative / totalFeedback > 0.2) {
        this.fastify.log.warn(
          `[BiasMonitor] ALERT: Model ${stat.ai_model} has ${Math.round(negative / totalFeedback * 100)}% negative feedback (${negative}/${totalFeedback})`
        );
      }
      if (stat.flagged_count > 0 && stat.flagged_count / stat.total_requests > 0.1) {
        this.fastify.log.warn(
          `[BiasMonitor] ALERT: Model ${stat.ai_model} has ${Math.round(stat.flagged_count / stat.total_requests * 100)}% flagged content`
        );
      }
    }

    this.fastify.log.info(`[BiasMonitor] Cycle completed — ${modelStats.length} models monitored`);
  }
}
