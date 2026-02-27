import os from 'os';
import fs from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';
import type { Pool } from 'mysql2/promise';

const execAsync = promisify(exec);

function formatBytesBackend(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

// Prometheus API response type
interface PrometheusResponse {
    status: string;
    data: {
        result: Array<{
            metric: Record<string, string>;
            value: [number, string];
        }>;
    };
}

export class MetricsService {
    private static PROMETHEUS_URL = process.env.PROMETHEUS_URL || 'http://kube-prom-stack-kube-prome-prometheus.observability.svc.cluster.local:9090';
    private static K8S_API_URL = process.env.K8S_API_URL || 'https://kubernetes.default.svc';

    // Cache for CPU delta calculation
    private static previousCpuCoreStats: any[] | null = null;
    // Cache for network rate calculation
    private static previousNetStats: Map<string, { rx: number; tx: number; time: number }> | null = null;

    // Helper to query Prometheus
    private static async queryPrometheus(query: string): Promise<PrometheusResponse['data']['result']> {
        try {
            const response = await fetch(`${this.PROMETHEUS_URL}/api/v1/query?query=${encodeURIComponent(query)}`);
            const data = await response.json() as PrometheusResponse;
            return data.status === 'success' ? data.data.result : [];
        } catch {
            return [];
        }
    }

    // Helper to get Kubernetes API token
    private static getK8sToken(): string {
        try {
            return fs.readFileSync('/var/run/secrets/kubernetes.io/serviceaccount/token', 'utf8');
        } catch {
            return '';
        }
    }

    private static DCGM_EXPORTER_URL = process.env.DCGM_EXPORTER_URL || 'http://nvidia-dcgm-exporter.gpu-operator-resources.svc.cluster.local:9400/metrics';

    // Parse a single metric value from Prometheus text format, grouped by gpu label
    private static parseDcgmMetric(text: string, metricName: string): Map<string, { value: number; labels: Record<string, string> }> {
        const results = new Map<string, { value: number; labels: Record<string, string> }>();
        const regex = new RegExp(`^${metricName}\\{([^}]+)\\}\\s+([\\d.eE+-]+)`, 'gm');
        let match;
        while ((match = regex.exec(text)) !== null) {
            const labelsStr = match[1];
            const value = parseFloat(match[2]);
            const labels: Record<string, string> = {};
            for (const pair of labelsStr.split(',')) {
                const eqIdx = pair.indexOf('=');
                if (eqIdx > 0) {
                    labels[pair.substring(0, eqIdx).trim()] = pair.substring(eqIdx + 1).trim().replace(/"/g, '');
                }
            }
            const gpuId = labels['gpu'] || '0';
            results.set(gpuId, { value, labels });
        }
        return results;
    }

    // Helper to get GPU metrics via Prometheus DCGM, direct DCGM exporter, or nvidia-smi
    static async getGpuMetrics(): Promise<any[]> {
        // Method 1: Try Prometheus DCGM queries (works when ServiceMonitor is configured)
        try {
            const [utilResult, fbUsedResult, fbFreeResult, tempResult, powerResult] = await Promise.all([
                this.queryPrometheus('DCGM_FI_DEV_GPU_UTIL'),
                this.queryPrometheus('DCGM_FI_DEV_FB_USED'),
                this.queryPrometheus('DCGM_FI_DEV_FB_FREE'),
                this.queryPrometheus('DCGM_FI_DEV_GPU_TEMP'),
                this.queryPrometheus('DCGM_FI_DEV_POWER_USAGE'),
            ]);
            if (utilResult.length > 0) {
                return utilResult.map((gpu, i) => {
                    const fbUsedMB = parseFloat(fbUsedResult[i]?.value?.[1] || '0');
                    const fbFreeMB = parseFloat(fbFreeResult[i]?.value?.[1] || '0');
                    const totalMB = fbUsedMB + fbFreeMB;
                    const gpuName = gpu.metric.modelName || gpu.metric.GPU_I_ID || 'NVIDIA GPU';
                    return {
                        index: parseInt(gpu.metric.gpu || '0'),
                        name: gpuName,
                        utilization: parseFloat(gpu.value[1]),
                        memoryUsed: fbUsedMB * 1024 * 1024,
                        memoryTotal: totalMB * 1024 * 1024,
                        memoryUsagePercent: totalMB > 0 ? Math.round((fbUsedMB / totalMB) * 1000) / 10 : 0,
                        temperature: parseFloat(tempResult[i]?.value?.[1] || '0'),
                        powerDraw: parseFloat(powerResult[i]?.value?.[1] || '0')
                    };
                });
            }
        } catch { /* Prometheus not available */ }

        // Method 2: Query DCGM exporter directly (always works if exporter pod is running)
        try {
            const response = await fetch(this.DCGM_EXPORTER_URL, { signal: AbortSignal.timeout(5000) });
            if (response.ok) {
                const text = await response.text();
                const utilMap = this.parseDcgmMetric(text, 'DCGM_FI_DEV_GPU_UTIL');
                const fbUsedMap = this.parseDcgmMetric(text, 'DCGM_FI_DEV_FB_USED');
                const fbFreeMap = this.parseDcgmMetric(text, 'DCGM_FI_DEV_FB_FREE');
                const tempMap = this.parseDcgmMetric(text, 'DCGM_FI_DEV_GPU_TEMP');
                const powerMap = this.parseDcgmMetric(text, 'DCGM_FI_DEV_POWER_USAGE');

                if (utilMap.size > 0) {
                    const gpus: any[] = [];
                    for (const [gpuId, utilEntry] of utilMap) {
                        const fbUsedMB = fbUsedMap.get(gpuId)?.value || 0;
                        const fbFreeMB = fbFreeMap.get(gpuId)?.value || 0;
                        const totalMB = fbUsedMB + fbFreeMB;
                        const gpuName = utilEntry.labels['modelName'] || utilEntry.labels['GPU_I_ID'] || 'NVIDIA GPU';
                        gpus.push({
                            index: parseInt(gpuId),
                            name: gpuName,
                            utilization: utilEntry.value,
                            memoryUsed: fbUsedMB * 1024 * 1024,
                            memoryTotal: totalMB * 1024 * 1024,
                            memoryUsagePercent: totalMB > 0 ? Math.round((fbUsedMB / totalMB) * 1000) / 10 : 0,
                            temperature: tempMap.get(gpuId)?.value || 0,
                            powerDraw: powerMap.get(gpuId)?.value || 0
                        });
                    }
                    gpus.sort((a, b) => a.index - b.index);
                    return gpus;
                }
            }
        } catch { /* DCGM exporter not reachable */ }

        // Method 3: Fallback to nvidia-smi (works on host, not in containers)
        try {
            const { stdout } = await execAsync('nvidia-smi --query-gpu=index,name,utilization.gpu,memory.used,memory.total,temperature.gpu,power.draw --format=csv,noheader,nounits');
            const lines = stdout.trim().split('\n');
            return lines.map(line => {
                const [index, name, util, memUsed, memTotal, temp, power] = line.split(',').map(s => s.trim());
                return {
                    index: parseInt(index),
                    name,
                    utilization: parseFloat(util),
                    memoryUsed: parseInt(memUsed) * 1024 * 1024,
                    memoryTotal: parseInt(memTotal) * 1024 * 1024,
                    memoryUsagePercent: Math.round((parseInt(memUsed) / parseInt(memTotal)) * 100 * 10) / 10,
                    temperature: parseInt(temp),
                    powerDraw: parseFloat(power)
                };
            });
        } catch {
            return [];
        }
    }

    // Helper to get Ollama active (running) models
    static async getOllamaActiveModels(): Promise<any[]> {
        try {
            const baseUrl = process.env.OLLAMA_BASE_URL || 'http://10.0.1.1:8086/ollama';
            const response = await fetch(`${baseUrl}/api/ps`, {
                headers: { 'X-Ollama-Key': process.env.OLLAMA_AUTH_KEY || '' }
            });
            if (!response.ok) return [];
            const data = await response.json() as any;
            return data.models || [];
        } catch {
            return [];
        }
    }

    // Helper to get all installed Ollama models
    static async getOllamaInstalledModels(): Promise<any[]> {
        try {
            const baseUrl = process.env.OLLAMA_BASE_URL || 'http://10.0.1.1:8086/ollama';
            const response = await fetch(`${baseUrl}/api/tags`, {
                headers: { 'X-Ollama-Key': process.env.OLLAMA_AUTH_KEY || '' }
            });
            if (!response.ok) return [];
            const data = await response.json() as any;
            return (data.models || []).map((m: any) => ({
                name: m.name,
                model: m.model,
                size: m.size,
                digest: m.digest,
                modifiedAt: m.modified_at,
                details: m.details || {}
            }));
        } catch {
            return [];
        }
    }

    // Helper to get Ollama version
    static async getOllamaVersion(): Promise<string> {
        try {
            const baseUrl = process.env.OLLAMA_BASE_URL || 'http://10.0.1.1:8086/ollama';
            const response = await fetch(`${baseUrl}/api/version`, {
                headers: { 'X-Ollama-Key': process.env.OLLAMA_AUTH_KEY || '' }
            });
            if (!response.ok) return '';
            const data = await response.json() as any;
            return data.version || '';
        } catch {
            return '';
        }
    }

    // Helper to get IO stats from /proc/diskstats
    static async getIoStats(): Promise<any[]> {
        try {
            const procPath = fs.existsSync('/host/proc') ? '/host/proc' : '/proc';
            const diskstats = fs.readFileSync(`${procPath}/diskstats`, 'utf8');
            const lines = diskstats.trim().split('\n');
            return lines.map(line => {
                const parts = line.trim().split(/\s+/);
                if (parts.length >= 14) {
                    const device = parts[2];
                    return {
                        device,
                        readsCompleted: parseInt(parts[3]),
                        readsMerged: parseInt(parts[4]),
                        sectorsRead: parseInt(parts[5]),
                        readTimeMs: parseInt(parts[6]),
                        writesCompleted: parseInt(parts[7]),
                        writesMerged: parseInt(parts[8]),
                        sectorsWritten: parseInt(parts[9]),
                        writeTimeMs: parseInt(parts[10]),
                        ioInProgress: parseInt(parts[11]),
                        ioTimeMs: parseInt(parts[12]),
                        weightedIoTimeMs: parseInt(parts[13])
                    };
                }
                return null;
            }).filter(Boolean);
        } catch {
            return [];
        }
    }

    // Helper to get CPU core stats from /proc/stat
    static async getCpuCoreStats(): Promise<any[]> {
        try {
            const procPath = fs.existsSync('/host/proc') ? '/host/proc' : '/proc';
            const stat = fs.readFileSync(`${procPath}/stat`, 'utf8');
            const lines = stat.trim().split('\n');
            const cpuLines = lines.filter(line => line.startsWith('cpu') && line !== 'cpu');
            return cpuLines.map(line => {
                const parts = line.split(/\s+/);
                const user = parseInt(parts[1]);
                const nice = parseInt(parts[2]);
                const system = parseInt(parts[3]);
                const idle = parseInt(parts[4]);
                const iowait = parseInt(parts[5]);
                const irq = parseInt(parts[6]);
                const softirq = parseInt(parts[7]);
                const steal = parseInt(parts[8]);
                const guest = parseInt(parts[9]);
                const guest_nice = parseInt(parts[10]);
                const total = user + nice + system + idle + iowait + irq + softirq + steal + guest + guest_nice;
                return {
                    core: parts[0],
                    user, nice, system, idle, iowait, irq, softirq, steal, guest, guest_nice, total
                };
            });
        } catch {
            return [];
        }
    }

    // Helper to get thermal stats from /sys/class/thermal
    static async getThermalStats(): Promise<any[]> {
        const thermalZones: any[] = [];
        try {
            const sysPath = fs.existsSync('/host/sys') ? '/host/sys' : '/sys';
            const zones = fs.readdirSync(`${sysPath}/class/thermal`).filter(d => d.startsWith('thermal_zone'));
            for (const zone of zones) {
                try {
                    const type = fs.readFileSync(`${sysPath}/class/thermal/${zone}/type`, 'utf8').trim();
                    const temp = parseInt(fs.readFileSync(`${sysPath}/class/thermal/${zone}/temp`, 'utf8').trim()) / 1000; // in Celsius
                    thermalZones.push({ zone, type, temperature: temp });
                } catch { /* ignore */ }
            }
        } catch { /* ignore */ }
        return thermalZones;
    }

    // Calculate per-core CPU usage percentages using delta between samples
    private static calculateCoreUsages(currentStats: any[]): number[] {
        if (!this.previousCpuCoreStats || this.previousCpuCoreStats.length !== currentStats.length) {
            this.previousCpuCoreStats = currentStats;
            return currentStats.map(() => 0);
        }
        const usages = currentStats.map((curr, i) => {
            const prev = this.previousCpuCoreStats![i];
            const totalDelta = curr.total - prev.total;
            const idleDelta = curr.idle - prev.idle;
            if (totalDelta === 0) return 0;
            return Math.round(((totalDelta - idleDelta) / totalDelta) * 1000) / 10;
        });
        this.previousCpuCoreStats = currentStats;
        return usages;
    }

    // Fallback disk stats using df command
    static async getDiskStatsFallback(): Promise<any[]> {
        try {
            const { stdout } = await execAsync('df -B1 --output=source,size,used,avail,pcent,target -x tmpfs -x devtmpfs -x overlay 2>/dev/null');
            const lines = stdout.trim().split('\n').slice(1);
            return lines.map(line => {
                const parts = line.trim().split(/\s+/);
                if (parts.length >= 6) {
                    return {
                        device: parts[0],
                        size: parseInt(parts[1]),
                        used: parseInt(parts[2]),
                        available: parseInt(parts[3]),
                        usePercent: parseInt(parts[4]),
                        mountPoint: parts[5]
                    };
                }
                return null;
            }).filter(Boolean);
        } catch {
            return [];
        }
    }

    // Fallback network stats using /proc/net/dev with rate calculation
    static async getNetworkStatsFallback(): Promise<any[]> {
        try {
            const procPath = fs.existsSync('/host/proc') ? '/host/proc' : '/proc';
            const netdev = fs.readFileSync(`${procPath}/net/dev`, 'utf8');
            const lines = netdev.trim().split('\n').slice(2);
            const currentStats = new Map<string, { rx: number; tx: number; time: number }>();
            const results: any[] = [];

            for (const line of lines) {
                const parts = line.trim().split(/[:\s]+/);
                if (parts.length < 11) continue;
                const iface = parts[0];
                if (iface === 'lo') continue;
                // Skip virtual/container interfaces — only show physical NICs
                if (/^(cali|veth|br-|docker|vxlan|flannel|tunl|cilium|lxc|virbr|cni)/.test(iface)) continue;
                const rxBytes = parseInt(parts[1]);
                const txBytes = parseInt(parts[9]);
                const now = Date.now();
                currentStats.set(iface, { rx: rxBytes, tx: txBytes, time: now });

                let rxPerSec = 0, txPerSec = 0;
                if (this.previousNetStats?.has(iface)) {
                    const prev = this.previousNetStats.get(iface)!;
                    const timeDelta = (now - prev.time) / 1000;
                    if (timeDelta > 0) {
                        rxPerSec = Math.round((rxBytes - prev.rx) / timeDelta);
                        txPerSec = Math.round((txBytes - prev.tx) / timeDelta);
                    }
                }
                results.push({
                    interface: iface,
                    rxBytesPerSec: Math.max(0, rxPerSec),
                    txBytesPerSec: Math.max(0, txPerSec)
                });
            }
            this.previousNetStats = currentStats;
            return results;
        } catch {
            return [];
        }
    }

    // Get Docker container stats via Docker Engine API (TCP on host)
    static async getDockerContainers(): Promise<any[]> {
        const dockerHost = process.env.DOCKER_HOST_API || 'http://10.0.1.1:2375';
        try {
            // Get list of containers
            const listResp = await fetch(`${dockerHost}/containers/json?all=false`, { signal: AbortSignal.timeout(5000) });
            if (!listResp.ok) return [];
            const containers = await listResp.json() as any[];

            // Get stats for each container (one-shot, no stream)
            const results = await Promise.all(containers.map(async (c: any) => {
                try {
                    const statsResp = await fetch(`${dockerHost}/containers/${c.Id}/stats?stream=false`, { signal: AbortSignal.timeout(5000) });
                    if (!statsResp.ok) return null;
                    const stats = await statsResp.json() as any;

                    // Calculate CPU %
                    const cpuDelta = (stats.cpu_stats?.cpu_usage?.total_usage || 0) - (stats.precpu_stats?.cpu_usage?.total_usage || 0);
                    const sysDelta = (stats.cpu_stats?.system_cpu_usage || 0) - (stats.precpu_stats?.system_cpu_usage || 0);
                    const cpuCount = stats.cpu_stats?.online_cpus || 1;
                    const cpuPercent = sysDelta > 0 ? Math.round((cpuDelta / sysDelta) * cpuCount * 10000) / 100 : 0;

                    // Memory
                    const memUsage = stats.memory_stats?.usage || 0;
                    const memLimit = stats.memory_stats?.limit || 0;
                    const memPercent = memLimit > 0 ? Math.round((memUsage / memLimit) * 10000) / 100 : 0;

                    // Network I/O
                    let rxBytes = 0, txBytes = 0;
                    if (stats.networks) {
                        for (const net of Object.values(stats.networks) as any[]) {
                            rxBytes += net.rx_bytes || 0;
                            txBytes += net.tx_bytes || 0;
                        }
                    }

                    return {
                        id: c.Id?.substring(0, 12),
                        name: (c.Names?.[0] || '').replace(/^\//, ''),
                        image: c.Image,
                        status: c.Status || c.State,
                        state: c.State,
                        cpu: cpuPercent,
                        memoryUsage: formatBytesBackend(memUsage),
                        memoryLimit: formatBytesBackend(memLimit),
                        memoryPercent: memPercent,
                        netRx: formatBytesBackend(rxBytes),
                        netTx: formatBytesBackend(txBytes),
                        created: c.Created,
                        ports: c.Ports?.map((p: any) => `${p.PublicPort || ''}:${p.PrivatePort}/${p.Type}`).filter((p: string) => p) || []
                    };
                } catch { return null; }
            }));
            return results.filter(Boolean);
        } catch {
            // Fallback to docker CLI (works on host, not in containers)
            try {
                const { stdout } = await execAsync(
                    'docker stats --no-stream --format "{{.ID}}|{{.Name}}|{{.CPUPerc}}|{{.MemUsage}}|{{.MemPerc}}|{{.NetIO}}|{{.PIDs}}" 2>/dev/null',
                    { timeout: 8000 }
                );
                const lines = stdout.trim().split('\n');
                return lines.map(line => {
                    const [id, name, cpuPerc, memUsage, memPerc, netIO, pids] = line.split('|');
                    return {
                        id: id?.trim(),
                        name: name?.trim(),
                        status: 'Running',
                        cpu: parseFloat(cpuPerc?.replace('%', '') || '0'),
                        memoryUsage: memUsage?.trim() || '-',
                        memoryPercent: parseFloat(memPerc?.replace('%', '') || '0'),
                        netIO: netIO?.trim() || '-',
                        pids: parseInt(pids?.trim() || '0')
                    };
                }).filter(c => c.id);
            } catch {
                return [];
            }
        }
    }

    // Helper to get top processes
    static async getTopProcesses(): Promise<any[]> {
        const processes: any[] = [];
        try {
            const { stdout } = await execAsync(
                'ps -eo pid,user,%cpu,%mem,vsz,rss,stat,time,comm --sort=-%cpu 2>/dev/null | head -16 | tail -15',
                { timeout: 5000 }
            );
            const lines = stdout.trim().split('\n');
            for (const line of lines) {
                const parts = line.trim().split(/\s+/);
                if (parts.length >= 9) {
                    const [pid, user, cpu, mem, vsz, rss, stat, time, ...cmdParts] = parts;
                    processes.push({
                        pid: pid,
                        user,
                        cpu: parseFloat(cpu) || 0,
                        mem: parseFloat(mem) || 0,
                        vsz: vsz,
                        rss: rss,
                        stat: stat,
                        command: cmdParts.join(' ').substring(0, 50),
                        time
                    });
                }
            }
            if (processes.length > 0) return processes;
        } catch { /* ps failed */ }

        // Fallback: Read /proc
        try {
            const procPath = fs.existsSync('/host/proc') ? '/host/proc' : '/proc';
            const dirs = fs.readdirSync(procPath).filter(d => /^\d+$/.test(d));
            const totalMem = os.totalmem();
            for (const pid of dirs.slice(0, 50)) {
                try {
                    const statPath = `${procPath}/${pid}/stat`;
                    const statusPath = `${procPath}/${pid}/status`;
                    const cmdlinePath = `${procPath}/${pid}/cmdline`;
                    if (!fs.existsSync(statPath)) continue;
                    const stat = fs.readFileSync(statPath, 'utf8');
                    const status = fs.readFileSync(statusPath, 'utf8');
                    const cmdline = fs.existsSync(cmdlinePath) ? fs.readFileSync(cmdlinePath, 'utf8').replace(/\0/g, ' ').trim() : '';
                    const statMatch = stat.match(/^(\d+)\s+\(([^)]+)\)\s+(\S+)\s+/);
                    if (!statMatch) continue;
                    const uidMatch = status.match(/Uid:\s+(\d+)/);
                    const user = uidMatch ? (uidMatch[1] === '0' ? 'root' : `user${uidMatch[1]}`) : 'unknown';
                    const vmRssMatch = status.match(/VmRSS:\s+(\d+)/);
                    const rss = vmRssMatch ? parseInt(vmRssMatch[1]) * 1024 : 0;
                    const memPercent = totalMem > 0 ? (rss / totalMem) * 100 : 0;
                    const vmSizeMatch = status.match(/VmSize:\s+(\d+)/);
                    const vsz = vmSizeMatch ? parseInt(vmSizeMatch[1]) : 0;
                    processes.push({
                        pid: pid,
                        user,
                        cpu: 0,
                        mem: Math.round(memPercent * 10) / 10,
                        vsz: String(vsz),
                        rss: String(Math.round(rss / 1024)),
                        stat: '-',
                        command: (cmdline || statMatch[2]).substring(0, 50),
                        time: '-'
                    });
                } catch { /* skip */ }
            }
            processes.sort((a, b) => b.mem - a.mem);
            return processes.slice(0, 15);
        } catch { return []; }
    }

    // Get active user sessions from database (active = logged_out_at IS NULL AND activity within 15 min)
    static async getActiveUsers(db?: Pool): Promise<any[]> {
        if (!db) return [];
        try {
            const [rows] = await db.execute(
                `SELECT u.id, u.email, u.name, u.role, u.last_login_at,
                        us.ip_address, us.country, us.user_agent, us.last_activity_at,
                        us.created_at as session_start, us.logged_out_at
                 FROM user_sessions us
                 JOIN users u ON u.id = us.user_id
                 WHERE us.logged_out_at IS NULL
                   AND us.revoked_at IS NULL
                   AND us.expires_at > NOW()
                   AND us.last_activity_at > DATE_SUB(NOW(), INTERVAL 15 MINUTE)
                 ORDER BY us.created_at DESC
                 LIMIT 30`
            );
            return (rows as any[]).map(r => ({
                id: r.id,
                email: r.email,
                name: r.name,
                role: r.role,
                lastActivity: r.last_activity_at,
                ipAddress: r.ip_address || null,
                country: r.country || null,
                userAgent: r.user_agent || null,
                sessionStart: r.session_start || null,
                loggedOutAt: r.logged_out_at || null
            }));
        } catch {
            // Fallback: query users table by last_login_at
            try {
                const [rows] = await db.execute(
                    `SELECT id, email, name, role, last_login_at
                     FROM users
                     WHERE last_login_at > DATE_SUB(NOW(), INTERVAL 30 MINUTE)
                     ORDER BY last_login_at DESC
                     LIMIT 30`
                );
                return (rows as any[]).map(r => ({
                    id: r.id,
                    email: r.email,
                    name: r.name,
                    role: r.role,
                    lastActivity: r.last_login_at,
                    ipAddress: null,
                    country: null,
                    userAgent: null,
                    sessionStart: null,
                    loggedOutAt: null
                }));
            } catch {
                return [];
            }
        }
    }

    static async getExhaustiveMetrics(db?: Pool): Promise<any> {
        const cpus = os.cpus();
        const loadAvg = os.loadavg();

        const [
            cpuUsageResult, memTotalResult, memAvailResult, diskSizeResult, diskAvailResult,
            networkRxResult, networkTxResult, containerCpuResult, containerMemResult,
            nodeUptimeResult, gpuMetrics, ollamaActiveModels, ollamaInstalledModels,
            ollamaVersion, ioStats, cpuCoreStats,
            thermalStats, topProcesses, diskFallback, networkFallback, dockerContainers,
            activeUsers
        ] = await Promise.all([
            this.queryPrometheus('100 - (avg(rate(node_cpu_seconds_total{mode="idle"}[5m])) * 100)'),
            this.queryPrometheus('node_memory_MemTotal_bytes'),
            this.queryPrometheus('node_memory_MemAvailable_bytes'),
            this.queryPrometheus('node_filesystem_size_bytes{mountpoint="/",fstype!="rootfs"}'),
            this.queryPrometheus('node_filesystem_avail_bytes{mountpoint="/",fstype!="rootfs"}'),
            this.queryPrometheus('sum by (device) (rate(node_network_receive_bytes_total{device!="lo"}[5m]))'),
            this.queryPrometheus('sum by (device) (rate(node_network_transmit_bytes_total{device!="lo"}[5m]))'),
            this.queryPrometheus('sum by (container, namespace, pod) (rate(container_cpu_usage_seconds_total{container!="",container!="POD"}[5m])) * 100'),
            this.queryPrometheus('sum by (container, namespace, pod) (container_memory_usage_bytes{container!="",container!="POD"})'),
            this.queryPrometheus('node_time_seconds - node_boot_time_seconds'),
            this.getGpuMetrics(),
            this.getOllamaActiveModels(),
            this.getOllamaInstalledModels(),
            this.getOllamaVersion(),
            this.getIoStats(),
            this.getCpuCoreStats(),
            this.getThermalStats(),
            this.getTopProcesses(),
            this.getDiskStatsFallback(),
            this.getNetworkStatsFallback(),
            this.getDockerContainers(),
            this.getActiveUsers(db)
        ]);

        // CPU usage: Prometheus first, then calculate from os.cpus()
        let cpuUsage = cpuUsageResult[0]?.value?.[1] ? parseFloat(cpuUsageResult[0].value[1]) : 0;
        if (cpuUsage === 0) {
            const totalIdle = cpus.reduce((sum, c) => sum + c.times.idle, 0);
            const totalTick = cpus.reduce((sum, c) => sum + c.times.user + c.times.nice + c.times.sys + c.times.idle + c.times.irq, 0);
            if (totalTick > 0) cpuUsage = parseFloat(((1 - totalIdle / totalTick) * 100).toFixed(1));
        }

        const memTotal = memTotalResult[0]?.value?.[1] ? parseInt(memTotalResult[0].value[1]) : os.totalmem();
        const memAvail = memAvailResult[0]?.value?.[1] ? parseInt(memAvailResult[0].value[1]) : os.freemem();

        // Disk: Prometheus first, fallback to df command
        let diskStats = diskSizeResult.map((d, i) => {
            const size = parseInt(d.value[1]);
            const avail = parseInt(diskAvailResult[i]?.value[1] || '0');
            return {
                device: d.metric.device,
                size, used: size - avail, available: avail,
                usePercent: size > 0 ? Math.round(((size - avail) / size) * 100) : 0,
                mountPoint: d.metric.mountpoint
            };
        });
        if (diskStats.length === 0) {
            diskStats = diskFallback;
        }

        // Network: Prometheus first, fallback to /proc/net/dev
        const virtualIfaceRegex = /^(cali|veth|br-|docker|vxlan|flannel|tunl|cilium|lxc|virbr|cni)/;
        let networkStats = networkRxResult
            .filter(rx => !virtualIfaceRegex.test(rx.metric.device))
            .map(rx => {
                const tx = networkTxResult.find(t => t.metric.device === rx.metric.device);
                return {
                    interface: rx.metric.device,
                    rxBytesPerSec: Math.round(parseFloat(rx.value[1])),
                    txBytesPerSec: Math.round(parseFloat(tx?.value[1] || '0'))
                };
            });
        if (networkStats.length === 0) {
            networkStats = networkFallback;
        }

        // Containers: Prometheus first, fallback to docker stats
        let containerStats = containerCpuResult.map(c => {
            const mem = containerMemResult.find(m => m.metric.pod === c.metric.pod && m.metric.container === c.metric.container);
            return {
                id: c.metric.pod.substring(0, 12),
                name: `${c.metric.namespace}/${c.metric.container}`,
                status: 'Running',
                cpu: Math.round(parseFloat(c.value[1]) * 100) / 100,
                memoryUsage: formatBytesBackend(parseInt(mem?.value[1] || '0')),
                memoryPercent: 0
            };
        }).sort((a, b) => b.cpu - a.cpu).slice(0, 20);
        if (containerStats.length === 0 && dockerContainers.length > 0) {
            containerStats = dockerContainers;
        }

        // CPU per-core usage percentages
        const coreUsages = this.calculateCoreUsages(cpuCoreStats);

        let k8sPods: any[] = [];
        const k8sToken = this.getK8sToken();
        if (k8sToken) {
            try {
                const https = await import('https');
                const podsData = await new Promise<any>((resolve, reject) => {
                    const url = new URL(`${this.K8S_API_URL}/api/v1/pods?limit=100`);
                    const options = {
                        hostname: url.hostname, port: url.port || 443, path: url.pathname + url.search,
                        method: 'GET', rejectUnauthorized: false,
                        headers: { 'Authorization': `Bearer ${k8sToken}`, 'Accept': 'application/json' }
                    };
                    const req = https.request(options, (res) => {
                        let data = '';
                        res.on('data', chunk => data += chunk);
                        res.on('end', () => resolve(JSON.parse(data)));
                    });
                    req.on('error', reject);
                    req.end();
                });
                if (podsData.items) {
                    k8sPods = podsData.items.map((p: any) => ({
                        namespace: p.metadata.namespace,
                        name: p.metadata.name,
                        ready: `${p.status.containerStatuses?.filter((c: any) => c.ready).length || 0}/${p.status.containerStatuses?.length || 0}`,
                        status: p.status.phase,
                        restarts: p.status.containerStatuses?.[0]?.restartCount || 0,
                        age: this.getAge(p.metadata.creationTimestamp)
                    }));
                }
            } catch { /* ignore */ }
        }

        const uptimeSeconds = nodeUptimeResult[0]?.value?.[1] ? parseFloat(nodeUptimeResult[0].value[1]) : os.uptime();

        return {
            timestamp: new Date().toISOString(),
            hostname: os.hostname(),
            platform: os.platform(),
            arch: os.arch(),
            uptime: this.formatUptime(uptimeSeconds),
            cpu: {
                model: cpus[0]?.model || 'Unknown',
                cores: cpus.length,
                usage: cpuUsage,
                loadAvg: { '1m': loadAvg[0], '5m': loadAvg[1], '15m': loadAvg[2] },
                cores_detailed: cpuCoreStats,
                coreUsages
            },
            memory: {
                total: memTotal, used: memTotal - memAvail, free: memAvail,
                usagePercent: parseFloat(((memTotal - memAvail) / memTotal * 100).toFixed(1))
            },
            gpu: gpuMetrics,
            ollama: {
                version: ollamaVersion,
                activeModels: ollamaActiveModels,
                installedModels: ollamaInstalledModels
            },
            disk: diskStats,
            io: ioStats,
            thermal: thermalStats,
            network: { stats: networkStats },
            containers: containerStats,
            dockerContainers,
            processes: topProcesses,
            k8sPods,
            activeUsers
        };
    }

    private static formatUptime(seconds: number) {
        const days = Math.floor(seconds / 86400);
        const hours = Math.floor((seconds % 86400) / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        return { days, hours, minutes, totalSeconds: Math.round(seconds) };
    }

    private static getAge(timestamp: string): string {
        if (!timestamp) return '-';
        const diffMs = new Date().getTime() - new Date(timestamp).getTime();
        const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
        const diffHours = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const diffMinutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
        if (diffDays > 0) return `${diffDays}d`;
        if (diffHours > 0) return `${diffHours}h`;
        return `${diffMinutes}m`;
    }
}
