/**
 * BatchProcessingService — Anthropic Batch API integration
 * Submit batches of messages for async processing at 50% discount.
 */

export interface BatchRequest {
  customId: string;
  model: string;
  messages: any[];
  system?: string;
  maxTokens?: number;
}

export interface BatchStatus {
  id: string;
  type: string;
  processing_status: string;
  request_counts: {
    processing: number;
    succeeded: number;
    errored: number;
    canceled: number;
    expired: number;
  };
  created_at: string;
  ended_at: string | null;
  results_url: string | null;
}

/**
 * Submit a batch of requests to the Anthropic Batch API.
 * Returns the batch ID for status polling.
 */
export async function submitBatch(apiKey: string, requests: BatchRequest[]): Promise<string> {
  const formattedRequests = requests.map(r => ({
    custom_id: r.customId,
    params: {
      model: r.model,
      max_tokens: r.maxTokens || 4096,
      messages: r.messages,
      ...(r.system ? { system: r.system } : {}),
    }
  }));

  const response = await fetch('https://api.anthropic.com/v1/messages/batches', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({ requests: formattedRequests }),
    signal: AbortSignal.timeout(30000),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`Batch submit failed (${response.status}): ${errText}`);
  }

  const data = await response.json() as { id: string };
  return data.id;
}

/**
 * Get the status of a batch job.
 */
export async function getBatchStatus(apiKey: string, batchId: string): Promise<BatchStatus> {
  const response = await fetch(`https://api.anthropic.com/v1/messages/batches/${encodeURIComponent(batchId)}`, {
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    signal: AbortSignal.timeout(10000),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`Batch status failed (${response.status}): ${errText}`);
  }

  return response.json() as Promise<BatchStatus>;
}

/**
 * Cancel a batch job.
 */
export async function cancelBatch(apiKey: string, batchId: string): Promise<BatchStatus> {
  const response = await fetch(`https://api.anthropic.com/v1/messages/batches/${encodeURIComponent(batchId)}/cancel`, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    signal: AbortSignal.timeout(10000),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`Batch cancel failed (${response.status}): ${errText}`);
  }

  return response.json() as Promise<BatchStatus>;
}

/**
 * Stream batch results as JSONL.
 */
export async function* streamBatchResults(apiKey: string, batchId: string): AsyncGenerator<any> {
  const status = await getBatchStatus(apiKey, batchId);
  if (!status.results_url) {
    throw new Error('Batch results not yet available');
  }

  // Validate results URL to prevent SSRF — must be from Anthropic
  if (!status.results_url.startsWith('https://api.anthropic.com/')) {
    throw new Error('Invalid results URL: unexpected domain');
  }

  const response = await fetch(status.results_url, {
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    signal: AbortSignal.timeout(300000), // 5 min for large result sets
  });

  if (!response.ok) {
    throw new Error(`Batch results fetch failed (${response.status})`);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error('No response body');

  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        yield JSON.parse(line);
      } catch { /* skip invalid JSONL */ }
    }
  }

  // Handle remaining buffer
  if (buffer.trim()) {
    try {
      yield JSON.parse(buffer);
    } catch { /* skip */ }
  }
}
