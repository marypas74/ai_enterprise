/**
 * RagSourcesBadges.tsx
 * Renders attribution badges for RAG document sources and web fallback sources.
 * Shows a banner when web results were used to augment insufficient RAG context.
 *
 * v2.1.85 — T5 Frontend update
 */

import React from 'react';
import { FileText, Globe, Info } from 'lucide-react';
import type { RagSources } from '../../services/api';

interface RagSourcesBadgesProps {
  readonly sources: RagSources | null;
}

/**
 * Extracts hostname from a URL string. Falls back to the full URL on parse error.
 */
function safeHostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

export default function RagSourcesBadges({ sources }: RagSourcesBadgesProps) {
  if (!sources) return null;

  const { documents, web } = sources;
  const hasDocuments = documents && documents.length > 0;
  const hasWeb = web && web.length > 0;

  if (!hasDocuments && !hasWeb) return null;

  return (
    <div className="mt-2 space-y-2">
      {/* Web fallback notification banner */}
      {hasWeb && (
        <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-blue-950/30 border border-blue-700/40 text-xs text-blue-300">
          <Info className="w-3.5 h-3.5 flex-shrink-0 mt-0.5 text-blue-400" />
          <span>
            Risposta integrata con ricerca web (il documento non conteneva informazioni sufficienti)
          </span>
        </div>
      )}

      {/* Source badges row */}
      <div className="flex flex-wrap gap-1.5">
        {/* Document badges */}
        {hasDocuments && documents.map((doc, i) => (
          <span
            key={`doc-${i}`}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-indigo-950/40 border border-indigo-700/40 text-[11px] text-indigo-300 max-w-[180px]"
            title={String(doc.name)}
          >
            <FileText className="w-3 h-3 flex-shrink-0" />
            <span className="truncate">{doc.name}</span>
          </span>
        ))}

        {/* Web badges */}
        {hasWeb && web.map((result, i) => (
          <a
            key={`web-${i}`}
            href={result.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-950/40 border border-blue-700/40 text-[11px] text-blue-300 hover:bg-blue-900/40 hover:border-blue-600/50 transition-colors max-w-[180px]"
            title={`${result.title}\n${result.url}`}
          >
            <Globe className="w-3 h-3 flex-shrink-0" />
            <span className="truncate">{safeHostname(result.url)}</span>
          </a>
        ))}
      </div>
    </div>
  );
}
