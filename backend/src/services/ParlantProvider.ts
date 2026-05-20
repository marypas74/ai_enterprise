import { AIProvider, CompletionOptions, CompletionResult, StreamChunk, ProviderType } from '../modules/ai/providers.js';
import { extractTextContent } from '../modules/ai/types.js';

// Parlant service URL
const PARLANT_URL = process.env.PARLANT_URL || 'http://parlant:8800';

export interface ParlantSession {
  id: string;
  agent_id: string;
  customer_id?: string;
  creation_utc?: string;
}

export interface ParlantEvent {
  id: string;
  offset: number;
  source: 'customer' | 'ai_agent' | 'system';
  kind: string;
  correlation_id?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
  data: any;
  creation_utc: string;
  deleted: boolean;
}

export interface ParlantAgent {
  id: string;
  name: string;
  description?: string;
}

// Helper to make requests to Parlant
async function parlantFetch(
  method: string,
  path: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
  body?: any,
  timeout: number = 30000
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
): Promise<{ data: any; status: number }> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(`${PARLANT_URL}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    const text = await response.text();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
    let data: any;
    if (text && text.trim()) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    } else {
      data = null;
    }

    return { data, status: response.status };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
  } catch (error: any) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error('Parlant service request timeout');
    }
    // Provide more specific error messages
    if (error.cause?.code === 'ECONNREFUSED' || error.message?.includes('ECONNREFUSED')) {
      throw new Error(`Parlant service not reachable at ${PARLANT_URL}. Is the service running?`);
    }
    if (error.cause?.code === 'ENOTFOUND' || error.message?.includes('ENOTFOUND')) {
      throw new Error(`Parlant service hostname not found: ${PARLANT_URL}. Check PARLANT_URL configuration.`);
    }
    throw new Error(`Parlant service error: ${error.message}`);
  }
}

// ParlantProvider implements AIProvider interface
export class ParlantProvider implements AIProvider {
  name: ProviderType = 'custom';
  private agentId: string;
  private agentName: string;
  private customerId: string;
  private sessionCache: Map<string, ParlantSession> = new Map();

  constructor(agentId: string, agentName: string = 'Parlant Agent', customerId: string = 'enterprise-user') {
    this.agentId = agentId;
    this.agentName = agentName;
    this.customerId = customerId;
  }

  // Get or create a session for the customer
  private async getOrCreateSession(): Promise<ParlantSession> {
    const cacheKey = `${this.agentId}_${this.customerId}`;

    // Check cache first
    if (this.sessionCache.has(cacheKey)) {
      return this.sessionCache.get(cacheKey)!;
    }

    // List existing sessions for this agent/customer
    const { data: sessions, status } = await parlantFetch(
      'GET',
      `/sessions?agent_id=${this.agentId}&customer_id=${this.customerId}`
    );

    if (status === 200 && Array.isArray(sessions) && sessions.length > 0) {
      // Use the most recent session
      const session = sessions[0] as ParlantSession;
      this.sessionCache.set(cacheKey, session);
      return session;
    }

    // Create a new session
    const { data: newSession, status: createStatus } = await parlantFetch('POST', '/sessions', {
      agent_id: this.agentId,
      customer_id: this.customerId
    });

    if (createStatus !== 200 && createStatus !== 201) {
      throw new Error(`Failed to create Parlant session: ${JSON.stringify(newSession)}`);
    }

    this.sessionCache.set(cacheKey, newSession);
    return newSession;
  }

  // Send a message event and get current offset
  private async sendMessage(sessionId: string, content: string): Promise<number> {
    // First, get current events to know the offset
    const { data: currentEvents } = await parlantFetch('GET', `/sessions/${sessionId}/events`);
    const currentOffset = Array.isArray(currentEvents) ? currentEvents.length : 0;

    // Parlant v3.0 expects: { kind: "message", source: "customer", data: { message: "..." } }
    const eventPayload = {
      kind: 'message',
      source: 'customer',
      data: {
        message: content
      }
    };

    console.log(`[Parlant] Sending message to session ${sessionId}:`, JSON.stringify(eventPayload));

    const { data, status } = await parlantFetch('POST', `/sessions/${sessionId}/events`, eventPayload, 60000);

    if (status !== 200 && status !== 201 && status !== 202) {
      console.error(`[Parlant] Send message failed with status ${status}:`, data);
      throw new Error(`Failed to send message to Parlant: ${status} - ${JSON.stringify(data)}`);
    }

    console.log(`[Parlant] Message sent, current offset: ${currentOffset}`);
    return currentOffset;
  }

  // Long-poll for AI response
  private async pollForResponse(sessionId: string, minOffset: number, timeout: number = 120000): Promise<string> {
    const startTime = Date.now();
    let offset = minOffset + 1; // Start after the user message

    console.log(`[Parlant] Polling for response, starting offset: ${offset}`);

    while (Date.now() - startTime < timeout) {
      try {
        // Long-poll with waitForData
        const { data: events, status } = await parlantFetch(
          'GET',
          `/sessions/${sessionId}/events?min_offset=${offset}&waitForData=true`,
          undefined,
          30000
        );

        if (status !== 200) {
          console.log(`[Parlant] Poll returned status ${status}, retrying...`);
          await new Promise(resolve => setTimeout(resolve, 1000));
          continue;
        }

        if (Array.isArray(events) && events.length > 0) {
          // Look for AI agent response
          for (const event of events as ParlantEvent[]) {
            console.log(`[Parlant] Event received: source=${event.source}, kind=${event.kind}`);

            if (event.source === 'ai_agent' && event.kind === 'message' && !event.deleted) {
              // Extract message content
              const message = event.data?.message || event.data?.content || '';
              if (message) {
                console.log(`[Parlant] AI response received: ${message.substring(0, 100)}...`);
                return message;
              }
            }

            // Update offset
            if (event.offset >= offset) {
              offset = event.offset + 1;
            }
          }
        }

        // Brief pause before next poll
        await new Promise(resolve => setTimeout(resolve, 500));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
      } catch (err: any) {
        console.error(`[Parlant] Poll error:`, err.message);
        if (err.message.includes('timeout')) {
          // Continue polling on timeout
          continue;
        }
        throw err;
      }
    }

    throw new Error('Timeout waiting for Parlant AI response');
  }

  // Implement AIProvider.complete()
  async complete(options: CompletionOptions): Promise<CompletionResult> {
    // Get the last user message
    const lastUserMessage = [...options.messages].reverse().find(m => m.role === 'user');
    if (!lastUserMessage) {
      throw new Error('No user message found');
    }

    // Get or create session
    const session = await this.getOrCreateSession();

    // Send message and get response
    const userText = extractTextContent(lastUserMessage.content);
    const offset = await this.sendMessage(session.id, userText);
    const response = await this.pollForResponse(session.id, offset);

    return {
      content: response,
      tokensInput: Math.ceil(userText.length / 4),
      tokensOutput: Math.ceil(response.length / 4),
      model: `parlant:${this.agentId}`,
      provider: 'custom'
    };
  }

  // Implement AIProvider.streamComplete() - yields chunks as they arrive
  async *streamComplete(options: CompletionOptions): AsyncGenerator<StreamChunk> {
    const lastUserMessage = [...options.messages].reverse().find(m => m.role === 'user');
    if (!lastUserMessage) {
      throw new Error('No user message found');
    }

    // Get or create session
    const session = await this.getOrCreateSession();

    // Send message
    const offset = await this.sendMessage(session.id, extractTextContent(lastUserMessage.content));

    // For Parlant, we poll and yield the complete response
    // (Parlant doesn't stream partial responses like OpenAI)
    let responseReceived = false;
    const startTime = Date.now();
    const timeout = 120000;
    let currentOffset = offset + 1;

    while (!responseReceived && Date.now() - startTime < timeout) {
      try {
        const { data: events, status } = await parlantFetch(
          'GET',
          `/sessions/${session.id}/events?min_offset=${currentOffset}&waitForData=true`,
          undefined,
          30000
        );

        if (status === 200 && Array.isArray(events)) {
          for (const event of events as ParlantEvent[]) {
            if (event.source === 'ai_agent' && event.kind === 'message' && !event.deleted) {
              const message = event.data?.message || event.data?.content || '';
              if (message) {
                // Yield the full response as one chunk
                yield { content: message, done: false };
                yield { content: '', done: true };
                responseReceived = true;
                break;
              }
            }
            if (event.offset >= currentOffset) {
              currentOffset = event.offset + 1;
            }
          }
        }

        if (!responseReceived) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
      } catch (err: any) {
        if (!err.message.includes('timeout')) {
          throw err;
        }
      }
    }

    if (!responseReceived) {
      yield { content: 'Error: Timeout waiting for Parlant response', done: true };
    }
  }

  // Clear session cache (useful when starting fresh)
  clearSessionCache() {
    this.sessionCache.clear();
  }
}

// Factory for creating Parlant providers for different agents
export class ParlantProviderFactory {
  private static providers: Map<string, ParlantProvider> = new Map();

  static getProvider(agentId: string, agentName: string = 'Parlant Agent', customerId?: string): ParlantProvider {
    const key = `${agentId}_${customerId || 'default'}`;

    if (!this.providers.has(key)) {
      this.providers.set(key, new ParlantProvider(agentId, agentName, customerId));
    }

    return this.providers.get(key)!;
  }

  static clearAll() {
    this.providers.clear();
  }
}

// Fetch available Parlant agents
export async function fetchParlantAgents(): Promise<ParlantAgent[]> {
  try {
    const { data, status } = await parlantFetch('GET', '/agents');

    if (status === 200 && Array.isArray(data)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic/untyped interop
      return data.map((agent: any) => ({
        id: agent.id,
        name: agent.name || `Agent ${agent.id}`,
        description: agent.description
      }));
    }

    return [];
  } catch (err) {
    console.error('[Parlant] Failed to fetch agents:', err);
    return [];
  }
}

// Check Parlant health - uses /agents endpoint since root returns 307 redirect
export async function checkParlantHealth(): Promise<boolean> {
  try {
    const { status, data } = await parlantFetch('GET', '/agents', undefined, 5000);
    // Parlant is healthy if it returns 200 and a valid array
    const healthy = status === 200 && Array.isArray(data);
    if (healthy) console.log(`[Parlant] Health check: status=${status}, healthy=true`);
    return healthy;
  } catch {
    // Parlant not deployed — silently return false (not an error condition)
    return false;
  }
}
