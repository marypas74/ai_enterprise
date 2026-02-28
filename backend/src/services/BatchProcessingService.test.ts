import { describe, it, expect, vi, beforeEach } from 'vitest';
import { submitBatch, getBatchStatus, cancelBatch } from './BatchProcessingService.js';

describe('BatchProcessingService', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('submitBatch', () => {
    it('should submit batch and return batch ID', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ id: 'batch_abc123' }),
      }));

      const batchId = await submitBatch('test-key', [
        {
          customId: 'req-1',
          model: 'claude-sonnet-4-20250514',
          messages: [{ role: 'user', content: 'Hello' }],
          maxTokens: 1024,
        },
      ]);

      expect(batchId).toBe('batch_abc123');

      const fetchCall = (fetch as any).mock.calls[0];
      expect(fetchCall[0]).toBe('https://api.anthropic.com/v1/messages/batches');
      expect(fetchCall[1].method).toBe('POST');

      const body = JSON.parse(fetchCall[1].body);
      expect(body.requests).toHaveLength(1);
      expect(body.requests[0].custom_id).toBe('req-1');
      expect(body.requests[0].params.model).toBe('claude-sonnet-4-20250514');

      vi.unstubAllGlobals();
    });

    it('should throw on API error', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        text: () => Promise.resolve('Bad Request'),
      }));

      await expect(
        submitBatch('test-key', [{ customId: 'x', model: 'claude-sonnet-4-20250514', messages: [] }])
      ).rejects.toThrow('Batch submit failed (400)');

      vi.unstubAllGlobals();
    });
  });

  describe('getBatchStatus', () => {
    it('should return batch status', async () => {
      const mockStatus = {
        id: 'batch_abc123',
        type: 'message_batch',
        processing_status: 'ended',
        request_counts: { processing: 0, succeeded: 5, errored: 0, canceled: 0, expired: 0 },
        created_at: '2026-02-28T00:00:00Z',
        ended_at: '2026-02-28T00:01:00Z',
        results_url: 'https://api.anthropic.com/v1/messages/batches/batch_abc123/results',
      };

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockStatus),
      }));

      const status = await getBatchStatus('test-key', 'batch_abc123');
      expect(status.processing_status).toBe('ended');
      expect(status.request_counts.succeeded).toBe(5);

      vi.unstubAllGlobals();
    });
  });

  describe('cancelBatch', () => {
    it('should cancel batch and return status', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          id: 'batch_abc123',
          processing_status: 'canceling',
          request_counts: { processing: 2, succeeded: 3, errored: 0, canceled: 0, expired: 0 },
        }),
      }));

      const status = await cancelBatch('test-key', 'batch_abc123');
      expect(status.processing_status).toBe('canceling');

      const fetchCall = (fetch as any).mock.calls[0];
      expect(fetchCall[0]).toContain('/cancel');
      expect(fetchCall[1].method).toBe('POST');

      vi.unstubAllGlobals();
    });
  });
});
