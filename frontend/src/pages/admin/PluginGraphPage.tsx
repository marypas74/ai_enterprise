import { useState, useEffect, useRef } from 'react';
import { api } from '../../services/api';
import { GitBranch, RefreshCw } from 'lucide-react';

interface Plugin {
  id: number;
  name: string;
  display_name: string;
  version: string;
  is_enabled: boolean;
  category: string;
  dependencies?: string[];
  hooks_count?: number;
  tools_count?: number;
  forms_count?: number;
}

interface GraphNode {
  id: string;
  label: string;
  version: string;
  active: boolean;
  category: string;
  hooks: number;
  tools: number;
  forms: number;
  x: number;
  y: number;
}

interface GraphEdge {
  from: string;
  to: string;
}

const CATEGORY_COLORS: Record<string, string> = {
  tools: '#3b82f6',
  integrations: '#8b5cf6',
  utilities: '#06b6d4',
  ai: '#f59e0b',
  data: '#10b981',
  other: '#6b7280',
};

export default function PluginGraphPage() {
  const [plugins, setPlugins] = useState<Plugin[]>([]);
  const [hooks, setHooks] = useState<Record<string, any[]>>({});
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [pluginsRes, hooksRes] = await Promise.all([
        api.get('/plugins').catch(() => ({ data: [] })),
        api.get('/admin/hooks').catch(() => ({ data: { registered_handlers: {} } })),
      ]);
      const pluginList = Array.isArray(pluginsRes.data) ? pluginsRes.data : pluginsRes.data.plugins || [];
      setPlugins(pluginList);
      setHooks(hooksRes.data.registered_handlers || {});
    } finally {
      setLoading(false);
    }
  };

  // Build graph data
  const nodes: GraphNode[] = plugins.map((p, i) => {
    const angle = (2 * Math.PI * i) / Math.max(plugins.length, 1);
    const radius = Math.min(250, 100 + plugins.length * 15);

    // Count hooks, tools, forms from registered handlers
    let hookCount = 0;
    for (const handlers of Object.values(hooks)) {
      hookCount += (handlers as any[]).filter(h => h.pluginId === p.id).length;
    }

    return {
      id: p.name,
      label: p.display_name || p.name,
      version: p.version,
      active: p.is_enabled,
      category: p.category || 'other',
      hooks: hookCount,
      tools: p.tools_count || 0,
      forms: p.forms_count || 0,
      x: 300 + radius * Math.cos(angle),
      y: 300 + radius * Math.sin(angle),
    };
  });

  const edges: GraphEdge[] = [];
  for (const p of plugins) {
    if (p.dependencies) {
      const deps = typeof p.dependencies === 'string' ? JSON.parse(p.dependencies) : p.dependencies;
      if (Array.isArray(deps)) {
        for (const dep of deps) {
          if (nodes.find(n => n.id === dep)) {
            edges.push({ from: p.name, to: dep });
          }
        }
      }
    }
  }

  // Draw graph on canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || nodes.length === 0) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = 600 * dpr;
    canvas.height = 600 * dpr;
    ctx.scale(dpr, dpr);

    // Clear
    ctx.clearRect(0, 0, 600, 600);

    // Draw edges
    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = 1.5;
    for (const edge of edges) {
      const fromNode = nodes.find(n => n.id === edge.from);
      const toNode = nodes.find(n => n.id === edge.to);
      if (!fromNode || !toNode) continue;

      ctx.beginPath();
      ctx.moveTo(fromNode.x, fromNode.y);
      ctx.lineTo(toNode.x, toNode.y);
      ctx.stroke();

      // Arrow head
      const dx = toNode.x - fromNode.x;
      const dy = toNode.y - fromNode.y;
      const angle = Math.atan2(dy, dx);
      const arrowLen = 10;
      const arrowX = toNode.x - 25 * Math.cos(angle);
      const arrowY = toNode.y - 25 * Math.sin(angle);

      ctx.beginPath();
      ctx.moveTo(arrowX, arrowY);
      ctx.lineTo(arrowX - arrowLen * Math.cos(angle - 0.4), arrowY - arrowLen * Math.sin(angle - 0.4));
      ctx.lineTo(arrowX - arrowLen * Math.cos(angle + 0.4), arrowY - arrowLen * Math.sin(angle + 0.4));
      ctx.closePath();
      ctx.fillStyle = '#94a3b8';
      ctx.fill();
    }

    // Draw nodes
    for (const node of nodes) {
      const isSelected = selected === node.id;
      const radius = isSelected ? 28 : 22;
      const color = CATEGORY_COLORS[node.category] || CATEGORY_COLORS.other;

      // Circle
      ctx.beginPath();
      ctx.arc(node.x, node.y, radius, 0, 2 * Math.PI);
      ctx.fillStyle = node.active ? color : '#9ca3af';
      ctx.globalAlpha = node.active ? 1 : 0.5;
      ctx.fill();
      ctx.globalAlpha = 1;

      if (isSelected) {
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 3;
        ctx.stroke();
      }

      // Label
      ctx.fillStyle = '#f8fafc';
      ctx.font = `${isSelected ? 'bold ' : ''}11px system-ui`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      const shortLabel = node.label.length > 10 ? node.label.substring(0, 9) + '...' : node.label;
      ctx.fillText(shortLabel, node.x, node.y);

      // Version below
      ctx.fillStyle = '#94a3b8';
      ctx.font = '9px system-ui';
      ctx.fillText(`v${node.version}`, node.x, node.y + radius + 12);
    }
  }, [nodes, edges, selected]);

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    for (const node of nodes) {
      const dx = x - node.x;
      const dy = y - node.y;
      if (dx * dx + dy * dy < 28 * 28) {
        setSelected(selected === node.id ? null : node.id);
        return;
      }
    }
    setSelected(null);
  };

  const selectedNode = nodes.find(n => n.id === selected);
  const selectedPlugin = plugins.find(p => p.name === selected);

  if (loading) {
    return <div className="p-6 flex items-center justify-center"><div className="animate-spin h-8 w-8 border-4 border-primary-500 border-t-transparent rounded-full"></div></div>;
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <GitBranch className="w-6 h-6 text-primary-500" />
          <h1 className="text-2xl font-bold">Grafo Dipendenze Plugin</h1>
        </div>
        <button onClick={loadData} className="btn btn-secondary flex items-center gap-2">
          <RefreshCw className="w-4 h-4" /> Aggiorna
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Graph Canvas */}
        <div className="lg:col-span-2 card p-4">
          {nodes.length === 0 ? (
            <div className="h-[600px] flex items-center justify-center text-surface-500">
              Nessun plugin installato. Aggiungi plugin nella cartella <code>plugins/</code> per visualizzare il grafo.
            </div>
          ) : (
            <canvas
              ref={canvasRef}
              width={600}
              height={600}
              onClick={handleCanvasClick}
              className="w-full max-w-[600px] mx-auto cursor-pointer"
              style={{ aspectRatio: '1/1' }}
            />
          )}

          {/* Legend */}
          <div className="flex flex-wrap gap-3 mt-4 justify-center">
            {Object.entries(CATEGORY_COLORS).map(([cat, color]) => (
              <div key={cat} className="flex items-center gap-1.5 text-xs">
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: color }} />
                <span className="capitalize">{cat}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Details Panel */}
        <div className="card p-4">
          <h3 className="text-sm font-semibold mb-4">Dettagli</h3>

          {selectedNode && selectedPlugin ? (
            <div className="space-y-4">
              <div>
                <p className="text-lg font-bold">{selectedNode.label}</p>
                <p className="text-sm text-surface-500">v{selectedNode.version}</p>
              </div>

              <div className="flex items-center gap-2">
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                  selectedNode.active
                    ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300'
                    : 'bg-surface-100 text-surface-600 dark:bg-surface-800 dark:text-surface-400'
                }`}>
                  {selectedNode.active ? 'Attivo' : 'Disattivato'}
                </span>
                <span className="px-2 py-0.5 rounded-full text-xs font-medium capitalize" style={{ backgroundColor: CATEGORY_COLORS[selectedNode.category] + '20', color: CATEGORY_COLORS[selectedNode.category] }}>
                  {selectedNode.category}
                </span>
              </div>

              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-surface-500">Hook registrati</span>
                  <span className="font-medium">{selectedNode.hooks}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-surface-500">Tools</span>
                  <span className="font-medium">{selectedNode.tools}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-surface-500">Forms</span>
                  <span className="font-medium">{selectedNode.forms}</span>
                </div>
              </div>

              {/* Dependencies */}
              {selectedPlugin.dependencies && (
                <div>
                  <p className="text-xs font-semibold text-surface-500 mb-2">Dipendenze</p>
                  <div className="space-y-1">
                    {(typeof selectedPlugin.dependencies === 'string'
                      ? JSON.parse(selectedPlugin.dependencies)
                      : selectedPlugin.dependencies
                    ).map((dep: string) => {
                      const depPlugin = plugins.find(p => p.name === dep);
                      return (
                        <div key={dep} className="flex items-center gap-2 text-sm">
                          <div className={`w-2 h-2 rounded-full ${depPlugin?.is_enabled ? 'bg-green-500' : 'bg-red-500'}`} />
                          <span>{dep}</span>
                          {!depPlugin && <span className="text-red-500 text-xs">(mancante)</span>}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Dependents */}
              {edges.filter(e => e.to === selected).length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-surface-500 mb-2">Dipendenti (usato da)</p>
                  <div className="space-y-1">
                    {edges.filter(e => e.to === selected).map(e => (
                      <div key={e.from} className="text-sm">{e.from}</div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="text-sm text-surface-500">
              <p>Clicca su un nodo nel grafo per vedere i dettagli.</p>
              <div className="mt-4 space-y-2">
                <p className="font-medium">Plugin installati: {plugins.length}</p>
                <p>Attivi: {plugins.filter(p => p.is_enabled).length}</p>
                <p>Dipendenze: {edges.length}</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
