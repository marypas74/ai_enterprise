import fs from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';

export const execAsync = promisify(exec);

// Prometheus API response type
export interface PrometheusResponse {
    status: string;
    data: {
        result: Array<{
            metric: Record<string, string>;
            value: [number, string];
        }>;
    };
}

const PROMETHEUS_URL = process.env.PROMETHEUS_URL || 'http://kube-prom-stack-kube-prome-prometheus.observability.svc.cluster.local:9090';

export async function queryPrometheus(query: string): Promise<PrometheusResponse['data']['result']> {
    try {
        const response = await fetch(`${PROMETHEUS_URL}/api/v1/query?query=${encodeURIComponent(query)}`);
        const data = await response.json() as PrometheusResponse;
        return data.status === 'success' ? data.data.result : [];
    } catch {
        return [];
    }
}

export function getK8sToken(): string {
    try {
        return fs.readFileSync('/var/run/secrets/kubernetes.io/serviceaccount/token', 'utf8');
    } catch {
        return '';
    }
}

export function getHostProcPath(): string {
    return fs.existsSync('/host/proc') ? '/host/proc' : '/proc';
}

export function getHostNetPath(): string {
    // /proc/net shows container namespace; /host/proc/1/net shows host namespace
    if (fs.existsSync('/host/proc/1/net')) return '/host/proc/1/net';
    return fs.existsSync('/host/proc') ? '/host/proc/net' : '/proc/net';
}

export function formatBytesBackend(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}
