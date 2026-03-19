import type mysql from 'mysql2/promise';
import type { QdrantClient } from '../qdrant/QdrantClient.js';
import { generateServiceToken } from '../auth/serviceToken.js';

const COLLECTION_NAME = 'competency_kb';
const MAX_CHUNK_SIZE = 500;
const EMBEDDING_TIMEOUT_MS = 30_000;

interface KBDocument {
  readonly id: number;
  readonly installation_id: number;
  readonly document_name: string;
  readonly source_url: string | null;
  readonly chunk_count: number;
  readonly indexed_at: string;
}

function chunkContent(content: string): readonly string[] {
  const paragraphs = content.split(/\n\n+/).filter((p) => p.trim().length > 0);
  const chunks: string[] = [];

  for (const paragraph of paragraphs) {
    if (paragraph.length <= MAX_CHUNK_SIZE) {
      chunks.push(paragraph.trim());
    } else {
      let remaining = paragraph;
      while (remaining.length > 0) {
        if (remaining.length <= MAX_CHUNK_SIZE) {
          chunks.push(remaining.trim());
          break;
        }
        let splitIndex = remaining.lastIndexOf(' ', MAX_CHUNK_SIZE);
        if (splitIndex <= 0) {
          splitIndex = MAX_CHUNK_SIZE;
        }
        chunks.push(remaining.slice(0, splitIndex).trim());
        remaining = remaining.slice(splitIndex).trim();
      }
    }
  }

  return chunks;
}

export class KBService {
  constructor(
    private readonly pool: mysql.Pool,
    private readonly qdrantClient: QdrantClient,
    private readonly backendUrl: string,
    private readonly serviceTokenSecret: string,
  ) {}

  async indexDocument(
    installationId: number,
    documentName: string,
    content: string,
  ): Promise<number> {
    const chunks = chunkContent(content);

    const embeddings = await this.generateEmbeddings([...chunks]);

    await this.qdrantClient.ensureCollection(COLLECTION_NAME, embeddings[0].length);

    const points = chunks.map((chunk, index) => ({
      id: crypto.randomUUID(),
      vector: embeddings[index],
      payload: {
        installation_id: installationId,
        chunk_index: index,
        content: chunk,
        document_name: documentName,
      },
    }));

    await this.qdrantClient.upsertPoints(COLLECTION_NAME, points);

    const [result] = await this.pool.execute(
      'INSERT INTO marketplace_kb_documents (installation_id, document_name, chunk_count) VALUES (?, ?, ?)',
      [installationId, documentName, chunks.length],
    );

    return (result as mysql.ResultSetHeader).insertId;
  }

  async removeDocument(docId: number): Promise<void> {
    const [rows] = await this.pool.execute(
      'SELECT * FROM marketplace_kb_documents WHERE id = ?',
      [docId],
    );

    const docs = rows as KBDocument[];
    if (docs.length === 0) {
      throw new Error('Document not found');
    }

    const doc = docs[0];

    await this.qdrantClient.deleteByFilter(COLLECTION_NAME, {
      must: [
        { key: 'installation_id', match: { value: doc.installation_id } },
        { key: 'document_name', match: { value: doc.document_name } },
      ],
    });

    await this.pool.execute(
      'DELETE FROM marketplace_kb_documents WHERE id = ?',
      [docId],
    );
  }

  async listDocuments(installationId: number): Promise<readonly KBDocument[]> {
    const [rows] = await this.pool.execute(
      'SELECT * FROM marketplace_kb_documents WHERE installation_id = ?',
      [installationId],
    );

    return rows as KBDocument[];
  }

  async searchKB(
    installationId: number,
    query: string,
    limit: number = 5,
  ): Promise<readonly unknown[]> {
    const embeddings = await this.generateEmbeddings([query]);
    const queryVector = embeddings[0];

    const results = await this.qdrantClient.search(
      COLLECTION_NAME,
      queryVector,
      limit,
      {
        must: [{ key: 'installation_id', match: { value: installationId } }],
      },
    );

    return results;
  }

  private async generateEmbeddings(texts: readonly string[]): Promise<number[][]> {
    const token = generateServiceToken(this.serviceTokenSecret);

    const response = await fetch(`${this.backendUrl}/api/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ texts }),
      signal: AbortSignal.timeout(EMBEDDING_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new Error(`Embedding generation failed: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as { embeddings: number[][] };
    return data.embeddings;
  }
}
