import type mysql from 'mysql2/promise';
import { findOne, findMany, insertOne, execute } from '../database/helpers.js';
import { mapTargetType, requiresApproval } from './TypeMapper.js';
import { generateServiceToken } from '../auth/serviceToken.js';
import { config } from '../config.js';

const MAX_INSTALLATIONS_PER_USER = 50;

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

interface InstallResult {
  readonly installationId: number;
  readonly status: 'installed' | 'pending_approval';
  readonly targetId?: number;
}

interface PaginatedInstallations {
  readonly items: readonly Record<string, unknown>[];
  readonly total: number;
  readonly page: number;
  readonly limit: number;
}

async function callBackendCreateSkill(
  catalogItem: CatalogItem,
  userId: number,
): Promise<number | null> {
  const token = generateServiceToken(config.jwtSecret);
  const response = await fetch(`${config.backendUrl}/api/skills`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      name: catalogItem.name,
      display_name: catalogItem.display_name,
      description: catalogItem.description,
      category: catalogItem.category,
      type: catalogItem.type,
      metadata: catalogItem.metadata,
      installed_by: userId,
    }),
  });

  if (!response.ok) {
    return null;
  }

  const body = await response.json();
  return body?.data?.id ?? null;
}

async function callBackendDeleteSkill(targetId: number): Promise<void> {
  const token = generateServiceToken(config.jwtSecret);
  await fetch(`${config.backendUrl}/api/skills/${targetId}`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
}

export class InstallService {
  constructor(private readonly pool: mysql.Pool) {}

  async install(catalogItemId: number, userId: number): Promise<InstallResult> {
    const countRow = await findOne<{ count: number }>(
      this.pool,
      'SELECT COUNT(*) AS count FROM marketplace_installations WHERE installed_by = ?',
      [userId],
    );
    const installCount = countRow?.count ?? 0;

    if (installCount >= MAX_INSTALLATIONS_PER_USER) {
      throw new Error(`Maximum installation limit (${MAX_INSTALLATIONS_PER_USER}) reached`);
    }

    const catalogItem = await findOne<CatalogItem>(
      this.pool,
      'SELECT * FROM marketplace_catalog_items WHERE id = ?',
      [catalogItemId],
    );

    if (!catalogItem) {
      throw new Error('Catalog item not found');
    }

    const existing = await findOne<{ id: number }>(
      this.pool,
      'SELECT id FROM marketplace_installations WHERE catalog_item_id = ? AND installed_by = ?',
      [catalogItemId, userId],
    );

    if (existing) {
      throw new Error('Item is already installed by this user');
    }

    const targetType = mapTargetType(catalogItem.type);
    const needsApproval = requiresApproval(catalogItem.type);

    if (needsApproval) {
      return this.installWithApproval(catalogItemId, userId, targetType, catalogItem.version);
    }

    return this.installDirect(catalogItemId, userId, targetType, catalogItem, catalogItem.version);
  }

  private async installDirect(
    catalogItemId: number,
    userId: number,
    targetType: string,
    catalogItem: CatalogItem,
    version: string | null,
  ): Promise<InstallResult> {
    const installationId = await insertOne(
      this.pool,
      `INSERT INTO marketplace_installations
        (catalog_item_id, installed_by, status, target_type, installed_version)
       VALUES (?, ?, 'installed', ?, ?)`,
      [catalogItemId, userId, targetType, version],
    );

    const targetId = await callBackendCreateSkill(catalogItem, userId);

    if (targetId) {
      await execute(
        this.pool,
        'UPDATE marketplace_installations SET target_id = ? WHERE id = ?',
        [targetId, installationId],
      );
    }

    return { installationId, status: 'installed', targetId: targetId ?? undefined };
  }

  private async installWithApproval(
    catalogItemId: number,
    userId: number,
    targetType: string,
    version: string | null,
  ): Promise<InstallResult> {
    const installationId = await insertOne(
      this.pool,
      `INSERT INTO marketplace_installations
        (catalog_item_id, installed_by, status, target_type, installed_version)
       VALUES (?, ?, 'pending_approval', ?, ?)`,
      [catalogItemId, userId, targetType, version],
    );

    await insertOne(
      this.pool,
      `INSERT INTO marketplace_approval_requests
        (catalog_item_id, requested_by, status)
       VALUES (?, ?, 'pending')`,
      [catalogItemId, userId],
    );

    return { installationId, status: 'pending_approval' };
  }

  async uninstall(installationId: number, userId: number): Promise<void> {
    const installation = await findOne<Installation>(
      this.pool,
      'SELECT * FROM marketplace_installations WHERE id = ? AND installed_by = ?',
      [installationId, userId],
    );

    if (!installation) {
      throw new Error('Installation not found');
    }

    if (installation.target_id) {
      await callBackendDeleteSkill(installation.target_id);
    }

    await execute(
      this.pool,
      'DELETE FROM marketplace_installations WHERE id = ?',
      [installationId],
    );
  }

  async listByUser(userId: number, page: number, limit: number): Promise<PaginatedInstallations> {
    const offset = (page - 1) * limit;

    const countRow = await findOne<{ total: number }>(
      this.pool,
      `SELECT COUNT(*) AS total
       FROM marketplace_installations i
       JOIN marketplace_catalog_items c ON i.catalog_item_id = c.id
       WHERE i.installed_by = ?`,
      [userId],
    );

    const total = countRow?.total ?? 0;

    const items = await findMany<Record<string, unknown>>(
      this.pool,
      `SELECT i.*, c.name, c.display_name, c.type, c.category
       FROM marketplace_installations i
       JOIN marketplace_catalog_items c ON i.catalog_item_id = c.id
       WHERE i.installed_by = ?
       ORDER BY i.installed_at DESC
       LIMIT ? OFFSET ?`,
      [userId, limit, offset],
    );

    return { items, total, page, limit };
  }

  async getInstallation(id: number): Promise<Installation | null> {
    return findOne<Installation>(
      this.pool,
      'SELECT * FROM marketplace_installations WHERE id = ?',
      [id],
    );
  }
}
