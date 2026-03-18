/**
 * PDFLockService — In-memory advisory lock for PDF editing.
 * Prevents concurrent edits to the same attachment.
 * Lock is released on save, explicit release, or timeout.
 */

const DEFAULT_LOCK_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

interface LockEntry {
  userId: number;
  acquiredAt: number;
  timeoutMs: number;
}

const locks = new Map<number, LockEntry>();

/**
 * Attempt to acquire an advisory lock on an attachment.
 * Returns true if acquired, false if another user holds it.
 */
export function acquireLock(
  attachmentId: number,
  userId: number,
  timeoutMs: number = DEFAULT_LOCK_TIMEOUT_MS,
): { acquired: boolean; heldBy?: number } {
  cleanExpiredLocks();

  const existing = locks.get(attachmentId);
  if (existing) {
    // Same user can re-acquire (refresh)
    if (existing.userId === userId) {
      existing.acquiredAt = Date.now();
      existing.timeoutMs = timeoutMs;
      return { acquired: true };
    }
    return { acquired: false, heldBy: existing.userId };
  }

  locks.set(attachmentId, { userId, acquiredAt: Date.now(), timeoutMs });
  return { acquired: true };
}

/**
 * Release a lock. Only the lock holder (or force) can release.
 */
export function releaseLock(
  attachmentId: number,
  userId: number,
  force: boolean = false,
): boolean {
  const existing = locks.get(attachmentId);
  if (!existing) return true; // Not locked

  if (existing.userId === userId || force) {
    locks.delete(attachmentId);
    return true;
  }
  return false; // Not the lock holder
}

/**
 * Check if an attachment is locked and by whom.
 */
export function getLockStatus(
  attachmentId: number,
): { locked: boolean; userId?: number; acquiredAt?: number } {
  cleanExpiredLocks();

  const existing = locks.get(attachmentId);
  if (!existing) return { locked: false };

  return {
    locked: true,
    userId: existing.userId,
    acquiredAt: existing.acquiredAt,
  };
}

/**
 * Remove expired locks.
 */
function cleanExpiredLocks(): void {
  const now = Date.now();
  for (const [id, entry] of locks.entries()) {
    if (now - entry.acquiredAt > entry.timeoutMs) {
      locks.delete(id);
    }
  }
}

/**
 * Get count of active locks (for monitoring).
 */
export function getActiveLockCount(): number {
  cleanExpiredLocks();
  return locks.size;
}
