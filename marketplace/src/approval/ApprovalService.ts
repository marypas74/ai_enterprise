import type mysql from 'mysql2/promise';
import { findOne, findMany, execute } from '../database/helpers.js';
import { createSkillInBackend } from '../backend/BackendClient.js';

interface ApprovalRequest {
  readonly id: number;
  readonly catalog_item_id: number;
  readonly requested_by: number;
  readonly status: 'pending' | 'approved' | 'rejected';
  readonly admin_notes: string | null;
  readonly resolved_at: string | null;
  readonly resolved_by: number | null;
}

interface CatalogItem {
  readonly id: number;
  readonly source_id: string;
  readonly type: 'skill' | 'agent' | 'mcp' | 'hook';
  readonly tier: string;
  readonly name: string;
  readonly display_name: string | null;
  readonly description: string | null;
  readonly category: string | null;
  readonly metadata: string | null;
  readonly version: string | null;
}

interface Installation {
  readonly id: number;
  readonly catalog_item_id: number;
  readonly installed_by: number;
  readonly status: string;
  readonly target_type: string;
  readonly target_id: number | null;
  readonly installed_version: string | null;
}

interface PendingListResult {
  readonly items: readonly Record<string, unknown>[];
  readonly total: number;
}

function assertPending(request: ApprovalRequest | null, requestId: number): asserts request is ApprovalRequest {
  if (!request) {
    throw new Error('Approval request not found');
  }
  if (request.status !== 'pending') {
    throw new Error(`Approval request ${requestId} has already been resolved (status: ${request.status})`);
  }
}

export class ApprovalService {
  constructor(private readonly pool: mysql.Pool) {}

  async approve(requestId: number, adminId: number, notes?: string): Promise<void> {
    const request = await findOne<ApprovalRequest>(
      this.pool,
      'SELECT * FROM marketplace_approval_requests WHERE id = ?',
      [requestId],
    );

    assertPending(request, requestId);

    await execute(
      this.pool,
      `UPDATE marketplace_approval_requests
       SET status = 'approved', resolved_at = NOW(), resolved_by = ?, admin_notes = ?
       WHERE id = ?`,
      [adminId, notes ?? null, requestId],
    );

    const catalogItem = await findOne<CatalogItem>(
      this.pool,
      'SELECT * FROM marketplace_catalog_items WHERE id = ?',
      [request.catalog_item_id],
    );

    const installation = await findOne<Installation>(
      this.pool,
      'SELECT * FROM marketplace_installations WHERE catalog_item_id = ? AND installed_by = ?',
      [request.catalog_item_id, request.requested_by],
    );

    if (!catalogItem || !installation) {
      return;
    }

    try {
      const targetId = await createSkillInBackend(catalogItem);

      await execute(
        this.pool,
        `UPDATE marketplace_installations
         SET status = 'installed', approved_by = ?, target_id = ?
         WHERE id = ?`,
        [adminId, targetId, installation.id],
      );
    } catch (error) {
      // Mark installation as failed if backend call fails
      await execute(
        this.pool,
        `UPDATE marketplace_installations SET status = 'failed' WHERE id = ?`,
        [installation.id],
      );
      throw new Error(
        `Approval succeeded but skill creation failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async reject(requestId: number, adminId: number, notes: string): Promise<void> {
    const request = await findOne<ApprovalRequest>(
      this.pool,
      'SELECT * FROM marketplace_approval_requests WHERE id = ?',
      [requestId],
    );

    assertPending(request, requestId);

    await execute(
      this.pool,
      `UPDATE marketplace_approval_requests
       SET status = 'rejected', resolved_at = NOW(), resolved_by = ?, admin_notes = ?
       WHERE id = ?`,
      [adminId, notes, requestId],
    );

    await execute(
      this.pool,
      `UPDATE marketplace_installations
       SET status = 'failed'
       WHERE catalog_item_id = ? AND installed_by = ?`,
      [request.catalog_item_id, request.requested_by],
    );
  }

  async listPending(page: number, limit: number): Promise<PendingListResult> {
    const offset = (page - 1) * limit;

    const countRow = await findOne<{ total: number }>(
      this.pool,
      `SELECT COUNT(*) AS total
       FROM marketplace_approval_requests
       WHERE status = 'pending'`,
      [],
    );

    const total = countRow?.total ?? 0;

    const items = await findMany<Record<string, unknown>>(
      this.pool,
      `SELECT ar.*, ci.name, ci.display_name, ci.type, ci.category, u.username AS requested_by_name
       FROM marketplace_approval_requests ar
       JOIN marketplace_catalog_items ci ON ar.catalog_item_id = ci.id
       JOIN users u ON ar.requested_by = u.id
       WHERE ar.status = 'pending'
       ORDER BY ar.created_at ASC
       LIMIT ? OFFSET ?`,
      [limit, offset],
    );

    return { items, total };
  }
}
