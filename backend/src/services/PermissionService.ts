/**
 * Permission Service — Resource-based permissions
 *
 * Ported from Cheshire Cat's permission system.
 * Each user can have per-resource permissions: read, write, edit, delete, list.
 * Admins bypass all permission checks.
 *
 * Resources: memory, conversation, settings, plugins, hooks, tools,
 *            forms, models, providers, users, scheduler
 */

import type mysql from 'mysql2/promise';
import { findOne, findMany } from '../database/index.js';

export type Resource =
  | 'memory'
  | 'conversation'
  | 'settings'
  | 'plugins'
  | 'hooks'
  | 'tools'
  | 'forms'
  | 'models'
  | 'providers'
  | 'users'
  | 'scheduler';

export type Permission = 'read' | 'write' | 'edit' | 'delete' | 'list';

export interface ResourcePermission {
  resource: Resource;
  can_read: boolean;
  can_write: boolean;
  can_edit: boolean;
  can_delete: boolean;
  can_list: boolean;
}

const ALL_RESOURCES: Resource[] = [
  'memory', 'conversation', 'settings', 'plugins', 'hooks',
  'tools', 'forms', 'models', 'providers', 'users', 'scheduler',
];

/** Default permissions for regular users */
const DEFAULT_USER_PERMISSIONS: Record<Resource, Record<Permission, boolean>> = {
  memory:       { read: true,  write: true,  edit: true,  delete: true,  list: true },
  conversation: { read: true,  write: true,  edit: false, delete: true,  list: true },
  settings:     { read: true,  write: false, edit: false, delete: false, list: false },
  plugins:      { read: false, write: false, edit: false, delete: false, list: false },
  hooks:        { read: false, write: false, edit: false, delete: false, list: false },
  tools:        { read: true,  write: false, edit: false, delete: false, list: true },
  forms:        { read: true,  write: false, edit: false, delete: false, list: true },
  models:       { read: true,  write: false, edit: false, delete: false, list: true },
  providers:    { read: false, write: false, edit: false, delete: false, list: false },
  users:        { read: false, write: false, edit: false, delete: false, list: false },
  scheduler:    { read: true,  write: true,  edit: true,  delete: true,  list: true },
};

export class PermissionService {
  constructor(private db: mysql.Pool) {}

  /**
   * Check if a user has a specific permission on a resource.
   * Admins always have all permissions.
   */
  async check(userId: number, userRole: string, resource: Resource, permission: Permission): Promise<boolean> {
    // Admins bypass all checks
    if (userRole === 'admin') return true;

    // Check DB for custom permissions
    const row = await findOne<any>(
      this.db,
      'SELECT can_read, can_write, can_edit, can_delete, can_list FROM resource_permissions WHERE user_id = ? AND resource = ?',
      [userId, resource],
    );

    if (row) {
      return !!row[`can_${permission}`];
    }

    // Fall back to defaults
    return DEFAULT_USER_PERMISSIONS[resource]?.[permission] ?? false;
  }

  /**
   * Get all permissions for a user across all resources.
   */
  async getUserPermissions(userId: number, userRole: string): Promise<ResourcePermission[]> {
    if (userRole === 'admin') {
      return ALL_RESOURCES.map(resource => ({
        resource,
        can_read: true,
        can_write: true,
        can_edit: true,
        can_delete: true,
        can_list: true,
      }));
    }

    const rows = await findMany<any>(
      this.db,
      'SELECT resource, can_read, can_write, can_edit, can_delete, can_list FROM resource_permissions WHERE user_id = ?',
      [userId],
    );

    const dbPerms = new Map(rows.map(r => [r.resource as Resource, r]));

    return ALL_RESOURCES.map(resource => {
      const row = dbPerms.get(resource);
      const defaults = DEFAULT_USER_PERMISSIONS[resource];
      return {
        resource,
        can_read: row ? !!row.can_read : defaults.read,
        can_write: row ? !!row.can_write : defaults.write,
        can_edit: row ? !!row.can_edit : defaults.edit,
        can_delete: row ? !!row.can_delete : defaults.delete,
        can_list: row ? !!row.can_list : defaults.list,
      };
    });
  }

  /**
   * Set permissions for a user on a resource (admin only).
   */
  async setPermission(
    userId: number,
    resource: Resource,
    permissions: Partial<Record<Permission, boolean>>,
  ): Promise<void> {
    const existing = await findOne<any>(
      this.db,
      'SELECT id FROM resource_permissions WHERE user_id = ? AND resource = ?',
      [userId, resource],
    );

    if (existing) {
      const fields: string[] = [];
      const values: any[] = [];
      for (const [perm, val] of Object.entries(permissions)) {
        if (['read', 'write', 'edit', 'delete', 'list'].includes(perm)) {
          fields.push(`can_${perm} = ?`);
          values.push(val ? 1 : 0);
        }
      }
      if (fields.length > 0) {
        values.push(userId, resource);
        await this.db.execute(
          `UPDATE resource_permissions SET ${fields.join(', ')} WHERE user_id = ? AND resource = ?`,
          values,
        );
      }
    } else {
      const defaults = DEFAULT_USER_PERMISSIONS[resource];
      await this.db.execute(
        `INSERT INTO resource_permissions (user_id, resource, can_read, can_write, can_edit, can_delete, can_list) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          userId,
          resource,
          permissions.read !== undefined ? (permissions.read ? 1 : 0) : (defaults.read ? 1 : 0),
          permissions.write !== undefined ? (permissions.write ? 1 : 0) : (defaults.write ? 1 : 0),
          permissions.edit !== undefined ? (permissions.edit ? 1 : 0) : (defaults.edit ? 1 : 0),
          permissions.delete !== undefined ? (permissions.delete ? 1 : 0) : (defaults.delete ? 1 : 0),
          permissions.list !== undefined ? (permissions.list ? 1 : 0) : (defaults.list ? 1 : 0),
        ],
      );
    }
  }

  /**
   * Reset a user's permissions on a resource to defaults (removes custom override).
   */
  async resetPermission(userId: number, resource: Resource): Promise<void> {
    await this.db.execute(
      'DELETE FROM resource_permissions WHERE user_id = ? AND resource = ?',
      [userId, resource],
    );
  }

  /**
   * Reset all permissions for a user.
   */
  async resetAllPermissions(userId: number): Promise<void> {
    await this.db.execute('DELETE FROM resource_permissions WHERE user_id = ?', [userId]);
  }

  /**
   * Get the default permission set (for reference/UI display).
   */
  getDefaults(): Record<Resource, Record<Permission, boolean>> {
    return { ...DEFAULT_USER_PERMISSIONS };
  }

  /**
   * Get available resources and permissions.
   */
  getSchema(): { resources: Resource[]; permissions: Permission[] } {
    return {
      resources: [...ALL_RESOURCES],
      permissions: ['read', 'write', 'edit', 'delete', 'list'],
    };
  }
}
