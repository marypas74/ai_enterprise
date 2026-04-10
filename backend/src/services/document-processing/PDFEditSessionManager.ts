/**
 * PDFEditSessionManager — In-memory PDF editing session manager.
 *
 * Holds a live PDF buffer per attachment with undo/redo stacks.
 * The frontend widget applies edits server-side, and page renders
 * read from the session buffer so changes are immediately visible.
 */

import { acquireLock, releaseLock } from './PDFLockService.js';
import fs from 'fs/promises';

interface EditSession {
  attachmentId: number;
  userId: number;
  currentBuffer: Buffer;
  undoStack: Buffer[];
  redoStack: Buffer[];
  originalBuffer: Buffer;
  createdAt: number;
  lastActivityAt: number;
}

/** Max undo depth — reduced for buffers > 5MB to limit memory */
const MAX_UNDO_DEPTH = 50;
const MAX_UNDO_DEPTH_LARGE = 20;
const LARGE_BUFFER_THRESHOLD = 5 * 1024 * 1024; // 5MB
const MAX_BUFFER_SIZE = 50 * 1024 * 1024; // 50MB
const SESSION_IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
const CLEANUP_INTERVAL_MS = 60 * 1000; // 1 minute

const sessions = new Map<number, EditSession>();
let cleanupTimer: ReturnType<typeof setInterval> | null = null;

function getMaxUndo(buffer: Buffer): number {
  return buffer.length > LARGE_BUFFER_THRESHOLD ? MAX_UNDO_DEPTH_LARGE : MAX_UNDO_DEPTH;
}

function ensureCleanupTimer(): void {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(() => {
    cleanExpiredSessions();
  }, CLEANUP_INTERVAL_MS);
  // Allow process to exit even if timer is running
  if (cleanupTimer && typeof cleanupTimer === 'object' && 'unref' in cleanupTimer) {
    cleanupTimer.unref();
  }
}

/**
 * Get or create an editing session for an attachment.
 * Acquires an advisory lock — throws if another user holds it.
 */
export async function getOrCreateSession(
  attachmentId: number,
  userId: number,
  filePath: string,
): Promise<EditSession> {
  const existing = sessions.get(attachmentId);
  if (existing) {
    if (existing.userId !== userId) {
      throw new Error(`PDF is being edited by another user (userId=${existing.userId})`);
    }
    existing.lastActivityAt = Date.now();
    return existing;
  }

  // Acquire lock
  const lock = acquireLock(attachmentId, userId);
  if (!lock.acquired) {
    throw new Error(`PDF is locked by another user (userId=${lock.heldBy})`);
  }

  const buffer = await fs.readFile(filePath);
  if (buffer.length > MAX_BUFFER_SIZE) {
    releaseLock(attachmentId, userId);
    throw new Error(`PDF too large for editing (${(buffer.length / 1024 / 1024).toFixed(1)}MB, max ${MAX_BUFFER_SIZE / 1024 / 1024}MB)`);
  }

  const session: EditSession = {
    attachmentId,
    userId,
    currentBuffer: Buffer.from(buffer),
    undoStack: [],
    redoStack: [],
    originalBuffer: buffer,
    createdAt: Date.now(),
    lastActivityAt: Date.now(),
  };

  sessions.set(attachmentId, session);
  ensureCleanupTimer();
  return session;
}

/**
 * Get the current session buffer for an attachment, or null if no active session.
 */
export function getSessionBuffer(attachmentId: number): Buffer | null {
  const session = sessions.get(attachmentId);
  if (!session) return null;
  session.lastActivityAt = Date.now();
  return session.currentBuffer;
}

/**
 * Apply an edit to the session buffer.
 * Pushes the current buffer to the undo stack, applies editFn, clears redo stack.
 */
export async function applyEdit(
  attachmentId: number,
  userId: number,
  filePath: string,
  editFn: (buffer: Buffer) => Promise<Buffer>,
): Promise<Buffer> {
  const session = await getOrCreateSession(attachmentId, userId, filePath);

  // Push current state to undo stack
  const maxUndo = getMaxUndo(session.currentBuffer);
  session.undoStack.push(Buffer.from(session.currentBuffer));
  if (session.undoStack.length > maxUndo) {
    session.undoStack.shift(); // Remove oldest
  }

  // Apply edit
  const newBuffer = await editFn(session.currentBuffer);
  session.currentBuffer = newBuffer;

  // Clear redo stack (new edit branch)
  session.redoStack.length = 0;
  session.lastActivityAt = Date.now();

  return newBuffer;
}

/**
 * Undo the last edit. Returns the restored buffer, or null if nothing to undo.
 */
export function undoEdit(attachmentId: number, userId: number): Buffer | null {
  const session = sessions.get(attachmentId);
  if (!session || session.userId !== userId) return null;
  if (session.undoStack.length === 0) return null;

  // Push current to redo
  session.redoStack.push(session.currentBuffer);

  // Pop undo
  session.currentBuffer = session.undoStack.pop()!;
  session.lastActivityAt = Date.now();

  return session.currentBuffer;
}

/**
 * Redo a previously undone edit. Returns the restored buffer, or null if nothing to redo.
 */
export function redoEdit(attachmentId: number, userId: number): Buffer | null {
  const session = sessions.get(attachmentId);
  if (!session || session.userId !== userId) return null;
  if (session.redoStack.length === 0) return null;

  // Push current to undo
  session.undoStack.push(session.currentBuffer);

  // Pop redo
  session.currentBuffer = session.redoStack.pop()!;
  session.lastActivityAt = Date.now();

  return session.currentBuffer;
}

/**
 * Save the current session buffer to disk (overwrite original attachment file).
 * Clears undo/redo stacks and destroys the session.
 */
export async function saveSession(
  attachmentId: number,
  userId: number,
  filePath: string,
): Promise<void> {
  const session = sessions.get(attachmentId);
  if (!session || session.userId !== userId) {
    throw new Error('No active editing session for this attachment');
  }

  await fs.writeFile(filePath, session.currentBuffer);
  destroySession(attachmentId, userId);
}

/**
 * Destroy a session and release its lock.
 */
export function destroySession(attachmentId: number, userId?: number): void {
  const session = sessions.get(attachmentId);
  if (!session) return;

  const uid = userId ?? session.userId;
  sessions.delete(attachmentId);
  releaseLock(attachmentId, uid);
}

/**
 * Check if a session exists for an attachment.
 */
export function hasSession(attachmentId: number): boolean {
  return sessions.has(attachmentId);
}

/**
 * Clean up sessions that have been idle longer than the timeout.
 */
export function cleanExpiredSessions(maxIdleMs: number = SESSION_IDLE_TIMEOUT_MS): void {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (now - session.lastActivityAt > maxIdleMs) {
      destroySession(id, session.userId);
    }
  }

  // Stop timer if no sessions left
  if (sessions.size === 0 && cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }
}