import { useEffect, useState } from 'react';
import { useAuthStore } from '../hooks/useAuthStore';

interface GuideMeta {
  slug: string;
  title: string;
  description: string | null;
  updated_at: string;
}

interface Guide extends GuideMeta {
  content: string;
}

export default function HelpPage() {
  const { accessToken: token, user } = useAuthStore();
  const [guides, setGuides] = useState<GuideMeta[]>([]);
  const [activeSlug, setActiveSlug] = useState<string>('user');
  const [content, setContent] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const isAdmin = user?.role === 'admin';

  useEffect(() => {
    let cancelled = false;
    async function loadList() {
      try {
        const res = await fetch('/api/guides', {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data: GuideMeta[] = await res.json();
        if (cancelled) return;
        const visible = isAdmin ? data : data.filter((g) => g.slug !== 'admin');
        setGuides(visible);
        if (visible.length > 0 && !visible.find((g) => g.slug === activeSlug)) {
          setActiveSlug(visible[0].slug);
        }
      } catch (err: any) {
        if (!cancelled) setError(err.message || 'Errore nel caricamento');
      }
    }
    loadList();
    return () => {
      cancelled = true;
    };
  }, [token, isAdmin]);

  useEffect(() => {
    let cancelled = false;
    async function loadContent() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/guides/${activeSlug}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data: Guide = await res.json();
        if (!cancelled) setContent(data.content);
      } catch (err: any) {
        if (!cancelled) setError(err.message || 'Errore nel caricamento');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    if (activeSlug) loadContent();
    return () => {
      cancelled = true;
    };
  }, [activeSlug, token]);

  return (
    <div className="min-h-screen bg-surface-50 dark:bg-surface-950 flex">
      <aside className="w-64 border-r border-surface-200 dark:border-surface-800 p-4 flex-shrink-0">
        <h2 className="text-lg font-semibold mb-4 text-surface-900 dark:text-surface-100">
          Guide
        </h2>
        <nav className="space-y-1">
          {guides.map((g) => (
            <button
              key={g.slug}
              onClick={() => setActiveSlug(g.slug)}
              className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${
                activeSlug === g.slug
                  ? 'bg-primary-100 dark:bg-primary-900 text-primary-700 dark:text-primary-300 font-medium'
                  : 'text-surface-700 dark:text-surface-300 hover:bg-surface-100 dark:hover:bg-surface-800'
              }`}
            >
              {g.title}
            </button>
          ))}
        </nav>
        <a
          href="/"
          className="block mt-6 text-sm text-surface-500 hover:text-primary-600 dark:hover:text-primary-400"
        >
          ← Torna alla chat
        </a>
      </aside>
      <main className="flex-1 overflow-auto">
        {loading && (
          <div className="flex items-center justify-center h-full">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
          </div>
        )}
        {error && (
          <div className="p-8 text-danger-600">Errore: {error}</div>
        )}
        {!loading && !error && (
          <iframe
            title="Guide content"
            srcDoc={content}
            sandbox="allow-same-origin"
            className="w-full h-full border-0"
          />
        )}
      </main>
    </div>
  );
}
