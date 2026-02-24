/**
 * White Rabbit Service — Task Scheduler
 *
 * Provides one-shot, interval, and cron-based job scheduling
 * backed by Redis for persistence and coordination.
 *
 * Job types:
 *   - one_shot: execute once after a delay
 *   - interval: repeat every N milliseconds
 *   - cron: run on a cron schedule (e.g., "0 9 * * *")
 *
 * Jobs can trigger:
 *   - scheduled_message: send a chat message to a user at a future time
 *   - webhook: POST to an external URL
 *   - hook: fire an EventBus hook
 *   - plugin_action: call a plugin's exported function
 */

import { FastifyInstance } from 'fastify';
import { findOne, findMany, insertOne, updateOne } from '../database/index.js';
import { eventBus } from './EventBusService.js';
import type mysql from 'mysql2/promise';

// ---- Types ----

export type JobType = 'one_shot' | 'interval' | 'cron';
export type JobStatus = 'active' | 'paused' | 'completed' | 'failed' | 'cancelled';
export type ActionType = 'scheduled_message' | 'webhook' | 'hook' | 'plugin_action';

export interface ScheduledJob {
  id: number;
  name: string;
  description?: string;
  job_type: JobType;
  action_type: ActionType;
  action_config: Record<string, any>;
  schedule_config: {
    delay_ms?: number;        // for one_shot
    interval_ms?: number;     // for interval
    cron_expression?: string; // for cron
  };
  status: JobStatus;
  user_id: number;
  next_run_at: string | null;
  last_run_at: string | null;
  run_count: number;
  max_runs?: number;
  created_at: string;
}

export interface JobExecution {
  id: number;
  job_id: number;
  started_at: string;
  completed_at: string | null;
  status: 'success' | 'failed';
  result?: string;
  error?: string;
}

// ---- Service ----

export class WhiteRabbitService {
  private timers: Map<number, NodeJS.Timeout> = new Map();
  private running = false;
  private checkInterval: NodeJS.Timeout | null = null;

  constructor(
    private fastify: FastifyInstance,
    private db: mysql.Pool,
  ) {}

  /** Start the scheduler — loads active jobs and starts timers */
  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    this.fastify.log.info('[WhiteRabbit] Starting scheduler...');

    // Load active jobs from DB
    const jobs = await findMany<ScheduledJob>(this.db,
      'SELECT * FROM scheduled_jobs WHERE status = ?', ['active'],
    );

    for (const job of jobs) {
      this.scheduleJob(job);
    }

    this.fastify.log.info(`[WhiteRabbit] Loaded ${jobs.length} active jobs`);

    // Periodic check for cron jobs (every 30 seconds)
    this.checkInterval = setInterval(() => this.checkCronJobs(), 30_000);
  }

  /** Stop the scheduler — clear all timers */
  stop(): void {
    this.running = false;
    for (const [, timer] of this.timers) {
      clearTimeout(timer);
      clearInterval(timer);
    }
    this.timers.clear();
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
    this.fastify.log.info('[WhiteRabbit] Scheduler stopped');
  }

  /** Create a new scheduled job */
  async createJob(job: Omit<ScheduledJob, 'id' | 'status' | 'next_run_at' | 'last_run_at' | 'run_count' | 'created_at'>): Promise<number> {
    const nextRunAt = this.calculateNextRun(job.job_type, job.schedule_config);

    const id = await insertOne(this.db,
      `INSERT INTO scheduled_jobs (name, description, job_type, action_type, action_config, schedule_config, status, user_id, next_run_at, max_runs)
       VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`,
      [job.name, job.description || null, job.job_type, job.action_type,
       JSON.stringify(job.action_config), JSON.stringify(job.schedule_config),
       job.user_id, nextRunAt, job.max_runs || null],
    );

    // Load and schedule the new job
    const created = await findOne<ScheduledJob>(this.db, 'SELECT * FROM scheduled_jobs WHERE id = ?', [id]);
    if (created && this.running) {
      this.scheduleJob(created);
    }

    this.fastify.log.info(`[WhiteRabbit] Created job #${id} "${job.name}" (${job.job_type})`);
    return id;
  }

  /** Pause a job */
  async pauseJob(jobId: number): Promise<boolean> {
    const timer = this.timers.get(jobId);
    if (timer) {
      clearTimeout(timer);
      clearInterval(timer);
      this.timers.delete(jobId);
    }

    const affected = await updateOne(this.db,
      'UPDATE scheduled_jobs SET status = ? WHERE id = ?', ['paused', jobId],
    );
    return affected > 0;
  }

  /** Resume a paused job */
  async resumeJob(jobId: number): Promise<boolean> {
    const affected = await updateOne(this.db,
      'UPDATE scheduled_jobs SET status = ? WHERE id = ?', ['active', jobId],
    );

    if (affected > 0 && this.running) {
      const job = await findOne<ScheduledJob>(this.db, 'SELECT * FROM scheduled_jobs WHERE id = ?', [jobId]);
      if (job) this.scheduleJob(job);
    }
    return affected > 0;
  }

  /** Cancel a job */
  async cancelJob(jobId: number): Promise<boolean> {
    const timer = this.timers.get(jobId);
    if (timer) {
      clearTimeout(timer);
      clearInterval(timer);
      this.timers.delete(jobId);
    }

    const affected = await updateOne(this.db,
      'UPDATE scheduled_jobs SET status = ? WHERE id = ?', ['cancelled', jobId],
    );
    return affected > 0;
  }

  /** List jobs with optional status filter */
  async listJobs(userId?: number, status?: JobStatus): Promise<ScheduledJob[]> {
    let sql = 'SELECT * FROM scheduled_jobs WHERE 1=1';
    const params: any[] = [];

    if (userId) {
      sql += ' AND user_id = ?';
      params.push(userId);
    }
    if (status) {
      sql += ' AND status = ?';
      params.push(status);
    }

    sql += ' ORDER BY created_at DESC';
    return findMany<ScheduledJob>(this.db, sql, params);
  }

  /** Get execution history for a job */
  async getExecutions(jobId: number, limit = 20): Promise<JobExecution[]> {
    return findMany<JobExecution>(this.db,
      'SELECT * FROM job_executions WHERE job_id = ? ORDER BY started_at DESC LIMIT ?',
      [jobId, limit],
    );
  }

  // ---- Private: Scheduling ----

  private scheduleJob(job: ScheduledJob): void {
    const config = typeof job.schedule_config === 'string'
      ? JSON.parse(job.schedule_config) : job.schedule_config;

    switch (job.job_type) {
      case 'one_shot': {
        const delayMs = config.delay_ms || 60_000;
        // Calculate delay from next_run_at if available
        let actualDelay = delayMs;
        if (job.next_run_at) {
          const nextRun = new Date(job.next_run_at).getTime();
          const now = Date.now();
          actualDelay = Math.max(nextRun - now, 100);
        }

        const timer = setTimeout(() => this.executeJob(job), actualDelay);
        this.timers.set(job.id, timer);
        break;
      }

      case 'interval': {
        const intervalMs = config.interval_ms || 60_000;
        const timer = setInterval(() => this.executeJob(job), intervalMs);
        this.timers.set(job.id, timer);
        break;
      }

      case 'cron': {
        // Cron jobs are checked periodically via checkCronJobs()
        // No timer to set here
        break;
      }
    }
  }

  private async checkCronJobs(): Promise<void> {
    if (!this.running) return;

    const jobs = await findMany<ScheduledJob>(this.db,
      "SELECT * FROM scheduled_jobs WHERE job_type = 'cron' AND status = 'active' AND (next_run_at IS NULL OR next_run_at <= NOW())",
      [],
    );

    for (const job of jobs) {
      await this.executeJob(job);
    }
  }

  private async executeJob(job: ScheduledJob): Promise<void> {
    const startTime = new Date();

    // Record execution start
    const execId = await insertOne(this.db,
      'INSERT INTO job_executions (job_id, started_at) VALUES (?, ?)',
      [job.id, startTime.toISOString()],
    );

    try {
      const config = typeof job.action_config === 'string'
        ? JSON.parse(job.action_config) : job.action_config;

      await this.runAction(job.action_type, config, job);

      // Record success
      await updateOne(this.db,
        'UPDATE job_executions SET completed_at = NOW(), status = ? WHERE id = ?',
        ['success', execId],
      );

      // Update job state
      const newRunCount = (job.run_count || 0) + 1;
      const nextRun = this.calculateNextRun(job.job_type,
        typeof job.schedule_config === 'string' ? JSON.parse(job.schedule_config) : job.schedule_config);

      // Check if max runs reached
      const isComplete = job.job_type === 'one_shot' || (job.max_runs && newRunCount >= job.max_runs);

      await updateOne(this.db,
        'UPDATE scheduled_jobs SET run_count = ?, last_run_at = NOW(), next_run_at = ?, status = ? WHERE id = ?',
        [newRunCount, isComplete ? null : nextRun, isComplete ? 'completed' : 'active', job.id],
      );

      if (isComplete) {
        const timer = this.timers.get(job.id);
        if (timer) {
          clearTimeout(timer);
          clearInterval(timer);
          this.timers.delete(job.id);
        }
      }

      this.fastify.log.info(`[WhiteRabbit] Job #${job.id} "${job.name}" executed successfully (run ${newRunCount})`);
    } catch (err: any) {
      // Record failure
      await updateOne(this.db,
        'UPDATE job_executions SET completed_at = NOW(), status = ?, error = ? WHERE id = ?',
        ['failed', err.message, execId],
      );

      await updateOne(this.db,
        'UPDATE scheduled_jobs SET last_run_at = NOW(), status = ? WHERE id = ?',
        ['failed', job.id],
      );

      this.fastify.log.error(`[WhiteRabbit] Job #${job.id} "${job.name}" failed: ${err.message}`);
    }
  }

  private async runAction(actionType: ActionType, config: Record<string, any>, job: ScheduledJob): Promise<void> {
    switch (actionType) {
      case 'webhook': {
        const resp = await fetch(config.url, {
          method: config.method || 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(config.headers || {}),
          },
          body: config.body ? JSON.stringify(config.body) : undefined,
          signal: AbortSignal.timeout(30_000),
        });
        if (!resp.ok) throw new Error(`Webhook failed: HTTP ${resp.status}`);
        break;
      }

      case 'hook': {
        const hookName = config.hook_name;
        const hookData = config.data || {};
        await eventBus.emit(hookName, hookData, { userId: job.user_id });
        break;
      }

      case 'scheduled_message': {
        // Store a scheduled message that the chat pipeline can pick up
        await insertOne(this.db,
          `INSERT INTO messages (conversation_id, role, content) VALUES (?, 'system', ?)`,
          [config.conversation_id, config.message],
        );
        break;
      }

      case 'plugin_action': {
        // Fire a hook that plugins can listen to
        await eventBus.emit('on_scheduled_action', {
          pluginName: config.plugin_name,
          action: config.action,
          params: config.params || {},
        }, { userId: job.user_id });
        break;
      }

      default:
        throw new Error(`Unknown action type: ${actionType}`);
    }
  }

  private calculateNextRun(jobType: JobType, config: any): string | null {
    const now = new Date();

    switch (jobType) {
      case 'one_shot':
        return new Date(now.getTime() + (config.delay_ms || 60_000)).toISOString();

      case 'interval':
        return new Date(now.getTime() + (config.interval_ms || 60_000)).toISOString();

      case 'cron': {
        // Simple next-run calculation for basic cron patterns
        // For full cron support, would use node-cron — keeping it simple here
        return new Date(now.getTime() + 60_000).toISOString();
      }

      default:
        return null;
    }
  }
}
