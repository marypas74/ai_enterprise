/**
 * useAgentStore — Unit tests for the Agent stores (split into Session, Template, Orchestrator, Worktree).
 *
 * Tests cover:
 * - Initial state
 * - fetchSessions (success + error)
 * - fetchSession (success + error)
 * - createSession (success + error)
 * - deleteSession (removes from lists)
 * - updateSession (updates in place)
 * - fetchTemplates
 * - deleteTemplate
 * - clearError
 * - setSelectedSession
 * - fetchTerminalSlots
 * - fetchOrchestratorMetrics
 * - fetchSessionLogs
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useSessionStore } from './useSessionStore';
import { useTemplateStore } from './useTemplateStore';
import { useOrchestratorStore } from './useOrchestratorStore';
import { api } from '../services/api';

const mockApi = vi.mocked(api);

describe('useSessionStore', () => {
  beforeEach(() => {
    useSessionStore.setState({
      sessions: [],
      activeSessions: [],
      selectedSession: null,
      sessionLogs: [],
      isLoading: false,
      error: null,
    });
    vi.clearAllMocks();
  });

  describe('initial state', () => {
    it('should have empty sessions', () => {
      expect(useSessionStore.getState().sessions).toEqual([]);
    });

    it('should have no selected session', () => {
      expect(useSessionStore.getState().selectedSession).toBeNull();
    });

    it('should have isLoading as false', () => {
      expect(useSessionStore.getState().isLoading).toBe(false);
    });

    it('should have no error', () => {
      expect(useSessionStore.getState().error).toBeNull();
    });
  });

  describe('fetchSessions', () => {
    it('should set sessions from API response', async () => {
      const mockSessions = [
        { id: 1, name: 'Session 1', status: 'completed' },
        { id: 2, name: 'Session 2', status: 'running' },
        { id: 3, name: 'Session 3', status: 'paused' },
      ];

      mockApi.get.mockResolvedValueOnce({
        data: { sessions: mockSessions, total: 3 },
      } as any);

      await useSessionStore.getState().fetchSessions();

      const state = useSessionStore.getState();
      expect(state.sessions).toEqual(mockSessions);
      expect(state.isLoading).toBe(false);
    });

    it('should filter active sessions (running, paused, initializing)', async () => {
      const mockSessions = [
        { id: 1, name: 'Completed', status: 'completed' },
        { id: 2, name: 'Running', status: 'running' },
        { id: 3, name: 'Paused', status: 'paused' },
        { id: 4, name: 'Initializing', status: 'initializing' },
        { id: 5, name: 'Failed', status: 'failed' },
      ];

      mockApi.get.mockResolvedValueOnce({
        data: { sessions: mockSessions, total: 5 },
      } as any);

      await useSessionStore.getState().fetchSessions();

      const state = useSessionStore.getState();
      expect(state.activeSessions).toHaveLength(3);
      expect(state.activeSessions.map((s: any) => s.id)).toEqual([2, 3, 4]);
    });

    it('should set error on API failure', async () => {
      mockApi.get.mockRejectedValueOnce({
        response: { data: { error: 'Unauthorized' } },
      });

      await useSessionStore.getState().fetchSessions();

      const state = useSessionStore.getState();
      expect(state.error).toBe('Unauthorized');
      expect(state.isLoading).toBe(false);
    });

    it('should pass query params to API', async () => {
      mockApi.get.mockResolvedValueOnce({
        data: { sessions: [], total: 0 },
      } as any);

      await useSessionStore.getState().fetchSessions({ status: 'running', limit: 10, offset: 0 });

      expect(mockApi.get).toHaveBeenCalledWith('/agents/sessions', {
        params: { status: 'running', limit: 10, offset: 0 },
      });
    });

    it('should use fallback error message when no API error provided', async () => {
      mockApi.get.mockRejectedValueOnce(new Error('Network'));

      await useSessionStore.getState().fetchSessions();

      expect(useSessionStore.getState().error).toBe('Failed to fetch sessions');
    });
  });

  describe('fetchSession', () => {
    it('should set selectedSession from API', async () => {
      const mockSession = { id: 1, name: 'Test', status: 'running' };
      mockApi.get.mockResolvedValueOnce({ data: mockSession } as any);

      const result = await useSessionStore.getState().fetchSession(1);

      expect(useSessionStore.getState().selectedSession).toEqual(mockSession);
      expect(result).toEqual(mockSession);
    });

    it('should return null on error', async () => {
      mockApi.get.mockRejectedValueOnce({
        response: { data: { error: 'Not found' } },
      });

      const result = await useSessionStore.getState().fetchSession(999);

      expect(result).toBeNull();
      expect(useSessionStore.getState().error).toBe('Not found');
    });
  });

  describe('createSession', () => {
    it('should add new session to the list', async () => {
      const newSession = { id: 10, name: 'New Session', status: 'pending' };
      mockApi.post.mockResolvedValueOnce({ data: newSession } as any);

      const result = await useSessionStore.getState().createSession({
        name: 'New Session',
        taskSpecification: 'Do something',
        modelId: 1,
      });

      expect(result).toEqual(newSession);
      expect(useSessionStore.getState().sessions).toContainEqual(newSession);
      expect(useSessionStore.getState().isLoading).toBe(false);
    });

    it('should prepend new session to existing sessions', async () => {
      useSessionStore.setState({
        sessions: [{ id: 1, name: 'Existing' }] as any[],
      });

      const newSession = { id: 2, name: 'New' };
      mockApi.post.mockResolvedValueOnce({ data: newSession } as any);

      await useSessionStore.getState().createSession({
        name: 'New',
        taskSpecification: 'Task',
        modelId: 1,
      });

      const sessions = useSessionStore.getState().sessions;
      expect(sessions[0]).toEqual(newSession);
      expect(sessions).toHaveLength(2);
    });

    it('should set error and throw on failure', async () => {
      mockApi.post.mockRejectedValueOnce({
        response: { data: { error: 'Validation failed' } },
      });

      await expect(
        useSessionStore.getState().createSession({
          name: 'Bad',
          taskSpecification: '',
          modelId: 0,
        })
      ).rejects.toBeDefined();

      expect(useSessionStore.getState().error).toBe('Validation failed');
    });
  });

  describe('deleteSession', () => {
    it('should remove session from all lists', async () => {
      useSessionStore.setState({
        sessions: [{ id: 1 }, { id: 2 }] as any[],
        activeSessions: [{ id: 1 }] as any[],
        selectedSession: { id: 1 } as any,
      });

      mockApi.delete.mockResolvedValueOnce({ data: {} } as any);

      await useSessionStore.getState().deleteSession(1);

      const state = useSessionStore.getState();
      expect(state.sessions).toHaveLength(1);
      expect(state.sessions[0].id).toBe(2);
      expect(state.activeSessions).toHaveLength(0);
      expect(state.selectedSession).toBeNull();
    });

    it('should keep selectedSession if different session is deleted', async () => {
      useSessionStore.setState({
        sessions: [{ id: 1 }, { id: 2 }] as any[],
        activeSessions: [],
        selectedSession: { id: 2 } as any,
      });

      mockApi.delete.mockResolvedValueOnce({ data: {} } as any);

      await useSessionStore.getState().deleteSession(1);

      expect(useSessionStore.getState().selectedSession).toEqual({ id: 2 });
    });
  });

  describe('updateSession', () => {
    it('should update session in the list', async () => {
      const original = { id: 1, name: 'Old Name', status: 'pending' };
      const updated = { id: 1, name: 'New Name', status: 'pending' };

      useSessionStore.setState({
        sessions: [original] as any[],
        selectedSession: original as any,
      });

      mockApi.patch.mockResolvedValueOnce({ data: updated } as any);

      await useSessionStore.getState().updateSession(1, { name: 'New Name' });

      const state = useSessionStore.getState();
      expect(state.sessions[0]).toEqual(updated);
      expect(state.selectedSession).toEqual(updated);
    });
  });

  describe('fetchSessionLogs', () => {
    it('should set sessionLogs from API', async () => {
      const mockLogs = [
        { id: 1, logType: 'info', content: 'Started' },
        { id: 2, logType: 'error', content: 'Failed' },
      ];
      mockApi.get.mockResolvedValueOnce({ data: { logs: mockLogs } } as any);

      await useSessionStore.getState().fetchSessionLogs(1);

      expect(useSessionStore.getState().sessionLogs).toEqual(mockLogs);
    });
  });

  describe('UI actions', () => {
    it('setSelectedSession should update selectedSession', () => {
      const session = { id: 5, name: 'Test' } as any;
      useSessionStore.getState().setSelectedSession(session);

      expect(useSessionStore.getState().selectedSession).toEqual(session);
    });

    it('setSelectedSession(null) should clear selectedSession', () => {
      useSessionStore.setState({ selectedSession: { id: 1 } as any });
      useSessionStore.getState().setSelectedSession(null);

      expect(useSessionStore.getState().selectedSession).toBeNull();
    });

    it('clearError should reset error to null', () => {
      useSessionStore.setState({ error: 'Some error' });
      useSessionStore.getState().clearError();

      expect(useSessionStore.getState().error).toBeNull();
    });
  });
});

describe('useTemplateStore', () => {
  beforeEach(() => {
    useTemplateStore.setState({
      templates: [],
      isLoading: false,
      error: null,
    });
    vi.clearAllMocks();
  });

  describe('initial state', () => {
    it('should have empty templates', () => {
      expect(useTemplateStore.getState().templates).toEqual([]);
    });
  });

  describe('fetchTemplates', () => {
    it('should set templates from API', async () => {
      const mockTemplates = [{ id: 1, name: 'Template 1' }];
      mockApi.get.mockResolvedValueOnce({ data: mockTemplates } as any);

      await useTemplateStore.getState().fetchTemplates();

      expect(useTemplateStore.getState().templates).toEqual(mockTemplates);
    });

    it('should pass category param when provided', async () => {
      mockApi.get.mockResolvedValueOnce({ data: [] } as any);

      await useTemplateStore.getState().fetchTemplates('coding');

      expect(mockApi.get).toHaveBeenCalledWith('/agents/templates', {
        params: { category: 'coding' },
      });
    });
  });

  describe('deleteTemplate', () => {
    it('should remove template from the list', async () => {
      useTemplateStore.setState({
        templates: [{ id: 1 }, { id: 2 }] as any[],
      });

      mockApi.delete.mockResolvedValueOnce({ data: {} } as any);

      await useTemplateStore.getState().deleteTemplate(1);

      expect(useTemplateStore.getState().templates).toHaveLength(1);
      expect(useTemplateStore.getState().templates[0].id).toBe(2);
    });
  });
});

describe('useOrchestratorStore', () => {
  beforeEach(() => {
    useOrchestratorStore.setState({
      terminalSlots: [],
      orchestratorMetrics: null,
      wsConnection: null,
      isLoading: false,
      error: null,
    });
    vi.clearAllMocks();
  });

  describe('initial state', () => {
    it('should have null orchestratorMetrics', () => {
      expect(useOrchestratorStore.getState().orchestratorMetrics).toBeNull();
    });
  });

  describe('fetchTerminalSlots', () => {
    it('should set terminalSlots from API', async () => {
      const mockSlots = [
        { slot: 1, status: 'available' },
        { slot: 2, status: 'occupied' },
      ];
      mockApi.get.mockResolvedValueOnce({ data: { slots: mockSlots } } as any);

      await useOrchestratorStore.getState().fetchTerminalSlots();

      expect(useOrchestratorStore.getState().terminalSlots).toEqual(mockSlots);
    });
  });

  describe('fetchOrchestratorMetrics', () => {
    it('should set orchestratorMetrics from API', async () => {
      const mockMetrics = {
        terminals: { total: 5, available: 3, occupied: 1, reserved: 1 },
        sessions: { total: 10, running: 2, completed: 6, failed: 2, successRate: 0.75 },
        performance: { totalIterations: 100, avgDurationSeconds: 45 },
      };
      mockApi.get.mockResolvedValueOnce({ data: mockMetrics } as any);

      await useOrchestratorStore.getState().fetchOrchestratorMetrics();

      expect(useOrchestratorStore.getState().orchestratorMetrics).toEqual(mockMetrics);
    });
  });
});
