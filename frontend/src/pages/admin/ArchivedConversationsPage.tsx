import { useState, useEffect } from 'react';
import { api } from '../../services/api';
import { Archive, Trash2, Eye, X, ChevronLeft, ChevronRight } from 'lucide-react';

interface ArchivedConversation {
  id: number;
  original_id: number;
  user_id: number;
  user_name: string;
  user_email: string;
  title: string;
  model: string;
  provider: string;
  message_count: number;
  archived_at: string;
  original_created_at: string;
}

interface ArchivedMessage {
  role: string;
  content: string;
  created_at: string;
}

export default function ArchivedConversationsPage() {
  const [archives, setArchives] = useState<ArchivedConversation[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [selectedArchive, setSelectedArchive] = useState<{ id: number; title: string; messages: ArchivedMessage[] } | null>(null);
  const limit = 20;

  const loadArchives = async () => {
    setLoading(true);
    try {
      const res = await api.get(`/admin/archived-conversations?limit=${limit}&offset=${offset}`);
      setArchives(res.data.archives);
      setTotal(res.data.total);
    } catch (err) {
      console.error('Failed to load archives:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadArchives(); }, [offset]);

  const viewArchive = async (id: number) => {
    try {
      const res = await api.get(`/admin/archived-conversations/${id}`);
      setSelectedArchive({
        id: res.data.id,
        title: res.data.title,
        messages: res.data.messages || [],
      });
    } catch (err) {
      console.error('Failed to load archive detail:', err);
    }
  };

  const deleteArchive = async (id: number) => {
    if (!confirm('Eliminare questa conversazione archiviata?')) return;
    try {
      await api.delete(`/admin/archived-conversations/${id}`);
      setArchives(archives.filter(a => a.id !== id));
      setTotal(t => t - 1);
      if (selectedArchive?.id === id) setSelectedArchive(null);
    } catch (err) {
      console.error('Failed to delete archive:', err);
    }
  };

  const totalPages = Math.ceil(total / limit);
  const currentPage = Math.floor(offset / limit) + 1;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Conversazioni Archiviate</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            {total} conversazioni archiviate
          </p>
        </div>
      </div>

      {/* Detail Modal */}
      {selectedArchive && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-3xl max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between p-4 border-b dark:border-gray-700">
              <h3 className="font-semibold text-gray-900 dark:text-white truncate">{selectedArchive.title}</h3>
              <button onClick={() => setSelectedArchive(null)} className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {selectedArchive.messages.map((msg, i) => (
                <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[80%] rounded-lg px-4 py-2 ${
                    msg.role === 'user'
                      ? 'bg-blue-600 text-white'
                      : msg.role === 'system'
                      ? 'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300 text-xs italic'
                      : 'bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-white'
                  }`}>
                    <p className="text-xs font-medium mb-1 opacity-70">{msg.role}</p>
                    <p className="whitespace-pre-wrap text-sm">{msg.content?.substring(0, 2000)}{msg.content?.length > 2000 ? '...' : ''}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Table */}
      {loading ? (
        <div className="text-center py-12 text-gray-500">Caricamento...</div>
      ) : archives.length === 0 ? (
        <div className="text-center py-12">
          <Archive className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
          <p className="text-gray-500 dark:text-gray-400">Nessuna conversazione archiviata</p>
        </div>
      ) : (
        <>
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm overflow-hidden">
            <table className="w-full">
              <thead className="bg-gray-50 dark:bg-gray-900">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Titolo</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Utente</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Modello</th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Messaggi</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Archiviata il</th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Azioni</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {archives.map((arch) => (
                  <tr key={arch.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                    <td className="px-4 py-3 text-sm text-gray-900 dark:text-white max-w-xs truncate">{arch.title}</td>
                    <td className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">{arch.user_name || arch.user_email}</td>
                    <td className="px-4 py-3 text-sm">
                      <span className="px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 text-xs">
                        {arch.model}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-center text-gray-500">{arch.message_count}</td>
                    <td className="px-4 py-3 text-sm text-gray-500">
                      {new Date(arch.archived_at).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <div className="flex items-center justify-center gap-1">
                        <button onClick={() => viewArchive(arch.id)} className="p-1.5 hover:bg-blue-100 dark:hover:bg-blue-900/30 rounded text-blue-600" title="Visualizza">
                          <Eye className="w-4 h-4" />
                        </button>
                        <button onClick={() => deleteArchive(arch.id)} className="p-1.5 hover:bg-red-100 dark:hover:bg-red-900/30 rounded text-red-500" title="Elimina">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between">
              <p className="text-sm text-gray-500">Pagina {currentPage} di {totalPages}</p>
              <div className="flex gap-2">
                <button
                  onClick={() => setOffset(Math.max(0, offset - limit))}
                  disabled={offset === 0}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-lg border text-sm disabled:opacity-50 hover:bg-gray-50 dark:hover:bg-gray-700"
                >
                  <ChevronLeft className="w-4 h-4" /> Precedente
                </button>
                <button
                  onClick={() => setOffset(offset + limit)}
                  disabled={offset + limit >= total}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-lg border text-sm disabled:opacity-50 hover:bg-gray-50 dark:hover:bg-gray-700"
                >
                  Successiva <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
