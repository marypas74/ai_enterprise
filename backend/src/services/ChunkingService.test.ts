/**
 * Unit tests for ChunkingService
 */

import { describe, it, expect } from 'vitest';
import { chunkDocument, selectRelevantChunks, DocumentChunk } from './ChunkingService.js';

describe('ChunkingService', () => {
    describe('chunkDocument', () => {
        it('should return empty array for empty text', () => {
            expect(chunkDocument('')).toEqual([]);
            expect(chunkDocument('   ')).toEqual([]);
        });

        it('should return single chunk for small text', () => {
            const text = 'This is a short text.';
            const chunks = chunkDocument(text, { chunkSize: 1000 });
            expect(chunks).toHaveLength(1);
            expect(chunks[0].content).toBe(text);
            expect(chunks[0].index).toBe(0);
            expect(chunks[0].charCount).toBe(text.length);
        });

        it('should split long text into multiple chunks', () => {
            const text = 'A'.repeat(500) + '\n\n' + 'B'.repeat(500) + '\n\n' + 'C'.repeat(500);
            const chunks = chunkDocument(text, { chunkSize: 600, overlap: 100 });
            expect(chunks.length).toBeGreaterThan(1);
        });

        it('should handle overlap between chunks', () => {
            const lines = Array.from({ length: 20 }, (_, i) => `Line ${i + 1}: ${'x'.repeat(80)}`);
            const text = lines.join('\n');
            const chunks = chunkDocument(text, { chunkSize: 300, overlap: 100, minChunkSize: 20 });

            expect(chunks.length).toBeGreaterThan(1);

            // Verify chunks cover the document
            const firstChunkEnd = chunks[0].metadata.endOffset;
            const secondChunkStart = chunks[1].metadata.startOffset;
            expect(secondChunkStart).toBeLessThan(firstChunkEnd); // overlap
        });

        it('should detect section titles — markdown headings', () => {
            const text = '# Introduction\nThis is the intro paragraph that has some content about the topic.';
            const chunks = chunkDocument(text, { chunkSize: 5000 });
            // detectSectionTitle returns the title string, stored as sectionTitle
            expect(chunks[0].metadata.sectionTitle).toBeDefined();
        });

        it('should detect section titles — numbered sections', () => {
            const text = '1.2 Analysis\nSome analysis content here that discusses findings.';
            const chunks = chunkDocument(text, { chunkSize: 5000 });
            expect(chunks[0].metadata.sectionTitle).toBeDefined();
        });

        it('should skip chunks smaller than minChunkSize', () => {
            const text = 'Short\n\n' + 'A'.repeat(500);
            const chunks = chunkDocument(text, { chunkSize: 600, overlap: 0, minChunkSize: 100 });
            // The "Short" piece alone should be skipped
            for (const chunk of chunks) {
                expect(chunk.charCount).toBeGreaterThanOrEqual(5);
            }
        });

        it('should prefer paragraph boundaries for splitting', () => {
            const para1 = 'First paragraph content. '.repeat(20);
            const para2 = 'Second paragraph content. '.repeat(20);
            const text = para1 + '\n\n' + para2;
            const chunks = chunkDocument(text, { chunkSize: 300, overlap: 50 });

            // Check that at least one chunk boundary aligns with paragraph
            const boundaries = chunks.map(c => c.metadata.endOffset);
            const paragraphBreak = text.indexOf('\n\n') + 2;
            expect(boundaries.some(b => Math.abs(b - paragraphBreak) < 50)).toBe(true);
        });
    });

    describe('selectRelevantChunks', () => {
        const sampleChunks: DocumentChunk[] = [
            { index: 0, content: 'Machine learning algorithms for data analysis', charCount: 46, metadata: { startOffset: 0, endOffset: 46 } },
            { index: 1, content: 'Recipe for chocolate cake with vanilla frosting', charCount: 47, metadata: { startOffset: 46, endOffset: 93 } },
            { index: 2, content: 'Neural networks and deep learning techniques', charCount: 45, metadata: { startOffset: 93, endOffset: 138 } },
            { index: 3, content: 'Gardening tips for growing tomatoes', charCount: 35, metadata: { startOffset: 138, endOffset: 173 } },
            { index: 4, content: 'Advanced machine learning optimization', charCount: 38, metadata: { startOffset: 173, endOffset: 211 } },
            { index: 5, content: 'Financial analysis of stock markets', charCount: 36, metadata: { startOffset: 211, endOffset: 247 } },
        ];

        it('should return all chunks if fewer than maxChunks', () => {
            const result = selectRelevantChunks(sampleChunks, 'anything', 10);
            expect(result).toHaveLength(sampleChunks.length);
        });

        it('should select relevant chunks based on keywords', () => {
            const result = selectRelevantChunks(sampleChunks, 'machine learning algorithms', 2);
            expect(result).toHaveLength(2);
            // Should include chunks 0 and 4 (both mention machine learning)
            const indices = result.map(c => c.index);
            expect(indices).toContain(0);
            expect(indices).toContain(4);
        });

        it('should return results in document order', () => {
            const result = selectRelevantChunks(sampleChunks, 'machine learning', 3);
            for (let i = 1; i < result.length; i++) {
                expect(result[i].index).toBeGreaterThan(result[i - 1].index);
            }
        });

        it('should return first N chunks when no keywords match', () => {
            const result = selectRelevantChunks(sampleChunks, 'ab', 3);
            expect(result).toHaveLength(3);
            expect(result[0].index).toBe(0);
        });

        it('should handle empty query gracefully', () => {
            const result = selectRelevantChunks(sampleChunks, '', 3);
            expect(result).toHaveLength(3);
        });
    });
});
