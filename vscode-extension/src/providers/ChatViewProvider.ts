/**
 * ChatViewProvider - Type definition for the legacy sidebar ChatViewProvider
 *
 * The ChatViewProvider class was originally in extension.ts as the sidebar webview provider.
 * This file exports the interface that other modules (AuthService, ModelFetcher, ClaudeOAuth)
 * depend on via `import type { ChatViewProvider }`.
 *
 * The actual ChatViewProvider class still exists in extension.ts but is no longer
 * the primary UI - ClaudeCodePanel (editor tab) is used instead.
 */

import * as vscode from 'vscode';

export interface AvailableModel {
    id: string;
    name: string;
    provider: string;
}

export interface PlaygroundSettings {
    temperature: number;
    maxTokens: number;
    topP: number;
    frequencyPenalty: number;
    presencePenalty: number;
    stopSequences: string[];
}

export interface PromptTemplate {
    id: string;
    name: string;
    description: string;
    template: string;
    variables: string[];
    category: 'code' | 'debug' | 'refactor' | 'document' | 'test' | 'custom';
    chainNext?: string;
}

export interface MCPServer {
    id: string;
    name: string;
    type: 'stdio' | 'http';
    command?: string;
    url?: string;
    tools: Array<{ name: string; description: string; inputSchema: object }>;
    status: 'connected' | 'disconnected' | 'error';
}

/**
 * ChatViewProvider interface - used by AuthService, ModelFetcher, and ClaudeOAuth
 * to interact with the sidebar webview provider.
 */
export interface ChatViewProvider {
    setAuthenticated(
        isAuthenticated: boolean,
        user?: { email: string; name: string },
        models?: AvailableModel[],
        model?: string
    ): void;
    setClaudeProAuthenticated(isAuthenticated: boolean): void;
    updateModels(models: AvailableModel[], selected?: string): void;
    updateAIToolkitConfig(
        enabled: boolean,
        playground: PlaygroundSettings,
        templates: PromptTemplate[],
        servers: MCPServer[]
    ): void;
    sendMessage(message: string): Promise<void>;
    insertCode(fileName: string, language: string, code: string): void;
    addFileContext(name: string, language: string, content: string): void;
}
