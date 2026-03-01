/**
 * ChatViewMessaging - Message sending methods from ChatViewProvider
 *
 * Extracted from extension.ts to keep each module under 800 LOC.
 * Contains: sendMessage, sendAgenticMessage, sendMessageWithSettings,
 * and the Claude/Backend API call implementations.
 */

import * as vscode from 'vscode';
import axios, { AxiosInstance } from 'axios';

// ============================================
// TYPES
// ============================================

export interface PlaygroundSettings {
    temperature: number;
    maxTokens: number;
    topP: number;
    frequencyPenalty: number;
    presencePenalty: number;
    stopSequences: string[];
}

export interface ChatMessage {
    role: 'user' | 'assistant' | 'system';
    content: string;
    timestamp: Date;
}

export interface MessagingDeps {
    api: AxiosInstance;
    accessToken: string | undefined;
    selectedModel: string | undefined;
    claudeOAuthToken: string | undefined;
    outputChannel: vscode.OutputChannel;
    context: vscode.ExtensionContext;
    messages: ChatMessage[];
    fileContexts: Array<{ name: string; language: string; content: string }>;
    playgroundSettings: PlaygroundSettings;
    postMessage: (msg: any) => void;
    setLoading: (loading: boolean) => void;
    updateView: () => void;
}

// ============================================
// CONSTANTS
// ============================================

const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';

// ============================================
// AGENTIC MESSAGE (tool-supported, SSE streaming via fetch)
// ============================================

export async function sendAgenticMessage(
    deps: MessagingDeps,
    message: string,
    projectId: number
): Promise<void> {
    if (!deps.accessToken) {
        vscode.window.showWarningMessage('Login required for agentic mode');
        return;
    }

    const config = vscode.workspace.getConfiguration('enterprise-ai-chat');
    const serverUrl = config.get<string>('serverUrl') || 'https://192.168.1.123';
    const model = config.get<string>('claudeModel') || 'claude-sonnet-4-20250514';

    deps.postMessage({ type: 'streamStart' });

    try {
        const response = await fetch(`${serverUrl}/api/chat/agentic`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${deps.accessToken}`,
            },
            body: JSON.stringify({
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

## EXAMPLE:
User: "Create a Python hello world"
You: I'll create a Python hello world script.
[Use write_file tool with path="src/hello.py" and content="print('Hello, World!')"]
Done! I created src/hello.py. Run it with: python src/hello.py

REMEMBER: Always USE THE TOOLS. Never just print code without saving it.`,
                enableTools: true,
            }),
        });

        if (!response.ok) {
            const errBody = await response.json().catch(() => ({ error: 'Unknown error' })) as { error?: string };
            throw new Error(errBody.error || `HTTP ${response.status}`);
        }

        const reader = response.body?.getReader();
        if (!reader) { throw new Error('No response body'); }

        const decoder = new TextDecoder();
        let buffer = '';
        let chunkCount = 0;
        const streamStartTime = Date.now();

        deps.outputChannel.appendLine(`[Agentic] TRACE: SSE stream connected, waiting for chunks...`);

        while (true) {
            const { done, value } = await reader.read();
            if (done) {
                deps.outputChannel.appendLine(
                    `[Agentic] TRACE: Stream ended after ${Date.now() - streamStartTime}ms, ${chunkCount} chunks received`
                );
                break;
            }

            const rawChunk = decoder.decode(value, { stream: true });
            chunkCount++;
            deps.outputChannel.appendLine(`[Agentic] TRACE: Chunk #${chunkCount} received, size: ${rawChunk.length} bytes`);

            buffer += rawChunk;
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    const jsonStr = line.slice(6);
                    if (!jsonStr.trim()) { continue; }

                    try {
                        const data = JSON.parse(jsonStr);
                        deps.outputChannel.appendLine(
                            `[Agentic] TRACE: Parsed event - keys: ${Object.keys(data).join(', ')}`
                        );

                        if (data.content) {
                            deps.postMessage({ type: 'streamChunk', payload: { content: data.content } });
                        }
                        if (data.toolUse) {
                            deps.postMessage({ type: 'toolUse', payload: data.toolUse });
                            deps.outputChannel.appendLine(`[Agentic] Tool use: ${data.toolUse.name}`);
                        }
                        if (data.toolResult) {
                            deps.postMessage({ type: 'toolResult', payload: data.toolResult });
                            deps.outputChannel.appendLine(
                                `[Agentic] Tool result: ${data.toolResult.name} - ${data.toolResult.success ? 'success' : 'error'}`
                            );
                        }
                        if (data.error) {
                            deps.postMessage({ type: 'streamError', payload: { error: data.error } });
                        }
                        if (data.done) {
                            deps.postMessage({
                                type: 'streamEnd',
                                payload: { conversationId: data.conversationId, iterations: data.iterations },
                            });
                        }
                    } catch {
                        // Skip invalid JSON
                    }
                }
            }
        }
    } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'Unknown error';
        deps.outputChannel.appendLine(`[Agentic] Error: ${errorMsg}`);
        deps.postMessage({ type: 'streamError', payload: { error: errorMsg } });
    }
}

// ============================================
// STANDARD MESSAGE (sidebar ChatViewProvider)
// ============================================

export async function sendMessage(deps: MessagingDeps, message: string): Promise<void> {
    const config = vscode.workspace.getConfiguration('enterprise-ai-chat');
    const useDirectClaude = config.get<boolean>('useDirectClaude') ?? false;
    const claudeAuthMode = config.get<string>('claudeAuthMode') || 'pro';
    const claudeApiKey = config.get<string>('claudeApiKey') || '';

    // Check authentication based on mode
    if (useDirectClaude) {
        if (claudeAuthMode === 'pro') {
            const storedToken = deps.context.globalState.get<string>('claudeOAuthToken');
            if (!storedToken) {
                const action = await vscode.window.showWarningMessage(
                    'Effettua il login con Claude Pro per continuare',
                    'Login Claude Pro'
                );
                if (action === 'Login Claude Pro') {
                    vscode.commands.executeCommand('enterprise-ai-chat.loginClaudePro');
                }
                return;
            }
            deps.claudeOAuthToken = storedToken;
        } else {
            if (!claudeApiKey) {
                const action = await vscode.window.showWarningMessage(
                    'Configura la tua API key Claude nelle impostazioni',
                    'Configura'
                );
                if (action === 'Configura') {
                    vscode.commands.executeCommand('workbench.action.openSettings', 'enterprise-ai-chat.claudeApiKey');
                }
                return;
            }
        }
    } else if (!deps.accessToken) {
        vscode.window.showWarningMessage('Effettua il login per continuare');
        return;
    }

    deps.messages.push({ role: 'user', content: message, timestamp: new Date() });
    deps.setLoading(true);
    deps.updateView();

    try {
        let systemPrompt = `Sei un assistente AI per sviluppatori. Rispondi in italiano. Usa blocchi di codice markdown quando appropriato.`;

        if (deps.fileContexts.length > 0) {
            systemPrompt += '\n\nFile nel contesto:';
            for (const fc of deps.fileContexts) {
                systemPrompt += `\n\n--- ${fc.name} ---\n\`\`\`${fc.language}\n${fc.content.substring(0, 5000)}\n\`\`\``;
            }
        }

        let content: string;

        if (useDirectClaude) {
            const token = claudeAuthMode === 'pro' ? deps.claudeOAuthToken! : claudeApiKey;
            content = await callClaudeDirectly(deps, token, message, systemPrompt, config);
        } else {
            content = await callBackendServer(deps, message, systemPrompt, config);
        }

        deps.messages.push({ role: 'assistant', content, timestamp: new Date() });
    } catch (error: any) {
        const errorMessage = error.message || 'Errore sconosciuto';
        deps.messages.push({ role: 'assistant', content: `Errore: ${errorMessage}`, timestamp: new Date() });
    } finally {
        deps.setLoading(false);
        deps.updateView();
    }
}

// ============================================
// PLAYGROUND MESSAGE
// ============================================

export async function sendMessageWithSettings(
    deps: MessagingDeps,
    message: string,
    settings: PlaygroundSettings
): Promise<void> {
    const originalSettings = { ...deps.playgroundSettings };
    deps.playgroundSettings = settings;

    deps.messages.push({ role: 'user', content: message, timestamp: new Date() });
    deps.setLoading(true);
    deps.updateView();

    try {
        const config = vscode.workspace.getConfiguration('enterprise-ai-chat');
        const useDirectClaude = config.get<boolean>('useDirectClaude') ?? false;

        let content: string;

        if (useDirectClaude) {
            const claudeApiKey = config.get<string>('claudeApiKey') || '';
            content = await callClaudeWithPlayground(claudeApiKey, message, settings, config);
        } else {
            content = await callBackendWithPlayground(deps, message, settings);
        }

        deps.messages.push({ role: 'assistant', content, timestamp: new Date() });
    } catch (error: any) {
        deps.messages.push({ role: 'assistant', content: `Errore: ${error.message}`, timestamp: new Date() });
    } finally {
        deps.setLoading(false);
        Object.assign(deps.playgroundSettings, originalSettings);
        deps.updateView();
    }
}

// ============================================
// INTERNAL API CALLERS
// ============================================

async function callClaudeDirectly(
    deps: MessagingDeps,
    token: string,
    message: string,
    systemPrompt: string,
    config: vscode.WorkspaceConfiguration
): Promise<string> {
    const model = config.get<string>('claudeModel') || 'claude-sonnet-4-20250514';

    const conversationMessages = deps.messages
        .filter(m => m.role !== 'system')
        .slice(-20)
        .map(m => ({
            role: m.role as 'user' | 'assistant',
            content: m.content,
        }));

    conversationMessages.push({ role: 'user', content: message });

    const isOAuthToken = token.startsWith('sk-ant-oat');

    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01',
    };

    if (isOAuthToken) {
        headers['Authorization'] = `Bearer ${token}`;
        headers['anthropic-beta'] = 'oauth-2025-04-20';
    } else {
        headers['x-api-key'] = token;
    }

    const response = await axios.post(CLAUDE_API_URL, {
        model,
        max_tokens: 4096,
        system: systemPrompt,
        messages: conversationMessages,
    }, { headers });

    const textBlock = response.data.content?.find((block: { type: string; text?: string }) => block.type === 'text');
    return textBlock?.text || 'Nessuna risposta';
}

async function callBackendServer(
    deps: MessagingDeps,
    message: string,
    systemPrompt: string,
    config: vscode.WorkspaceConfiguration
): Promise<string> {
    const model = deps.selectedModel || config.get<string>('defaultModel') || 'gpt-4o';
    deps.outputChannel.appendLine(`Calling backend with model: ${model}`);
    deps.outputChannel.appendLine(`Auth header set: ${!!deps.api.defaults.headers.common['Authorization']}`);
    deps.outputChannel.appendLine(
        `Access token: ${deps.accessToken ? 'Present (' + deps.accessToken.substring(0, 20) + '...)' : 'Missing'}`
    );

    const response = await deps.api.post('/api/chat/completions', {
        model,
        message,
        systemPrompt,
    }, {
        responseType: 'text',
        headers: {
            'Accept': 'text/event-stream',
            'Authorization': `Bearer ${deps.accessToken}`,
        },
    });

    let fullContent = '';
    const lines = response.data.split('\n');
    for (const line of lines) {
        if (line.startsWith('data: ')) {
            try {
                const data = JSON.parse(line.slice(6));
                if (data.content) { fullContent += data.content; }
            } catch {
                // Ignore parse errors
            }
        }
    }

    return fullContent || 'Nessuna risposta';
}

async function callClaudeWithPlayground(
    apiKey: string,
    message: string,
    settings: PlaygroundSettings,
    config: vscode.WorkspaceConfiguration
): Promise<string> {
    const model = config.get<string>('claudeModel') || 'claude-sonnet-4-20250514';

    const response = await axios.post(CLAUDE_API_URL, {
        model,
        max_tokens: settings.maxTokens,
        temperature: settings.temperature,
        top_p: settings.topP,
        messages: [{ role: 'user', content: message }],
    }, {
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
        },
    });

    const textBlock = response.data.content?.find((block: { type: string; text?: string }) => block.type === 'text');
    return textBlock?.text || 'Nessuna risposta';
}

async function callBackendWithPlayground(
    deps: MessagingDeps,
    message: string,
    settings: PlaygroundSettings
): Promise<string> {
    const model = deps.selectedModel || 'gpt-4o';

    const response = await deps.api.post('/api/chat/completions', {
        model,
        message,
        temperature: settings.temperature,
        max_tokens: settings.maxTokens,
        top_p: settings.topP,
        frequency_penalty: settings.frequencyPenalty,
        presence_penalty: settings.presencePenalty,
    }, {
        responseType: 'text',
        headers: {
            'Accept': 'text/event-stream',
            'Authorization': `Bearer ${deps.accessToken}`,
        },
    });

    let fullContent = '';
    const lines = response.data.split('\n');
    for (const line of lines) {
        if (line.startsWith('data: ')) {
            try {
                const data = JSON.parse(line.slice(6));
                if (data.content) { fullContent += data.content; }
            } catch {
                // Ignore parse errors
            }
        }
    }
    return fullContent || 'Nessuna risposta';
}
