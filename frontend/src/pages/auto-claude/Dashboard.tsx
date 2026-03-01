import { useState, useEffect } from 'react';
import { useAgentStore } from '../../hooks/useAgentStore';
import {
  Terminal,
  Activity,
  CheckCircle2,
  Clock,
  RefreshCw,
} from 'lucide-react';
import clsx from 'clsx';
import MetricCard from './MetricCard';
import TerminalSlotCard from './TerminalSlotCard';
import { formatDuration } from './constants';

interface DashboardProps {
  onSelectSession?: (sessionId: number) => void;
}

export default function Dashboard({ onSelectSession }: DashboardProps) {
  const { orchestratorMetrics, terminalSlots, fetchOrchestratorMetrics, fetchTerminalSlots } = useAgentStore();
  const [isRefreshing, setIsRefreshing] = useState(false);

  useEffect(() => {
    fetchOrchestratorMetrics();
    fetchTerminalSlots();
    const interval = setInterval(() => {
      fetchOrchestratorMetrics();
      fetchTerminalSlots();
    }, 10000);
    return () => clearInterval(interval);
  }, []);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await Promise.all([fetchOrchestratorMetrics(), fetchTerminalSlots()]);
    setIsRefreshing(false);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-surface-900">Orchestrator Dashboard</h2>
          <p className="text-sm text-surface-500">Real-time agent monitoring</p>
        </div>
        <button
          onClick={handleRefresh}
          disabled={isRefreshing}
          className="flex items-center gap-2 px-3 py-2 text-sm bg-surface-100 hover:bg-surface-200 rounded-lg transition-colors"
        >
          <RefreshCw className={clsx('w-4 h-4', isRefreshing && 'animate-spin')} />
          Refresh
        </button>
      </div>

      {/* Metrics Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          title="Terminal Slots"
          value={`${orchestratorMetrics?.terminals.occupied || 0} / 12`}
          subtitle={`${orchestratorMetrics?.terminals.available || 12} available`}
          icon={<Terminal className="w-5 h-5" />}
          color="cyan"
        />
        <MetricCard
          title="Active Sessions"
          value={orchestratorMetrics?.sessions.running || 0}
          subtitle={`${orchestratorMetrics?.sessions.total || 0} total (30 days)`}
          icon={<Activity className="w-5 h-5" />}
          color="magenta"
        />
        <MetricCard
          title="Success Rate"
          value={`${orchestratorMetrics?.sessions.successRate || 0}%`}
          subtitle={`${orchestratorMetrics?.sessions.completed || 0} completed`}
          icon={<CheckCircle2 className="w-5 h-5" />}
          color="cyan"
        />
        <MetricCard
          title="Avg Duration"
          value={formatDuration(orchestratorMetrics?.performance.avgDurationSeconds || 0)}
          subtitle={`${orchestratorMetrics?.performance.totalIterations || 0} iterations`}
          icon={<Clock className="w-5 h-5" />}
          color="yellow"
        />
      </div>

      {/* Terminal Slots Grid */}
      <div>
        <h3 className="text-md font-medium text-surface-800 mb-3">Terminal Slots</h3>
        <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
          {Array.from({ length: 12 }, (_, i) => {
            const slot = terminalSlots.find(s => s.slot === i);
            return (
              <TerminalSlotCard
                key={i}
                slotNumber={i}
                status={slot?.status || 'available'}
                sessionName={slot?.sessionName}
                onClick={slot?.sessionId && onSelectSession ? () => onSelectSession(slot.sessionId!) : undefined}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
