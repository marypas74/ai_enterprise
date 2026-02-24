/**
 * MemoryPanel — Sidebar panel showing vector memory recall results for the current chat
 * Can be toggled from the chat view to see what memories were injected.
 */

import { useState } from 'react';
import { Database, ChevronDown, ChevronRight, X } from 'lucide-react';

interface MemoryItem {
  id: string | number;
  collection: string;
  content: string;
  score: number;
  metadata: Record<string, any>;
}

interface MemoryPanelProps {
  memories: {
    episodic: MemoryItem[];
    declarative: MemoryItem[];
    procedural: MemoryItem[];
  } | null;
  onClose: () => void;
}

const COLLECTION_COLORS: Record<string, string> = {
  episodic: 'text-blue-400',
  declarative: 'text-green-400',
  procedural: 'text-purple-400',
};

export default function MemoryPanel({ memories, onClose }: MemoryPanelProps) {
  const [expandedCollection, setExpandedCollection] = useState<string | null>('episodic');

  if (!memories) {
    return (
      <div className="w-80 border-l border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 p-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Database className="w-5 h-5 text-cyan-400" />
            <span className="font-medium">Vector Memory</span>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-surface-100 dark:hover:bg-surface-800 rounded">
            <X className="w-4 h-4" />
          </button>
        </div>
        <p className="text-sm text-surface-500">No memory recall results for this message.</p>
      </div>
    );
  }

  const collections = [
    { key: 'episodic', label: 'Episodic', items: memories.episodic },
    { key: 'declarative', label: 'Declarative', items: memories.declarative },
    { key: 'procedural', label: 'Procedural', items: memories.procedural },
  ];

  const total = memories.episodic.length + memories.declarative.length + memories.procedural.length;

  return (
    <div className="w-80 border-l border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 overflow-y-auto">
      <div className="sticky top-0 bg-white dark:bg-surface-900 p-4 border-b border-surface-200 dark:border-surface-700 z-10">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Database className="w-5 h-5 text-cyan-400" />
            <span className="font-medium">Vector Memory</span>
            <span className="text-xs text-surface-500">({total})</span>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-surface-100 dark:hover:bg-surface-800 rounded">
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="p-4 space-y-3">
        {collections.map(({ key, label, items }) => {
          const isExpanded = expandedCollection === key;
          return (
            <div key={key}>
              <button
                onClick={() => setExpandedCollection(isExpanded ? null : key)}
                className="flex items-center gap-2 w-full text-left py-1"
              >
                {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                <span className={`font-medium text-sm ${COLLECTION_COLORS[key]}`}>{label}</span>
                <span className="text-xs text-surface-500">({items.length})</span>
              </button>

              {isExpanded && items.length > 0 && (
                <div className="ml-6 mt-1 space-y-2">
                  {items.map((item, i) => (
                    <div key={i} className="p-2 bg-surface-50 dark:bg-surface-800 rounded text-xs">
                      <div className="flex justify-between mb-1">
                        <span className="text-surface-500">score: {item.score.toFixed(3)}</span>
                        {item.metadata.source && (
                          <span className="text-surface-500 truncate max-w-[100px]">{item.metadata.source}</span>
                        )}
                      </div>
                      <p className="text-surface-700 dark:text-surface-300 line-clamp-4">{item.content}</p>
                    </div>
                  ))}
                </div>
              )}

              {isExpanded && items.length === 0 && (
                <p className="ml-6 mt-1 text-xs text-surface-500">No results</p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
