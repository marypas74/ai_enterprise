/**
 * MessageHandler - Functions for sending messages via different backends
 *
 * Extracted from extension.ts to keep each module under 800 LOC.
 * Handles: direct Claude API calls, backend SSE streaming, and agentic messages.
 */

import * as vscode from 'vscode';
import { ClaudeCodePanel } from '../ClaudeCodePanel';

// ============================================
// TYPES
// ============================================

export interface MessageHandlerDeps {
    accessToken: string | undefined;
    selectedModel: string | undefined;
    outputChannel: vscode.OutputChannel;
    getCustomInstructions: () => Promise<string | null>;
}

// ============================================
// PANEL-BASED MESSAGE HANDLERS
// ============================================

/**
 * Handle send message from panel - routes to direct Claude or backend
 */
export async function handleSendMessage(
    message: string,
    deps: MessageHandlerDeps
): Promise<void> {
    const panel = ClaudeCodePanel.currentPanel;
    if (!panel) { return; }

    deps.outputChannel.appendLine(`Sending message: ${message.substring(0, 50)}...`);

    const config = vscode.workspace.getConfiguration('enterprise-ai-chat');
    const useDirectClaude = config.get<boolean>('useDirectClaude', false);
    const claudeApiKey = config.get<string>('claudeApiKey', '');
    const claudeModel = config.get<string>('claudeModel', 'claude-sonnet-4-20250514');

    if (useDirectClaude && claudeApiKey) {
        await sendDirectClaudeMessage(message, claudeApiKey, claudeModel, panel, deps.outputChannel);
    } else if (deps.accessToken) {
        await sendBackendMessage(message, panel, deps);
    } else {
        panel.addMessage('system', 'Please login first or configure Claude API key in settings.');
    }
}

/**
 * Handle agentic message from Kanban task execution
 * Uses /api/chat/agentic endpoint with tool support
 */
export async function handleAgenticMessage(
    panel: ClaudeCodePanel,
    message: string,
    projectId: number,
    deps: MessageHandlerDeps
): Promise<void> {
    if (!deps.accessToken) {
        panel.addMessage('system', 'Please login first to execute tasks.');
        vscode.commands.executeCommand('enterprise-ai-chat.login');
        return;
    }

    const config = vscode.workspace.getConfiguration('enterprise-ai-chat');
    const serverUrl = config.get<string>('serverUrl') || 'https://192.168.1.123';
    const model = config.get<string>('claudeModel') || 'claude-sonnet-4-20250514';

    deps.outputChannel.appendLine(
        `[Agentic Panel] Starting: message=${message.substring(0, 50)}..., projectId=${projectId}, model=${model}`
    );

    panel.streamStart();

    try {
        const https = require('https');
        const url = new URL(`${serverUrl}/api/chat/agentic`);

        const requestBody = JSON.stringify({
            message,
            projectId,
            model,
            systemPrompt: `You are an AI coding assistant with DIRECT FILE SYSTEM ACCESS.

## CRITICAL INSTRUCTIONS:
1. When generating code, you MUST use the 'write_file' tool to save files. DO NOT just print code.
2. Files are saved to a network repository at: \\\\192.168.1.123\\projects\\repositories
3. Use 'list_files' to check existing project structure before writing.
4. Use 'read_file' to read existing files when needed.

## WORKFLOW:
1. Analyze the user's request
2. Plan the file structure (e.g., src/main.py, tests/test_main.py)
3. Use write_file tool to CREATE each file with full content
4. Explain what you created and how to use it

REMEMBER: Always USE THE TOOLS. Never just print code without saving it.`,
            enableTools: true,
        });

        const options = {
            hostname: url.hostname,
            port: url.port || 443,
            path: url.pathname,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${deps.accessToken}`,
                'Accept': 'text/event-stream',
                'Content-Length': Buffer.byteLength(requestBody),
            },
            rejectUnauthorized: false,
        };

        const req = https.request(options, (res: any) => {
            deps.outputChannel.appendLine(`[Agentic Panel] Response status: ${res.statusCode}`);

            if (res.statusCode !== 200) {
                let errorBody = '';
                res.on('data', (chunk: Buffer) => { errorBody += chunk.toString(); });
                res.on('end', () => {
                    panel.streamEnd();
                    let errorMsg = `Server error: ${res.statusCode}`;
                    try {
                        const parsed = JSON.parse(errorBody);
                        errorMsg = parsed.error || parsed.message || errorMsg;
                    } catch { /* ignore */ }
                    panel.streamError(errorMsg);
                });
                return;
            }

            let buffer = '';
            let chunkCount = 0;

            res.on('data', (chunk: Buffer) => {
                buffer += chunk.toString();
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        const jsonStr = line.slice(6).trim();
                        if (!jsonStr) { continue; }

                        try {
                            const data = JSON.parse(jsonStr);
                            chunkCount++;
                            deps.outputChannel.appendLine(
                                `[Agentic Panel] Chunk #${chunkCount}: keys=${Object.keys(data).join(',')}`
                            );

                            if (data.content) { panel.streamChunk(data.content); }
                            if (data.error) { panel.streamError(data.error); }
                            if (data.done) { panel.streamEnd(); }
                        } catch {
                            // Skip invalid JSON
                        }
                    }
                }
            });

            res.on('end', () => {
                deps.outputChannel.appendLine(`[Agentic Panel] Stream ended, ${chunkCount} chunks received`);
                panel.streamEnd();
            });

            res.on('error', (err: Error) => {
                deps.outputChannel.appendLine(`[Agentic Panel] Response error: ${err.message}`);
                panel.streamError(err.message);
            });
        });

        req.on('error', (err: Error) => {
            deps.outputChannel.appendLine(`[Agentic Panel] Request error: ${err.message}`);
            panel.streamError(err.message);
        });

        req.write(requestBody);
        req.end();

    } catch (error: any) {
        deps.outputChannel.appendLine(`[Agentic Panel] Error: ${error.message}`);
        panel.streamError(error.message);
    }
}

/**
 * Send message via direct Claude API
 */
export async function sendDirectClaudeMessage(
    message: string,
    apiKey: string,
    model: string,
    panel: ClaudeCodePanel,
    outputChannel: vscode.OutputChannel
): Promise<void> {
    panel.streamStart();

    try {
        const Anthropic = require('@anthropic-ai/sdk');
        const anthropic = new Anthropic({ apiKey });

        const stream = await anthropic.messages.stream({
            model: model,
            max_tokens: 4096,
            messages: [{ role: 'user', content: message }],
        });

        for await (const event of stream) {
            if (event.type === 'content_block_delta' && event.delta?.text) {
                panel.streamChunk(event.delta.text);
            }
        }

        panel.streamEnd();
    } catch (error: any) {
        outputChannel.appendLine(`Claude API error: ${error.message}`);
        panel.streamEnd();
        panel.addMessage('system', `Error: ${error.message}`);
    }
}

/**
 * Send message via backend API with SSE streaming
 *
 * CRITICAL: Uses /api/chat/completions endpoint (not /chat/send)
 * The /api prefix is required by Kubernetes Ingress routing
 */
export async function sendBackendMessage(
    message: string,
    panel: ClaudeCodePanel,
    deps: MessageHandlerDeps
): Promise<void> {
    if (!deps.accessToken) {
        deps.outputChannel.appendLine('ERROR: No access token available');
        panel.addMessage('system', 'Not authenticated. Please login first.');
        vscode.commands.executeCommand('enterprise-ai-chat.login');
        return;
    }

    deps.outputChannel.appendLine(`Access token present: ${deps.accessToken.substring(0, 20)}...`);

    panel.streamStart();

    const config = vscode.workspace.getConfiguration('enterprise-ai-chat');
    const serverUrl = config.get<string>('serverUrl') || 'https://192.168.1.123';
    const apiUrl = `${serverUrl.replace(/\/+$/, '')}/api/chat/completions`;

    deps.outputChannel.appendLine(`SSE Request to: ${apiUrl}`);
    deps.outputChannel.appendLine(`Model: ${deps.selectedModel}`);
    deps.outputChannel.appendLine(`Token: Bearer ${deps.accessToken.substring(0, 30)}...`);

    try {
        const customInstructions = await deps.getCustomInstructions();
        if (customInstructions) {
            deps.outputChannel.appendLine(`Using custom instructions (${customInstructions.length} chars)`);
        }

        const https = require('https');
        const url = new URL(apiUrl);

        const requestBody = JSON.stringify({
            message: message,
            model: deps.selectedModel || 'gpt-4o',
            systemPrompt: customInstructions || undefined,
        });

        const options = {
            hostname: url.hostname,
            port: url.port || 443,
            path: url.pathname,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${deps.accessToken}`,
                'Accept': 'text/event-stream',
                'Content-Length': Buffer.byteLength(requestBody),
            },
            rejectUnauthorized: false,
        };

        const req = https.request(options, (res: any) => {
            deps.outputChannel.appendLine(`Response status: ${res.statusCode}`);

            if (res.statusCode !== 200) {
                _handleNon200Response(res, panel, deps);
                return;
            }

            const conversationId = res.headers['x-conversation-id'];
            let buffer = '';

            res.on('data', (chunk: Buffer) => {
                buffer += chunk.toString();
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        const jsonStr = line.slice(6).trim();
                        if (jsonStr) {
                            try {
                                const data = JSON.parse(jsonStr);
                                if (data.content) {
                                    deps.outputChannel.appendLine(`[Stream] Chunk received: ${data.content.length} chars`);
                                    panel.streamChunk(data.content);
                                }
                                if (data.error) {
                                    deps.outputChannel.appendLine(`[Stream] Error from backend: ${data.error}`);
                                    panel.addMessage('system', data.error);
                                }
                                if (data.done) {
                                    deps.outputChannel.appendLine(
                                        `[Stream] Complete. ConvID: ${data.conversationId || conversationId}`
                                    );
                                }
                            } catch (parseErr) {
                                deps.outputChannel.appendLine(`[Stream] SSE parse error: ${jsonStr}`);
                            }
                        }
                    }
                }
            });

            res.on('end', () => {
                panel.streamEnd();
                deps.outputChannel.appendLine('[Stream] SSE stream ended successfully');
            });

            res.on('error', (error: Error) => {
                deps.outputChannel.appendLine(`[Stream] Response error: ${error.message}`);
                panel.streamError(`Stream interrupted: ${error.message}`);
            });
        });

        req.on('error', (error: Error) => {
            deps.outputChannel.appendLine(`[Stream] Request error: ${error.message}`);

            let userMessage = error.message;
            if (error.message.includes('ECONNREFUSED')) {
                userMessage = 'Connection refused. Is the backend server running?';
            } else if (error.message.includes('ETIMEDOUT')) {
                userMessage = 'Connection timed out. Check network connectivity.';
            } else if (error.message.includes('ENOTFOUND')) {
                userMessage = 'Server not found. Check the server URL in settings.';
            }
            panel.streamError(userMessage);
        });

        req.write(requestBody);
        req.end();

    } catch (error: any) {
        deps.outputChannel.appendLine(`[Stream] Backend API error: ${error.message}`);
        panel.streamError(`Error: ${error.message}`);
    }
}

// ============================================
// INTERNAL HELPERS
// ============================================

function _handleNon200Response(
    res: any,
    panel: ClaudeCodePanel,
    deps: MessageHandlerDeps
): void {
    let errorBody = '';
    res.on('data', (chunk: Buffer) => { errorBody += chunk.toString(); });
    res.on('end', () => {
        panel.streamEnd();
        let errorMsg = `Server error: ${res.statusCode}`;

        try {
            const parsed = JSON.parse(errorBody);
            errorMsg = parsed.error || parsed.message || errorMsg;
        } catch {
            if (errorBody.includes('<html') || errorBody.includes('<!DOCTYPE')) {
                deps.outputChannel.appendLine(`HTML error response received: ${errorBody.substring(0, 200)}...`);
            } else if (errorBody && errorBody.length < 200) {
                errorMsg = errorBody;
            }
        }

        if (res.statusCode === 404) {
            errorMsg = 'Endpoint not found. Check that backend is running and Ingress is configured.';
        } else if (res.statusCode === 502) {
            errorMsg = 'Backend service unavailable. Check that pods are running.';
        } else if (res.statusCode === 504) {
            errorMsg = 'Request timed out. The AI service may be overloaded or unreachable.';
        } else if (res.statusCode === 401) {
            errorMsg = 'Session expired. Please login again.';
            deps.outputChannel.appendLine('Token invalid/expired - clearing auth state');
            vscode.commands.executeCommand('enterprise-ai-chat.login');
        } else if (res.statusCode === 503) {
            errorMsg = 'Service temporarily unavailable. Please try again later.';
        }

        panel.addMessage('system', errorMsg);
    });
}
