/**
 * useParlantStore — Unit tests for the Parlant Zustand store.
 *
 * Tests cover:
 * - Initial state
 * - checkHealth (healthy, unhealthy, error)
 * - fetchAgents / createAgent / deleteAgent
 * - fetchGuidelines / createGuideline / updateGuideline / deleteGuideline
 * - fetchSessions / createSession / deleteSession
 * - sendMessage
 * - clearError
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useParlantStore } from './useParlantStore';
import { api } from '../services/api';

const mockApi = vi.mocked(api);

describe('useParlantStore', () => {
  beforeEach(() => {
    useParlantStore.setState({
      agents: [],
      currentAgent: null,
      guidelines: [],
      sessions: [],
      currentSession: null,
      events: [],
      evaluations: [],
      isLoading: false,
      error: null,
      serviceHealth: 'unknown',
    });
    vi.clearAllMocks();
  });

  describe('initial state', () => {
    it('should have empty agents', () => {
      expect(useParlantStore.getState().agents).toEqual([]);
    });

    it('should have serviceHealth as unknown', () => {
      expect(useParlantStore.getState().serviceHealth).toBe('unknown');
    });

    it('should have no error', () => {
      expect(useParlantStore.getState().error).toBeNull();
    });

    it('should have no currentAgent', () => {
      expect(useParlantStore.getState().currentAgent).toBeNull();
    });
  });

  describe('checkHealth', () => {
    it('should set serviceHealth to healthy when API returns healthy', async () => {
      mockApi.get.mockResolvedValueOnce({
        data: { status: 'healthy' },
      } as any);

      await useParlantStore.getState().checkHealth();

      expect(useParlantStore.getState().serviceHealth).toBe('healthy');
    });

    it('should set serviceHealth to healthy when API returns ok', async () => {
      mockApi.get.mockResolvedValueOnce({
        data: { status: 'ok' },
      } as any);

      await useParlantStore.getState().checkHealth();

      expect(useParlantStore.getState().serviceHealth).toBe('healthy');
    });

    it('should set serviceHealth to unhealthy on non-healthy status', async () => {
      mockApi.get.mockResolvedValueOnce({
        data: { status: 'degraded' },
      } as any);

      await useParlantStore.getState().checkHealth();

      expect(useParlantStore.getState().serviceHealth).toBe('unhealthy');
    });

    it('should set serviceHealth to unhealthy on API error', async () => {
      mockApi.get.mockRejectedValueOnce(new Error('Connection refused'));

      await useParlantStore.getState().checkHealth();

      expect(useParlantStore.getState().serviceHealth).toBe('unhealthy');
    });
  });

  describe('fetchAgents', () => {
    it('should set agents from API response', async () => {
      const mockAgents = [
        { id: 'agent-1', name: 'Helper' },
        { id: 'agent-2', name: 'Coder' },
      ];
      mockApi.get.mockResolvedValueOnce({ data: mockAgents } as any);

      await useParlantStore.getState().fetchAgents();

      expect(useParlantStore.getState().agents).toEqual(mockAgents);
      expect(useParlantStore.getState().isLoading).toBe(false);
    });

    it('should set error on API failure', async () => {
      mockApi.get.mockRejectedValueOnce({
        response: { data: { error: 'Service unavailable' } },
      });

      await useParlantStore.getState().fetchAgents();

      expect(useParlantStore.getState().error).toBe('Service unavailable');
      expect(useParlantStore.getState().isLoading).toBe(false);
    });

    it('should handle null response data gracefully', async () => {
      mockApi.get.mockResolvedValueOnce({ data: null } as any);

      await useParlantStore.getState().fetchAgents();

      expect(useParlantStore.getState().agents).toEqual([]);
    });
  });

  describe('createAgent', () => {
    it('should add new agent to the list', async () => {
      const newAgent = { id: 'new-1', name: 'New Agent' };
      mockApi.post.mockResolvedValueOnce({ data: newAgent } as any);

      const result = await useParlantStore.getState().createAgent('New Agent', 'Description');

      expect(result).toEqual(newAgent);
      expect(useParlantStore.getState().agents).toContainEqual(newAgent);
    });

    it('should return null on failure', async () => {
      mockApi.post.mockRejectedValueOnce({
        response: { data: { error: 'Invalid name' } },
      });

      const result = await useParlantStore.getState().createAgent('');

      expect(result).toBeNull();
      expect(useParlantStore.getState().error).toBe('Invalid name');
    });
  });

  describe('deleteAgent', () => {
    it('should remove agent from list and clear currentAgent if matching', async () => {
      const agent = { id: 'agent-1', name: 'Test' };
      useParlantStore.setState({
        agents: [agent] as any[],
        currentAgent: agent as any,
      });

      mockApi.delete.mockResolvedValueOnce({ data: {} } as any);

      const result = await useParlantStore.getState().deleteAgent('agent-1');

      expect(result).toBe(true);
      expect(useParlantStore.getState().agents).toHaveLength(0);
      expect(useParlantStore.getState().currentAgent).toBeNull();
    });

    it('should keep currentAgent if different agent is deleted', async () => {
      const agent1 = { id: 'agent-1', name: 'Agent 1' };
      const agent2 = { id: 'agent-2', name: 'Agent 2' };
      useParlantStore.setState({
        agents: [agent1, agent2] as any[],
        currentAgent: agent2 as any,
      });

      mockApi.delete.mockResolvedValueOnce({ data: {} } as any);

      await useParlantStore.getState().deleteAgent('agent-1');

      expect(useParlantStore.getState().currentAgent).toEqual(agent2);
    });

    it('should return false on failure', async () => {
      mockApi.delete.mockRejectedValueOnce({
        response: { data: { error: 'Not found' } },
      });

      const result = await useParlantStore.getState().deleteAgent('nonexistent');

      expect(result).toBe(false);
    });
  });

  describe('fetchGuidelines', () => {
    it('should set guidelines from API', async () => {
      const mockGuidelines = [
        { id: 'g1', condition: 'if greeting', action: 'say hello' },
      ];
      mockApi.get.mockResolvedValueOnce({ data: mockGuidelines } as any);

      await useParlantStore.getState().fetchGuidelines('agent-1');

      expect(useParlantStore.getState().guidelines).toEqual(mockGuidelines);
    });
  });

  describe('createGuideline', () => {
    it('should add new guideline to the list', async () => {
      const newGuideline = { id: 'g-new', condition: 'if x', action: 'do y' };
      mockApi.post.mockResolvedValueOnce({ data: newGuideline } as any);

      const result = await useParlantStore.getState().createGuideline('agent-1', 'if x', 'do y', 5);

      expect(result).toEqual(newGuideline);
      expect(useParlantStore.getState().guidelines).toContainEqual(newGuideline);
    });
  });

  describe('updateGuideline', () => {
    it('should update guideline in the list', async () => {
      useParlantStore.setState({
        guidelines: [{ id: 'g1', condition: 'old', action: 'old action', enabled: true }] as any[],
      });

      mockApi.patch.mockResolvedValueOnce({ data: {} } as any);

      const result = await useParlantStore.getState().updateGuideline('agent-1', 'g1', {
        condition: 'new condition',
      });

      expect(result).toBe(true);
      expect(useParlantStore.getState().guidelines[0].condition).toBe('new condition');
    });

    it('should return false on failure', async () => {
      mockApi.patch.mockRejectedValueOnce({
        response: { data: { error: 'Invalid' } },
      });

      const result = await useParlantStore.getState().updateGuideline('a', 'g', {});

      expect(result).toBe(false);
    });
  });

  describe('deleteGuideline', () => {
    it('should remove guideline from the list', async () => {
      useParlantStore.setState({
        guidelines: [{ id: 'g1' }, { id: 'g2' }] as any[],
      });

      mockApi.delete.mockResolvedValueOnce({ data: {} } as any);

      const result = await useParlantStore.getState().deleteGuideline('agent-1', 'g1');

      expect(result).toBe(true);
      expect(useParlantStore.getState().guidelines).toHaveLength(1);
      expect(useParlantStore.getState().guidelines[0].id).toBe('g2');
    });
  });

  describe('sessions', () => {
    it('fetchSessions should set sessions from API', async () => {
      const mockSessions = [{ id: 's1', agentId: 'a1' }];
      mockApi.get.mockResolvedValueOnce({ data: mockSessions } as any);

      await useParlantStore.getState().fetchSessions('a1');

      expect(useParlantStore.getState().sessions).toEqual(mockSessions);
      expect(mockApi.get).toHaveBeenCalledWith('/parlant/sessions?agentId=a1');
    });

    it('fetchSessions without agentId should call without params', async () => {
      mockApi.get.mockResolvedValueOnce({ data: [] } as any);

      await useParlantStore.getState().fetchSessions();

      expect(mockApi.get).toHaveBeenCalledWith('/parlant/sessions');
    });

    it('createSession should add session and set as current', async () => {
      const newSession = { id: 's-new', agentId: 'a1' };
      mockApi.post.mockResolvedValueOnce({ data: newSession } as any);

      const result = await useParlantStore.getState().createSession('a1', 'customer-1');

      expect(result).toEqual(newSession);
      expect(useParlantStore.getState().currentSession).toEqual(newSession);
      expect(useParlantStore.getState().sessions).toContainEqual(newSession);
    });

    it('deleteSession should remove from list and clear current if matching', async () => {
      const session = { id: 's1', agentId: 'a1' };
      useParlantStore.setState({
        sessions: [session] as any[],
        currentSession: session as any,
      });

      mockApi.delete.mockResolvedValueOnce({ data: {} } as any);

      const result = await useParlantStore.getState().deleteSession('s1');

      expect(result).toBe(true);
      expect(useParlantStore.getState().sessions).toHaveLength(0);
      expect(useParlantStore.getState().currentSession).toBeNull();
    });
  });

  describe('sendMessage', () => {
    it('should add event to events list', async () => {
      const newEvent = { id: 'e1', kind: 'message', source: 'human' };
      mockApi.post.mockResolvedValueOnce({ data: newEvent } as any);

      const result = await useParlantStore.getState().sendMessage('s1', 'Hello');

      expect(result).toEqual(newEvent);
      expect(useParlantStore.getState().events).toContainEqual(newEvent);
    });

    it('should return null on failure', async () => {
      mockApi.post.mockRejectedValueOnce({
        response: { data: { error: 'Session not found' } },
      });

      const result = await useParlantStore.getState().sendMessage('nonexistent', 'Hello');

      expect(result).toBeNull();
      expect(useParlantStore.getState().error).toBe('Session not found');
    });
  });

  describe('fetchEvaluations', () => {
    it('should set evaluations from API', async () => {
      const mockEvals = [{ id: 'ev1', applied: true }];
      mockApi.get.mockResolvedValueOnce({ data: mockEvals } as any);

      await useParlantStore.getState().fetchEvaluations('s1');

      expect(useParlantStore.getState().evaluations).toEqual(mockEvals);
    });
  });

  describe('clearError', () => {
    it('should reset error to null', () => {
      useParlantStore.setState({ error: 'Some error' });
      useParlantStore.getState().clearError();

      expect(useParlantStore.getState().error).toBeNull();
    });
  });
});
