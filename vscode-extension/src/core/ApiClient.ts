import axios, { AxiosInstance, AxiosError } from 'axios';
import * as https from 'https';
import * as vscode from 'vscode';
import type { ConfigService } from './ConfigService';
import type { EventBus } from './EventBus';
import type { ApiResponse, StreamChunk } from './types';

export class ApiClient {
  private readonly client: AxiosInstance;
  private token: string | null = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly eventBus: EventBus,
    private readonly outputChannel: vscode.OutputChannel,
  ) {
    const baseURL = this.configService.getServerUrl();
    const allowSelfSigned = this.configService.getAllowSelfSigned();

    this.client = axios.create({
      baseURL,
      timeout: 30000,
      httpsAgent: allowSelfSigned
        ? new https.Agent({ rejectUnauthorized: false })
        : undefined,
    });

    this.client.interceptors.request.use((config) => {
      if (this.token) {
        config.headers.Authorization = `Bearer ${this.token}`;
      }
      return config;
    });

    this.client.interceptors.response.use(
      (response) => response,
      async (error: AxiosError) => {
        if (error.response?.status === 401) {
          this.outputChannel.appendLine('[ApiClient] 401 — session expired');
          this.eventBus.emit('auth:logout', undefined);
        }
        throw error;
      },
    );

    this.eventBus.on('config:changed', () => {
      this.client.defaults.baseURL = this.configService.getServerUrl();
    });
  }

  setToken(token: string): void {
    this.token = token;
  }

  clearToken(): void {
    this.token = null;
  }

  hasToken(): boolean {
    return this.token !== null;
  }

  async get<T>(path: string, params?: Record<string, unknown>): Promise<T> {
    const response = await this.withRetry(() =>
      this.client.get<ApiResponse<T>>(path, { params }),
    );
    return response.data.data as T;
  }

  async post<T>(path: string, body?: unknown): Promise<T> {
    const response = await this.withRetry(() =>
      this.client.post<ApiResponse<T>>(path, body),
    );
    return response.data.data as T;
  }

  async delete<T>(path: string): Promise<T> {
    const response = await this.withRetry(() =>
      this.client.delete<ApiResponse<T>>(path),
    );
    return response.data.data as T;
  }

  stream(
    path: string,
    body: unknown,
    onChunk: (chunk: StreamChunk) => void,
    onError?: (error: Error) => void,
  ): AbortController {
    const controller = new AbortController();
    this.doStream(path, body, onChunk, onError, controller);
    return controller;
  }

  private async doStream(
    path: string,
    body: unknown,
    onChunk: (chunk: StreamChunk) => void,
    onError: ((error: Error) => void) | undefined,
    controller: AbortController,
    attempt = 0,
  ): Promise<void> {
    const maxRetries = 5;
    const baseURL = this.configService.getServerUrl();
    const url = `${baseURL}${path}`;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        if (response.status === 401) {
          this.eventBus.emit('auth:logout', undefined);
        }
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('No response body');
      }

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const chunk = JSON.parse(line.slice(6)) as StreamChunk;
              onChunk(chunk);
            } catch {
              // skip malformed chunks
            }
          }
        }
      }
    } catch (error) {
      if (controller.signal.aborted) {
        return;
      }

      if (attempt < maxRetries) {
        const delay = Math.min(1000 * Math.pow(2, attempt), 30000);
        this.outputChannel.appendLine(
          `[ApiClient] SSE reconnect attempt ${attempt + 1}/${maxRetries} in ${delay}ms`,
        );
        await new Promise((r) => setTimeout(r, delay));
        return this.doStream(path, body, onChunk, onError, controller, attempt + 1);
      }

      this.outputChannel.appendLine(
        `[ApiClient] SSE failed after ${maxRetries} retries`,
      );
      onError?.(error instanceof Error ? error : new Error(String(error)));
    }
  }

  private async withRetry<T>(fn: () => Promise<T>, retries = 3): Promise<T> {
    for (let i = 0; i < retries; i++) {
      try {
        return await fn();
      } catch (error) {
        if (i === retries - 1) {
          throw error;
        }
        const axiosErr = error as AxiosError;
        if (
          axiosErr.response?.status === 401 ||
          axiosErr.response?.status === 403
        ) {
          throw error;
        }
        const delay = Math.min(1000 * Math.pow(2, i), 10000);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
    throw new Error('Unreachable');
  }
}
