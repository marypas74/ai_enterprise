import { queryPrometheus, execAsync } from './shared.js';
import { getVLLMHealthService } from '../VLLMHealthService.js';

const DCGM_EXPORTER_URL = process.env.DCGM_EXPORTER_URL || 'http://nvidia-dcgm-exporter.gpu-operator-resources.svc.cluster.local:9400/metrics';

// Parse a single metric value from Prometheus text format, grouped by gpu label
function parseDcgmMetric(text: string, metricName: string): Map<string, { value: number; labels: Record<string, string> }> {
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
export async function getGpuMetrics(): Promise<any[]> {
    // Method 1: Try Prometheus DCGM queries (works when ServiceMonitor is configured)
    try {
        const [utilResult, fbUsedResult, fbFreeResult, tempResult, powerResult] = await Promise.all([
            queryPrometheus('DCGM_FI_DEV_GPU_UTIL'),
            queryPrometheus('DCGM_FI_DEV_FB_USED'),
            queryPrometheus('DCGM_FI_DEV_FB_FREE'),
            queryPrometheus('DCGM_FI_DEV_GPU_TEMP'),
            queryPrometheus('DCGM_FI_DEV_POWER_USAGE'),
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
        const response = await fetch(DCGM_EXPORTER_URL, { signal: AbortSignal.timeout(5000) });
        if (response.ok) {
            const text = await response.text();
            const utilMap = parseDcgmMetric(text, 'DCGM_FI_DEV_GPU_UTIL');
            const fbUsedMap = parseDcgmMetric(text, 'DCGM_FI_DEV_FB_USED');
            const fbFreeMap = parseDcgmMetric(text, 'DCGM_FI_DEV_FB_FREE');
            const tempMap = parseDcgmMetric(text, 'DCGM_FI_DEV_GPU_TEMP');
            const powerMap = parseDcgmMetric(text, 'DCGM_FI_DEV_POWER_USAGE');

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
    // Note: hardcoded command, no user input - exec is safe here
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

// Delegates to VLLMHealthService singleton (single source of truth)
export async function getVllmStatus(): Promise<{ healthy: boolean; models: string[]; inferenceMode: string }> {
    const inferenceMode = process.env.INFERENCE_MODE || 'vllm';
    try {
        const svc = getVLLMHealthService();
        const healthy = await svc.isHealthy();
        if (!healthy) return { healthy: false, models: [], inferenceMode };
        const modelIds = await svc.getServedModelIds();
        return { healthy: true, models: [...modelIds], inferenceMode };
    } catch {
        return { healthy: false, models: [], inferenceMode };
    }
}
