/**
 * Classification Service — Zero-shot text classification
 *
 * Uses embeddings to compare input text against labeled example sets,
 * returning the best matching label if above threshold.
 *
 * Usage:
 *   const label = await classificationService.classify(
 *     "I want to order pizza",
 *     {
 *       food_order: ["order food", "get pizza", "buy meal"],
 *       general_chat: ["hello", "how are you", "what's up"],
 *     },
 *     0.5
 *   );
 *   // => "food_order"
 */

import type { FastifyInstance } from 'fastify';
import type mysql from 'mysql2/promise';
import { generateEmbedding, generateEmbeddings } from './EmbeddingService.js';

interface ClassifyResult {
  label: string | null;
  scores: Record<string, number>;
  bestScore: number;
}

export class ClassificationService {
  constructor(
    private fastify: FastifyInstance,
    private db: mysql.Pool,
  ) {}

  /**
   * Zero-shot classification using embedding similarity.
   * Compares the input text against labeled example sets and returns the best match.
   *
   * @param text - The input text to classify
   * @param labels - Map of label name → example sentences for that label
   * @param threshold - Minimum similarity score to accept (0-1, default 0.5)
   * @returns The best matching label, or null if below threshold
   */
  async classify(
    text: string,
    labels: Record<string, string[]>,
    threshold: number = 0.5,
  ): Promise<ClassifyResult> {
    const scores: Record<string, number> = {};

    // Generate embedding for the input text
    const inputEmb = await generateEmbedding(this.db, text);
    if (!inputEmb) {
      this.fastify.log.warn('[Classification] Failed to generate embedding for input text');
      return { label: null, scores: {}, bestScore: 0 };
    }

    // Collect all example texts and their label associations
    const allExamples: { label: string; text: string }[] = [];
    for (const [label, examples] of Object.entries(labels)) {
      for (const example of examples) {
        allExamples.push({ label, text: example });
      }
    }

    if (allExamples.length === 0) {
      return { label: null, scores: {}, bestScore: 0 };
    }

    // Generate embeddings for all examples in batch
    const exampleTexts = allExamples.map(e => e.text);
    const exampleEmbeddings = await generateEmbeddings(this.db, exampleTexts);
    if (!exampleEmbeddings || exampleEmbeddings.length === 0) {
      this.fastify.log.warn('[Classification] Failed to generate embeddings for examples');
      return { label: null, scores: {}, bestScore: 0 };
    }

    // Compute cosine similarity between input and each example
    const labelScores: Record<string, number[]> = {};

    for (let i = 0; i < allExamples.length; i++) {
      const example = allExamples[i];
      const exampleEmb = exampleEmbeddings[i];
      if (!exampleEmb) continue;

      const similarity = cosineSimilarity(inputEmb.embedding, exampleEmb.embedding);

      if (!labelScores[example.label]) {
        labelScores[example.label] = [];
      }
      labelScores[example.label].push(similarity);
    }

    // Average scores per label
    let bestLabel: string | null = null;
    let bestScore = 0;

    for (const [label, similarities] of Object.entries(labelScores)) {
      const avgScore = similarities.reduce((a, b) => a + b, 0) / similarities.length;
      scores[label] = Number(avgScore.toFixed(4));

      if (avgScore > bestScore) {
        bestScore = avgScore;
        bestLabel = label;
      }
    }

    // Apply threshold
    if (bestScore < threshold) {
      return { label: null, scores, bestScore };
    }

    return { label: bestLabel, scores, bestScore };
  }

  /**
   * Classify with multiple possible results above threshold.
   * Returns all labels sorted by score (descending).
   */
  async classifyMulti(
    text: string,
    labels: Record<string, string[]>,
    threshold: number = 0.5,
  ): Promise<{ label: string; score: number }[]> {
    const result = await this.classify(text, labels, 0); // no threshold filtering in classify
    return Object.entries(result.scores)
      .filter(([, score]) => score >= threshold)
      .sort(([, a], [, b]) => b - a)
      .map(([label, score]) => ({ label, score }));
  }
}

/**
 * Cosine similarity between two vectors
 */
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) return 0;

  return dotProduct / denominator;
}
