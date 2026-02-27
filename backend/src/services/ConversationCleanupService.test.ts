/**
 * Unit tests for ConversationCleanupService
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConversationCleanupService } from './ConversationCleanupService.js';

// Mock mysql pool
function createMockPool(archiveRows = 0, deleteRows = 0) {
  return {
    execute: vi.fn()
      .mockResolvedValueOnce([{ affectedRows: archiveRows }]) // archive query
      .mockResolvedValueOnce([{ affectedRows: deleteRows }])  // delete query
  } as any;
}

describe('ConversationCleanupService', () => {
  let service: ConversationCleanupService;

  beforeEach(() => {
    service = new ConversationCleanupService();
  });

  describe('runCleanup', () => {
    it('should archive conversations older than 24h and delete older than 60d', async () => {
      const mockPool = createMockPool(5, 2);
      const result = await service.runCleanup(mockPool);

      expect(result.archived).toBe(5);
      expect(result.deleted).toBe(2);
      expect(mockPool.execute).toHaveBeenCalledTimes(2);
    });

    it('should execute archive query with correct SQL', async () => {
      const mockPool = createMockPool(0, 0);
      await service.runCleanup(mockPool);

      const archiveCall = mockPool.execute.mock.calls[0][0] as string;
      expect(archiveCall).toContain('UPDATE conversations');
      expect(archiveCall).toContain('is_archived = TRUE');
      expect(archiveCall).toContain('INTERVAL 24 HOUR');
      expect(archiveCall).toContain('is_archived = FALSE');
    });

    it('should execute delete query with correct SQL', async () => {
      const mockPool = createMockPool(0, 0);
      await service.runCleanup(mockPool);

      const deleteCall = mockPool.execute.mock.calls[1][0] as string;
      expect(deleteCall).toContain('DELETE FROM conversations');
      expect(deleteCall).toContain('INTERVAL 60 DAY');
    });

    it('should return zeros when no rows affected', async () => {
      const mockPool = createMockPool(0, 0);
      const result = await service.runCleanup(mockPool);

      expect(result.archived).toBe(0);
      expect(result.deleted).toBe(0);
    });

    it('should handle database errors gracefully', async () => {
      const mockPool = {
        execute: vi.fn().mockRejectedValue(new Error('Connection lost'))
      } as any;

      const result = await service.runCleanup(mockPool);
      expect(result.archived).toBe(0);
      expect(result.deleted).toBe(0);
    });
  });

  describe('start/stop', () => {
    it('should start and stop the timer', () => {
      vi.useFakeTimers();
      const mockPool = createMockPool(0, 0);

      service.start(mockPool);
      // Timer should be running - verify by stopping
      service.stop();

      vi.useRealTimers();
    });

    it('should run cleanup immediately on start', async () => {
      const mockPool = createMockPool(0, 0);
      service.start(mockPool);

      // First call is the immediate run
      expect(mockPool.execute).toHaveBeenCalled();

      service.stop();
    });
  });
});
