export interface QdrantPoint {
  readonly id: string | number;
  readonly vector: readonly number[];
  readonly payload: Record<string, unknown>;
}

export interface QdrantSearchResult {
  readonly id: string | number;
  readonly score: number;
  readonly payload: Record<string, unknown>;
}

const TIMEOUT_MS = 10_000;

export class QdrantClient {
  constructor(private readonly qdrantUrl: string) {}

  async isAvailable(): Promise<boolean> {
    try {
      const response = await fetch(`${this.qdrantUrl}/healthz`, {
        method: 'GET',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async ensureCollection(name: string, dimensions: number): Promise<void> {
    const checkResponse = await fetch(`${this.qdrantUrl}/collections/${name}`, {
      method: 'GET',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (checkResponse.ok) {
      return;
    }

    if (checkResponse.status !== 404) {
      throw new Error(`Qdrant collection check failed: ${checkResponse.status} ${checkResponse.statusText}`);
    }

    const createResponse = await fetch(`${this.qdrantUrl}/collections/${name}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        vectors: {
          size: dimensions,
          distance: 'Cosine',
        },
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!createResponse.ok) {
      throw new Error(`Qdrant collection create failed: ${createResponse.status} ${createResponse.statusText}`);
    }
  }

  async upsertPoints(collection: string, points: readonly QdrantPoint[]): Promise<void> {
    const response = await fetch(`${this.qdrantUrl}/collections/${collection}/points`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ points }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new Error(`Qdrant upsert failed: ${response.status} ${response.statusText}`);
    }
  }

  async search(
    collection: string,
    vector: readonly number[],
    limit: number,
    filter?: Record<string, unknown>,
  ): Promise<readonly QdrantSearchResult[]> {
    const body: Record<string, unknown> = { vector, limit, with_payload: true };
    if (filter) {
      body.filter = filter;
    }

    const response = await fetch(`${this.qdrantUrl}/collections/${collection}/points/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new Error(`Qdrant search failed: ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as { result: QdrantSearchResult[] };
    return data.result;
  }

  async deleteByFilter(collection: string, filter: Record<string, unknown>): Promise<void> {
    const response = await fetch(`${this.qdrantUrl}/collections/${collection}/points/delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filter }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new Error(`Qdrant delete failed: ${response.status} ${response.statusText}`);
    }
  }
}
