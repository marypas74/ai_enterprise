import { execAsync, formatBytesBackend } from './shared.js';

// Get Cloudflare Tunnel health from cloudflared metrics endpoint
export async function getCloudflaredHealth(): Promise<any> {
    const metricsUrl = process.env.CLOUDFLARED_METRICS_URL || 'http://10.0.1.1:20243/metrics';
    try {
        const response = await fetch(metricsUrl, { signal: AbortSignal.timeout(3000) });
        if (!response.ok) return { status: 'unreachable' };
        const text = await response.text();

        const parseGauge = (name: string): number => {
            const match = text.match(new RegExp(`^${name}\\s+([\\d.eE+-]+)`, 'm'));
            return match ? parseFloat(match[1]) : 0;
        };
        const parseCounter = (name: string): number => {
            const lines = text.split('\n').filter(l => l.startsWith(name + '{') || l.startsWith(name + ' '));
            let total = 0;
            for (const line of lines) {
                const match = line.match(/\s+([\d.eE+-]+)$/);
                if (match) total += parseFloat(match[1]);
            }
            return total;
        };

        // Parse server locations (active tunnels)
        const locationRegex = /cloudflared_tunnel_server_locations\{.*?location="([^"]+)".*?\}\s+([\d.]+)/g;
        const locations: { location: string; active: boolean }[] = [];
        let locMatch;
        while ((locMatch = locationRegex.exec(text)) !== null) {
            if (parseFloat(locMatch[2]) === 1) {
                locations.push({ location: locMatch[1], active: true });
            }
        }

        // Parse response codes
        const codeRegex = /cloudflared_tunnel_response_by_code\{.*?status_code="(\d+)".*?\}\s+([\d.eE+-]+)/g;
        const responseCodes: Record<string, number> = {};
        let codeMatch;
        while ((codeMatch = codeRegex.exec(text)) !== null) {
            responseCodes[codeMatch[1]] = (responseCodes[codeMatch[1]] || 0) + parseFloat(codeMatch[2]);
        }

        return {
            status: 'connected',
            haConnections: parseGauge('cloudflared_tunnel_ha_connections'),
            totalRequests: parseCounter('cloudflared_tunnel_total_requests'),
            requestErrors: parseCounter('cloudflared_tunnel_request_errors'),
            connectStreamErrors: parseCounter('cloudflared_proxy_connect_streams_errors'),
            activeTcpSessions: parseGauge('cloudflared_tcp_active_sessions'),
            totalTcpSessions: parseCounter('cloudflared_tcp_total_sessions'),
            activeUdpSessions: parseGauge('cloudflared_udp_active_sessions'),
            totalUdpSessions: parseCounter('cloudflared_udp_total_sessions'),
            tunnelRegistrations: parseCounter('cloudflared_tunnel_tunnel_register_success'),
            locations,
            responseCodes,
        };
    } catch {
        return { status: 'unreachable' };
    }
}

// Get Docker container stats via Docker Engine API (TCP on host)
// Note: exec fallback uses hardcoded commands only, no user input - safe from injection
export async function getDockerContainers(): Promise<any[]> {
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
