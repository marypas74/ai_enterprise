import os from 'os';
import fs from 'fs';
import type { Pool } from 'mysql2/promise';
import {
    queryPrometheus, getK8sToken, formatBytesBackend,
    getGpuMetrics, getVllmStatus,
    getNetworkStatsFallback, getNetworkDetailedStats, getTcpUdpStats,
    getCloudflaredHealth, getDockerContainers,
    getTopProcesses, getActiveUsers,
    getIoStats, getCpuCoreStats, getThermalStats, calculateCoreUsages,
    getDiskStatsFallback, formatUptime, getAge
} from './metrics/index.js';

const K8S_API_URL = process.env.K8S_API_URL || 'https://kubernetes.default.svc';

export class MetricsService {
    static async getExhaustiveMetrics(db?: Pool): Promise<any> {
        const cpus = os.cpus();
        const loadAvg = os.loadavg();

        const [
            cpuUsageResult, memTotalResult, memAvailResult, diskSizeResult, diskAvailResult,
            networkRxResult, networkTxResult, containerCpuResult, containerMemResult,
            nodeUptimeResult, gpuMetrics,
            ioStats, cpuCoreStats,
            thermalStats, topProcesses, diskFallback, networkFallback, dockerContainers,
            activeUsers, networkDetailed, tcpUdpStats, cloudflaredHealth
        ] = await Promise.all([
            queryPrometheus('100 - (avg(rate(node_cpu_seconds_total{mode="idle"}[5m])) * 100)'),
            queryPrometheus('node_memory_MemTotal_bytes'),
            queryPrometheus('node_memory_MemAvailable_bytes'),
            queryPrometheus('node_filesystem_size_bytes{mountpoint="/",fstype!="rootfs"}'),
            queryPrometheus('node_filesystem_avail_bytes{mountpoint="/",fstype!="rootfs"}'),
            queryPrometheus('sum by (device) (rate(node_network_receive_bytes_total{device!="lo"}[5m]))'),
            queryPrometheus('sum by (device) (rate(node_network_transmit_bytes_total{device!="lo"}[5m]))'),
            queryPrometheus('sum by (container, namespace, pod) (rate(container_cpu_usage_seconds_total{container!="",container!="POD"}[5m])) * 100'),
            queryPrometheus('sum by (container, namespace, pod) (container_memory_usage_bytes{container!="",container!="POD"})'),
            queryPrometheus('node_time_seconds - node_boot_time_seconds'),
            getGpuMetrics(),
            getIoStats(),
            getCpuCoreStats(),
            getThermalStats(),
            getTopProcesses(),
            getDiskStatsFallback(),
            getNetworkStatsFallback(),
            getDockerContainers(),
            getActiveUsers(db),
            getNetworkDetailedStats(),
            getTcpUdpStats(),
            getCloudflaredHealth(),
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
                const detailed = networkDetailed.find(d => d.interface === rx.metric.device);
                return {
                    interface: rx.metric.device,
                    rxBytesPerSec: Math.round(parseFloat(rx.value[1])),
                    txBytesPerSec: Math.round(parseFloat(tx?.value[1] || '0')),
                    rxBytes: detailed?.rxBytes || 0,
                    txBytes: detailed?.txBytes || 0,
                    rxPackets: detailed?.rxPackets || 0,
                    txPackets: detailed?.txPackets || 0,
                    rxErrors: detailed?.rxErrors || 0,
                    txErrors: detailed?.txErrors || 0,
                    rxDropped: detailed?.rxDropped || 0,
                    txDropped: detailed?.txDropped || 0,
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
        const coreUsages = calculateCoreUsages(cpuCoreStats);

        let k8sPods: any[] = [];
        const k8sToken = getK8sToken();
        if (k8sToken) {
            try {
                const https = await import('https');
                const podsData = await new Promise<any>((resolve, reject) => {
                    const url = new URL(`${K8S_API_URL}/api/v1/pods?limit=100`);
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
                        age: getAge(p.metadata.creationTimestamp)
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
            uptime: formatUptime(uptimeSeconds),
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
            vllm: await getVllmStatus(),
            disk: diskStats,
            io: ioStats,
            thermal: thermalStats,
            network: { stats: networkStats },
            connectionHealth: tcpUdpStats,
            cloudflared: cloudflaredHealth,
            containers: containerStats,
            dockerContainers,
            processes: topProcesses,
            k8sPods,
            activeUsers
        };
    }
}
