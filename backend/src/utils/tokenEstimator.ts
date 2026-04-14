import type { Message } from '../modules/ai/providers.js';

export const ASYNC_TOKEN_THRESHOLD = 8000;
export const MAX_TOKEN_LIMIT = 64000;

/**
 * Stima il numero di token in un array di messaggi.
 * Testo: chars / 4 (approssimazione standard).
 * Immagini base64: (dimensione decoded / 560) * 100 (formula Qwen2.5-VL).
 * Immagini senza dimensioni: 1000 token default.
 */
export function estimateMessageTokens(messages: Message[]): number {
  let total = 0;

  for (const msg of messages) {
    if (typeof msg.content === 'string') {
      total += Math.ceil(msg.content.length / 4);
    } else if (Array.isArray(msg.content)) {
      for (const part of msg.content as any[]) {
        if (part.type === 'text' && typeof part.text === 'string') {
          total += Math.ceil(part.text.length / 4);
        } else if (part.type === 'image_url') {
          total += estimateImageTokens(part.image_url?.url ?? '');
        }
      }
    }
  }

  return total;
}

function estimateImageTokens(url: string): number {
  if (!url) return 1000;

  const base64Match = url.match(/^data:image\/[^;]+;base64,(.+)$/);
  if (base64Match) {
    const base64Data = base64Match[1];
    const estimatedBytes = base64Data.length * 0.75;
    const tokens = Math.ceil(estimatedBytes / 560 * 100);
    return Math.max(tokens, 64);
  }

  return 1000;
}
