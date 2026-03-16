import fs from 'fs';
import { execAsync, getHostProcPath } from './shared.js';

// Helper to get IO stats from /proc/diskstats
export async function getIoStats(): Promise<any[]> {
    try {
        const hostProcPath = getHostProcPath();
        const diskstats = fs.readFileSync(`${hostProcPath}/diskstats`, 'utf8');
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
export async function getCpuCoreStats(): Promise<any[]> {
    try {
        const hostProcPath = getHostProcPath();
        const stat = fs.readFileSync(`${hostProcPath}/stat`, 'utf8');
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
export async function getThermalStats(): Promise<any[]> {
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

// Module-level cache for CPU delta calculation
let previousCpuCoreStats: any[] | null = null;

// Calculate per-core CPU usage percentages using delta between samples
export function calculateCoreUsages(currentStats: any[]): number[] {
    if (!previousCpuCoreStats || previousCpuCoreStats.length !== currentStats.length) {
        previousCpuCoreStats = currentStats;
        return currentStats.map(() => 0);
    }
    const usages = currentStats.map((curr, i) => {
        const prev = previousCpuCoreStats![i];
        const totalDelta = curr.total - prev.total;
        const idleDelta = curr.idle - prev.idle;
        if (totalDelta === 0) return 0;
        return Math.round(((totalDelta - idleDelta) / totalDelta) * 1000) / 10;
    });
    previousCpuCoreStats = currentStats;
    return usages;
}

// Fallback disk stats using df command
// Note: hardcoded command, no user input - exec is safe here
export async function getDiskStatsFallback(): Promise<any[]> {
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

export function formatUptime(seconds: number) {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return { days, hours, minutes, totalSeconds: Math.round(seconds) };
}

export function getAge(timestamp: string): string {
    if (!timestamp) return '-';
    const diffMs = new Date().getTime() - new Date(timestamp).getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    const diffHours = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const diffMinutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
    if (diffDays > 0) return `${diffDays}d`;
    if (diffHours > 0) return `${diffHours}h`;
    return `${diffMinutes}m`;
}
