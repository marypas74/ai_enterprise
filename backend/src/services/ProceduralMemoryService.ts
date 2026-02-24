/**
 * Procedural Memory Service — LLM-driven tool/form selection via semantic memory
 *
 * When plugins register tools/forms:
 *   1. Embed descriptions + examples into procedural_memory collection
 *   2. Store metadata: { type, name, pluginId, triggerType }
 *   3. On plugin deactivation, remove associated procedural memories
 *
 * During message processing:
 *   1. Embed user message → search procedural_memory (k=5, threshold=0.6)
 *   2. If matches found → build tool selection prompt
 *   3. Return selected tool/form or 'no_action'
 */

import type { FastifyInstance } from 'fastify';
import type mysql from 'mysql2/promise';
import { storeProcedural, type MemoryPoint } from './VectorMemoryService.js';
import { generateEmbedding } from './EmbeddingService.js';

const QDRANT_URL = process.env.QDRANT_URL || 'http://localhost:6333';

// ---- Types ----

export interface ProceduralEntry {
  name: string;
  description: string;
  type: 'tool' | 'form';
  pluginId?: number;
  triggerType: 'description' | 'start_example';
  examples?: string[];
}

export interface ToolSelectionResult {
  action: string;
  actionInput: string | null;
  confidence: number;
}

// ---- Service ----

export class ProceduralMemoryService {
  constructor(
    private fastify: FastifyInstance,
    private db: mysql.Pool,
  ) {}

  /**
   * Register a tool/form into procedural memory
   * Embeds the description + each start_example as separate points
   */
  async registerProcedural(entry: ProceduralEntry): Promise<number> {
    // Generate a deterministic-ish ID from name
    const baseId = hashString(entry.name) * 100;

    // Store the description embedding
    await this.upsertPoint(
      baseId + 1,
      `${entry.name}: ${entry.description}`,
      {
        name: entry.name,
        type: entry.type,
        plugin_id: entry.pluginId ?? 0,
        trigger_type: 'description',
        content: entry.description,
      },
    );

    // Store each start_example as a separate point
    if (entry.examples && entry.examples.length > 0) {
      for (let i = 0; i < Math.min(entry.examples.length, 5); i++) {
        await this.upsertPoint(
          baseId + 10 + i,
          entry.examples[i],
          {
            name: entry.name,
            type: entry.type,
            plugin_id: entry.pluginId ?? 0,
            trigger_type: 'start_example',
            content: entry.examples[i],
          },
        );
      }
    }

    return baseId;
  }

  /**
   * Remove all procedural memories for a given tool/form name
   */
  async unregisterProcedural(name: string): Promise<void> {
    const baseId = hashString(name) * 100;
    const pointIds = [baseId + 1];
    for (let i = 0; i < 5; i++) pointIds.push(baseId + 10 + i);

    try {
      await fetch(`${QDRANT_URL}/collections/procedural_memory/points/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ points: pointIds }),
      });
    } catch (err: any) {
      this.fastify.log.warn(`[ProceduralMemory] Failed to unregister "${name}": ${err.message}`);
    }
  }

  /**
   * Remove all procedural memories for a plugin
   */
  async unregisterPlugin(pluginId: number): Promise<void> {
    try {
      await fetch(`${QDRANT_URL}/collections/procedural_memory/points/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filter: { must: [{ key: 'plugin_id', match: { value: pluginId } }] },
        }),
      });
    } catch (err: any) {
      this.fastify.log.warn(`[ProceduralMemory] Failed to unregister plugin ${pluginId}: ${err.message}`);
    }
  }

  /**
   * Build the Cheshire Cat-style tool selection prompt from recalled procedural memories
   */
  buildToolSelectionPrompt(
    proceduralMatches: MemoryPoint[],
    userMessage: string,
  ): string {
    if (proceduralMatches.length === 0) return '';

    // Deduplicate by name (multiple examples may match the same tool)
    const toolMap = new Map<string, { name: string; description: string; type: string; score: number }>();
    for (const match of proceduralMatches) {
      const name = match.metadata.name || 'unknown';
      const existing = toolMap.get(name);
      if (!existing || match.score > existing.score) {
        toolMap.set(name, {
          name,
          description: match.metadata.trigger_type === 'description'
            ? match.content
            : `${name}: ${match.content}`,
          type: match.metadata.type || 'tool',
          score: match.score,
        });
      }
    }

    const tools = Array.from(toolMap.values());

    const toolDescriptions = tools
      .map(t => `- "${t.name}": ${t.description} [${t.type}] (confidence: ${(t.score * 100).toFixed(0)}%)`)
      .join('\n');

    return `Create a JSON object with "action" and "action_input" to help the Human.
You can use one of the following actions:
${toolDescriptions}
- "no_action": Use this if no relevant action is available. Input is null.

## Example output
\`\`\`json
{"action": "tool_name", "action_input": "the input for the tool"}
\`\`\`

## Rules
- Output ONLY the JSON object, no extra text
- Choose "no_action" if the user's request doesn't clearly match any available action
- The "action_input" should be the user's relevant input for the chosen tool

## Human message
"${userMessage}"`;
  }

  /**
   * Parse the LLM's tool selection response
   */
  parseToolSelection(llmResponse: string): ToolSelectionResult | null {
    try {
      // Try to extract JSON from the response
      const jsonMatch = llmResponse.match(/\{[\s\S]*?"action"[\s\S]*?\}/);
      if (!jsonMatch) return null;

      const parsed = JSON.parse(jsonMatch[0]);
      if (!parsed.action) return null;

      if (parsed.action === 'no_action') return null;

      return {
        action: parsed.action,
        actionInput: parsed.action_input ?? null,
        confidence: 1.0,
      };
    } catch {
      return null;
    }
  }

  // ---- Private helpers ----

  private async upsertPoint(
    pointId: number,
    text: string,
    payload: Record<string, any>,
  ): Promise<boolean> {
    try {
      const emb = await generateEmbedding(this.db, text);
      if (!emb) return false;

      // Delete old point
      await fetch(`${QDRANT_URL}/collections/procedural_memory/points/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ points: [pointId] }),
      });

      // Insert new point
      const resp = await fetch(`${QDRANT_URL}/collections/procedural_memory/points`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          points: [{
            id: pointId,
            vector: emb.embedding,
            payload: { ...payload, when: new Date().toISOString() },
          }],
        }),
      });

      return resp.ok;
    } catch (err: any) {
      this.fastify.log.warn(`[ProceduralMemory] upsertPoint failed: ${err.message}`);
      return false;
    }
  }
}

/** Simple string hash → positive integer */
function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash);
}
