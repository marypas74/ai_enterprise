import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import bcrypt from 'bcrypt';
import os from 'os';
import fs from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';
import { findOne, findMany, insertOne, updateOne } from '../../database/index.js';

const execAsync = promisify(exec);

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

// Middleware: Admin only
async function adminOnly(request: FastifyRequest, reply: FastifyReply) {
  const user = request.user as { role: string };
  if (user.role !== 'admin') {
    return reply.status(403).send({ error: 'Admin access required' });
  }
}

// Types
interface User {
  id: number;
  email: string;
  name: string;
  role: 'admin' | 'user';
  is_active: boolean;
  created_at: Date;
  last_login_at: Date;
}

interface Group {
  id: number;
  name: string;
  description: string;
  max_tokens_per_month: number;
  allowed_models: string;
  is_active: boolean;
}

interface UsageStats {
  user_id: number;
  email: string;
  name: string;
  total_tokens: number;
  total_cost: number;
  request_count: number;
}

interface AuditLog {
  id: number;
  user_id: number;
  action: string;
  entity_type: string;
  entity_id: number;
  details: string;
  ip_address: string;
  created_at: Date;
}

export async function adminRoutes(fastify: FastifyInstance) {
  // All routes require authentication + admin role
  fastify.addHook('onRequest', async (request, reply) => {
    await (fastify as any).authenticate(request, reply);
    await adminOnly(request, reply);
  });

  // ==================== USERS ====================

  // List users
  fastify.get('/users', {
    schema: {
      description: 'List all users (admin)',
      tags: ['admin'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest) => {
    const query = request.query as { limit?: string; offset?: string; search?: string };
    const limit = parseInt(query.limit || '50');
    const offset = parseInt(query.offset || '0');
    const search = query.search || '';

    let sql = `
      SELECT u.*,
             GROUP_CONCAT(g.name) as groups,
             (SELECT SUM(total_tokens_input + total_tokens_output) FROM monthly_usage WHERE user_id = u.id) as total_tokens
      FROM users u
      LEFT JOIN user_groups ug ON u.id = ug.user_id
      LEFT JOIN \`groups\` g ON ug.group_id = g.id
    `;

    const params: any[] = [];

    if (search) {
      sql += ' WHERE u.email LIKE ? OR u.name LIKE ?';
      params.push(`%${search}%`, `%${search}%`);
    }

    sql += ' GROUP BY u.id ORDER BY u.created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    return findMany<User>(fastify.db, sql, params);
  });

  // Get user details
  fastify.get('/users/:id', {
    schema: {
      description: 'Get user details (admin)',
      tags: ['admin'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const params = request.params as { id: string };

    const user = await findOne(
      fastify.db,
      `SELECT u.*,
              JSON_ARRAYAGG(JSON_OBJECT('id', g.id, 'name', g.name)) as groups
       FROM users u
       LEFT JOIN user_groups ug ON u.id = ug.user_id
       LEFT JOIN \`groups\` g ON ug.group_id = g.id
       WHERE u.id = ?
       GROUP BY u.id`,
      [params.id]
    );

    if (!user) {
      return reply.status(404).send({ error: 'User not found' });
    }

    return user;
  });

  // Create user
  fastify.post('/users', {
    schema: {
      description: 'Create new user (admin)',
      tags: ['admin'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as {
      email: string;
      password: string;
      name: string;
      role?: 'admin' | 'user';
      groupIds?: number[];
    };

    // Check if exists
    const existing = await findOne(fastify.db, 'SELECT id FROM users WHERE email = ?', [body.email]);
    if (existing) {
      return reply.status(409).send({ error: 'Email already exists' });
    }

    const passwordHash = await bcrypt.hash(body.password, 10);

    const userId = await insertOne(
      fastify.db,
      'INSERT INTO users (email, password_hash, name, role) VALUES (?, ?, ?, ?)',
      [body.email, passwordHash, body.name, body.role || 'user']
    );

    // Add to groups
    if (body.groupIds && body.groupIds.length > 0) {
      for (const groupId of body.groupIds) {
        await insertOne(
          fastify.db,
          'INSERT INTO user_groups (user_id, group_id) VALUES (?, ?)',
          [userId, groupId]
        );
      }
    } else {
      // Add to default group
      await insertOne(fastify.db, 'INSERT INTO user_groups (user_id, group_id) VALUES (?, 1)', [userId]);
    }

    // Audit log
    const admin = request.user as { id: number };
    await insertOne(
      fastify.db,
      'INSERT INTO audit_log (user_id, action, entity_type, entity_id, ip_address) VALUES (?, ?, ?, ?, ?)',
      [admin.id, 'create_user', 'user', userId, request.ip]
    );

    return reply.status(201).send({ userId, message: 'User created' });
  });

  // Update user
  fastify.patch('/users/:id', {
    schema: {
      description: 'Update user (admin)',
      tags: ['admin'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const params = request.params as { id: string };
    const body = request.body as {
      name?: string;
      role?: 'admin' | 'user';
      is_active?: boolean;
      password?: string;
    };

    const updates: string[] = [];
    const values: any[] = [];

    if (body.name) {
      updates.push('name = ?');
      values.push(body.name);
    }
    if (body.role) {
      updates.push('role = ?');
      values.push(body.role);
    }
    if (body.is_active !== undefined) {
      updates.push('is_active = ?');
      values.push(body.is_active);
    }
    if (body.password) {
      updates.push('password_hash = ?');
      values.push(await bcrypt.hash(body.password, 10));
    }

    if (updates.length === 0) {
      return reply.status(400).send({ error: 'No fields to update' });
    }

    values.push(params.id);
    const result = await updateOne(
      fastify.db,
      `UPDATE users SET ${updates.join(', ')} WHERE id = ?`,
      values
    );

    if (result === 0) {
      return reply.status(404).send({ error: 'User not found' });
    }

    // Audit log
    const admin = request.user as { id: number };
    await insertOne(
      fastify.db,
      'INSERT INTO audit_log (user_id, action, entity_type, entity_id, details, ip_address) VALUES (?, ?, ?, ?, ?, ?)',
      [admin.id, 'update_user', 'user', params.id, JSON.stringify(body), request.ip]
    );

    return { message: 'User updated' };
  });

  // Delete user
  fastify.delete('/users/:id', {
    schema: {
      description: 'Delete user (admin)',
      tags: ['admin'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const params = request.params as { id: string };
    const admin = request.user as { id: number };

    // Prevent self-deletion
    if (parseInt(params.id) === admin.id) {
      return reply.status(400).send({ error: 'Cannot delete yourself' });
    }

    const result = await updateOne(fastify.db, 'DELETE FROM users WHERE id = ?', [params.id]);

    if (result === 0) {
      return reply.status(404).send({ error: 'User not found' });
    }

    // Audit log
    await insertOne(
      fastify.db,
      'INSERT INTO audit_log (user_id, action, entity_type, entity_id, ip_address) VALUES (?, ?, ?, ?, ?)',
      [admin.id, 'delete_user', 'user', params.id, request.ip]
    );

    return { message: 'User deleted' };
  });

  // Note: Groups routes are defined in settings.ts to avoid duplication

  // ==================== USAGE & STATS ====================

  // Get usage statistics
  fastify.get('/usage', {
    schema: {
      description: 'Get usage statistics (admin)',
      tags: ['admin'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest) => {
    const query = request.query as { month?: string; userId?: string };
    const month = query.month || new Date().toISOString().slice(0, 7);

    let sql = `
      SELECT u.id as user_id, u.email, u.name,
             COALESCE(SUM(mu.total_tokens_input + mu.total_tokens_output), 0) as total_tokens,
             COALESCE(SUM(mu.total_cost_usd), 0) as total_cost,
             COALESCE(SUM(mu.request_count), 0) as request_count
      FROM users u
      LEFT JOIN monthly_usage mu ON u.id = mu.user_id AND mu.\`year_month\` = ?
    `;

    const params: any[] = [month];

    if (query.userId) {
      sql += ' WHERE u.id = ?';
      params.push(query.userId);
    }

    sql += ' GROUP BY u.id ORDER BY total_cost DESC';

    const userStats = await findMany<UsageStats>(fastify.db, sql, params);

    // Get provider breakdown
    const providerStats = await findMany(
      fastify.db,
      `SELECT provider,
              SUM(total_tokens_input) as tokens_input,
              SUM(total_tokens_output) as tokens_output,
              SUM(total_cost_usd) as cost,
              SUM(request_count) as requests
       FROM monthly_usage
       WHERE \`year_month\` = ?
       GROUP BY provider`,
      [month]
    );

    // Get totals
    const [totals] = await fastify.db.execute(
      `SELECT
         SUM(total_tokens_input + total_tokens_output) as total_tokens,
         SUM(total_cost_usd) as total_cost,
         SUM(request_count) as total_requests
       FROM monthly_usage
       WHERE \`year_month\` = ?`,
      [month]
    ) as any;

    return {
      month,
      totals: totals[0] || { total_tokens: 0, total_cost: 0, total_requests: 0 },
      byProvider: providerStats,
      byUser: userStats
    };
  });

  // ==================== SYSTEM STATS ====================

  // Get system statistics for dashboard
  fastify.get('/system-stats', {
    schema: {
      description: 'Get system statistics for dashboard (admin)',
      tags: ['admin'],
      security: [{ bearerAuth: [] }]
    }
  }, async () => {
    // Users stats
    let userStats = { totalUsers: 0, activeUsers: 0 };
    try {
      const [rows] = await fastify.db.execute(
        `SELECT COUNT(*) as totalUsers, SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) as activeUsers FROM users`
      ) as any;
      userStats = rows[0] || userStats;
    } catch {
      try {
        const [rows] = await fastify.db.execute(`SELECT COUNT(*) as totalUsers FROM users`) as any;
        const total = rows[0]?.totalUsers || 0;
        userStats = { totalUsers: total, activeUsers: total };
      } catch { /* Table may not exist */ }
    }

    // Providers stats
    let providerStats = { totalProviders: 0, activeProviders: 0 };
    try {
      const [rows] = await fastify.db.execute(
        `SELECT COUNT(*) as totalProviders, SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) as activeProviders FROM ai_providers`
      ) as any;
      providerStats = rows[0] || providerStats;
    } catch {
      try {
        const [rows] = await fastify.db.execute(`SELECT COUNT(*) as totalProviders FROM ai_providers`) as any;
        const total = rows[0]?.totalProviders || 0;
        providerStats = { totalProviders: total, activeProviders: total };
      } catch { /* Table may not exist */ }
    }

    // Models stats
    let modelStats = { totalModels: 0, activeModels: 0 };
    try {
      const [rows] = await fastify.db.execute(
        `SELECT COUNT(*) as totalModels, SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) as activeModels FROM ai_models`
      ) as any;
      modelStats = rows[0] || modelStats;
    } catch {
      try {
        const [rows] = await fastify.db.execute(`SELECT COUNT(*) as totalModels FROM ai_models`) as any;
        const total = rows[0]?.totalModels || 0;
        modelStats = { totalModels: total, activeModels: total };
      } catch { /* Table may not exist */ }
    }

    // Agents stats
    let agentStats = { activeAgents: 0 };
    try {
      const [agentResult] = await fastify.db.execute(
        `SELECT COUNT(*) as activeAgents FROM agents WHERE status = 'active'`
      ) as any;
      agentStats = agentResult[0] || { activeAgents: 0 };
    } catch { /* Table may not exist */ }

    // Plugins stats
    let pluginStats = { totalPlugins: 0 };
    try {
      const [pluginResult] = await fastify.db.execute(
        `SELECT COUNT(*) as totalPlugins FROM plugins`
      ) as any;
      pluginStats = pluginResult[0] || { totalPlugins: 0 };
    } catch { /* Table may not exist */ }

    // MCP Servers stats
    let mcpStats = { mcpServers: 0 };
    try {
      const [mcpResult] = await fastify.db.execute(
        `SELECT COUNT(*) as mcpServers FROM mcp_servers`
      ) as any;
      mcpStats = mcpResult[0] || { mcpServers: 0 };
    } catch { /* Table may not exist */ }

    // Today's requests
    let todayRequests = 0;
    try {
      const today = new Date().toISOString().slice(0, 10);
      const [rows] = await fastify.db.execute(
        `SELECT COUNT(*) as cnt FROM usage_log WHERE DATE(created_at) = ?`,
        [today]
      ) as any;
      todayRequests = Number(rows[0]?.cnt) || 0;
    } catch { /* Table may not exist */ }

    // This week's requests
    let weekRequests = 0;
    try {
      const [rows] = await fastify.db.execute(
        `SELECT COUNT(*) as cnt FROM usage_log WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)`
      ) as any;
      weekRequests = Number(rows[0]?.cnt) || 0;
    } catch { /* Table may not exist */ }

    // This month's cost
    let monthCost = 0;
    try {
      const currentMonth = new Date().toISOString().slice(0, 7);
      const [rows] = await fastify.db.execute(
        `SELECT COALESCE(SUM(total_cost_usd), 0) as cost FROM monthly_usage WHERE \`year_month\` = ?`,
        [currentMonth]
      ) as any;
      monthCost = Number(rows[0]?.cost) || 0;
    } catch { /* Table may not exist */ }

    // Success rate and avg response time
    let successRate = 100;
    let avgResponseTime = 0;
    try {
      const [rows] = await fastify.db.execute(
        `SELECT
           ROUND(AVG(CASE WHEN status = 'success' THEN 100 ELSE 0 END), 1) as rate,
           ROUND(AVG(response_time_ms) / 1000, 2) as respTime
         FROM usage_log
         WHERE created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)`
      ) as any;
      if (rows[0]?.rate !== null) {
        successRate = Number(rows[0].rate) || 100;
        avgResponseTime = Number(rows[0].respTime) || 0;
      }
    } catch { /* Column may not exist */ }

    return {
      activeUsers: Number(userStats?.activeUsers) || 0,
      totalUsers: Number(userStats?.totalUsers) || 0,
      activeProviders: Number(providerStats?.activeProviders) || 0,
      totalProviders: Number(providerStats?.totalProviders) || 0,
      activeModels: Number(modelStats?.activeModels) || 0,
      totalModels: Number(modelStats?.totalModels) || 0,
      activeAgents: Number(agentStats?.activeAgents) || 0,
      totalPlugins: Number(pluginStats?.totalPlugins) || 0,
      mcpServers: Number(mcpStats?.mcpServers) || 0,
      todayRequests,
      weekRequests,
      monthCost,
      successRate,
      avgResponseTime
    };
  });

  // ==================== AUDIT LOG ====================

  // Get audit log
  fastify.get('/audit-log', {
    schema: {
      description: 'Get audit log (admin)',
      tags: ['admin'],
      security: [{ bearerAuth: [] }]
    }
  }, async (request: FastifyRequest) => {
    const query = request.query as {
      limit?: string;
      offset?: string;
      action?: string;
      userId?: string;
    };

    const limit = parseInt(query.limit || '100');
    const offset = parseInt(query.offset || '0');

    let sql = `
      SELECT al.*, u.email as user_email, u.name as user_name
      FROM audit_log al
      LEFT JOIN users u ON al.user_id = u.id
      WHERE 1=1
    `;

    const params: any[] = [];

    if (query.action) {
      sql += ' AND al.action = ?';
      params.push(query.action);
    }

    if (query.userId) {
      sql += ' AND al.user_id = ?';
      params.push(query.userId);
    }

    sql += ' ORDER BY al.created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    return findMany<AuditLog>(fastify.db, sql, params);
  });

  // ==================== SYSTEM MONITORING ====================

  const PROMETHEUS_URL = process.env.PROMETHEUS_URL || 'http://kube-prom-stack-kube-prome-prometheus.observability.svc.cluster.local:9090';
  const K8S_API_URL = process.env.K8S_API_URL || 'https://kubernetes.default.svc';

  // Helper to query Prometheus
  async function queryPrometheus(query: string): Promise<PrometheusResponse['data']['result']> {
    try {
      const response = await fetch(`${PROMETHEUS_URL}/api/v1/query?query=${encodeURIComponent(query)}`);
      const data = await response.json() as PrometheusResponse;
      return data.status === 'success' ? data.data.result : [];
    } catch {
      return [];
    }
  }

  // Helper to get Kubernetes API token
  function getK8sToken(): string {
    try {
      return fs.readFileSync('/var/run/secrets/kubernetes.io/serviceaccount/token', 'utf8');
    } catch {
      return '';
    }
  }

  // Get real-time system metrics from Prometheus
  fastify.get('/system-monitor', {
    schema: {
      description: 'Get real-time system monitoring data from Prometheus (admin)',
      tags: ['admin'],
      security: [{ bearerAuth: [] }]
    }
  }, async () => {
    // Basic info from container
    const cpus = os.cpus();
    const loadAvg = os.loadavg();

    // Query Prometheus for metrics
    const [
      cpuUsageResult,
      memTotalResult,
      memAvailResult,
      diskSizeResult,
      diskAvailResult,
      networkRxResult,
      networkTxResult,
      containerCpuResult,
      containerMemResult,
      nodeUptimeResult
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
      queryPrometheus('node_time_seconds - node_boot_time_seconds')
    ]);

    // Parse CPU usage
    const cpuUsage = cpuUsageResult[0]?.value?.[1] ? parseFloat(cpuUsageResult[0].value[1]) : 0;

    // Parse Memory
    const memTotal = memTotalResult[0]?.value?.[1] ? parseInt(memTotalResult[0].value[1]) : os.totalmem();
    const memAvail = memAvailResult[0]?.value?.[1] ? parseInt(memAvailResult[0].value[1]) : os.freemem();
    const memUsed = memTotal - memAvail;
    const memUsagePercent = Math.round((memUsed / memTotal) * 100 * 10) / 10;

    // Parse Disk info
    const diskInfo: any[] = [];
    if (diskSizeResult.length > 0) {
      for (let i = 0; i < diskSizeResult.length; i++) {
        const size = parseInt(diskSizeResult[i]?.value?.[1] || '0');
        const avail = parseInt(diskAvailResult[i]?.value?.[1] || '0');
        const used = size - avail;
        const mountpoint = diskSizeResult[i]?.metric?.mountpoint || '/';
        const device = diskSizeResult[i]?.metric?.device || '/dev/sda';
        diskInfo.push({
          device,
          size: formatBytes(size),
          used: formatBytes(used),
          available: formatBytes(avail),
          usePercent: size > 0 ? Math.round((used / size) * 100) : 0,
          mountPoint: mountpoint
        });
      }
    }

    // Parse Network stats
    const networkStats: any[] = [];
    for (const rx of networkRxResult) {
      const device = rx.metric?.device || 'eth0';
      const rxRate = parseFloat(rx.value?.[1] || '0');
      const txItem = networkTxResult.find((t: any) => t.metric?.device === device);
      const txRate = parseFloat(txItem?.value?.[1] || '0');
      networkStats.push({
        interface: device,
        rxBytesPerSec: Math.round(rxRate),
        txBytesPerSec: Math.round(txRate),
        rxBytes: Math.round(rxRate),
        txBytes: Math.round(txRate)
      });
    }

    // Parse Container metrics
    const containers: any[] = [];
    for (const cpu of containerCpuResult) {
      const name = cpu.metric?.container || 'unknown';
      const namespace = cpu.metric?.namespace || '';
      const pod = cpu.metric?.pod || '';
      const cpuPercent = parseFloat(cpu.value?.[1] || '0');
      const memItem = containerMemResult.find((m: any) =>
        m.metric?.container === name && m.metric?.namespace === namespace
      );
      const memBytes = parseInt(memItem?.value?.[1] || '0');
      containers.push({
        id: pod.substring(0, 12),
        name: `${namespace}/${name}`,
        status: 'Running',
        image: '-',
        cpu: Math.round(cpuPercent * 100) / 100,
        memory: formatBytes(memBytes),
        memoryBytes: memBytes
      });
    }
    // Sort by CPU and take top 15
    containers.sort((a, b) => b.cpu - a.cpu);

    // Get Kubernetes pods via API using native https module
    let k8sPods: any[] = [];
    const k8sToken = getK8sToken();

    if (k8sToken) {
      try {
        const https = await import('https');
        const podsData = await new Promise<any>((resolve, reject) => {
          const url = new URL(`${K8S_API_URL}/api/v1/pods?limit=50`);
          const options = {
            hostname: url.hostname,
            port: url.port || 443,
            path: url.pathname + url.search,
            method: 'GET',
            rejectUnauthorized: false, // Skip cert validation for internal K8s API
            headers: {
              'Authorization': `Bearer ${k8sToken}`,
              'Accept': 'application/json'
            }
          };

          const req = https.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
              try {
                resolve(JSON.parse(data));
              } catch {
                reject(new Error('Invalid JSON'));
              }
            });
          });

          req.on('error', reject);
          req.setTimeout(10000, () => {
            req.destroy();
            reject(new Error('Timeout'));
          });
          req.end();
        });

        if (podsData.items) {
          k8sPods = podsData.items.map((pod: any) => ({
            namespace: pod.metadata?.namespace || '',
            name: pod.metadata?.name || '',
            ready: `${pod.status?.containerStatuses?.filter((c: any) => c.ready).length || 0}/${pod.status?.containerStatuses?.length || 0}`,
            status: pod.status?.phase || 'Unknown',
            restarts: pod.status?.containerStatuses?.[0]?.restartCount || 0,
            age: getAge(pod.metadata?.creationTimestamp)
          }));
        }
      } catch (err) {
        fastify.log.warn(`K8s API error: ${err}`);
        // K8s API not available
      }
    }

    // Uptime
    const uptimeSeconds = nodeUptimeResult[0]?.value?.[1] ? parseFloat(nodeUptimeResult[0].value[1]) : os.uptime();
    const uptimeDays = Math.floor(uptimeSeconds / 86400);
    const uptimeHours = Math.floor((uptimeSeconds % 86400) / 3600);
    const uptimeMinutes = Math.floor((uptimeSeconds % 3600) / 60);

    return {
      timestamp: new Date().toISOString(),
      hostname: os.hostname(),
      platform: os.platform(),
      arch: os.arch(),
      source: 'prometheus',
      uptime: { days: uptimeDays, hours: uptimeHours, minutes: uptimeMinutes, totalSeconds: uptimeSeconds },
      cpu: {
        model: cpus[0]?.model || 'Unknown',
        cores: cpus.length,
        speed: cpus[0]?.speed || 0,
        usage: Math.round(cpuUsage * 10) / 10,
        loadAvg: { '1m': loadAvg[0], '5m': loadAvg[1], '15m': loadAvg[2] }
      },
      memory: {
        total: memTotal,
        used: memUsed,
        free: memAvail,
        usagePercent: memUsagePercent
      },
      disk: diskInfo,
      network: {
        interfaces: [],
        stats: networkStats
      },
      containers: containers.slice(0, 20),
      processes: await getTopProcesses(),
      k8sPods
    };
  });

  // Get top processes by reading /proc filesystem directly (works with hostPID)
  async function getTopProcesses(): Promise<any[]> {
    const processes: any[] = [];

    try {
      // Try GNU ps first (works on full Linux), then fallback to reading /proc
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
            pid: pid, // string as frontend expects
            user,
            cpu: parseFloat(cpu) || 0,
            mem: parseFloat(mem) || 0, // 'mem' not 'memory' - matches frontend
            vsz: vsz, // string
            rss: rss, // string
            stat: stat,
            command: cmdParts.join(' ').substring(0, 50),
            time
          });
        }
      }
      if (processes.length > 0) return processes;
    } catch {
      // GNU ps not available, try reading /proc directly
    }

    // Fallback: Read /proc filesystem directly (works with BusyBox and hostPID)
    try {
      const procPath = fs.existsSync('/host/proc') ? '/host/proc' : '/proc';
      const dirs = fs.readdirSync(procPath).filter(d => /^\d+$/.test(d));
      const totalMem = os.totalmem();

      for (const pid of dirs.slice(0, 50)) {
        try {
          const statPath = `${procPath}/${pid}/stat`;
          const cmdlinePath = `${procPath}/${pid}/cmdline`;
          const statusPath = `${procPath}/${pid}/status`;

          if (!fs.existsSync(statPath)) continue;

          const stat = fs.readFileSync(statPath, 'utf8');
          const cmdline = fs.existsSync(cmdlinePath) ? fs.readFileSync(cmdlinePath, 'utf8').replace(/\0/g, ' ').trim() : '';
          const status = fs.existsSync(statusPath) ? fs.readFileSync(statusPath, 'utf8') : '';

          // Parse stat file: pid (comm) state ppid pgrp session tty_nr tpgid flags ...
          const statMatch = stat.match(/^(\d+)\s+\(([^)]+)\)\s+(\S+)\s+/);
          if (!statMatch) continue;

          // Get user from status file
          const uidMatch = status.match(/Uid:\s+(\d+)/);
          const uid = uidMatch ? uidMatch[1] : '0';
          const user = uid === '0' ? 'root' : `user${uid}`;

          // Get memory from status file (VmRSS in KB)
          const vmRssMatch = status.match(/VmRSS:\s+(\d+)/);
          const rss = vmRssMatch ? parseInt(vmRssMatch[1]) * 1024 : 0;
          const memPercent = totalMem > 0 ? (rss / totalMem) * 100 : 0;

          // Get VmSize from status file
          const vmSizeMatch = status.match(/VmSize:\s+(\d+)/);
          const vsz = vmSizeMatch ? parseInt(vmSizeMatch[1]) : 0;

          processes.push({
            pid: pid, // string as frontend expects
            user,
            cpu: 0, // CPU requires sampling over time, skip for now
            mem: Math.round(memPercent * 10) / 10, // 'mem' not 'memory' - matches frontend
            vsz: String(vsz),
            rss: String(Math.round(rss / 1024)),
            stat: '-',
            command: (cmdline || statMatch[2]).substring(0, 50),
            time: '-'
          });
        } catch {
          // Skip this process
        }
      }

      // Sort by memory usage and return top 15
      processes.sort((a, b) => b.mem - a.mem);
      return processes.slice(0, 15);
    } catch (error) {
      fastify.log.warn(`Failed to read processes: ${error}`);
      return [];
    }
  }

  // Helper functions
  function formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  function getAge(timestamp: string): string {
    if (!timestamp) return '-';
    const now = new Date();
    const created = new Date(timestamp);
    const diffMs = now.getTime() - created.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    const diffHours = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const diffMinutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
    if (diffDays > 0) return `${diffDays}d`;
    if (diffHours > 0) return `${diffHours}h`;
    return `${diffMinutes}m`;
  }
}
