import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Brain,
  Bot,
  Plug,
  Zap,
  Search,
  Download,
  Trash2,
  ArrowLeft,
  Clock,
} from 'lucide-react';
import { useMarketplaceStore } from '../hooks/useMarketplaceStore';
import type { CatalogItem } from '../services/marketplaceApi';

const TYPE_OPTIONS = [
  { value: '', label: 'Tutti' },
  { value: 'skill', label: 'Skills' },
  { value: 'agent', label: 'Agenti' },
  { value: 'mcp', label: 'MCP' },
  { value: 'hook', label: 'Hooks' },
] as const;

const TIER_OPTIONS = [
  { value: '', label: 'Tutti i livelli' },
  { value: 'tier1', label: 'Core' },
  { value: 'tier2', label: 'Extended' },
  { value: 'tier3', label: 'Niche' },
] as const;

const TYPE_ICONS: Record<CatalogItem['type'], typeof Brain> = {
  skill: Brain,
  agent: Bot,
  mcp: Plug,
  hook: Zap,
};

const TIER_BADGES: Record<CatalogItem['tier'], { label: string; className: string }> = {
  tier1: {
    label: 'Core',
    className: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  },
  tier2: {
    label: 'Extended',
    className: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  },
  tier3: {
    label: 'Niche',
    className: 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-300',
  },
};

export default function MarketplacePage() {
  const navigate = useNavigate();
  const {
    catalogItems,
    filters,
    loading,
    error,
    fetchCatalog,
    setFilters,
    installItem,
    uninstallItem,
    clearError,
  } = useMarketplaceStore();

  const [searchInput, setSearchInput] = useState(filters.search ?? '');

  useEffect(() => {
    fetchCatalog();
  }, [filters, fetchCatalog]);

  const handleSearchSubmit = useCallback(() => {
    setFilters({ ...filters, search: searchInput || undefined });
  }, [filters, searchInput, setFilters]);

  const handleSearchKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') handleSearchSubmit();
    },
    [handleSearchSubmit]
  );

  const handleFilterChange = useCallback(
    (key: 'type' | 'tier' | 'category', value: string) => {
      setFilters({ ...filters, [key]: value || undefined });
    },
    [filters, setFilters]
  );

  const handleInstall = useCallback(
    async (item: CatalogItem) => {
      await installItem(item.id);
    },
    [installItem]
  );

  const handleUninstall = useCallback(
    async (item: CatalogItem) => {
      if (!item.installationId) return;
      await uninstallItem(item.installationId);
    },
    [uninstallItem]
  );

  const categories = Array.from(
    new Set(catalogItems.map((i) => i.category).filter(Boolean))
  ).sort() as string[];

  return (
    <div className="min-h-screen bg-surface-50 dark:bg-surface-950">
      {/* Top bar */}
      <div className="bg-white dark:bg-surface-900 border-b border-surface-200 dark:border-surface-700 px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center gap-4">
          <button
            onClick={() => navigate(-1)}
            className="p-2 rounded-lg hover:bg-surface-100 dark:hover:bg-surface-800 text-surface-500 transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-xl font-bold text-surface-900 dark:text-surface-100">
              Marketplace
            </h1>
            <p className="text-sm text-surface-500 mt-0.5">
              Esplora e installa competenze e strumenti per la tua esperienza AI
            </p>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto p-6">
        {/* Error Banner */}
        {error && (
          <div className="mb-4 flex items-center justify-between px-4 py-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-800 dark:text-red-300">
            <span className="text-sm">{error}</span>
            <button onClick={clearError} className="text-sm underline hover:no-underline">
              Chiudi
            </button>
          </div>
        )}

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3 mb-6">
          <select
            value={filters.type ?? ''}
            onChange={(e) => handleFilterChange('type', e.target.value)}
            className="px-3 py-2 rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-800 text-sm"
          >
            {TYPE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>

          <select
            value={filters.tier ?? ''}
            onChange={(e) => handleFilterChange('tier', e.target.value)}
            className="px-3 py-2 rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-800 text-sm"
          >
            {TIER_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>

          {categories.length > 0 && (
            <select
              value={filters.category ?? ''}
              onChange={(e) => handleFilterChange('category', e.target.value)}
              className="px-3 py-2 rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-800 text-sm"
            >
              <option value="">Tutte le categorie</option>
              {categories.map((cat) => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>
          )}

          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-surface-400" />
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={handleSearchKeyDown}
              onBlur={handleSearchSubmit}
              placeholder="Cerca strumenti e competenze..."
              className="w-full pl-9 pr-3 py-2 rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-800 text-sm"
            />
          </div>
        </div>

        {/* Loading */}
        {loading && catalogItems.length === 0 && (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin h-8 w-8 border-4 border-primary-500 border-t-transparent rounded-full" />
          </div>
        )}

        {/* Empty */}
        {!loading && catalogItems.length === 0 && (
          <div className="text-center py-12 text-surface-500">
            <Brain className="w-12 h-12 mx-auto mb-3 opacity-40" />
            <p className="text-lg font-medium">Nessuno strumento disponibile</p>
            <p className="text-sm mt-1">Il catalogo non contiene ancora elementi. Riprova pi&ugrave; tardi.</p>
          </div>
        )}

        {/* Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {catalogItems.map((item) => {
            const TypeIcon = TYPE_ICONS[item.type] ?? Brain;
            const tierBadge = TIER_BADGES[item.tier] ?? TIER_BADGES.tier3;

            return (
              <div
                key={item.id}
                className="bg-white dark:bg-surface-800 rounded-xl shadow-sm border border-surface-200 dark:border-surface-700 p-5 flex flex-col"
              >
                <div className="flex items-start gap-3 mb-3">
                  <div className="p-2 rounded-lg bg-surface-100 dark:bg-surface-700">
                    <TypeIcon className="w-5 h-5 text-surface-600 dark:text-surface-300" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-sm truncate" title={item.name}>
                      {item.name}
                    </h3>
                    <div className="flex items-center gap-2 mt-0.5">
                      {item.version && (
                        <span className="text-xs text-surface-400">v{item.version}</span>
                      )}
                      {item.author && (
                        <span className="text-xs text-surface-400">di {item.author}</span>
                      )}
                    </div>
                  </div>
                </div>

                <p className="text-sm text-surface-500 dark:text-surface-400 mb-4 line-clamp-2 flex-1">
                  {item.description || 'Nessuna descrizione disponibile.'}
                </p>

                <div className="flex flex-wrap items-center gap-2 mb-4">
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${tierBadge.className}`}>
                    {tierBadge.label}
                  </span>
                  {item.category && (
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-surface-100 text-surface-700 dark:bg-surface-700 dark:text-surface-300">
                      {item.category}
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  {item.isActive ? (
                    <button
                      onClick={() => handleUninstall(item)}
                      disabled={loading}
                      className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-medium bg-red-50 text-red-700 hover:bg-red-100 dark:bg-red-900/20 dark:text-red-400 dark:hover:bg-red-900/30 disabled:opacity-50 transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                      Disinstalla
                    </button>
                  ) : item.installationStatus === 'pending_approval' ? (
                    <button
                      disabled
                      className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-medium bg-yellow-50 text-yellow-700 dark:bg-yellow-900/20 dark:text-yellow-400 cursor-not-allowed opacity-70"
                    >
                      <Clock className="w-4 h-4" />
                      In attesa di approvazione
                    </button>
                  ) : (
                    <button
                      onClick={() => handleInstall(item)}
                      disabled={loading}
                      className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-medium bg-green-50 text-green-700 hover:bg-green-100 dark:bg-green-900/20 dark:text-green-400 dark:hover:bg-green-900/30 disabled:opacity-50 transition-colors"
                    >
                      <Download className="w-4 h-4" />
                      Installa
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
