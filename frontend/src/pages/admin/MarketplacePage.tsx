import { useState, useEffect, useCallback } from 'react';
import {
  Brain,
  Bot,
  Plug,
  Zap,
  Search,
  RefreshCw,
  Download,
  Trash2,
  AlertTriangle,
  Bell,
} from 'lucide-react';
import { useMarketplaceStore } from '../../hooks/useMarketplaceStore';
import type { CatalogItem } from '../../services/marketplaceApi';

const TYPE_OPTIONS = [
  { value: '', label: 'All' },
  { value: 'skill', label: 'Skills' },
  { value: 'agent', label: 'Agents' },
  { value: 'mcp', label: 'MCP' },
  { value: 'hook', label: 'Hooks' },
] as const;

const TIER_OPTIONS = [
  { value: '', label: 'All' },
  { value: 'tier1', label: 'Tier 1' },
  { value: 'tier2', label: 'Tier 2' },
  { value: 'tier3', label: 'Tier 3' },
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

function formatSyncDate(dateStr: string | null): string {
  if (!dateStr) return 'mai';
  try {
    return new Date(dateStr).toLocaleString();
  } catch {
    return dateStr;
  }
}

export default function MarketplacePage() {
  const {
    catalogItems,
    syncStatus,
    notificationCount,
    filters,
    loading,
    error,
    fetchCatalog,
    setFilters,
    triggerSync,
    installItem,
    uninstallItem,
    fetchSyncStatus,
    fetchNotifications,
    clearError,
  } = useMarketplaceStore();

  const [searchInput, setSearchInput] = useState(filters.search ?? '');
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    fetchCatalog();
    fetchSyncStatus();
    fetchNotifications();
  }, [fetchCatalog, fetchSyncStatus, fetchNotifications]);

  // Re-fetch catalog when filters change
  useEffect(() => {
    fetchCatalog();
  }, [filters, fetchCatalog]);

  const handleSearchSubmit = useCallback(() => {
    setFilters({ ...filters, search: searchInput || undefined });
  }, [filters, searchInput, setFilters]);

  const handleSearchKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        handleSearchSubmit();
      }
    },
    [handleSearchSubmit]
  );

  const handleFilterChange = useCallback(
    (key: 'type' | 'tier' | 'category', value: string) => {
      setFilters({ ...filters, [key]: value || undefined });
    },
    [filters, setFilters]
  );

  const handleSync = useCallback(async () => {
    setSyncing(true);
    try {
      await triggerSync();
      await fetchCatalog();
    } finally {
      setSyncing(false);
    }
  }, [triggerSync, fetchCatalog]);

  const handleInstall = useCallback(
    async (item: CatalogItem) => {
      await installItem(item.id);
    },
    [installItem]
  );

  const handleUninstall = useCallback(
    async (item: CatalogItem) => {
      await uninstallItem(item.id);
    },
    [uninstallItem]
  );

  // Extract unique categories from catalog items
  const categories = Array.from(
    new Set(catalogItems.map((i) => i.category).filter(Boolean))
  ).sort() as string[];

  const isSuspended = syncStatus?.status === 'paused' || syncStatus?.status === 'failed';

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Marketplace</h1>
          <p className="text-sm text-surface-500 mt-1">
            Catalogo competenze e strumenti disponibili
          </p>
        </div>
        <div className="flex items-center gap-3">
          {notificationCount > 0 && (
            <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
              <Bell className="w-3.5 h-3.5" />
              {notificationCount} nuove competenze
            </span>
          )}
          <div className="flex items-center gap-2">
            {syncStatus && (
              <span className="text-xs text-surface-500">
                Ultimo sync: {formatSyncDate(syncStatus.lastSyncAt)}
              </span>
            )}
            <button
              onClick={handleSync}
              disabled={syncing || loading}
              className="flex items-center gap-2 px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 transition-colors text-sm font-medium"
            >
              <RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} />
              Sync Now
            </button>
          </div>
        </div>
      </div>

      {/* Suspended/Failed Banner */}
      {isSuspended && (
        <div className="mb-4 flex items-center gap-3 px-4 py-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300">
          <AlertTriangle className="w-5 h-5 flex-shrink-0" />
          <span className="text-sm font-medium">
            Catalogo offline — ultimo sync: {formatSyncDate(syncStatus?.lastSyncAt ?? null)}
          </span>
        </div>
      )}

      {/* Error Banner */}
      {error && (
        <div className="mb-4 flex items-center justify-between px-4 py-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-800 dark:text-red-300">
          <span className="text-sm">{error}</span>
          <button onClick={clearError} className="text-sm underline hover:no-underline">
            Chiudi
          </button>
        </div>
      )}

      {/* Filters Bar */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <select
          value={filters.type ?? ''}
          onChange={(e) => handleFilterChange('type', e.target.value)}
          className="px-3 py-2 rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-800 text-sm"
        >
          {TYPE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>

        <select
          value={filters.tier ?? ''}
          onChange={(e) => handleFilterChange('tier', e.target.value)}
          className="px-3 py-2 rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-800 text-sm"
        >
          {TIER_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>

        <select
          value={filters.category ?? ''}
          onChange={(e) => handleFilterChange('category', e.target.value)}
          className="px-3 py-2 rounded-lg border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-800 text-sm"
        >
          <option value="">Tutte le categorie</option>
          {categories.map((cat) => (
            <option key={cat} value={cat}>
              {cat}
            </option>
          ))}
        </select>

        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-surface-400" />
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={handleSearchKeyDown}
            onBlur={handleSearchSubmit}
            placeholder="Cerca nel catalogo..."
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

      {/* Empty State */}
      {!loading && catalogItems.length === 0 && (
        <div className="text-center py-12 text-surface-500">
          <Brain className="w-12 h-12 mx-auto mb-3 opacity-40" />
          <p className="text-lg font-medium">Nessun elemento trovato</p>
          <p className="text-sm mt-1">Prova a modificare i filtri o esegui un sync.</p>
        </div>
      )}

      {/* Card Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {catalogItems.map((item) => (
          <CatalogCard
            key={item.id}
            item={item}
            onInstall={handleInstall}
            onUninstall={handleUninstall}
            loading={loading}
          />
        ))}
      </div>
    </div>
  );
}

interface CatalogCardProps {
  readonly item: CatalogItem;
  readonly onInstall: (item: CatalogItem) => Promise<void>;
  readonly onUninstall: (item: CatalogItem) => Promise<void>;
  readonly loading: boolean;
}

function CatalogCard({ item, onInstall, onUninstall, loading }: CatalogCardProps) {
  const TypeIcon = TYPE_ICONS[item.type] ?? Brain;
  const tierBadge = TIER_BADGES[item.tier] ?? TIER_BADGES.tier3;

  const displayName = item.name;
  const description = item.description ?? '';

  return (
    <div className="bg-white dark:bg-surface-800 rounded-xl shadow-sm border border-surface-200 dark:border-surface-700 p-6 flex flex-col">
      {/* Header Row */}
      <div className="flex items-start gap-3 mb-3">
        <div className="p-2 rounded-lg bg-surface-100 dark:bg-surface-700">
          <TypeIcon className="w-5 h-5 text-surface-600 dark:text-surface-300" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-sm truncate" title={displayName}>
            {displayName}
          </h3>
          {item.version && (
            <span className="text-xs text-surface-400">v{item.version}</span>
          )}
        </div>
      </div>

      {/* Description */}
      <p className="text-sm text-surface-500 dark:text-surface-400 mb-4 line-clamp-2 flex-1">
        {description || 'Nessuna descrizione disponibile.'}
      </p>

      {/* Badges */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <span
          className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${tierBadge.className}`}
        >
          {tierBadge.label}
        </span>
        {item.category && (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-surface-100 text-surface-700 dark:bg-surface-700 dark:text-surface-300">
            {item.category}
          </span>
        )}
      </div>

      {/* Action Button */}
      <div className="flex items-center gap-2">
        {item.isActive ? (
          <button
            onClick={() => onUninstall(item)}
            disabled={loading}
            className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-medium bg-red-50 text-red-700 hover:bg-red-100 dark:bg-red-900/20 dark:text-red-400 dark:hover:bg-red-900/30 disabled:opacity-50 transition-colors"
          >
            <Trash2 className="w-4 h-4" />
            Disinstalla
          </button>
        ) : (
          <button
            onClick={() => onInstall(item)}
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
}
