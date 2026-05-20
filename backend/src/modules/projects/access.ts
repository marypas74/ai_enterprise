import { FastifyInstance } from 'fastify';
import { findOne } from '../../database/index.js';

// Types shared across project modules
export interface Project {
  id: number;
  name: string;
  description: string;
  owner_id: number;
  color: string;
  icon: string;
  is_archived: boolean;
  is_public: boolean;
}

export interface Board {
  id: number;
  project_id: number;
  name: string;
  description: string;
  is_default: boolean;
  sort_order: number;
}

export interface Column {
  id: number;
  board_id: number;
  name: string;
  color: string;
  wip_limit: number;
  sort_order: number;
}

export interface Card {
  id: number;
  column_id: number;
  title: string;
  description: string;
  priority: string;
  due_date: string;
  created_by: number;
  assigned_to: number;
  sort_order: number;
  is_archived: boolean;
}

// Helper: Check if user's group has Kanban access enabled
export async function checkKanbanAccess(fastify: FastifyInstance, userId: number): Promise<boolean> {
  // If user is admin, always allow Kanban access
  const user = await findOne<{ role: string }>(
    fastify.db,
    'SELECT role FROM users WHERE id = ?',
    [userId]
  );

  if (user?.role === 'admin') return true;

  // Try to check kanban_enabled column (may not exist in older databases)
  try {
    const result = await findOne<{ kanban_enabled: boolean }>(
      fastify.db,
      `SELECT MAX(g.kanban_enabled) as kanban_enabled
       FROM user_groups ug
       JOIN \`groups\` g ON ug.group_id = g.id
       WHERE ug.user_id = ? AND g.is_active = TRUE`,
      [userId]
    );

    return result?.kanban_enabled === true || (result?.kanban_enabled as unknown) === 1;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
  } catch (err: any) {
    // Column doesn't exist yet - allow access by default
    fastify.log.warn(`kanban_enabled column not found, allowing access by default: ${err.message}`);
    return true;
  }
}

// Helper: Check project access
export async function checkProjectAccess(
  fastify: FastifyInstance,
  userId: number,
  projectId: number,
  requiredRole?: string
): Promise<boolean> {
  // First check if user is a global Admin - they have full access to all projects
  const user = await findOne<{ role: string }>(
    fastify.db,
    'SELECT role FROM users WHERE id = ?',
    [userId]
  );

  if (user?.role === 'admin') {
    // Global admins have full access to everything
    return true;
  }

  const project = await findOne<Project & { member_role: string }>(
    fastify.db,
    `SELECT p.*, pm.role as member_role
     FROM projects p
     LEFT JOIN project_members pm ON p.id = pm.project_id AND pm.user_id = ?
     WHERE p.id = ? AND (p.owner_id = ? OR pm.user_id IS NOT NULL OR p.is_public = TRUE)`,
    [userId, projectId, userId]
  );

  if (!project) return false;
  if (project.owner_id === userId) return true;
  if (!requiredRole) return true;

  const roleHierarchy = ['viewer', 'member', 'admin'];
  const userRoleIndex = roleHierarchy.indexOf(project.member_role || 'viewer');
  const requiredRoleIndex = roleHierarchy.indexOf(requiredRole);

  return userRoleIndex >= requiredRoleIndex;
}
