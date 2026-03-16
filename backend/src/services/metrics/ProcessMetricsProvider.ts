import os from 'os';
import fs from 'fs';
import type { Pool } from 'mysql2/promise';
import { execAsync, getHostProcPath } from './shared.js';

// Helper to get top processes
// Note: exec uses hardcoded commands only, no user input - safe from injection
export async function getTopProcesses(): Promise<any[]> {
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
        const procPath = getHostProcPath();
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
export async function getActiveUsers(db?: Pool): Promise<any[]> {
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
