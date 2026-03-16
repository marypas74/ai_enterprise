import fs from 'fs';
import { queryPrometheus, getHostNetPath } from './shared.js';

// Module-level cache for network rate calculation
let previousNetStats: Map<string, { rx: number; tx: number; time: number }> | null = null;

const VIRTUAL_IFACE_REGEX = /^(cali|veth|br-|docker|vxlan|flannel|tunl|cilium|lxc|virbr|cni)/;

// Fallback network stats using /proc/net/dev with rate calculation
export async function getNetworkStatsFallback(): Promise<any[]> {
    try {
        const hostNetPath = getHostNetPath();
        const netdev = fs.readFileSync(`${hostNetPath}/dev`, 'utf8');
        const lines = netdev.trim().split('\n').slice(2);
        const currentStats = new Map<string, { rx: number; tx: number; time: number }>();
        const results: any[] = [];

        for (const line of lines) {
            const parts = line.trim().split(/[:\s]+/);
            if (parts.length < 11) continue;
            const iface = parts[0];
            if (iface === 'lo') continue;
            // Skip virtual/container interfaces — only show physical NICs
            if (VIRTUAL_IFACE_REGEX.test(iface)) continue;
            const rxBytes = parseInt(parts[1]);
            const txBytes = parseInt(parts[9]);
            const now = Date.now();
            currentStats.set(iface, { rx: rxBytes, tx: txBytes, time: now });

            let rxPerSec = 0, txPerSec = 0;
            if (previousNetStats?.has(iface)) {
                const prev = previousNetStats.get(iface)!;
                const timeDelta = (now - prev.time) / 1000;
                if (timeDelta > 0) {
                    rxPerSec = Math.round((rxBytes - prev.rx) / timeDelta);
                    txPerSec = Math.round((txBytes - prev.tx) / timeDelta);
                }
            }
            results.push({
                interface: iface,
                rxBytesPerSec: Math.max(0, rxPerSec),
                txBytesPerSec: Math.max(0, txPerSec),
                rxBytes,
                txBytes,
                rxPackets: parseInt(parts[2]) || 0,
                txPackets: parseInt(parts[10]) || 0,
                rxErrors: parseInt(parts[3]) || 0,
                txErrors: parseInt(parts[11]) || 0,
                rxDropped: parseInt(parts[4]) || 0,
                txDropped: parseInt(parts[12]) || 0
            });
        }
        previousNetStats = currentStats;
        return results;
    } catch {
        return [];
    }
}

// Get detailed network stats per interface (packets, errors, drops) from Prometheus or /proc/net/dev
export async function getNetworkDetailedStats(): Promise<any[]> {
    try {
        const [rxPackets, txPackets, rxErrors, txErrors, rxDrops, txDrops, rxBytes, txBytes] = await Promise.all([
            queryPrometheus('node_network_receive_packets_total{device!="lo"}'),
            queryPrometheus('node_network_transmit_packets_total{device!="lo"}'),
            queryPrometheus('node_network_receive_errs_total{device!="lo"}'),
            queryPrometheus('node_network_transmit_errs_total{device!="lo"}'),
            queryPrometheus('node_network_receive_drop_total{device!="lo"}'),
            queryPrometheus('node_network_transmit_drop_total{device!="lo"}'),
            queryPrometheus('node_network_receive_bytes_total{device!="lo"}'),
            queryPrometheus('node_network_transmit_bytes_total{device!="lo"}'),
        ]);
        if (rxPackets.length > 0) {
            return rxPackets
                .filter(r => !VIRTUAL_IFACE_REGEX.test(r.metric.device))
                .map(r => {
                    const dev = r.metric.device;
                    const find = (arr: any[]) => arr.find(x => x.metric.device === dev);
                    return {
                        interface: dev,
                        rxBytes: parseInt(find(rxBytes)?.value?.[1] || '0'),
                        txBytes: parseInt(find(txBytes)?.value?.[1] || '0'),
                        rxPackets: parseInt(r.value[1]),
                        txPackets: parseInt(find(txPackets)?.value?.[1] || '0'),
                        rxErrors: parseInt(find(rxErrors)?.value?.[1] || '0'),
                        txErrors: parseInt(find(txErrors)?.value?.[1] || '0'),
                        rxDropped: parseInt(find(rxDrops)?.value?.[1] || '0'),
                        txDropped: parseInt(find(txDrops)?.value?.[1] || '0'),
                    };
                });
        }
    } catch { /* Prometheus not available */ }
    // Fallback: read from /proc/net/dev (already parsed in getNetworkStatsFallback)
    return [];
}

// Get TCP/UDP stats: retransmits, timeouts, connection failures from /proc/net/snmp
export async function getTcpUdpStats(): Promise<any> {
    // Try Prometheus first
    try {
        const [retrans, outSegs, inSegs, attemptFails, tcpTimeouts, activeOpens, passiveOpens,
               estabResets, currEstab, udpInDatagrams, udpOutDatagrams, udpInErrors, udpNoPorts] = await Promise.all([
            queryPrometheus('node_netstat_Tcp_RetransSegs'),
            queryPrometheus('node_netstat_Tcp_OutSegs'),
            queryPrometheus('node_netstat_Tcp_InSegs'),
            queryPrometheus('node_netstat_Tcp_AttemptFails'),
            queryPrometheus('node_netstat_TcpExt_TCPTimeouts'),
            queryPrometheus('node_netstat_Tcp_ActiveOpens'),
            queryPrometheus('node_netstat_Tcp_PassiveOpens'),
            queryPrometheus('node_netstat_Tcp_EstabResets'),
            queryPrometheus('node_netstat_Tcp_CurrEstab'),
            queryPrometheus('node_netstat_Udp_InDatagrams'),
            queryPrometheus('node_netstat_Udp_OutDatagrams'),
            queryPrometheus('node_netstat_Udp_InErrors'),
            queryPrometheus('node_netstat_Udp_NoPorts'),
        ]);
        const v = (arr: any[]) => parseInt(arr[0]?.value?.[1] || '0');
        if (retrans.length > 0 || tcpTimeouts.length > 0) {
            const outTotal = v(outSegs);
            const retransTotal = v(retrans);
            return {
                tcp: {
                    retransmits: retransTotal,
                    outSegments: outTotal,
                    inSegments: v(inSegs),
                    attemptFails: v(attemptFails),
                    timeouts: v(tcpTimeouts),
                    activeOpens: v(activeOpens),
                    passiveOpens: v(passiveOpens),
                    estabResets: v(estabResets),
                    currentEstablished: v(currEstab),
                    retransmitRate: outTotal > 0 ? Math.round((retransTotal / outTotal) * 10000) / 100 : 0,
                },
                udp: {
                    inDatagrams: v(udpInDatagrams),
                    outDatagrams: v(udpOutDatagrams),
                    inErrors: v(udpInErrors),
                    noPorts: v(udpNoPorts),
                }
            };
        }
    } catch { /* Prometheus not available */ }

    // Fallback: parse /proc/net/snmp (use host network namespace)
    try {
        const hostNetPath = getHostNetPath();
        const snmp = fs.readFileSync(`${hostNetPath}/snmp`, 'utf8');
        const lines = snmp.trim().split('\n');
        const parsed: Record<string, Record<string, number>> = {};
        for (let i = 0; i < lines.length - 1; i += 2) {
            const headerParts = lines[i].split(/:\s+/);
            const valueParts = lines[i + 1].split(/:\s+/);
            if (headerParts.length < 2 || valueParts.length < 2) continue;
            const proto = headerParts[0];
            const keys = headerParts[1].split(/\s+/);
            const vals = valueParts[1].split(/\s+/);
            parsed[proto] = {};
            keys.forEach((k, idx) => { parsed[proto][k] = parseInt(vals[idx]) || 0; });
        }
        // Also parse /proc/net/netstat for TcpExt
        try {
            const netstat = fs.readFileSync(`${hostNetPath}/netstat`, 'utf8');
            const nsLines = netstat.trim().split('\n');
            for (let i = 0; i < nsLines.length - 1; i += 2) {
                const headerParts = nsLines[i].split(/:\s+/);
                const valueParts = nsLines[i + 1].split(/:\s+/);
                if (headerParts.length < 2 || valueParts.length < 2) continue;
                const proto = headerParts[0];
                const keys = headerParts[1].split(/\s+/);
                const vals = valueParts[1].split(/\s+/);
                parsed[proto] = parsed[proto] || {};
                keys.forEach((k, idx) => { parsed[proto][k] = parseInt(vals[idx]) || 0; });
            }
        } catch { /* netstat not available */ }

        const tcp = parsed['Tcp'] || {};
        const tcpExt = parsed['TcpExt'] || {};
        const udp = parsed['Udp'] || {};
        const outTotal = tcp['OutSegs'] || 0;
        const retransTotal = tcp['RetransSegs'] || 0;
        return {
            tcp: {
                retransmits: retransTotal,
                outSegments: outTotal,
                inSegments: tcp['InSegs'] || 0,
                attemptFails: tcp['AttemptFails'] || 0,
                timeouts: tcpExt['TCPTimeouts'] || 0,
                activeOpens: tcp['ActiveOpens'] || 0,
                passiveOpens: tcp['PassiveOpens'] || 0,
                estabResets: tcp['EstabResets'] || 0,
                currentEstablished: tcp['CurrEstab'] || 0,
                retransmitRate: outTotal > 0 ? Math.round((retransTotal / outTotal) * 10000) / 100 : 0,
            },
            udp: {
                inDatagrams: udp['InDatagrams'] || 0,
                outDatagrams: udp['OutDatagrams'] || 0,
                inErrors: udp['InErrors'] || 0,
                noPorts: udp['NoPorts'] || 0,
            }
        };
    } catch {
        return { tcp: {}, udp: {} };
    }
}
