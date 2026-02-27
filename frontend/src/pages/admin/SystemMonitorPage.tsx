import { useState, useEffect, useCallback } from 'react';
import { api } from '../../services/api';
import {
  Cpu,
  HardDrive,
  MemoryStick,
  Network,
  Activity,
  Server,
  Container,
  RefreshCw,
  Clock,
  Gauge,
  Zap,
  Box
} from 'lucide-react';

interface SystemData {
  timestamp: string;
  hostname: string;
  platform: string;
  arch: string;
  uptime: { days: number; hours: number; minutes: number; totalSeconds: number };
  cpu: {
    model: string;
    cores: number;
    speed: number;
    usage: number;
    loadAvg: { '1m': number; '5m': number; '15m': number };
  };
  memory: {
    total: number;
    used: number;
    free: number;
    usagePercent: number;
  };
  disk: Array<{
    device: string;
    size: string;
    used: string;
    available: string;
    usePercent: number;
    mountPoint: string;
  }>;
  network: {
    interfaces: Array<{ name: string; address: string; netmask: string; mac: string }>;
    stats: Array<{ interface: string; rxBytesPerSec: number; txBytesPerSec: number }>;
  };
  containers: Array<{ id: string; name: string; status: string; image: string; ports: string }>;
  processes: Array<{
    user: string;
    pid: string;
    cpu: number;
    mem: number;
    vsz: string;
    rss: string;
    stat: string;
    time: string;
    command: string;
  }>;
  k8sPods: Array<{
    namespace: string;
    name: string;
    ready: string;
    status: string;
    restarts: string;
    age: string;
  }>;
  gpu?: Array<{
    index: number;
    name: string;
    utilization: number;
    memoryUsed: number;
    memoryTotal: number;
    memoryUsagePercent: number;
    temperature: number;
    powerDraw: number;
  }>;
  ollama?: {
    activeModels: Array<{
      name: string;
      model: string;
      size: number;
      digest: string;
      details: any;
      expires_at: string;
      size_vram: number;
    }>;
  };
}

function formatBytes(bytes: number | undefined | null): string {
  if (!bytes || bytes <= 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function ProgressBar({ value, color = 'blue', showLabel = true }: { value: number; color?: string; showLabel?: boolean }) {
  const getColorClass = () => {
    if (value >= 90) return 'bg-red-500';
    if (value >= 70) return 'bg-amber-500';
    return `bg-${color}-500`;
  };

  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 bg-surface-200 dark:bg-surface-700 rounded-full overflow-hidden">
        <div className={`h-full ${getColorClass()} transition-all`} style={{ width: `${Math.min(value, 100)}%` }} />
      </div>
      {showLabel && <span className="text-xs font-mono w-12 text-right">{value.toFixed(1)}%</span>}
    </div>
  );
}

export default function SystemMonitorPage() {
  const [data, setData] = useState<SystemData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [refreshInterval, setRefreshInterval] = useState(5000);

  const fetchData = useCallback(async () => {
    try {
      const response = await api.get('/admin/system-monitor');
      setData(response.data);
      setError(null);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to fetch system data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(fetchData, refreshInterval);
    return () => clearInterval(interval);
  }, [autoRefresh, refreshInterval, fetchData]);

  if (loading && !data) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[400px]">
        <div className="animate-spin h-8 w-8 border-4 border-primary-500 border-t-transparent rounded-full"></div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="p-6">
        <div className="bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 p-4 rounded-lg">
          {error}
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 bg-surface-950 min-h-screen text-surface-100 font-mono text-sm">
      {/* Header */}
      <div className="flex items-center justify-between mb-4 pb-2 border-b border-surface-700">
        <div className="flex items-center gap-4">
          <h1 className="text-lg font-bold text-green-400 flex items-center gap-2">
            <Activity className="w-5 h-5" />
            System Monitor
          </h1>
          <span className="text-surface-400">
            {data?.hostname} | {data?.platform} {data?.arch}
          </span>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-surface-500 flex items-center gap-1">
            <Clock className="w-4 h-4" />
            Uptime: {data?.uptime.days}d {data?.uptime.hours}h {data?.uptime.minutes}m
          </span>
          <div className="flex items-center gap-2">
            <select
              value={refreshInterval}
              onChange={(e) => setRefreshInterval(Number(e.target.value))}
              className="bg-surface-800 border border-surface-600 rounded px-2 py-1 text-xs"
            >
              <option value={2000}>2s</option>
              <option value={5000}>5s</option>
              <option value={10000}>10s</option>
              <option value={30000}>30s</option>
            </select>
            <button
              onClick={() => setAutoRefresh(!autoRefresh)}
              className={`px-2 py-1 rounded text-xs ${autoRefresh ? 'bg-green-600' : 'bg-surface-700'}`}
            >
              {autoRefresh ? 'Auto' : 'Manual'}
            </button>
            <button
              onClick={fetchData}
              className="p-1 hover:bg-surface-700 rounded"
              title="Refresh"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-4">
        {/* CPU & Memory Section */}
        <div className="col-span-4 space-y-4">
          {/* CPU - Enhanced */}
          <div className="bg-surface-900 rounded-lg p-3 border border-surface-700">
            <div className="flex items-center gap-2 mb-3">
              <Cpu className="w-4 h-4 text-blue-400" />
              <span className="text-blue-400 font-semibold">CPU</span>
              <span className="text-surface-500 text-xs ml-auto">{data?.cpu.cores} cores @ {data?.cpu.speed}MHz</span>
            </div>

            {/* CPU Gauge */}
            <div className="flex items-center justify-center mb-4">
              <div className="relative w-32 h-16">
                {/* Gauge background */}
                <svg viewBox="0 0 100 50" className="w-full h-full">
                  <path
                    d="M 5 50 A 45 45 0 0 1 95 50"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="8"
                    className="text-surface-700"
                  />
                  <path
                    d="M 5 50 A 45 45 0 0 1 95 50"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="8"
                    strokeDasharray={`${(data?.cpu.usage || 0) * 1.41} 141`}
                    className={
                      (data?.cpu.usage || 0) > 90 ? 'text-red-500' :
                        (data?.cpu.usage || 0) > 70 ? 'text-amber-500' :
                          (data?.cpu.usage || 0) > 50 ? 'text-yellow-500' : 'text-green-500'
                    }
                  />
                </svg>
                {/* Usage percentage in center */}
                <div className="absolute inset-0 flex items-end justify-center pb-1">
                  <span className={`text-2xl font-bold ${(data?.cpu.usage || 0) > 80 ? 'text-red-400' : 'text-green-400'
                    }`}>
                    {data?.cpu.usage?.toFixed(1) || '0'}%
                  </span>
                </div>
              </div>
            </div>

            {/* CPU Model */}
            <div className="text-center text-xs text-surface-400 mb-3 truncate" title={data?.cpu.model}>
              {data?.cpu.model?.substring(0, 40)}
            </div>

            {/* Load Average with visual bars */}
            <div className="space-y-2">
              <div className="text-xs text-surface-500 mb-1">Load Average</div>
              <div className="grid grid-cols-3 gap-2">
                <div className="text-center">
                  <div className="text-lg font-mono text-blue-300">{data?.cpu.loadAvg['1m'].toFixed(2)}</div>
                  <div className="text-[10px] text-surface-500">1 min</div>
                  <div className="h-1 bg-surface-700 rounded mt-1">
                    <div
                      className="h-full bg-blue-500 rounded"
                      style={{ width: `${Math.min((data?.cpu.loadAvg['1m'] || 0) / (data?.cpu.cores || 1) * 100, 100)}%` }}
                    />
                  </div>
                </div>
                <div className="text-center">
                  <div className="text-lg font-mono text-cyan-300">{data?.cpu.loadAvg['5m'].toFixed(2)}</div>
                  <div className="text-[10px] text-surface-500">5 min</div>
                  <div className="h-1 bg-surface-700 rounded mt-1">
                    <div
                      className="h-full bg-cyan-500 rounded"
                      style={{ width: `${Math.min((data?.cpu.loadAvg['5m'] || 0) / (data?.cpu.cores || 1) * 100, 100)}%` }}
                    />
                  </div>
                </div>
                <div className="text-center">
                  <div className="text-lg font-mono text-teal-300">{data?.cpu.loadAvg['15m'].toFixed(2)}</div>
                  <div className="text-[10px] text-surface-500">15 min</div>
                  <div className="h-1 bg-surface-700 rounded mt-1">
                    <div
                      className="h-full bg-teal-500 rounded"
                      style={{ width: `${Math.min((data?.cpu.loadAvg['15m'] || 0) / (data?.cpu.cores || 1) * 100, 100)}%` }}
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Usage bar */}
            <div className="mt-3 pt-3 border-t border-surface-700">
              <div className="flex justify-between text-xs mb-1">
                <span>Current Usage</span>
                <span className={
                  (data?.cpu.usage || 0) > 90 ? 'text-red-400 animate-pulse' :
                    (data?.cpu.usage || 0) > 70 ? 'text-amber-400' : 'text-green-400'
                }>
                  {data?.cpu.usage?.toFixed(1) || '0'}%
                </span>
              </div>
              <ProgressBar value={data?.cpu.usage || 0} color="blue" showLabel={false} />
            </div>
          </div>

          {/* Memory */}
          <div className="bg-surface-900 rounded-lg p-3 border border-surface-700">
            <div className="flex items-center gap-2 mb-3">
              <MemoryStick className="w-4 h-4 text-green-400" />
              <span className="text-green-400 font-semibold">MEM</span>
              <span className="text-surface-500 text-xs ml-auto">{formatBytes(data?.memory.total || 0)}</span>
            </div>
            <div className="space-y-2">
              <div className="flex justify-between text-xs">
                <span>Used: {formatBytes(data?.memory.used || 0)}</span>
                <span className={data?.memory.usagePercent && data.memory.usagePercent > 80 ? 'text-red-400' : 'text-green-400'}>
                  {data?.memory.usagePercent}%
                </span>
              </div>
              <ProgressBar value={data?.memory.usagePercent || 0} color="green" showLabel={false} />
              <div className="text-xs text-surface-400">
                Free: {formatBytes(data?.memory.free || 0)}
              </div>
            </div>
          </div>

          {/* Disk */}
          <div className="bg-surface-900 rounded-lg p-3 border border-surface-700">
            <div className="flex items-center gap-2 mb-3">
              <HardDrive className="w-4 h-4 text-amber-400" />
              <span className="text-amber-400 font-semibold">DISK</span>
            </div>
            <div className="space-y-3">
              {data?.disk?.slice(0, 4).map((d, i) => (
                <div key={i}>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-surface-400 truncate max-w-[120px]" title={d.mountPoint}>
                      {d.mountPoint}
                    </span>
                    <span>{d.used}/{d.size}</span>
                  </div>
                  <ProgressBar value={d.usePercent} color="amber" />
                </div>
              ))}
            </div>
          </div>

          {/* Network */}
          <div className="bg-surface-900 rounded-lg p-3 border border-surface-700">
            <div className="flex items-center gap-2 mb-3">
              <Network className="w-4 h-4 text-cyan-400" />
              <span className="text-cyan-400 font-semibold">NETWORK</span>
            </div>
            <div className="space-y-2 text-xs">
              {data?.network?.interfaces?.slice(0, 4).map((iface, i) => (
                <div key={i} className="flex justify-between">
                  <span className="text-surface-400">{iface.name}</span>
                  <span>{iface.address}</span>
                </div>
              ))}
              {data?.network?.stats?.slice(0, 4).map((stat, i) => (
                <div key={i} className="flex justify-between text-surface-500">
                  <span>{stat.interface}</span>
                  <span>RX: {formatBytes(stat.rxBytesPerSec)}/s TX: {formatBytes(stat.txBytesPerSec)}/s</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* GPU & Ollama Section */}
        <div className="col-span-4 space-y-4">
          {/* GPU Monitoring */}
          <div className="bg-surface-900 rounded-lg p-3 border border-surface-700">
            <div className="flex items-center gap-2 mb-3">
              <Zap className="w-4 h-4 text-yellow-400" />
              <span className="text-yellow-400 font-semibold">GPU (RTX 5090)</span>
            </div>
            {data?.gpu && data.gpu.length > 0 ? (
              <div className="space-y-4">
                {data.gpu.map((gpu, i) => (
                  <div key={i} className="space-y-2">
                    <div className="flex justify-between text-xs">
                      <span className="text-surface-400">{gpu.name}</span>
                      <span className="text-yellow-400">{gpu.utilization}% Util</span>
                    </div>
                    <ProgressBar value={gpu.utilization} color="yellow" showLabel={false} />

                    <div className="flex justify-between text-[10px] text-surface-500 mt-1">
                      <span>Temp: {gpu.temperature}°C</span>
                      <span>Power: {gpu.powerDraw}W</span>
                    </div>

                    <div className="pt-2">
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-surface-400">VRAM Usage</span>
                        <span className={gpu.memoryUsagePercent > 80 ? 'text-red-400' : 'text-green-400'}>
                          {formatBytes(gpu.memoryUsed)} / {formatBytes(gpu.memoryTotal)}
                        </span>
                      </div>
                      <ProgressBar value={gpu.memoryUsagePercent} color="green" showLabel={true} />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-4 text-surface-500 text-xs">No GPU data available</div>
            )}
          </div>

          {/* Ollama Models */}
          <div className="bg-surface-900 rounded-lg p-3 border border-surface-700">
            <div className="flex items-center gap-2 mb-3">
              <Box className="w-4 h-4 text-orange-400" />
              <span className="text-orange-400 font-semibold">OLLAMA (Active Models)</span>
            </div>
            <div className="space-y-3">
              {data?.ollama?.activeModels && data.ollama.activeModels.length > 0 ? (
                data.ollama.activeModels.map((model, i) => (
                  <div key={i} className="bg-surface-800 rounded p-2 border border-surface-700">
                    <div className="flex justify-between items-center mb-1">
                      <span className="text-cyan-300 font-medium truncate max-w-[150px]">{model.name}</span>
                      <span className="text-[10px] text-surface-500">{formatBytes(model.size)}</span>
                    </div>
                    <div className="flex justify-between text-[10px]">
                      <span className="text-purple-400">{model.details?.parameter_size} | {model.details?.quantization_level}</span>
                      <span className="text-green-400">VRAM: {formatBytes(model.size_vram)}</span>
                    </div>
                  </div>
                ))
              ) : (
                <div className="text-center py-4 text-surface-500 text-xs">No models currently loaded</div>
              )}
            </div>
          </div>
        </div>

        {/* Containers & Pods */}
        <div className="col-span-4 space-y-4">
          {/* Containers with CPU/Memory */}
          <div className="bg-surface-900 rounded-lg p-3 border border-surface-700">
            <div className="flex items-center gap-2 mb-3">
              <Container className="w-4 h-4 text-purple-400" />
              <span className="text-purple-400 font-semibold">CONTAINERS (Real-time)</span>
              <span className="text-surface-500 text-xs ml-auto">{data?.containers.length || 0}</span>
            </div>
            <div className="overflow-x-auto max-h-[280px] overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="text-surface-500 sticky top-0 bg-surface-900">
                  <tr>
                    <th className="text-left py-1">Container</th>
                    <th className="text-right py-1">CPU%</th>
                    <th className="text-right py-1">MEM</th>
                  </tr>
                </thead>
                <tbody>
                  {data?.containers.map((c: any, i: number) => (
                    <tr key={i} className="border-t border-surface-800 hover:bg-surface-800">
                      <td className="py-1.5">
                        <div className="text-cyan-300 truncate max-w-[140px]" title={c.name}>
                          {c.name.split('/').pop()}
                        </div>
                        <div className="text-[10px] text-surface-500 truncate max-w-[140px]">
                          {c.name.includes('/') ? c.name.split('/')[0] : ''}
                        </div>
                      </td>
                      <td className="py-1.5 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <div className="w-12 h-1.5 bg-surface-700 rounded overflow-hidden">
                            <div
                              className={`h-full rounded ${(c.cpu || 0) > 80 ? 'bg-red-500' :
                                  (c.cpu || 0) > 50 ? 'bg-amber-500' : 'bg-green-500'
                                }`}
                              style={{ width: `${Math.min(c.cpu || 0, 100)}%` }}
                            />
                          </div>
                          <span className={
                            (c.cpu || 0) > 80 ? 'text-red-400' :
                              (c.cpu || 0) > 50 ? 'text-amber-400' : 'text-green-400'
                          }>
                            {(c.cpu || 0).toFixed(1)}%
                          </span>
                        </div>
                      </td>
                      <td className="py-1.5 text-right text-surface-300">
                        {c.memory || '-'}
                      </td>
                    </tr>
                  ))}
                  {(!data?.containers || data.containers.length === 0) && (
                    <tr><td colSpan={3} className="py-4 text-surface-500 text-center">No containers running</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Kubernetes Pods */}
          <div className="bg-surface-900 rounded-lg p-3 border border-surface-700">
            <div className="flex items-center gap-2 mb-3">
              <Server className="w-4 h-4 text-blue-400" />
              <span className="text-blue-400 font-semibold">K8S PODS</span>
              <span className="text-surface-500 text-xs ml-auto">{data?.k8sPods.length || 0}</span>
            </div>
            <div className="overflow-x-auto max-h-[300px] overflow-y-auto">
              <div className="space-y-2">
                {data?.k8sPods.map((pod, i) => (
                  <div key={i} className="bg-surface-800 rounded p-2 hover:bg-surface-750">
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <span className={`w-2 h-2 rounded-full ${pod.status === 'Running' ? 'bg-green-500' :
                            pod.status === 'Pending' ? 'bg-yellow-500 animate-pulse' : 'bg-red-500'
                          }`} />
                        <span className="text-cyan-300 font-medium">{pod.name}</span>
                      </div>
                      <span className="text-surface-500 text-[10px]">{pod.age}</span>
                    </div>
                    <div className="flex items-center justify-between text-[10px]">
                      <span className="text-purple-400">{pod.namespace}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-surface-400">Ready: {pod.ready}</span>
                        <span className={
                          pod.status === 'Running' ? 'text-green-400' :
                            pod.status === 'Pending' ? 'text-yellow-400' : 'text-red-400'
                        }>
                          {pod.status}
                        </span>
                        {pod.restarts && Number(pod.restarts) > 0 && (
                          <span className="text-amber-400">Restarts: {pod.restarts}</span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
                {(!data?.k8sPods || data.k8sPods.length === 0) && (
                  <div className="py-4 text-surface-500 text-center text-xs">No pods found</div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Processes */}
        <div className="col-span-4">
          <div className="bg-surface-900 rounded-lg p-3 border border-surface-700 h-full">
            <div className="flex items-center gap-2 mb-3">
              <Gauge className="w-4 h-4 text-orange-400" />
              <span className="text-orange-400 font-semibold">TOP PROCESSES</span>
              <span className="text-surface-500 text-xs ml-auto">by CPU</span>
            </div>
            <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="text-surface-500 sticky top-0 bg-surface-900">
                  <tr>
                    <th className="text-left py-1">PID</th>
                    <th className="text-left py-1">USER</th>
                    <th className="text-right py-1">CPU%</th>
                    <th className="text-right py-1">MEM%</th>
                    <th className="text-left py-1">CMD</th>
                  </tr>
                </thead>
                <tbody>
                  {data?.processes.map((p, i) => (
                    <tr key={i} className="border-t border-surface-800 hover:bg-surface-800">
                      <td className="py-1 text-surface-400">{p.pid}</td>
                      <td className="py-1 text-cyan-300">{p.user}</td>
                      <td className="py-1 text-right">
                        <span className={p.cpu > 50 ? 'text-red-400' : p.cpu > 20 ? 'text-yellow-400' : 'text-green-400'}>
                          {p.cpu.toFixed(1)}
                        </span>
                      </td>
                      <td className="py-1 text-right">
                        <span className={p.mem > 50 ? 'text-red-400' : p.mem > 20 ? 'text-yellow-400' : 'text-green-400'}>
                          {p.mem.toFixed(1)}
                        </span>
                      </td>
                      <td className="py-1 text-surface-300 truncate max-w-[150px]" title={p.command}>
                        {p.command}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="mt-4 pt-2 border-t border-surface-700 text-xs text-surface-500 flex justify-between">
        <span>Last update: {data?.timestamp ? new Date(data.timestamp).toLocaleString() : '-'}</span>
        <span>Enterprise AI Chat - System Monitor</span>
      </div>
    </div>
  );
}
