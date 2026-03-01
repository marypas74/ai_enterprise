import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import {
    Activity,
    Cpu,
    Zap,
    HardDrive,
    Network,
    Thermometer,
    Box,
    Server,
    Gauge,
    Users,
    Container
} from 'lucide-react';

// Using direct axios for public route to bypass intercepted auth logic if necessary
const publicApi = axios.create({
    baseURL: import.meta.env.VITE_API_BASE_URL || '/api',
    timeout: 10000
});

function formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function timeAgo(dateStr: string): string {
    if (!dateStr) return '-';
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    return `${hours}h ${mins % 60}m ago`;
}

function formatTime(dateStr: string): string {
    if (!dateStr) return '-';
    const d = new Date(dateStr);
    return d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function GridCard({ title, icon: Icon, color = 'blue', children }: { title: string; icon: any; color?: string; children: React.ReactNode }) {
    const colorClasses = {
        blue: 'text-blue-400 border-blue-500/30 bg-blue-500/5',
        green: 'text-green-400 border-green-500/30 bg-green-500/5',
        yellow: 'text-yellow-400 border-yellow-500/30 bg-yellow-500/5',
        red: 'text-red-400 border-red-500/30 bg-red-500/5',
        purple: 'text-purple-400 border-purple-500/30 bg-purple-500/5',
        cyan: 'text-cyan-400 border-cyan-500/30 bg-cyan-500/5',
        orange: 'text-orange-400 border-orange-500/30 bg-orange-500/5',
        pink: 'text-pink-400 border-pink-500/30 bg-pink-500/5',
    };

    const selectedColor = colorClasses[color as keyof typeof colorClasses] || colorClasses.blue;

    return (
        <div className={`border ${selectedColor} rounded-lg p-3 font-mono text-xs overflow-hidden`}>
            <div className="flex items-center gap-2 mb-2 pb-1 border-b border-white/10 uppercase tracking-widest font-bold">
                <Icon className="w-3.5 h-3.5" />
                {title}
            </div>
            {children}
        </div>
    );
}

function StatItem({ label, value, subValue = '', color = 'surface-400' }: { label: string; value: string | number; subValue?: string; color?: string }) {
    return (
        <div className="flex justify-between items-baseline gap-2 py-0.5">
            <span className="text-surface-500 truncate">{label}</span>
            <div className="flex items-baseline gap-1">
                <span className={`font-bold ${color.startsWith('text-') ? color : `text-${color}`} whitespace-nowrap`}>{value}</span>
                {subValue && <span className="text-[10px] text-surface-600">{subValue}</span>}
            </div>
        </div>
    );
}

function ProgressBar({ value, color = 'blue' }: { value: number; color?: string }) {
    const colorClass = value > 90 ? 'bg-red-500' : value > 75 ? 'bg-amber-500' : `bg-${color}-500`;
    return (
        <div className="w-full h-1 bg-white/5 rounded-full overflow-hidden mt-1">
            <div className={`h-full ${colorClass} transition-all duration-500`} style={{ width: `${Math.min(value, 100)}%` }} />
        </div>
    );
}

export default function PublicMonitorPage() {
    const [data, setData] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const fetchData = useCallback(async () => {
        try {
            const response = await publicApi.get('/public/metrics');
            setData(response.data);
            setError(null);
        } catch (err: any) {
            setError('SENSORS_OFFLINE: Failed to stream telemetry');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchData();
        const interval = setInterval(fetchData, 3000);
        return () => clearInterval(interval);
    }, [fetchData]);

    if (loading && !data) {
        return (
            <div className="min-h-screen bg-black text-green-500 flex items-center justify-center font-mono">
                <div className="animate-pulse">INITIALIZING_TELEM_LINK...</div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-black text-surface-200 p-4 font-mono select-none">
            {/* HUD Header */}
            <div className="flex items-center justify-between mb-6 pb-2 border-b-2 border-surface-800">
                <div className="flex items-baseline gap-4">
                    <h1 className="text-xl font-bold text-white tracking-tighter flex items-center gap-2">
                        <Activity className="w-6 h-6 text-green-500" />
                        VITAL_SIGNS_OS
                    </h1>
                    <span className="text-surface-500 text-[10px]">FE: 1.8.9_STABLE | BE: 1.8.9_STABLE | NODE: {data?.hostname}</span>
                </div>
                <div className="text-right">
                    <div className="text-green-500 animate-pulse text-xs font-bold font-mono">● LIVE_STREAM_ACTIVE</div>
                    <div className="text-[10px] text-surface-600">UPTIME: {data?.uptime?.days}d {data?.uptime?.hours}h {data?.uptime?.minutes}m</div>
                </div>
            </div>

            {error && (
                <div className="mb-4 bg-red-900/20 border border-red-500 text-red-500 p-2 text-xs text-center animate-pulse">
                    {error}
                </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {/* CPU_DETAILED */}
                <GridCard title="CPU_CORE_MATRIX" icon={Cpu} color="blue">
                    <StatItem label="MODEL" value={data?.cpu?.model || 'Unknown'} />
                    <StatItem label="CORES" value={data?.cpu?.cores || 0} />
                    <StatItem label="UTILIZATION" value={`${(data?.cpu?.usage || 0).toFixed(1)}%`} color="text-green-400" />
                    <ProgressBar value={data?.cpu?.usage || 0} color="blue" />
                    <div className="grid grid-cols-2 gap-2 mt-2 text-[10px]">
                        <StatItem label="LOAD_1M" value={(data?.cpu?.loadAvg?.['1m'] || 0).toFixed(2)} color="text-blue-300" />
                        <StatItem label="LOAD_5M" value={(data?.cpu?.loadAvg?.['5m'] || 0).toFixed(2)} color="text-blue-300" />
                    </div>

                    <div className="mt-3 grid grid-cols-4 gap-1">
                        {data?.cpu?.coreUsages?.slice(0, 16).map((usage: number, i: number) => (
                            <div key={i} className="h-6 border border-white/5 flex items-center justify-center relative group">
                                <div
                                    className={`absolute bottom-0 left-0 w-full transition-all duration-500 ${usage > 90 ? 'bg-red-500/30' : usage > 60 ? 'bg-amber-500/20' : 'bg-blue-500/20'}`}
                                    style={{ height: `${Math.min(usage, 100)}%` }}
                                />
                                <span className="relative z-10 text-[8px] text-surface-500">{i}</span>
                                <div className="absolute -top-6 left-1/2 -translate-x-1/2 bg-surface-800 text-surface-300 px-1 rounded text-[8px] opacity-0 group-hover:opacity-100 whitespace-nowrap z-20">
                                    {usage.toFixed(1)}%
                                </div>
                            </div>
                        ))}
                    </div>
                    <div className="mt-2 text-[8px] text-surface-600">CORE_LOAD_DISTRIBUTION (TOP_16)</div>
                </GridCard>

                {/* GPU_NVIDIA_5090 */}
                <GridCard title="GPU_NVIDIA_RTX_5090" icon={Zap} color="yellow">
                    {data?.gpu && data.gpu.length > 0 ? (
                        <div className="space-y-2">
                            <StatItem label="ENGINE_LOAD" value={`${data.gpu[0].utilization}%`} color="text-yellow-400" />
                            <ProgressBar value={data.gpu[0].utilization} color="yellow" />
                            <StatItem label="VRAM_ALLOC" value={formatBytes(data.gpu[0].memoryUsed)} subValue={`/ ${formatBytes(data.gpu[0].memoryTotal)}`} color="text-green-400" />
                            <ProgressBar value={data.gpu[0].memoryUsagePercent} color="green" />
                            <div className="grid grid-cols-2 gap-2 mt-2">
                                <StatItem label="TEMP" value={`${data.gpu[0].temperature}°C`} color="text-orange-400" />
                                <StatItem label="PWR" value={`${data.gpu[0].powerDraw}W`} color="text-cyan-400" />
                            </div>
                        </div>
                    ) : (
                        <div className="h-full flex flex-col items-center justify-center gap-2 py-4">
                            <Zap className="w-6 h-6 text-yellow-500/30" />
                            <div className="text-yellow-500/50 uppercase text-[10px] italic">Device_Not_Detected</div>
                            <div className="text-[8px] text-surface-600">nvidia-smi unavailable in container</div>
                        </div>
                    )}
                </GridCard>

                {/* MEMORY_BANK */}
                <GridCard title="MEMORY_SYSTEM" icon={Gauge} color="green">
                    <StatItem label="TOTAL_CAP" value={formatBytes(data?.memory?.total || 0)} />
                    <StatItem label="MEM_USED" value={formatBytes(data?.memory?.used || 0)} color="text-green-400" />
                    <StatItem label="MEM_FREE" value={formatBytes(data?.memory?.free || 0)} />
                    <div className="mt-2">
                        <ProgressBar value={data?.memory?.usagePercent || 0} color="green" />
                        <div className="text-right text-[10px] mt-1 text-green-500/70">{data?.memory?.usagePercent || 0}% LOAD</div>
                    </div>
                </GridCard>

                {/* NETWORK_I/O */}
                <GridCard title="NET_TRAFFIC_IO" icon={Network} color="cyan">
                    {data?.network?.stats && data.network.stats.length > 0 ? (
                        <div className="space-y-2 max-h-[140px] overflow-y-auto pr-1">
                            {data.network.stats.map((stat: any, i: number) => (
                                <div key={i} className="border-b border-white/5 pb-1 last:border-0">
                                    <div className="text-[10px] text-cyan-500 mb-1 font-bold">{stat.interface}</div>
                                    <StatItem label="RX" value={formatBytes(stat.rxBytesPerSec)} subValue="/s" color="text-cyan-400" />
                                    <StatItem label="TX" value={formatBytes(stat.txBytesPerSec)} subValue="/s" color="text-blue-400" />
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="py-4 text-center text-surface-600 italic text-[10px]">Awaiting_First_Sample...</div>
                    )}
                </GridCard>

                {/* STORAGE_ARRAYS */}
                <GridCard title="STORAGE_IO_SUBSYSTEM" icon={HardDrive} color="orange">
                    {data?.disk && data.disk.length > 0 ? (
                        <div className="max-h-[120px] overflow-y-auto pr-1">
                            {data.disk.map((d: any, i: number) => (
                                <div key={i} className="mb-2 border-b border-white/5 pb-1 last:border-0">
                                    <div className="flex justify-between text-[10px] mb-1">
                                        <span className="truncate w-28 text-orange-300">{d.mountPoint}</span>
                                        <span className={`font-bold ${(d.usePercent || 0) > 90 ? 'text-red-400' : (d.usePercent || 0) > 75 ? 'text-amber-400' : 'text-green-400'}`}>
                                            {d.usePercent}%
                                        </span>
                                    </div>
                                    <div className="flex justify-between text-[8px] text-surface-500 mb-0.5">
                                        <span>{formatBytes(d.used || 0)} / {formatBytes(d.size || 0)}</span>
                                        <span>{formatBytes(d.available || 0)} free</span>
                                    </div>
                                    <ProgressBar value={d.usePercent || 0} color="orange" />
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="py-4 text-center text-surface-600 italic text-[10px]">No_Volumes_Detected</div>
                    )}
                    {data?.io && data.io.length > 0 && (
                        <div className="mt-2 pt-2 border-t border-white/10">
                            <div className="flex justify-between text-[10px] text-surface-500">
                                <span>DEV: {data.io[0].device}</span>
                                <span>IO_WAIT: {data.io[0].ioInProgress}</span>
                            </div>
                        </div>
                    )}
                </GridCard>

                {/* THERMAL_ZONES */}
                <GridCard title="ENVIRONMENT_HEAT_MAP" icon={Thermometer} color="red">
                    <div className="space-y-1">
                        {data?.thermal?.slice(0, 8).map((t: any, i: number) => (
                            <div key={i} className="flex justify-between border-b border-white/5 pb-0.5">
                                <span className="text-[10px] truncate w-32">{t.type}</span>
                                <span className={`font-bold ${t.temperature > 80 ? 'text-red-500 animate-pulse' : t.temperature > 60 ? 'text-orange-500' : t.temperature > 40 ? 'text-yellow-500' : 'text-green-500'}`}>
                                    {t.temperature.toFixed(1)}°C
                                </span>
                            </div>
                        ))}
                        {(!data?.thermal || data.thermal.length === 0) && (
                            <div className="py-2 text-center text-surface-600 italic text-[10px]">No_Thermal_Zones</div>
                        )}
                    </div>
                </GridCard>

                {/* OLLAMA_COMPUTE */}
                <GridCard title="AI_INFERENCE_ORCHESTRATOR" icon={Box} color="purple">
                    {data?.ollama?.version && (
                        <div className="text-[8px] text-surface-500 mb-1">Ollama v{data.ollama.version}</div>
                    )}
                    {/* Active (loaded in VRAM) models */}
                    <div className="flex items-center justify-between mb-1">
                        <span className="text-purple-400">ACTIVE_IN_VRAM</span>
                        <span className="bg-purple-500/20 text-purple-400 px-1 rounded">{data?.ollama?.activeModels?.length || 0}</span>
                    </div>
                    <div className="space-y-1 mb-2">
                        {data?.ollama?.activeModels?.map((m: any, i: number) => (
                            <div key={i} className="bg-purple-500/10 p-1.5 rounded border border-purple-500/20">
                                <div className="text-[10px] text-purple-300 truncate font-bold">{m.name}</div>
                                <div className="flex justify-between text-[8px] text-surface-500">
                                    <span>{m.details?.parameter_size}</span>
                                    <span className="text-green-500">VRAM: {formatBytes(m.size_vram || 0)}</span>
                                </div>
                            </div>
                        ))}
                        {(!data?.ollama?.activeModels || data.ollama.activeModels.length === 0) && (
                            <div className="text-center py-1 text-surface-600 italic text-[9px]">No_Compute_Load</div>
                        )}
                    </div>
                    {/* All installed models */}
                    <div className="flex items-center justify-between mb-1">
                        <span className="text-cyan-400">INSTALLED_MODELS</span>
                        <span className="bg-cyan-500/20 text-cyan-400 px-1 rounded">{data?.ollama?.installedModels?.length || 0}</span>
                    </div>
                    <div className="space-y-1 max-h-[100px] overflow-y-auto">
                        {data?.ollama?.installedModels?.map((m: any, i: number) => (
                            <div key={i} className="bg-white/5 p-1.5 rounded">
                                <div className="text-[10px] text-cyan-300 truncate">{m.name}</div>
                                <div className="flex justify-between text-[8px] text-surface-500">
                                    <span>{m.details?.parameter_size || m.details?.family}</span>
                                    <span>{m.details?.quantization_level}</span>
                                    <span className="text-blue-400">{formatBytes(m.size || 0)}</span>
                                </div>
                            </div>
                        ))}
                        {(!data?.ollama?.installedModels || data.ollama.installedModels.length === 0) && (
                            <div className="text-center py-1 text-surface-600 italic text-[9px]">No_Models_Installed</div>
                        )}
                    </div>
                </GridCard>

                {/* K8S_CLUSTER_STATE */}
                <GridCard title="K8S_POD_ECOSYSTEM" icon={Server} color="blue">
                    <div className="flex items-center justify-between mb-2">
                        <span className="text-blue-400">TOTAL_PODS</span>
                        <span className="bg-blue-500/20 text-blue-400 px-1.5 rounded font-bold">{data?.k8sPods?.length || 0}</span>
                    </div>
                    {data?.k8sPods && data.k8sPods.length > 0 && (
                        <div className="flex gap-1 mb-2 text-[8px]">
                            <span className="text-green-400">{data.k8sPods.filter((p: any) => p.status === 'Running').length} Running</span>
                            <span className="text-surface-600">|</span>
                            <span className="text-yellow-400">{data.k8sPods.filter((p: any) => p.status === 'Pending').length} Pending</span>
                            <span className="text-surface-600">|</span>
                            <span className="text-red-400">{data.k8sPods.filter((p: any) => p.status !== 'Running' && p.status !== 'Pending').length} Other</span>
                        </div>
                    )}
                    <div className="space-y-1 max-h-[100px] overflow-y-auto pr-1">
                        {data?.k8sPods?.map((p: any, i: number) => (
                            <div key={i} className="flex items-center gap-1.5 whitespace-nowrap overflow-hidden group">
                                <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                                    p.status === 'Running' ? 'bg-green-500' :
                                    p.status === 'Pending' ? 'bg-yellow-500 animate-pulse' : 'bg-red-500'
                                }`} />
                                <span className="text-[8px] truncate flex-1 text-surface-400 group-hover:text-surface-200">{p.name}</span>
                                <span className="text-[7px] text-surface-600 flex-shrink-0">{p.ready}</span>
                            </div>
                        ))}
                        {(!data?.k8sPods || data.k8sPods.length === 0) && (
                            <div className="py-2 text-center text-surface-600 italic text-[10px]">No_Pods_Found</div>
                        )}
                    </div>
                </GridCard>
            </div>

            {/* Second row: Docker + K8s Containers + Active Users */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
                {/* HOST DOCKER CONTAINERS */}
                <GridCard title="DOCKER_HOST_CONTAINERS" icon={Container} color="orange">
                    {data?.dockerContainers && data.dockerContainers.length > 0 ? (
                        <div className="space-y-2 max-h-[180px] overflow-y-auto pr-1">
                            {data.dockerContainers.map((c: any, i: number) => (
                                <div key={i} className="bg-white/5 rounded p-2 border border-orange-500/20">
                                    <div className="flex items-center justify-between mb-1">
                                        <span className="text-orange-300 font-bold text-[11px] truncate">{c.name}</span>
                                        <span className={`text-[8px] px-1 rounded ${c.state === 'running' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
                                            {c.state}
                                        </span>
                                    </div>
                                    <div className="text-[8px] text-surface-500 truncate mb-1">{c.image}</div>
                                    <div className="grid grid-cols-2 gap-x-2 text-[9px]">
                                        <div className="flex justify-between">
                                            <span className="text-surface-500">CPU</span>
                                            <span className={`${(c.cpu || 0) > 50 ? 'text-red-400' : 'text-green-400'}`}>{(c.cpu || 0).toFixed(1)}%</span>
                                        </div>
                                        <div className="flex justify-between">
                                            <span className="text-surface-500">MEM</span>
                                            <span className="text-blue-400">{c.memoryUsage} / {c.memoryLimit}</span>
                                        </div>
                                        <div className="flex justify-between">
                                            <span className="text-surface-500">NET RX</span>
                                            <span className="text-cyan-400">{c.netRx}</span>
                                        </div>
                                        <div className="flex justify-between">
                                            <span className="text-surface-500">NET TX</span>
                                            <span className="text-purple-400">{c.netTx}</span>
                                        </div>
                                    </div>
                                    {c.ports && c.ports.length > 0 && (
                                        <div className="text-[7px] text-surface-600 mt-1 truncate">
                                            PORTS: {c.ports.join(', ')}
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="py-4 text-center text-surface-600 italic text-[10px]">No_Docker_Containers</div>
                    )}
                </GridCard>

                {/* K8S CONTAINER RUNTIME (Prometheus) */}
                <GridCard title="K8S_CONTAINER_RUNTIME" icon={Container} color="cyan">
                    {data?.containers && data.containers.length > 0 ? (
                        <div className="overflow-x-auto max-h-[180px] overflow-y-auto">
                            <table className="w-full text-[10px]">
                                <thead className="text-surface-500 sticky top-0 bg-black/80">
                                    <tr>
                                        <th className="text-left py-0.5 pr-2">CONTAINER</th>
                                        <th className="text-right py-0.5 px-1">CPU%</th>
                                        <th className="text-right py-0.5 px-1">MEM</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {data.containers.map((c: any, i: number) => (
                                        <tr key={i} className="border-t border-white/5 hover:bg-white/5">
                                            <td className="py-1 pr-2">
                                                <span className="text-cyan-300 truncate block max-w-[160px]" title={c.name}>
                                                    {c.name?.includes('/') ? c.name.split('/').pop() : c.name}
                                                </span>
                                            </td>
                                            <td className="py-1 px-1 text-right">
                                                <span className={`${(c.cpu || 0) > 80 ? 'text-red-400' : (c.cpu || 0) > 50 ? 'text-amber-400' : 'text-green-400'}`}>
                                                    {(c.cpu || 0).toFixed(1)}%
                                                </span>
                                            </td>
                                            <td className="py-1 px-1 text-right text-surface-300">
                                                {c.memoryUsage || '-'}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    ) : (
                        <div className="py-4 text-center text-surface-600 italic text-[10px]">No_Containers_Running</div>
                    )}
                </GridCard>

                {/* ACTIVE USERS */}
                <GridCard title="ACTIVE_USER_SESSIONS" icon={Users} color="pink">
                    <div className="flex items-center justify-between mb-2">
                        <span className="text-pink-400">ONLINE_NOW</span>
                        <span className="bg-pink-500/20 text-pink-400 px-1.5 rounded font-bold">{data?.activeUsers?.length || 0}</span>
                    </div>
                    {data?.activeUsers && data.activeUsers.length > 0 ? (
                        <div className="space-y-1.5 max-h-[180px] overflow-y-auto pr-1">
                            {data.activeUsers.map((u: any, i: number) => (
                                <div key={i} className="bg-white/5 rounded p-1.5 flex items-center gap-2">
                                    <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse flex-shrink-0" />
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center justify-between gap-1">
                                            <span className="text-[10px] text-pink-300 truncate font-bold">{u.name || u.email}</span>
                                            <span className={`text-[7px] px-1 rounded ${
                                                u.role === 'admin' ? 'bg-red-500/20 text-red-400' : 'bg-blue-500/20 text-blue-400'
                                            }`}>{u.role}</span>
                                        </div>
                                        <div className="flex items-center justify-between text-[8px] text-surface-500">
                                            <span className="truncate">{u.email}</span>
                                            <span className="flex-shrink-0 text-green-400">{timeAgo(u.lastActivity)}</span>
                                        </div>
                                        <div className="flex items-center justify-between text-[8px] mt-0.5">
                                            <span className="text-surface-500">LOGIN: <span className="text-green-400">{formatTime(u.sessionStart)}</span></span>
                                        </div>
                                        {u.ipAddress && (
                                            <div className="text-[7px] text-surface-600 truncate">
                                                IP: {u.ipAddress} {u.country ? `(${u.country})` : ''}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="text-center py-4 text-surface-600 italic">No_Active_Sessions</div>
                    )}
                </GridCard>
            </div>

            {/* FOOTER_CONSOLE */}
            <div className="mt-6 pt-2 border-t border-surface-800 grid grid-cols-3 text-[10px] text-surface-600">
                <div>LAST_SYNC: {data?.timestamp}</div>
                <div className="text-center">SYSTEM_MODE: EXHAUSTIVE_PROBE</div>
                <div className="text-right">OS_PLATFORM: {data?.platform}_{data?.arch}</div>
            </div>
        </div>
    );
}
