/**
 * TTS Text Preprocessing — cleans AI responses for natural speech synthesis.
 * Strips markdown, code blocks, URLs, HTML tags, and other non-speech artifacts.
 */

/**
 * Clean AI response text for natural TTS output.
 * Pure function — no side effects.
 */
export function preprocessForTTS(text: string): string {
  let result = text;

  // 1. Remove fenced code blocks → "Codice omesso."
  result = result.replace(/```[\s\S]*?```/g, ' Codice omesso. ');

  // 2. Remove inline code backticks, keep content
  result = result.replace(/`([^`]+)`/g, '$1');

  // 3. Remove heading markers, keep text
  result = result.replace(/^#{1,6}\s+/gm, '');

  // 4. Remove bold/italic markers, keep text
  result = result.replace(/\*\*\*(.+?)\*\*\*/g, '$1');
  result = result.replace(/\*\*(.+?)\*\*/g, '$1');
  result = result.replace(/\*(.+?)\*/g, '$1');
  result = result.replace(/___(.+?)___/g, '$1');
  result = result.replace(/__(.+?)__/g, '$1');
  result = result.replace(/_(.+?)_/g, '$1');

  // 5. Convert markdown links [text](url) → just "text"
  result = result.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');

  // 6. Replace standalone URLs with "un link"
  result = result.replace(/https?:\/\/[^\s)]+/g, 'un link');

  // 7. Remove horizontal rules (---, ***, ___)
  result = result.replace(/^[-*_]{3,}\s*$/gm, '');

  // 8. Remove blockquote markers
  result = result.replace(/^>\s*/gm, '');

  // 9. Remove list markers (-, *, 1.)
  result = result.replace(/^[\t ]*[-*]\s+/gm, '');
  result = result.replace(/^[\t ]*\d+\.\s+/gm, '');

  // 10. Remove markdown table rows (lines with |)
  result = result.replace(/^\|.*\|$/gm, '');
  result = result.replace(/^[-|: ]+$/gm, '');

  // 11. Remove HTML tags
  result = result.replace(/<[^>]+>/g, '');

  // 12. Normalize whitespace: collapse multiple spaces/newlines to single space
  result = result.replace(/\n{2,}/g, '. ');
  result = result.replace(/\n/g, ' ');
  result = result.replace(/\s{2,}/g, ' ');

  // 13. Clean up orphaned punctuation artifacts
  result = result.replace(/\.\s*\.\s*/g, '. ');
  result = result.replace(/,\s*,/g, ',');

  return result.trim();
}
