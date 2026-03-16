import type { Pool } from 'mysql2/promise';
import type { FastifyBaseLogger } from 'fastify';

/**
 * Context passed to tool execution.
 * Core fields (userName, projectName, projectId, userId) are always required.
 * db and log are optional — not all tool contexts need database or logger access.
 */
export interface ToolContext {
  readonly userName: string;
  readonly projectName: string;
  readonly projectId: number;
  readonly userId: number;
  readonly db?: Pool;
  readonly log?: FastifyBaseLogger;
}
