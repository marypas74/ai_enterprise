/**
 * AIGeneratedLabel — GAP-2: Content Marking (Art. 50.2 AI Act)
 *
 * Badge inline su ogni messaggio assistant che indica il modello AI
 * utilizzato per generare la risposta.
 */

import { Sparkles } from 'lucide-react';

interface AIGeneratedLabelProps {
  model?: string;
  provider?: string;
}

export default function AIGeneratedLabel({ model, provider }: AIGeneratedLabelProps) {
  const displayName = model || 'AI';
  const providerLabel = provider ? ` · ${provider}` : '';

  return (
    <span className="inline-flex items-center gap-1 text-xs text-surface-400 dark:text-surface-500">
      <Sparkles className="w-3 h-3" />
      <span>Generato da AI · {displayName}{providerLabel}</span>
    </span>
  );
}
