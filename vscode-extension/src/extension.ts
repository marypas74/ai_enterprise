import * as vscode from 'vscode';
import axios, { AxiosInstance } from 'axios';
import * as path from 'path';
import * as https from 'https';
import * as crypto from 'crypto';
import { ClaudeCodePanel } from './ClaudeCodePanel';
import {
    AgentSessionsProvider,
    TerminalSlotsProvider,
    AgentDashboardProvider,
    AgentApiService,
    registerAgentCommands
} from './AgentPanel';

// Self-signed certificate support: use httpsAgent per-instance instead of disabling globally
// The httpsAgent with rejectUnauthorized:false is applied only to the enterprise server axios instance
const selfSignedHttpsAgent = new https.Agent({ rejectUnauthorized: false });

// Claude OAuth Configuration (for Pro/Max subscriptions)
const CLAUDE_OAUTH_CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e'; // Official Claude Code client
const CLAUDE_OAUTH_AUTHORIZE_URL = 'https://claude.ai/oauth/authorize';
const CLAUDE_OAUTH_TOKEN_URL = 'https://console.anthropic.com/v1/oauth/token';
const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';

// ============================================
// TYPES & INTERFACES
// ============================================

interface ChatMessage {
    role: 'user' | 'assistant' | 'system';
    content: string;
    timestamp: Date;
}

interface AvailableModel {
    id: string;
    name: string;
    provider: string;
}

// ============================================
// AI TOOLKIT FEATURES - Model Playground
// ============================================

interface PlaygroundSettings {
    temperature: number;
    maxTokens: number;
    topP: number;
    frequencyPenalty: number;
    presencePenalty: number;
    stopSequences: string[];
}

// ============================================
// AI TOOLKIT FEATURES - Prompt Builder
// ============================================

interface PromptTemplate {
    id: string;
    name: string;
    description: string;
    template: string;
    variables: string[];
    category: 'code' | 'debug' | 'refactor' | 'document' | 'test' | 'custom';
    chainNext?: string; // For prompt chaining
}

// ============================================
// CUSTOM INSTRUCTIONS LOADER
// ============================================

/**
 * Load custom instructions from workspace files
 * Searches for .github/copilot-instructions.md, .enterprise-ai/instructions.md, STYLE.md, .cursorrules
 */
async function loadCustomInstructions(): Promise<string | null> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) return null;

    const instructionPaths = [
        '.github/copilot-instructions.md',
        '.enterprise-ai/instructions.md',
        'STYLE.md',
        '.cursorrules',
        '.ai-instructions.md'
    ];

    for (const folder of workspaceFolders) {
        for (const instructionPath of instructionPaths) {
            const fullPath = vscode.Uri.joinPath(folder.uri, instructionPath);
            try {
                const content = await vscode.workspace.fs.readFile(fullPath);
                const text = new TextDecoder().decode(content);
                outputChannel.appendLine(`Loaded custom instructions from: ${instructionPath}`);
                return text;
            } catch {
                // File doesn't exist, try next
                continue;
            }
        }
    }

    return null;
}

// Cache for custom instructions
let cachedCustomInstructions: string | null = null;
let customInstructionsLoaded = false;

/**
 * Get cached custom instructions or load them
 */
async function getCustomInstructions(): Promise<string | null> {
    if (!customInstructionsLoaded) {
        cachedCustomInstructions = await loadCustomInstructions();
        customInstructionsLoaded = true;
    }
    return cachedCustomInstructions;
}

// Watch for changes to instruction files
vscode.workspace.onDidSaveTextDocument((document) => {
    const fileName = document.fileName;
    if (fileName.includes('instructions') || fileName.includes('STYLE.md') || fileName.includes('.cursorrules')) {
        customInstructionsLoaded = false; // Force reload on next use
        outputChannel.appendLine('Custom instructions file changed, will reload on next request');
    }
});

// Built-in prompt templates (like AI Toolkit's Agent Builder)
const PROMPT_TEMPLATES: PromptTemplate[] = [
    {
        id: 'explain-code',
        name: 'Explain Code',
        description: 'Detailed code explanation with complexity analysis',
        template: `Analyze and explain the following {{language}} code from file "{{filename}}":

\`\`\`{{language}}
{{code}}
\`\`\`

Please provide:
1. **Purpose**: What does this code do?
2. **Key Components**: Break down the main parts
3. **Complexity**: Time and space complexity analysis
4. **Potential Issues**: Any bugs or improvements`,
        variables: ['language', 'filename', 'code'],
        category: 'code'
    },
    {
        id: 'fix-bugs',
        name: 'Fix Bugs',
        description: 'Identify and fix bugs with explanations',
        template: `Review this {{language}} code for bugs and issues:

\`\`\`{{language}}
{{code}}
\`\`\`

{{error_context}}

Please:
1. Identify all bugs and issues
2. Explain why each is problematic
3. Provide the corrected code
4. Suggest preventive measures`,
        variables: ['language', 'code', 'error_context'],
        category: 'debug'
    },
    {
        id: 'refactor-clean',
        name: 'Refactor & Clean',
        description: 'Improve code quality and readability',
        template: `Refactor the following {{language}} code for better quality:

\`\`\`{{language}}
{{code}}
\`\`\`

Focus on:
- SOLID principles
- Clean code practices
- Performance optimization
- Readability improvements

Explain each change made.`,
        variables: ['language', 'code'],
        category: 'refactor'
    },
    {
        id: 'generate-tests',
        name: 'Generate Tests',
        description: 'Create comprehensive unit tests',
        template: `Generate comprehensive unit tests for this {{language}} code:

\`\`\`{{language}}
{{code}}
\`\`\`

Testing framework: {{test_framework}}

Include:
- Happy path tests
- Edge cases
- Error handling tests
- Mocks where needed`,
        variables: ['language', 'code', 'test_framework'],
        category: 'test'
    },
    {
        id: 'add-documentation',
        name: 'Add Documentation',
        description: 'Generate code documentation and comments',
        template: `Add comprehensive documentation to this {{language}} code:

\`\`\`{{language}}
{{code}}
\`\`\`

Documentation style: {{doc_style}}

Include:
- Function/method docstrings
- Parameter descriptions
- Return value documentation
- Usage examples`,
        variables: ['language', 'code', 'doc_style'],
        category: 'document'
    },
    {
        id: 'security-review',
        name: 'Security Review',
        description: 'Analyze code for security vulnerabilities',
        template: `Perform a security audit on this {{language}} code:

\`\`\`{{language}}
{{code}}
\`\`\`

Check for:
- OWASP Top 10 vulnerabilities
- Injection attacks
- Authentication/authorization issues
- Data exposure risks
- Input validation problems

Provide severity ratings and fixes.`,
        variables: ['language', 'code'],
        category: 'code'
    },
    {
        id: 'convert-language',
        name: 'Convert to Another Language',
        description: 'Translate code to a different programming language',
        template: `Convert this {{source_language}} code to {{target_language}}:

\`\`\`{{source_language}}
{{code}}
\`\`\`

Requirements:
- Maintain the same functionality
- Use idiomatic {{target_language}} patterns
- Handle language-specific differences
- Add comments for non-obvious translations`,
        variables: ['source_language', 'target_language', 'code'],
        category: 'code'
    },
    {
        id: 'prompt-chain-analyze-fix',
        name: 'Analyze Then Fix (Chained)',
        description: 'First analyze, then fix issues',
        template: `Step 1: Analyze this code for issues:

\`\`\`{{language}}
{{code}}
\`\`\`

List all identified issues.`,
        variables: ['language', 'code'],
        category: 'debug',
        chainNext: 'prompt-chain-fix'
    }
];

// ============================================
// AI TOOLKIT FEATURES - MCP Integration
// ============================================

interface MCPServer {
    id: string;
    name: string;
    type: 'stdio' | 'http';
    command?: string;
    url?: string;
    tools: MCPTool[];
    status: 'connected' | 'disconnected' | 'error';
}

interface MCPTool {
    name: string;
    description: string;
    inputSchema: object;
}

// ============================================
// AI TOOLKIT FEATURES - RAG / Vector Database
// ============================================

interface VectorSearchResult {
    id: string;
    content: string;
    metadata: {
        filename: string;
        filepath: string;
        language: string;
        chunk_index: number;
    };
    similarity: number;
}

interface RAGConfig {
    enabled: boolean;
    provider: 'pinecone' | 'qdrant' | 'chroma' | 'weaviate' | 'backend';
    topK: number;
    minSimilarity: number;
    includeMetadata: boolean;
}

// ============================================
// GLOBAL STATE
// ============================================

let api: AxiosInstance;
let accessToken: string | undefined;
let currentUser: { email: string; name: string } | undefined;
let outputChannel: vscode.OutputChannel;
let claudeOAuthToken: string | undefined;
let claudeRefreshToken: string | undefined;
let availableModels: AvailableModel[] = [];
let selectedModel: string | undefined;

// Agent providers - need module-level access for credential updates
let _agentSessionsProvider: AgentSessionsProvider | undefined;
let _terminalSlotsProvider: TerminalSlotsProvider | undefined;
let _agentDashboardProvider: AgentDashboardProvider | undefined;
let _agentApiService: AgentApiService | undefined;

// AI Toolkit Features - Global State (fetched from admin console)
let playgroundSettings: PlaygroundSettings = {
    temperature: 0.7,
    maxTokens: 4096,
    topP: 1.0,
    frequencyPenalty: 0,
    presencePenalty: 0,
    stopSequences: []
};
let mcpServers: MCPServer[] = [];
let adminPromptTemplates: PromptTemplate[] = []; // Admin-approved templates from backend
let aiToolkitEnabled = false; // Admin toggle for AI Toolkit features

// Kanban loading guard to prevent infinite loops - CIRCUIT BREAKER
let isLoadingProjects = false;
let projectsLoaded = false;
let lastProjectLoadTime = 0;
const PROJECT_LOAD_COOLDOWN = 5000; // 5 seconds minimum between loads

// Circuit breaker - prevents DDOS on backend
let projectLoadCallCount = 0;
let circuitBreakerWindowStart = 0;
const CIRCUIT_BREAKER_MAX_CALLS = 10; // Allow more calls before tripping
const CIRCUIT_BREAKER_WINDOW_MS = 10000; // 10 seconds window
let circuitBreakerTripped = false;
let circuitBreakerTripTime = 0;
const CIRCUIT_BREAKER_RESET_MS = 30000; // Auto-reset after 30 seconds

// RAG Configuration (fetched from admin console)
let ragConfig: RAGConfig = {
    enabled: false,
    provider: 'backend',
    topK: 5,
    minSimilarity: 0.7,
    includeMetadata: true
};

// ============================================
// PANEL-BASED HELPER FUNCTIONS
// ============================================

/**
 * Login to backend server (panel version)
 */
async function loginToBackend(context: vscode.ExtensionContext) {
    const config = vscode.workspace.getConfiguration('enterprise-ai-chat');
    const serverUrl = config.get<string>('serverUrl') || 'https://192.168.1.123';

    outputChannel.appendLine(`=== LOGIN ATTEMPT ===`);
    outputChannel.appendLine(`Server URL: ${serverUrl}`);

    const email = await vscode.window.showInputBox({
        prompt: 'Email',
        placeHolder: 'admin@enterprise.local',
        value: 'admin@enterprise.local'
    });
    if (!email) return;

    const password = await vscode.window.showInputBox({
        prompt: 'Password',
        password: true
    });
    if (!password) return;

    try {
        outputChannel.appendLine(`Attempting login for: ${email}`);

        // CRITICAL: Use /api prefix for Kubernetes Ingress routing
        const response = await api.post('/api/auth/login', { email, password });

        outputChannel.appendLine(`Login response status: ${response.status}`);
        outputChannel.appendLine(`Response data keys: ${Object.keys(response.data).join(', ')}`);

        accessToken = response.data.accessToken;
        currentUser = response.data.user;

        if (!accessToken) {
            outputChannel.appendLine('ERROR: No accessToken in response!');
            outputChannel.appendLine(`Full response: ${JSON.stringify(response.data)}`);
            vscode.window.showErrorMessage('Login failed: No access token received');
            return;
        }

        outputChannel.appendLine(`Access token received: ${accessToken.substring(0, 30)}...`);
        outputChannel.appendLine(`User: ${currentUser?.name} (${currentUser?.email})`);

        api.defaults.headers.common['Authorization'] = `Bearer ${accessToken}`;
        await context.globalState.update('accessToken', accessToken);
        await context.globalState.update('currentUser', currentUser);

        // Fetch available models from backend
        await fetchModelsForPanel(context);

        // Update panel if open
        const panel = ClaudeCodePanel.currentPanel;
        if (panel) {
            panel.setAuthenticated(true, currentUser, availableModels);
            if (selectedModel) {
                panel.updateModels(availableModels, selectedModel);
            }
        }

        // CRITICAL: Update agent providers with new credentials (fixes 401 errors)
        const config = vscode.workspace.getConfiguration('enterprise-ai-chat');
        const agentServerUrl = config.get<string>('serverUrl') || 'https://192.168.1.123';
        if (_agentSessionsProvider) {
            _agentSessionsProvider.updateCredentials(agentServerUrl, accessToken || null);
            outputChannel.appendLine('[Auth] AgentSessionsProvider credentials updated');
        }
        if (_terminalSlotsProvider) {
            _terminalSlotsProvider.updateCredentials(agentServerUrl, accessToken || null);
            outputChannel.appendLine('[Auth] TerminalSlotsProvider credentials updated');
        }
        if (_agentDashboardProvider) {
            _agentDashboardProvider.updateCredentials(agentServerUrl, accessToken || null);
            outputChannel.appendLine('[Auth] AgentDashboardProvider credentials updated');
        }
        if (_agentApiService) {
            _agentApiService.updateCredentials(agentServerUrl, accessToken || null);
            outputChannel.appendLine('[Auth] AgentApiService credentials updated');
        }

        vscode.window.showInformationMessage(`Connected as ${currentUser?.name}`);
        outputChannel.appendLine(`=== LOGIN SUCCESS ===`);
    } catch (error: any) {
        outputChannel.appendLine(`Login error: ${error.message}`);
        if (error.response) {
            outputChannel.appendLine(`Response status: ${error.response.status}`);
            outputChannel.appendLine(`Response data: ${JSON.stringify(error.response.data)}`);
        }
        vscode.window.showErrorMessage(`Login failed: ${error.response?.data?.error || error.message}`);
    }
}

/**
 * Fetch available models (panel version)
 */
async function fetchModelsForPanel(context: vscode.ExtensionContext) {
    try {
        outputChannel.appendLine('Fetching available models from backend...');
        // CRITICAL: Use /api prefix for Kubernetes Ingress routing
        const response = await api.get('/api/chat/models');
        const rawModels = response.data || [];

        availableModels = rawModels.map((m: any) => ({
            id: m.id || m.model_id || 'unknown',
            name: m.name || m.display_name || m.id || 'Unknown Model',
            provider: m.provider || m.provider_type || 'unknown'
        }));

        // Restore or set selected model
        const savedModel = context.globalState.get<string>('selectedModel');
        if (savedModel && availableModels.some(m => m.id === savedModel)) {
            selectedModel = savedModel;
        } else if (availableModels.length > 0) {
            selectedModel = availableModels[0].id;
            await context.globalState.update('selectedModel', selectedModel);
        }

        // Update panel if open
        const panel = ClaudeCodePanel.currentPanel;
        if (panel) {
            panel.updateModels(availableModels, selectedModel);
        }
    } catch (error: any) {
        outputChannel.appendLine(`Failed to fetch models: ${error.message}`);
        availableModels = [];
    }
}

/**
 * Logout from backend (panel version)
 */
async function logoutFromBackend(context: vscode.ExtensionContext) {
    accessToken = undefined;
    currentUser = undefined;
    availableModels = [];
    selectedModel = undefined;
    api.defaults.headers.common['Authorization'] = '';
    await context.globalState.update('accessToken', undefined);
    await context.globalState.update('currentUser', undefined);
    vscode.window.showInformationMessage('Logged out');
}

/**
 * Code action with panel (explain, fix, improve, tests)
 */
async function codeActionWithPanel(action: string, getPanel: () => ClaudeCodePanel) {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showWarningMessage('No active editor');
        return;
    }

    const selection = editor.selection;
    const code = editor.document.getText(selection);
    if (!code) {
        vscode.window.showWarningMessage('Select code first');
        return;
    }

    const language = editor.document.languageId;
    const prompts: Record<string, string> = {
        explain: `Explain this ${language} code:\n\n\`\`\`${language}\n${code}\n\`\`\``,
        fix: `Fix any bugs in this ${language} code:\n\n\`\`\`${language}\n${code}\n\`\`\``,
        improve: `Improve this ${language} code:\n\n\`\`\`${language}\n${code}\n\`\`\``,
        tests: `Generate tests for this ${language} code:\n\n\`\`\`${language}\n${code}\n\`\`\``
    };

    const panel = getPanel();
    panel.addMessage('user', prompts[action] || prompts.explain);

    // Trigger send message command
    vscode.commands.executeCommand('enterprise-ai-chat.sendMessage', prompts[action] || prompts.explain);
}

/**
 * Add selected code to chat panel
 */
function addToChatPanel(getPanel: () => ClaudeCodePanel) {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showWarningMessage('No active editor');
        return;
    }

    const selection = editor.selection;
    const code = editor.document.getText(selection);
    if (!code) {
        vscode.window.showWarningMessage('Select code first');
        return;
    }

    const language = editor.document.languageId;
    const panel = getPanel();
    panel.addMessage('user', `\`\`\`${language}\n${code}\n\`\`\``);
}

/**
 * Add current file to context
 */
function addFileToContextPanel(getPanel: () => ClaudeCodePanel) {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showWarningMessage('No active editor');
        return;
    }

    const content = editor.document.getText();
    const filename = editor.document.fileName.split('/').pop() || 'file';
    const language = editor.document.languageId;

    const panel = getPanel();
    panel.addMessage('user', `File: ${filename}\n\n\`\`\`${language}\n${content}\n\`\`\``);
    vscode.window.showInformationMessage(`Added ${filename} to context`);
}

/**
 * Claude Pro OAuth login (panel version)
 */
async function loginClaudeProPanel(context: vscode.ExtensionContext) {
    vscode.window.showInformationMessage(
        'Claude Pro OAuth is not fully supported for programmatic access. Please use API key authentication instead.',
        'Open Settings'
    ).then(selection => {
        if (selection === 'Open Settings') {
            vscode.commands.executeCommand('workbench.action.openSettings', 'enterprise-ai-chat.claudeApiKey');
        }
    });
}

/**
 * Handle send message from panel
 */
async function handleSendMessage(message: string, context: vscode.ExtensionContext) {
    const panel = ClaudeCodePanel.currentPanel;
    if (!panel) return;

    outputChannel.appendLine(`Sending message: ${message.substring(0, 50)}...`);

    // Check if using direct Claude API
    const config = vscode.workspace.getConfiguration('enterprise-ai-chat');
    const useDirectClaude = config.get<boolean>('useDirectClaude', false);
    const claudeApiKey = config.get<string>('claudeApiKey', '');
    const claudeModel = config.get<string>('claudeModel', 'claude-sonnet-4-20250514');

    if (useDirectClaude && claudeApiKey) {
        // Direct Claude API call with streaming
        await sendDirectClaudeMessage(message, claudeApiKey, claudeModel, panel);
    } else if (accessToken) {
        // Backend API call
        await sendBackendMessage(message, panel);
    } else {
        panel.addMessage('system', 'Please login first or configure Claude API key in settings.');
    }
}

/**
 * Handle agentic message from Kanban task execution
 * Uses /api/chat/agentic endpoint with tool support
 */
async function handleAgenticMessage(
    panel: ClaudeCodePanel,
    message: string,
    projectId: number,
    context: vscode.ExtensionContext
) {
    if (!accessToken) {
        panel.addMessage('system', 'Please login first to execute tasks.');
        vscode.commands.executeCommand('enterprise-ai-chat.login');
        return;
    }

    const config = vscode.workspace.getConfiguration('enterprise-ai-chat');
    const serverUrl = config.get<string>('serverUrl') || 'https://192.168.1.123';
    const model = config.get<string>('claudeModel') || 'claude-sonnet-4-20250514';

    outputChannel.appendLine(`[Agentic Panel] Starting: message=${message.substring(0, 50)}..., projectId=${projectId}, model=${model}`);

    // Notify webview that we're starting
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
            enableTools: true
        });

        const options = {
            hostname: url.hostname,
            port: url.port || 443,
            path: url.pathname,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${accessToken}`,
                'Accept': 'text/event-stream',
                'Content-Length': Buffer.byteLength(requestBody),
            },
            rejectUnauthorized: false,
        };

        const req = https.request(options, (res: any) => {
            outputChannel.appendLine(`[Agentic Panel] Response status: ${res.statusCode}`);

            if (res.statusCode !== 200) {
                let errorBody = '';
                res.on('data', (chunk: Buffer) => { errorBody += chunk.toString(); });
                res.on('end', () => {
                    panel.streamEnd();
                    let errorMsg = `Server error: ${res.statusCode}`;
                    try {
                        const parsed = JSON.parse(errorBody);
                        errorMsg = parsed.error || parsed.message || errorMsg;
                    } catch { }
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
                        if (!jsonStr) continue;

                        try {
                            const data = JSON.parse(jsonStr);
                            chunkCount++;
                            outputChannel.appendLine(`[Agentic Panel] Chunk #${chunkCount}: keys=${Object.keys(data).join(',')}`);

                            if (data.content) {
                                panel.streamChunk(data.content);
                            }
                            if (data.error) {
                                panel.streamError(data.error);
                            }
                            if (data.done) {
                                panel.streamEnd();
                            }
                        } catch (e) {
                            // Skip invalid JSON
                        }
                    }
                }
            });

            res.on('end', () => {
                outputChannel.appendLine(`[Agentic Panel] Stream ended, ${chunkCount} chunks received`);
                panel.streamEnd();
            });

            res.on('error', (err: Error) => {
                outputChannel.appendLine(`[Agentic Panel] Response error: ${err.message}`);
                panel.streamError(err.message);
            });
        });

        req.on('error', (err: Error) => {
            outputChannel.appendLine(`[Agentic Panel] Request error: ${err.message}`);
            panel.streamError(err.message);
        });

        req.write(requestBody);
        req.end();

    } catch (error: any) {
        outputChannel.appendLine(`[Agentic Panel] Error: ${error.message}`);
        panel.streamError(error.message);
    }
}

/**
 * Send message via direct Claude API
 */
async function sendDirectClaudeMessage(
    message: string,
    apiKey: string,
    model: string,
    panel: ClaudeCodePanel
) {
    panel.streamStart();

    try {
        const Anthropic = require('@anthropic-ai/sdk');
        const anthropic = new Anthropic({ apiKey });

        const stream = await anthropic.messages.stream({
            model: model,
            max_tokens: 4096,
            messages: [{ role: 'user', content: message }]
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
 *
 * SSE Response Format:
 *   data: {"content": "chunk", "done": false}
 *   data: {"content": "", "done": true, "conversationId": 123}
 */
async function sendBackendMessage(message: string, panel: ClaudeCodePanel) {
    // Check authentication first
    if (!accessToken) {
        outputChannel.appendLine('ERROR: No access token available');
        panel.addMessage('system', 'Not authenticated. Please login first.');
        vscode.commands.executeCommand('enterprise-ai-chat.login');
        return;
    }

    outputChannel.appendLine(`Access token present: ${accessToken.substring(0, 20)}...`);

    panel.streamStart();

    const config = vscode.workspace.getConfiguration('enterprise-ai-chat');
    const serverUrl = config.get<string>('serverUrl') || 'https://192.168.1.123';

    // CRITICAL: Construct URL with /api prefix for Ingress routing
    const apiUrl = `${serverUrl.replace(/\/+$/, '')}/api/chat/completions`;

    outputChannel.appendLine(`SSE Request to: ${apiUrl}`);
    outputChannel.appendLine(`Model: ${selectedModel}`);
    outputChannel.appendLine(`Token: Bearer ${accessToken.substring(0, 30)}...`);

    try {
        // Load custom instructions from workspace
        const customInstructions = await getCustomInstructions();
        if (customInstructions) {
            outputChannel.appendLine(`Using custom instructions (${customInstructions.length} chars)`);
        }

        // Use native https for SSE streaming
        const https = require('https');
        const url = new URL(apiUrl);

        const requestBody = JSON.stringify({
            message: message,
            model: selectedModel || 'gpt-4o',
            systemPrompt: customInstructions || undefined,
            // conversationId can be added for continuing conversations
        });

        const options = {
            hostname: url.hostname,
            port: url.port || 443,
            path: url.pathname,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${accessToken}`,
                'Accept': 'text/event-stream',
                'Content-Length': Buffer.byteLength(requestBody),
            },
            rejectUnauthorized: false, // Allow self-signed certs
        };

        const req = https.request(options, (res: any) => {
            outputChannel.appendLine(`Response status: ${res.statusCode}`);

            // Handle non-200 responses
            if (res.statusCode !== 200) {
                let errorBody = '';
                res.on('data', (chunk: Buffer) => { errorBody += chunk.toString(); });
                res.on('end', () => {
                    panel.streamEnd();
                    let errorMsg = `Server error: ${res.statusCode}`;

                    // Try to parse JSON error response
                    try {
                        const parsed = JSON.parse(errorBody);
                        errorMsg = parsed.error || parsed.message || errorMsg;
                    } catch {
                        // If it's HTML (nginx error page), don't show raw HTML
                        if (errorBody.includes('<html') || errorBody.includes('<!DOCTYPE')) {
                            outputChannel.appendLine(`HTML error response received: ${errorBody.substring(0, 200)}...`);
                            // Keep the status code message, don't show HTML
                        } else if (errorBody && errorBody.length < 200) {
                            errorMsg = errorBody;
                        }
                    }

                    // User-friendly error messages based on status code
                    if (res.statusCode === 404) {
                        errorMsg = 'Endpoint not found. Check that backend is running and Ingress is configured.';
                    } else if (res.statusCode === 502) {
                        errorMsg = 'Backend service unavailable. Check that pods are running.';
                    } else if (res.statusCode === 504) {
                        errorMsg = 'Request timed out. The AI service may be overloaded or unreachable.';
                    } else if (res.statusCode === 401) {
                        errorMsg = 'Session expired. Please login again.';
                        // Clear invalid token and trigger re-login
                        accessToken = undefined;
                        outputChannel.appendLine('Token invalid/expired - clearing auth state');
                        vscode.commands.executeCommand('enterprise-ai-chat.login');
                    } else if (res.statusCode === 503) {
                        errorMsg = 'Service temporarily unavailable. Please try again later.';
                    }

                    panel.addMessage('system', errorMsg);
                });
                return;
            }

            // Get conversation ID from header
            const conversationId = res.headers['x-conversation-id'];
            let buffer = '';

            res.on('data', (chunk: Buffer) => {
                buffer += chunk.toString();

                // Process complete SSE lines
                const lines = buffer.split('\n');
                buffer = lines.pop() || ''; // Keep incomplete line

                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        const jsonStr = line.slice(6).trim();
                        if (jsonStr) {
                            try {
                                const data = JSON.parse(jsonStr);
                                if (data.content) {
                                    outputChannel.appendLine(`[Stream] Chunk received: ${data.content.length} chars`);
                                    panel.streamChunk(data.content);
                                }
                                if (data.error) {
                                    outputChannel.appendLine(`[Stream] Error from backend: ${data.error}`);
                                    panel.addMessage('system', data.error);
                                }
                                if (data.done) {
                                    outputChannel.appendLine(`[Stream] Complete. ConvID: ${data.conversationId || conversationId}`);
                                }
                            } catch (parseErr) {
                                outputChannel.appendLine(`[Stream] SSE parse error: ${jsonStr}`);
                            }
                        }
                    }
                }
            });

            res.on('end', () => {
                panel.streamEnd();
                outputChannel.appendLine('[Stream] SSE stream ended successfully');
            });

            res.on('error', (error: Error) => {
                outputChannel.appendLine(`[Stream] Response error: ${error.message}`);
                panel.streamError(`Stream interrupted: ${error.message}`);
            });
        });

        req.on('error', (error: Error) => {
            outputChannel.appendLine(`[Stream] Request error: ${error.message}`);

            // User-friendly connection errors
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
        outputChannel.appendLine(`[Stream] Backend API error: ${error.message}`);
        panel.streamError(`Error: ${error.message}`);
    }
}

// ============================================
// ACTIVATION
// ============================================

export function activate(context: vscode.ExtensionContext) {
    outputChannel = vscode.window.createOutputChannel('Enterprise AI Chat');
    // Don't force show output channel on activation for better UX
    outputChannel.appendLine('='.repeat(50));
    outputChannel.appendLine('Extension activating at ' + new Date().toISOString());
    outputChannel.appendLine('='.repeat(50));

    // Copilot Coexistence Detection
    const copilotExtension = vscode.extensions.getExtension('GitHub.copilot');
    const copilotChatExtension = vscode.extensions.getExtension('GitHub.copilot-chat');
    if (copilotExtension || copilotChatExtension) {
        outputChannel.appendLine('GitHub Copilot detected - running in coexistence mode');
        outputChannel.appendLine('  - Copilot: ' + (copilotExtension ? 'Active' : 'Not installed'));
        outputChannel.appendLine('  - Copilot Chat: ' + (copilotChatExtension ? 'Active' : 'Not installed'));
        // Note: This extension uses different keybindings to avoid conflicts
        // Enterprise AI Chat: Ctrl+Shift+L, Ctrl+Shift+A
        // GitHub Copilot: Ctrl+Alt+I, Ctrl+I, Alt+[/]
    }

    try {
        initializeApi();
        outputChannel.appendLine('API initialized successfully');
    } catch (e: any) {
        outputChannel.appendLine('ERROR: API init failed: ' + e.message);
        vscode.window.showErrorMessage('Enterprise AI Chat: API init error - ' + e.message);
    }

    // Flag to track if session is being validated
    let isValidatingSession = false;

    // Function to clear session on 401
    const clearSessionOnUnauthorized = () => {
        outputChannel.appendLine('Session expired or invalid (401), clearing credentials');
        context.globalState.update('accessToken', undefined);
        context.globalState.update('currentUser', undefined);
        accessToken = undefined;
        currentUser = undefined;
        delete api.defaults.headers.common['Authorization'];

        // Force panel to show login
        const panel = ClaudeCodePanel.currentPanel;
        if (panel) {
            panel.setAuthenticated(false);
        }
    };

    // Add axios interceptor to handle 401 globally
    api.interceptors.response.use(
        response => response,
        error => {
            if (error.response?.status === 401) {
                clearSessionOnUnauthorized();
            }
            return Promise.reject(error);
        }
    );

    // Restore session - but validate token first
    const savedToken = context.globalState.get<string>('accessToken');
    const savedUser = context.globalState.get<{ email: string; name: string }>('currentUser');

    // IMPORTANT: Do NOT set accessToken until validation passes
    // This prevents the UI from showing authenticated state before we're sure
    if (savedToken && savedUser) {
        isValidatingSession = true;
        outputChannel.appendLine('Validating saved session...');
        api.get('/api/auth/me', {
            headers: { 'Authorization': `Bearer ${savedToken}` }
        }).then(testResponse => {
            if (testResponse.data && testResponse.data.user) {
                // Only NOW set the credentials after validation
                accessToken = savedToken;
                currentUser = testResponse.data.user;
                api.defaults.headers.common['Authorization'] = `Bearer ${accessToken}`;
                outputChannel.appendLine(`Session validated and restored for: ${currentUser?.email}`);

                // Update panel if open
                const panel = ClaudeCodePanel.currentPanel;
                if (panel) {
                    panel.setAuthenticated(true, currentUser, availableModels);
                }
            } else {
                outputChannel.appendLine('Session validation failed: no user in response');
                clearSessionOnUnauthorized();
            }
        }).catch((error: any) => {
            outputChannel.appendLine(`Saved session invalid (${error.message}), clearing credentials`);
            clearSessionOnUnauthorized();
        }).finally(() => {
            isValidatingSession = false;
        });
    }

    // Restore Claude Pro OAuth token
    claudeOAuthToken = context.globalState.get<string>('claudeOAuthToken');
    claudeRefreshToken = context.globalState.get<string>('claudeRefreshToken');
    outputChannel.appendLine('Claude Pro token restored: ' + (claudeOAuthToken ? 'Yes' : 'No'));

    // ============================================
    // AUTO-CLAUDE AGENT PANEL SETUP
    // ============================================
    const config = vscode.workspace.getConfiguration('enterprise-ai-chat');
    const agentServerUrl = config.get<string>('serverUrl') || 'https://192.168.1.123';

    // Initialize agent providers and assign to module-level variables
    const agentSessionsProvider = new AgentSessionsProvider(agentServerUrl, savedToken || null);
    const terminalSlotsProvider = new TerminalSlotsProvider(agentServerUrl, savedToken || null);
    const agentDashboardProvider = new AgentDashboardProvider(
        context.extensionUri,
        agentServerUrl,
        savedToken || null
    );
    const agentApiService = new AgentApiService(agentServerUrl, savedToken || null);

    // Store references for credential updates after login
    _agentSessionsProvider = agentSessionsProvider;
    _terminalSlotsProvider = terminalSlotsProvider;
    _agentDashboardProvider = agentDashboardProvider;
    _agentApiService = agentApiService;

    // Register tree views
    context.subscriptions.push(
        vscode.window.registerTreeDataProvider('enterprise-ai-chat.agentSessions', agentSessionsProvider),
        vscode.window.registerTreeDataProvider('enterprise-ai-chat.terminalSlots', terminalSlotsProvider),
        vscode.window.registerWebviewViewProvider('enterprise-ai-chat.agentDashboard', agentDashboardProvider)
    );

    // Register agent commands
    registerAgentCommands(
        context,
        agentSessionsProvider,
        terminalSlotsProvider,
        agentDashboardProvider,
        agentApiService
    );

    // Refresh agent data periodically
    const agentRefreshInterval = setInterval(() => {
        agentSessionsProvider.refresh();
        terminalSlotsProvider.refresh();
        agentDashboardProvider.refresh();
    }, 30000); // Every 30 seconds

    context.subscriptions.push({
        dispose: () => clearInterval(agentRefreshInterval)
    });

    // Initial load
    agentSessionsProvider.refresh();
    terminalSlotsProvider.refresh();

    outputChannel.appendLine('Auto-Claude Agent Panel initialized');

    // Register Chat Webview Provider
    outputChannel.appendLine('Setting up Claude Code panel commands...');

    // Note: We no longer use WebviewViewProvider (sidebar).
    // All chat interactions go through ClaudeCodePanel (editor tab).

    // Helper function for Kanban column colors
    const getColumnColor = (columnName: string): string => {
        const colors: Record<string, string> = {
            'Backlog': '#6B7280',
            'To Do': '#6B7280',
            'In Progress': '#F59E0B',
            'Review': '#8B5CF6',
            'Done': '#10B981',
            'Completato': '#10B981'
        };
        return colors[columnName] || '#6B7280';
    };

    // Helper function to get or create the Enterprise AI panel
    const getPanel = () => {
        const panel = ClaudeCodePanel.createOrShow(context.extensionUri);
        // Only set authenticated if we have a validated token
        if (accessToken && currentUser) {
            // Verify token is still valid before setting authenticated
            api.get('/api/auth/me', {
                headers: { 'Authorization': `Bearer ${accessToken}` }
            }).then(() => {
                panel.setAuthenticated(true, currentUser!, availableModels);
                if (selectedModel) {
                    panel.updateModels(availableModels, selectedModel);
                }
            }).catch(() => {
                // Token invalid, clear and show login
                outputChannel.appendLine('Token expired, showing login screen');
                accessToken = undefined;
                currentUser = undefined;
                context.globalState.update('accessToken', undefined);
                context.globalState.update('currentUser', undefined);
                panel.setAuthenticated(false);
            });
        } else {
            // No credentials, show login screen
            panel.setAuthenticated(false);
        }
        return panel;
    };

    // Register Commands - All use ClaudeCodePanel (Editor Tab)
    context.subscriptions.push(
        // Open Enterprise AI Panel (main entry point)
        vscode.commands.registerCommand('enterprise-ai-chat.openAIPanel', getPanel),

        // Alias: openChat also opens the panel
        vscode.commands.registerCommand('enterprise-ai-chat.openChat', () => {
            outputChannel.appendLine('openChat command called - opening Enterprise AI panel');
            getPanel();
        }),

        // New chat - clears messages in panel
        vscode.commands.registerCommand('enterprise-ai-chat.newChat', () => {
            const panel = ClaudeCodePanel.currentPanel;
            if (panel) {
                panel.postMessage({ type: 'clearMessages' });
            }
        }),

        // Login command
        vscode.commands.registerCommand('enterprise-ai-chat.login', async () => {
            await loginToBackend(context);
            const panel = ClaudeCodePanel.currentPanel;
            if (panel && accessToken && currentUser) {
                panel.setAuthenticated(true, currentUser, availableModels);
            }
        }),

        // Logout command
        vscode.commands.registerCommand('enterprise-ai-chat.logout', async () => {
            await logoutFromBackend(context);
            const panel = ClaudeCodePanel.currentPanel;
            if (panel) {
                panel.setAuthenticated(false);
            }
        }),

        // Code actions - open panel and send selected code
        vscode.commands.registerCommand('enterprise-ai-chat.explainCode', () => codeActionWithPanel('explain', getPanel)),
        vscode.commands.registerCommand('enterprise-ai-chat.fixCode', () => codeActionWithPanel('fix', getPanel)),
        vscode.commands.registerCommand('enterprise-ai-chat.improveCode', () => codeActionWithPanel('improve', getPanel)),
        vscode.commands.registerCommand('enterprise-ai-chat.generateTests', () => codeActionWithPanel('tests', getPanel)),

        // Add to chat
        vscode.commands.registerCommand('enterprise-ai-chat.addToChat', () => addToChatPanel(getPanel)),

        // Add file to context
        vscode.commands.registerCommand('enterprise-ai-chat.addFileToContext', () => addFileToContextPanel(getPanel)),

        // ============================================
        // INLINE EDIT (Cursor Ctrl+K Style)
        // ============================================
        vscode.commands.registerCommand('enterprise-ai-chat.inlineEdit', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                vscode.window.showWarningMessage('No active editor');
                return;
            }

            const selection = editor.selection;
            const selectedText = editor.document.getText(selection);

            if (!selectedText || selectedText.trim() === '') {
                vscode.window.showWarningMessage('Please select code to edit');
                return;
            }

            // Show input box for instruction
            const instruction = await vscode.window.showInputBox({
                prompt: 'Describe the change you want to make',
                placeHolder: 'e.g., Add error handling, Convert to async/await, Add comments...',
                ignoreFocusOut: true
            });

            if (!instruction) return;

            try {
                // Show progress
                await vscode.window.withProgress({
                    location: vscode.ProgressLocation.Notification,
                    title: 'Generating code edit...',
                    cancellable: false
                }, async () => {
                    // Load custom instructions
                    const customInstructions = await getCustomInstructions();
                    let systemPrompt = `You are a code editor assistant. When given code and an instruction, output ONLY the modified code without any explanation, markdown formatting, or code blocks. Output the raw code only.`;

                    // Append custom instructions if available
                    if (customInstructions) {
                        systemPrompt += `\n\nProject-specific coding guidelines:\n${customInstructions}`;
                    }

                    // Call API to generate edit
                    const response = await api.post('/api/chat/completions', {
                        model: selectedModel || 'gpt-4o',
                        messages: [
                            {
                                role: 'system',
                                content: systemPrompt
                            },
                            {
                                role: 'user',
                                content: `Modify this ${editor.document.languageId} code according to the instruction.

Code:
${selectedText}

Instruction: ${instruction}

Output only the modified code, nothing else:`
                            }
                        ],
                        temperature: 0.3,
                        max_tokens: 4096
                    });

                    const newCode = response.data.choices?.[0]?.message?.content?.trim() || '';

                    if (!newCode) {
                        vscode.window.showErrorMessage('Failed to generate code edit');
                        return;
                    }

                    // Show diff and ask for confirmation
                    const accept = await vscode.window.showInformationMessage(
                        'Apply the AI-generated edit?',
                        { modal: true, detail: `Original:\n${selectedText.substring(0, 100)}...\n\nNew:\n${newCode.substring(0, 100)}...` },
                        'Apply',
                        'Cancel'
                    );

                    if (accept === 'Apply') {
                        await editor.edit(editBuilder => {
                            editBuilder.replace(selection, newCode);
                        });
                        vscode.window.showInformationMessage('Code updated successfully');
                    }
                });
            } catch (error: any) {
                outputChannel.appendLine(`Inline edit error: ${error.message}`);
                vscode.window.showErrorMessage(`Failed to generate edit: ${error.message}`);
            }
        }),

        // ============================================
        // CONTEXT TAGGING (@workspace, @file, @selection)
        // ============================================
        vscode.commands.registerCommand('enterprise-ai-chat.chatWithContext', async () => {
            const editor = vscode.window.activeTextEditor;

            // Build context options
            const contextOptions = [
                { label: '@selection', description: 'Include selected code', picked: !!editor?.selection && !editor.selection.isEmpty },
                { label: '@file', description: 'Include current file', picked: !!editor },
                { label: '@workspace', description: 'Include workspace info', picked: false }
            ];

            const selectedContexts = await vscode.window.showQuickPick(contextOptions, {
                canPickMany: true,
                placeHolder: 'Select context to include in chat',
                title: 'Chat Context'
            });

            if (!selectedContexts || selectedContexts.length === 0) return;

            // Ask for the message
            const message = await vscode.window.showInputBox({
                prompt: 'Enter your message',
                placeHolder: 'What would you like to ask?',
                ignoreFocusOut: true
            });

            if (!message) return;

            // Build context string
            let contextString = '';

            for (const ctx of selectedContexts) {
                if (ctx.label === '@selection' && editor) {
                    const selectedText = editor.document.getText(editor.selection);
                    contextString += `\n\n[Selected Code from ${editor.document.fileName}]\n\`\`\`${editor.document.languageId}\n${selectedText}\n\`\`\``;
                }
                if (ctx.label === '@file' && editor) {
                    const fileContent = editor.document.getText();
                    contextString += `\n\n[File: ${editor.document.fileName}]\n\`\`\`${editor.document.languageId}\n${fileContent}\n\`\`\``;
                }
                if (ctx.label === '@workspace') {
                    const workspaceFolders = vscode.workspace.workspaceFolders;
                    if (workspaceFolders) {
                        contextString += `\n\n[Workspace: ${workspaceFolders[0].name}]`;
                    }
                }
            }

            // Send to chat panel
            const panel = getPanel();
            panel.addMessage('user', `${message}\n${contextString}`);
        }),

        // Settings
        vscode.commands.registerCommand('enterprise-ai-chat.configure', () => {
            vscode.commands.executeCommand('workbench.action.openSettings', 'enterprise-ai-chat');
        }),

        // Claude Pro login
        vscode.commands.registerCommand('enterprise-ai-chat.loginClaudePro', () => loginClaudeProPanel(context)),

        // AI Toolkit Commands (simplified - just open panel)
        vscode.commands.registerCommand('enterprise-ai-chat.useTemplate', () => {
            vscode.window.showInformationMessage('Prompt templates available in Enterprise AI panel');
            getPanel();
        }),
        vscode.commands.registerCommand('enterprise-ai-chat.openPlayground', () => {
            vscode.window.showInformationMessage('Model Playground available in Enterprise AI panel');
            getPanel();
        }),
        vscode.commands.registerCommand('enterprise-ai-chat.ragSearch', async () => {
            const query = await vscode.window.showInputBox({
                prompt: 'Search codebase with RAG',
                placeHolder: 'Enter your query...'
            });
            if (query) {
                const panel = getPanel();
                // Send search query to panel
                panel.addMessage('user', `RAG Search: ${query}`);
            }
        }),

        // Handle send message from panel
        vscode.commands.registerCommand('enterprise-ai-chat.sendMessage', async (message: string) => {
            await handleSendMessage(message, context);
        }),

        // Handle agentic message from Kanban task execution
        vscode.commands.registerCommand('enterprise-ai-chat.sendAgenticMessage', async (message: string, projectId: number) => {
            outputChannel.appendLine(`[Agentic Command] Received: message=${message?.substring(0, 50)}..., projectId=${projectId}`);
            const panel = getPanel();
            await handleAgenticMessage(panel, message, projectId, context);
        }),

        // Handle abort request
        vscode.commands.registerCommand('enterprise-ai-chat.abortRequest', () => {
            outputChannel.appendLine('[Abort] Request aborted by user');
            // Currently just logs - actual abort would require AbortController in fetch
        }),

        // Handle model selection
        vscode.commands.registerCommand('enterprise-ai-chat.selectModel', (modelId: string) => {
            selectedModel = modelId;
            context.globalState.update('selectedModel', modelId);
            outputChannel.appendLine(`Model selected: ${modelId}`);
        }),

        // Get version info - for debugging deployments
        vscode.commands.registerCommand('enterprise-ai-chat.getVersionInfo', async () => {
            const extensionVersion = '1.6.0';
            let backendVersion = null;

            try {
                const response = await api.get('/api/version');
                backendVersion = response.data;
                outputChannel.appendLine(`Backend version: ${JSON.stringify(backendVersion)}`);
            } catch (error: any) {
                outputChannel.appendLine(`Could not fetch backend version: ${error.message}`);
            }

            const panel = getPanel();
            panel.postMessage({
                type: 'versionInfo',
                payload: {
                    extension: extensionVersion,
                    backend: backendVersion
                }
            });
        }),

        // ============================================
        // CHAT HISTORY COMMANDS
        // ============================================

        // Load chat history
        vscode.commands.registerCommand('enterprise-ai-chat.loadHistory', async () => {
            const panel = getPanel();
            try {
                outputChannel.appendLine('[History] Loading chat history...');

                if (!accessToken) {
                    outputChannel.appendLine('[History] No access token - user not authenticated');
                    // Notify webview that loading finished (with empty list)
                    panel.postMessage({
                        type: 'setHistory',
                        payload: { conversations: [], error: 'Please login first' }
                    });
                    return;
                }

                const authHeaders = { headers: { 'Authorization': `Bearer ${accessToken}` } };
                const response = await api.get('/api/chat/conversations', {
                    ...authHeaders,
                    params: { archived: false, limit: 50, offset: 0 }
                });

                const conversations = response.data || [];
                outputChannel.appendLine(`[History] Loaded ${conversations.length} conversations`);

                panel.postMessage({
                    type: 'setHistory',
                    payload: { conversations }
                });
            } catch (error: any) {
                outputChannel.appendLine(`[History] Error loading history: ${error.message}`);
                // Always notify webview on error so loading state clears
                panel.postMessage({
                    type: 'setHistory',
                    payload: { conversations: [], error: error.message }
                });
            }
        }),

        // Load a specific conversation
        vscode.commands.registerCommand('enterprise-ai-chat.loadConversation', async (conversationId: number) => {
            try {
                outputChannel.appendLine(`[History] Loading conversation ${conversationId}...`);

                if (!accessToken) {
                    outputChannel.appendLine('[History] No access token');
                    return;
                }

                const authHeaders = { headers: { 'Authorization': `Bearer ${accessToken}` } };
                const response = await api.get(`/api/chat/conversations/${conversationId}/messages`, authHeaders);

                const { conversation, messages } = response.data;
                outputChannel.appendLine(`[History] Loaded conversation with ${messages.length} messages`);

                const panel = getPanel();
                panel.postMessage({
                    type: 'loadedConversation',
                    payload: {
                        conversationId: conversation.id,
                        title: conversation.title,
                        model: conversation.model,
                        messages: messages.map((m: any) => ({
                            id: `msg-${m.id}`,
                            role: m.role,
                            content: m.content,
                            timestamp: m.created_at
                        }))
                    }
                });
            } catch (error: any) {
                outputChannel.appendLine(`[History] Error loading conversation: ${error.message}`);
            }
        }),

        // Delete a conversation
        vscode.commands.registerCommand('enterprise-ai-chat.deleteConversation', async (conversationId: number) => {
            try {
                outputChannel.appendLine(`[History] Deleting conversation ${conversationId}...`);

                if (!accessToken) {
                    return;
                }

                const authHeaders = { headers: { 'Authorization': `Bearer ${accessToken}` } };
                await api.delete(`/api/chat/conversations/${conversationId}`, authHeaders);

                outputChannel.appendLine(`[History] Conversation ${conversationId} deleted`);

                // Refresh history
                vscode.commands.executeCommand('enterprise-ai-chat.loadHistory');
            } catch (error: any) {
                outputChannel.appendLine(`[History] Error deleting conversation: ${error.message}`);
            }
        }),

        // ============================================
        // KANBAN COMMANDS
        // ============================================

        // Load Kanban projects (with access check)
        vscode.commands.registerCommand('enterprise-ai-chat.loadProjects', async () => {
            const now = Date.now();

            // CIRCUIT BREAKER: Auto-reset after timeout
            if (circuitBreakerTripped && (now - circuitBreakerTripTime > CIRCUIT_BREAKER_RESET_MS)) {
                outputChannel.appendLine('[Kanban] CIRCUIT BREAKER AUTO-RESET after 30s cooldown');
                circuitBreakerTripped = false;
                projectLoadCallCount = 0;
                circuitBreakerWindowStart = now;
            }

            // CIRCUIT BREAKER: Check if still tripped
            if (circuitBreakerTripped) {
                const remainingMs = CIRCUIT_BREAKER_RESET_MS - (now - circuitBreakerTripTime);
                outputChannel.appendLine(`[Kanban] CIRCUIT BREAKER ACTIVE - resets in ${Math.ceil(remainingMs / 1000)}s`);
                return;
            }

            // CIRCUIT BREAKER: Reset window if expired
            if (now - circuitBreakerWindowStart > CIRCUIT_BREAKER_WINDOW_MS) {
                projectLoadCallCount = 0;
                circuitBreakerWindowStart = now;
            }

            // CIRCUIT BREAKER: Increment and check
            projectLoadCallCount++;

            if (projectLoadCallCount > CIRCUIT_BREAKER_MAX_CALLS) {
                circuitBreakerTripped = true;
                circuitBreakerTripTime = now;
                outputChannel.appendLine(`[Kanban] CIRCUIT BREAKER TRIGGERED: ${projectLoadCallCount} calls in ${CIRCUIT_BREAKER_WINDOW_MS / 1000}s - auto-resets in 30s`);
                return;
            }

            // Guard against concurrent loading
            if (isLoadingProjects) {
                outputChannel.appendLine('[Kanban] Skipping - already loading projects');
                return;
            }

            // Cooldown check
            if (projectsLoaded && (now - lastProjectLoadTime) < PROJECT_LOAD_COOLDOWN) {
                outputChannel.appendLine(`[Kanban] Skipping - projects loaded ${now - lastProjectLoadTime}ms ago (cooldown: ${PROJECT_LOAD_COOLDOWN}ms)`);
                return;
            }

            isLoadingProjects = true;
            lastProjectLoadTime = now;

            try {
                outputChannel.appendLine('Loading Kanban projects...');
                outputChannel.appendLine(`Auth token present: ${!!accessToken}`);

                if (!accessToken) {
                    outputChannel.appendLine('WARNING: No access token - user not authenticated');
                    vscode.window.showWarningMessage('Please login first to access Kanban');
                    return;
                }

                // Ensure auth header is set
                const authHeaders = { headers: { 'Authorization': `Bearer ${accessToken}` } };

                // First check Kanban access
                try {
                    const accessResponse = await api.get('/api/projects/kanban-access', authHeaders);
                    outputChannel.appendLine(`Kanban access: ${JSON.stringify(accessResponse.data)}`);

                    if (!accessResponse.data.hasKanbanAccess) {
                        const groupNames = accessResponse.data.groups?.map((g: any) => g.name).join(', ') || 'None';
                        outputChannel.appendLine(`Kanban access denied. User groups: ${groupNames}`);

                        const panel = getPanel();
                        panel.postMessage({
                            type: 'kanbanAccessDenied',
                            payload: {
                                message: 'Your user group does not have Kanban access',
                                groups: accessResponse.data.groups
                            }
                        });
                        return;
                    }
                } catch (accessError: any) {
                    // If access check fails (e.g., endpoint not found), continue anyway
                    outputChannel.appendLine(`Kanban access check failed: ${accessError.message}`);
                }

                const response = await api.get('/api/projects', authHeaders);
                const projects = response.data || [];
                outputChannel.appendLine(`Loaded ${projects.length} projects`);
                projectsLoaded = true;

                const panel = getPanel();
                panel.postMessage({
                    type: 'setProjects',
                    payload: { projects }
                });
            } catch (error: any) {
                outputChannel.appendLine(`Error loading projects: ${error.message}`);

                // Handle 429 Rate Limit
                if (error.response?.status === 429) {
                    outputChannel.appendLine('[Kanban] Rate limited (429) - stopping further requests');
                    projectsLoaded = true; // Prevent further attempts
                    vscode.window.showWarningMessage('Rate limit exceeded. Please wait before retrying.');
                    return;
                }

                // Handle 403 Kanban access denied
                if (error.response?.status === 403 && error.response?.data?.error === 'Kanban access denied') {
                    const panel = getPanel();
                    panel.postMessage({
                        type: 'kanbanAccessDenied',
                        payload: {
                            message: error.response.data.message || 'Kanban access denied'
                        }
                    });
                    vscode.window.showWarningMessage('Your user group does not have Kanban access');
                } else {
                    vscode.window.showErrorMessage('Failed to load Kanban projects');
                }
            } finally {
                isLoadingProjects = false;
            }
        }),

        // Select a Kanban project and load its board with columns and cards
        vscode.commands.registerCommand('enterprise-ai-chat.selectKanbanProject', async (projectId: number) => {
            try {
                if (!accessToken) {
                    outputChannel.appendLine('Cannot load Kanban - not authenticated');
                    vscode.window.showWarningMessage('Please login first to access Kanban');
                    return;
                }

                outputChannel.appendLine(`Loading Kanban board for project ${projectId}...`);
                const authHeaders = { headers: { 'Authorization': `Bearer ${accessToken}` } };

                // First get project details with boards
                const projectResponse = await api.get(`/api/projects/${projectId}`, authHeaders);
                const project = projectResponse.data;

                if (!project.boards || project.boards.length === 0) {
                    outputChannel.appendLine('Project has no boards');
                    vscode.window.showWarningMessage('This project has no Kanban boards');
                    return;
                }

                // Get the first board's columns and cards
                const boardId = project.boards[0].id;
                outputChannel.appendLine(`Loading board ${boardId}...`);

                const boardResponse = await api.get(`/api/projects/${projectId}/boards/${boardId}`, authHeaders);
                const board = boardResponse.data;

                // Transform to match frontend format
                const columns = (board.columns || []).map((col: any) => ({
                    id: col.id,
                    name: col.name,
                    color: col.color || getColumnColor(col.name),
                    cards: (col.cards || []).map((card: any) => ({
                        id: card.id,
                        title: card.title,
                        description: card.description,
                        priority: card.priority || 'medium',
                        column_id: col.id,
                        assignee_name: card.assignee_name,
                        due_date: card.due_date,
                        tags: card.labels || [],
                        status: col.name
                    }))
                }));

                outputChannel.appendLine(`Loaded ${columns.length} columns with cards`);

                const panel = getPanel();
                panel.postMessage({
                    type: 'setKanbanColumns',
                    payload: { columns, boardId, projectId }
                });
            } catch (error: any) {
                outputChannel.appendLine(`Error loading Kanban board: ${error.message}`);
                if (error.response) {
                    outputChannel.appendLine(`Response: ${JSON.stringify(error.response.data)}`);
                }
                vscode.window.showErrorMessage('Failed to load Kanban board');
            }
        }),

        // Move a Kanban card to a different column
        vscode.commands.registerCommand('enterprise-ai-chat.moveKanbanCard', async (cardId: number, columnId: number, projectId?: number) => {
            try {
                if (!accessToken) {
                    outputChannel.appendLine('Cannot move card - not authenticated');
                    return;
                }

                outputChannel.appendLine(`Moving card ${cardId} to column ${columnId}...`);
                const authHeaders = { headers: { 'Authorization': `Bearer ${accessToken}` } };

                // Use the correct move card API
                await api.post(`/api/projects/${projectId}/cards/${cardId}/move`, {
                    column_id: columnId
                }, authHeaders);

                outputChannel.appendLine(`Card ${cardId} moved to column ${columnId}`);

                const panel = getPanel();
                panel.postMessage({
                    type: 'kanbanCardUpdated',
                    payload: { cardId, columnId, success: true }
                });
            } catch (error: any) {
                outputChannel.appendLine(`Error moving card: ${error.message}`);
                vscode.window.showErrorMessage('Failed to move card');
            }
        }),

        // Complete a task with feedback (like Jira)
        vscode.commands.registerCommand('enterprise-ai-chat.completeTaskWithFeedback', async (taskId: number, feedback: string) => {
            try {
                outputChannel.appendLine(`Completing task ${taskId} with feedback...`);

                await api.patch(`/api/tasks/${taskId}`, {
                    status: 'Done',
                    feedback: feedback,
                    completed_at: new Date().toISOString()
                });

                outputChannel.appendLine(`Task ${taskId} completed`);

                const panel = getPanel();
                panel.postMessage({
                    type: 'kanbanTaskCompleted',
                    payload: { taskId, success: true }
                });

                vscode.window.showInformationMessage('Task completed with feedback');
            } catch (error: any) {
                outputChannel.appendLine(`Error completing task: ${error.message}`);
                vscode.window.showErrorMessage('Failed to complete task');
            }
        }),

        // Add a comment/note to a Kanban task
        vscode.commands.registerCommand('enterprise-ai-chat.addKanbanComment', async (projectId: number, taskId: number, content: string) => {
            try {
                outputChannel.appendLine(`Adding note to task ${taskId}...`);

                // Try to add as task update/comment
                await api.patch(`/api/tasks/${taskId}`, {
                    ai_context: content // Store in ai_context field as development notes
                });

                outputChannel.appendLine(`Comment added successfully to task ${taskId}`);

                const panel = getPanel();
                panel.postMessage({
                    type: 'kanbanNoteAdded',
                    payload: { taskId, success: true }
                });

                vscode.window.showInformationMessage('Development note added successfully');
            } catch (error: any) {
                outputChannel.appendLine(`Error adding comment: ${error.message}`);
                vscode.window.showErrorMessage('Failed to add development note');
            }
        })
    );

    // Register OAuth URI handler
    const uriHandler = new ClaudeOAuthUriHandler();
    context.subscriptions.push(vscode.window.registerUriHandler(uriHandler));
    outputChannel.appendLine('OAuth URI handler registered');

    // Status bar - like Claude Code (conditional display)
    const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarItem.command = 'enterprise-ai-chat.openChat';
    statusBarItem.tooltip = 'Apri Enterprise AI Chat (Ctrl+Shift+L)';
    statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.prominentBackground');
    context.subscriptions.push(statusBarItem);

    // Update status bar based on auth state
    const updateStatusBar = () => {
        if (accessToken && currentUser) {
            statusBarItem.text = `$(cloud) ${currentUser.name}: Chat`;
            statusBarItem.show();
        } else {
            statusBarItem.text = '$(cloud) Enterprise AI: Login';
            statusBarItem.show(); // Still show but indicate login needed
        }
    };
    updateStatusBar();

    outputChannel.appendLine('Extension activated successfully');

    // Show login prompt if not authenticated
    if (!accessToken) {
        vscode.window.showInformationMessage('Enterprise AI Chat: Effettua il login per iniziare', 'Login')
            .then(action => {
                if (action === 'Login') {
                    vscode.commands.executeCommand('enterprise-ai-chat.login');
                }
            });
    } else {
        // User already logged in, fetch available models
        selectedModel = context.globalState.get<string>('selectedModel');
        fetchModelsForPanel(context);
    }
}

// ============================================
// API INITIALIZATION
// ============================================

function initializeApi() {
    const config = vscode.workspace.getConfiguration('enterprise-ai-chat');
    const serverUrl = config.get<string>('serverUrl') || 'https://192.168.1.123';

    // Create HTTPS agent that ignores self-signed certificates
    const httpsAgent = new https.Agent({
        rejectUnauthorized: false
    });

    api = axios.create({
        baseURL: serverUrl,
        headers: { 'Content-Type': 'application/json' },
        httpsAgent: httpsAgent,
        timeout: 300000  // 5 minutes - needed for Ollama models which can take longer
    });

    if (accessToken) {
        api.defaults.headers.common['Authorization'] = `Bearer ${accessToken}`;
    }
}

// ============================================
// AUTHENTICATION
// ============================================

async function login(context: vscode.ExtensionContext, chatProvider: ChatViewProvider) {
    const email = await vscode.window.showInputBox({
        prompt: 'Email',
        placeHolder: 'admin@enterprise.local',
        value: 'admin@enterprise.local'
    });
    if (!email) return;

    const password = await vscode.window.showInputBox({
        prompt: 'Password',
        password: true
    });
    if (!password) return;

    try {
        const response = await api.post('/api/auth/login', { email, password });
        accessToken = response.data.accessToken;
        currentUser = response.data.user;
        api.defaults.headers.common['Authorization'] = `Bearer ${accessToken}`;
        await context.globalState.update('accessToken', accessToken);
        await context.globalState.update('currentUser', currentUser);

        // Fetch available models from backend
        await fetchAvailableModels(context, chatProvider);

        // Fetch AI Toolkit configuration from admin console
        await fetchAIToolkitConfig(chatProvider);

        vscode.window.showInformationMessage(`Connesso come ${currentUser?.name}`);
        chatProvider.setAuthenticated(true, currentUser, availableModels, selectedModel);
    } catch (error: any) {
        vscode.window.showErrorMessage(`Login fallito: ${error.response?.data?.error || error.message}`);
    }
}

async function fetchAvailableModels(context: vscode.ExtensionContext, chatProvider: ChatViewProvider) {
    try {
        outputChannel.appendLine('Fetching available models from backend...');
        const response = await api.get('/api/chat/models');
        outputChannel.appendLine(`RAW RESPONSE: ${JSON.stringify(response.data)}`);

        // Backend returns { id, name, provider } format
        const rawModels = response.data || [];

        // Ensure we have the correct field mapping
        availableModels = rawModels.map((m: any) => ({
            id: m.id || m.model_id || 'unknown',
            name: m.name || m.display_name || m.id || 'Unknown Model',
            provider: m.provider || m.provider_type || 'unknown'
        }));

        outputChannel.appendLine(`MAPPED MODELS: ${JSON.stringify(availableModels.slice(0, 3))}`);

        // Restore or set selected model
        const savedModel = context.globalState.get<string>('selectedModel');
        if (savedModel && availableModels.some(m => m.id === savedModel)) {
            selectedModel = savedModel;
        } else if (availableModels.length > 0) {
            selectedModel = availableModels[0].id;
            await context.globalState.update('selectedModel', selectedModel);
        }

        chatProvider.updateModels(availableModels, selectedModel);
    } catch (error: any) {
        outputChannel.appendLine(`Failed to fetch models: ${error.message}`);
        availableModels = [];
    }
}

// ============================================
// AI TOOLKIT - Fetch Admin Configuration
// ============================================

async function fetchAIToolkitConfig(chatProvider: ChatViewProvider) {
    try {
        outputChannel.appendLine('Fetching AI Toolkit configuration from admin...');
        const response = await api.get('/api/admin/ai-toolkit/config');

        if (response.data) {
            // AI Toolkit enabled status (admin toggle)
            aiToolkitEnabled = response.data.enabled ?? false;
            outputChannel.appendLine(`AI Toolkit enabled: ${aiToolkitEnabled}`);

            // Playground settings (admin-configured)
            if (response.data.playground) {
                playgroundSettings = {
                    temperature: response.data.playground.temperature ?? 0.7,
                    maxTokens: response.data.playground.max_tokens ?? 4096,
                    topP: response.data.playground.top_p ?? 1.0,
                    frequencyPenalty: response.data.playground.frequency_penalty ?? 0,
                    presencePenalty: response.data.playground.presence_penalty ?? 0,
                    stopSequences: response.data.playground.stop_sequences ?? []
                };
                outputChannel.appendLine(`Playground settings loaded: temp=${playgroundSettings.temperature}`);
            }

            // Admin-approved prompt templates
            if (response.data.prompt_templates && Array.isArray(response.data.prompt_templates)) {
                adminPromptTemplates = response.data.prompt_templates.map((t: any) => ({
                    id: t.id || `template-${Date.now()}`,
                    name: t.name || 'Unnamed Template',
                    description: t.description || '',
                    template: t.template || '',
                    variables: t.variables || [],
                    category: t.category || 'custom',
                    chainNext: t.chain_next
                }));
                outputChannel.appendLine(`Loaded ${adminPromptTemplates.length} admin prompt templates`);
            }

            // MCP Servers (admin-configured)
            if (response.data.mcp_servers && Array.isArray(response.data.mcp_servers)) {
                mcpServers = response.data.mcp_servers.map((s: any) => ({
                    id: s.id,
                    name: s.name,
                    type: s.type || 'stdio',
                    command: s.command,
                    url: s.url,
                    tools: s.tools || [],
                    status: 'disconnected'
                }));
                outputChannel.appendLine(`Loaded ${mcpServers.length} MCP server configurations`);
            }

            // Update chat provider with AI Toolkit config
            chatProvider.updateAIToolkitConfig(aiToolkitEnabled, playgroundSettings, adminPromptTemplates, mcpServers);
        }
    } catch (error: any) {
        // AI Toolkit config endpoint might not exist yet - fail silently
        outputChannel.appendLine(`AI Toolkit config not available: ${error.message}`);
        // Use defaults + built-in templates
        chatProvider.updateAIToolkitConfig(true, playgroundSettings, PROMPT_TEMPLATES, []);
    }
}

async function logout(context: vscode.ExtensionContext, chatProvider: ChatViewProvider) {
    accessToken = undefined;
    currentUser = undefined;
    delete api.defaults.headers.common['Authorization'];
    await context.globalState.update('accessToken', undefined);
    await context.globalState.update('currentUser', undefined);
    vscode.window.showInformationMessage('Disconnesso');
    chatProvider.setAuthenticated(false, undefined);
}

// ============================================
// CLAUDE PRO OAUTH LOGIN
// ============================================

// Store references for OAuth callback handling
let pendingOAuthContext: vscode.ExtensionContext | undefined;
let pendingOAuthChatProvider: ChatViewProvider | undefined;

class ClaudeOAuthUriHandler implements vscode.UriHandler {
    async handleUri(uri: vscode.Uri): Promise<void> {
        outputChannel.appendLine('OAuth callback received: ' + uri.toString());

        if (uri.path !== '/oauth-callback') {
            return;
        }

        const params = new URLSearchParams(uri.query);
        const code = params.get('code');
        const state = params.get('state');
        const error = params.get('error');

        if (error) {
            vscode.window.showErrorMessage(`OAuth error: ${error}`);
            return;
        }

        if (!code || !state) {
            vscode.window.showErrorMessage('OAuth callback missing code or state');
            return;
        }

        if (!pendingOAuthContext || !pendingOAuthChatProvider) {
            vscode.window.showErrorMessage('OAuth context lost. Please try again.');
            return;
        }

        // Verify state
        const savedState = pendingOAuthContext.globalState.get<string>('claudeOAuthState');
        if (state !== savedState) {
            vscode.window.showErrorMessage('OAuth state mismatch. Please try again.');
            return;
        }

        // Exchange code for token
        try {
            const codeVerifier = pendingOAuthContext.globalState.get<string>('claudeCodeVerifier');
            const redirectUri = 'vscode://enterprise-ai.enterprise-ai-chat/oauth-callback';

            outputChannel.appendLine('Exchanging code for token...');

            const response = await axios.post(CLAUDE_OAUTH_TOKEN_URL, {
                grant_type: 'authorization_code',
                client_id: CLAUDE_OAUTH_CLIENT_ID,
                code: code,
                redirect_uri: redirectUri,
                code_verifier: codeVerifier
            }, {
                headers: {
                    'Content-Type': 'application/json'
                }
            });

            const accessToken = response.data.access_token;
            const refreshToken = response.data.refresh_token;

            if (accessToken) {
                claudeOAuthToken = accessToken;
                claudeRefreshToken = refreshToken;
                await pendingOAuthContext.globalState.update('claudeOAuthToken', accessToken);
                await pendingOAuthContext.globalState.update('claudeRefreshToken', refreshToken);

                vscode.window.showInformationMessage('Login Claude Pro completato!');
                pendingOAuthChatProvider.setClaudeProAuthenticated(true);

                outputChannel.appendLine('OAuth token obtained successfully');
            } else {
                throw new Error('No access token in response');
            }
        } catch (error: any) {
            outputChannel.appendLine('Token exchange error: ' + JSON.stringify(error.response?.data || error.message));
            vscode.window.showErrorMessage(`Token exchange failed: ${error.response?.data?.error || error.message}`);
        }
    }
}

async function loginClaudePro(context: vscode.ExtensionContext, chatProvider: ChatViewProvider) {
    // Show informational message about Claude Pro/Max limitations
    // OAuth tokens from Claude subscriptions are restricted to Claude Code only
    const choice = await vscode.window.showInformationMessage(
        'Claude Pro/Max OAuth è limitato a Claude Code ufficiale.\n\n' +
        'Per usare Claude in questa estensione:\n' +
        '1. Usa una API Key (console.anthropic.com)\n' +
        '2. Oppure usa l\'estensione Claude Code ufficiale',
        'Configura API Key',
        'Più info'
    );

    if (choice === 'Configura API Key') {
        // Switch to API key mode
        await vscode.workspace.getConfiguration('enterprise-ai-chat').update('claudeAuthMode', 'api', true);
        vscode.commands.executeCommand('workbench.action.openSettings', 'enterprise-ai-chat.claudeApiKey');
    } else if (choice === 'Più info') {
        vscode.env.openExternal(vscode.Uri.parse('https://support.claude.com/en/articles/9876003'));
    }
    return;

    /* NOTA: OAuth flow disabilitato - token Pro/Max sono restricted lato server
    // Store context for callback
    pendingOAuthContext = context;
    pendingOAuthChatProvider = chatProvider;

    // Generate PKCE code verifier and challenge
    const codeVerifier = crypto.randomBytes(32).toString('base64url');
    const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');

    // Store code verifier for later
    await context.globalState.update('claudeCodeVerifier', codeVerifier);

    // Build OAuth URL
    const redirectUri = 'vscode://enterprise-ai.enterprise-ai-chat/oauth-callback';
    const state = crypto.randomBytes(16).toString('hex');
    await context.globalState.update('claudeOAuthState', state);

    const authUrl = new URL(CLAUDE_OAUTH_AUTHORIZE_URL);
    authUrl.searchParams.set('client_id', CLAUDE_OAUTH_CLIENT_ID);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('scope', 'user:inference user:profile');
    authUrl.searchParams.set('state', state);
    authUrl.searchParams.set('code_challenge', codeChallenge);
    authUrl.searchParams.set('code_challenge_method', 'S256');

    outputChannel.appendLine('Opening OAuth URL: ' + authUrl.toString());

    // Open browser for login
    const opened = await vscode.env.openExternal(vscode.Uri.parse(authUrl.toString()));

    if (opened) {
        vscode.window.showInformationMessage('Completa il login nel browser. Verrai reindirizzato automaticamente.');
    } else {
        vscode.window.showErrorMessage('Impossibile aprire il browser');
    }
    */
}

// ============================================
// CODE ACTIONS
// ============================================

async function codeAction(action: string, chatProvider: ChatViewProvider) {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showErrorMessage('Nessun editor attivo');
        return;
    }

    const selection = editor.selection;
    let selectedText = editor.document.getText(selection);
    if (!selectedText) {
        selectedText = editor.document.getText();
    }

    const fileName = path.basename(editor.document.fileName);
    const language = editor.document.languageId;

    const prompts: Record<string, string> = {
        explain: `Spiega questo codice ${language} dal file "${fileName}":\n\n\`\`\`${language}\n${selectedText}\n\`\`\``,
        fix: `Correggi eventuali bug in questo codice ${language}:\n\n\`\`\`${language}\n${selectedText}\n\`\`\``,
        improve: `Migliora questo codice ${language}:\n\n\`\`\`${language}\n${selectedText}\n\`\`\``,
        tests: `Genera unit test per questo codice ${language}:\n\n\`\`\`${language}\n${selectedText}\n\`\`\``
    };

    chatProvider.sendMessage(prompts[action]);
}

async function addToChat(chatProvider: ChatViewProvider) {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const selectedText = editor.document.getText(editor.selection);
    if (!selectedText) return;

    const fileName = path.basename(editor.document.fileName);
    const language = editor.document.languageId;

    chatProvider.insertCode(fileName, language, selectedText);
}

async function addFileToContext(chatProvider: ChatViewProvider) {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showErrorMessage('Nessun file aperto');
        return;
    }

    const content = editor.document.getText();
    const fileName = path.basename(editor.document.fileName);
    const language = editor.document.languageId;

    chatProvider.addFileContext(fileName, language, content);
    vscode.window.showInformationMessage(`File aggiunto al contesto: ${fileName}`);
}

// ============================================
// CHAT VIEW PROVIDER
// ============================================

interface Project {
    id: number;
    name: string;
    description: string;
    color: string;
    board_count: number;
    card_count: number;
}

interface KanbanColumn {
    id: number;
    name: string;
    color: string;
}

interface ProjectMember {
    id: number;
    name: string;
    email: string;
    role: string;
}

interface KanbanNotification {
    id: number;
    type: 'card_assigned' | 'card_moved' | 'card_due' | 'mention';
    message: string;
    card_id?: number;
    card_title?: string;
    project_name?: string;
    created_at: string;
    read: boolean;
}

class ChatViewProvider implements vscode.WebviewViewProvider {
    private _view?: vscode.WebviewView;
    private _messages: ChatMessage[] = [];
    private _isAuthenticated: boolean;
    private _isClaudeProAuthenticated: boolean = false;
    private _user?: { email: string; name: string };
    private _isLoading: boolean = false;
    private _fileContexts: Array<{ name: string; language: string; content: string }> = [];
    private _availableModels: AvailableModel[] = [];
    private _selectedModel?: string;
    private _projects: Project[] = [];
    private _selectedProject?: number;
    private _kanbanColumns: KanbanColumn[] = [];
    private _projectMembers: ProjectMember[] = [];
    private _notifications: KanbanNotification[] = [];
    private _notificationInterval?: NodeJS.Timeout;
    private _isLoadingProjects: boolean = false;
    private _projectsLoaded: boolean = false;

    // AI Toolkit Features
    private _aiToolkitEnabled: boolean = false;
    private _playgroundSettings: PlaygroundSettings = playgroundSettings;
    private _promptTemplates: PromptTemplate[] = [];
    private _mcpServers: MCPServer[] = [];
    private _activeTab: 'chat' | 'playground' | 'templates' | 'mcp' = 'chat';
    private _ragConfig: RAGConfig = ragConfig;
    private _ragResults: VectorSearchResult[] = [];

    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly _context: vscode.ExtensionContext
    ) {
        this._isAuthenticated = !!accessToken;
        this._user = currentUser;
        this._availableModels = availableModels;
        this._selectedModel = selectedModel;
        outputChannel.appendLine('ChatViewProvider constructed');
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ) {
        outputChannel.appendLine('resolveWebviewView called!');

        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };

        webviewView.webview.html = this._getHtml();
        outputChannel.appendLine('HTML set to webview');

        webviewView.webview.onDidReceiveMessage(async (data) => {
            outputChannel.appendLine('Message received: ' + data.type);
            switch (data.type) {
                case 'send':
                    if (data.message?.trim()) {
                        await this.sendMessage(data.message);
                    }
                    break;
                case 'login':
                    vscode.commands.executeCommand('enterprise-ai-chat.login');
                    break;
                case 'loginClaudePro':
                    vscode.commands.executeCommand('enterprise-ai-chat.loginClaudePro');
                    break;
                case 'logout':
                    vscode.commands.executeCommand('enterprise-ai-chat.logout');
                    break;
                case 'clear':
                    this.clearChat();
                    break;
                case 'copy':
                    vscode.env.clipboard.writeText(data.text);
                    vscode.window.showInformationMessage('Copiato!');
                    break;
                case 'configureApiKey':
                    // Switch to API key mode and open settings
                    vscode.workspace.getConfiguration('enterprise-ai-chat').update('claudeAuthMode', 'api', true);
                    vscode.commands.executeCommand('workbench.action.openSettings', 'enterprise-ai-chat.claudeApiKey');
                    break;
                case 'openSettings':
                    vscode.commands.executeCommand('workbench.action.openSettings', 'enterprise-ai-chat');
                    break;
                case 'openExternal':
                    if (data.url) {
                        vscode.env.openExternal(vscode.Uri.parse(data.url));
                    }
                    break;
                case 'selectModel':
                    if (data.modelId) {
                        this._selectedModel = data.modelId;
                        selectedModel = data.modelId;
                        this._context.globalState.update('selectedModel', data.modelId);
                        outputChannel.appendLine(`Model selected: ${data.modelId}`);
                        this._updateView();
                    }
                    break;
                case 'runCommand':
                    if (data.command) {
                        this._executeCommand(data.command);
                    }
                    break;
                case 'applyCode':
                    if (data.code && data.language) {
                        this._applyCode(data.code, data.language, data.filename);
                    }
                    break;
                case 'createCard':
                    if (data.title) {
                        this._createKanbanCard(data.title, data.description, data.columnId);
                    }
                    break;
                case 'moveCard':
                    if (data.cardId && data.columnId) {
                        // Use projectId from message if provided, otherwise fall back to _selectedProject
                        const projectId = data.projectId || this._selectedProject;
                        if (projectId) {
                            this._moveKanbanCardWithProject(data.cardId, data.columnId, projectId);
                        } else {
                            outputChannel.appendLine('[moveCard] Error: No projectId available');
                        }
                    }
                    break;
                case 'deleteCard':
                    if (data.cardId) {
                        this._deleteKanbanCard(data.cardId);
                    }
                    break;
                case 'editCard':
                    if (data.cardId) {
                        this._editKanbanCard(data.cardId, data.title, data.description, data.priority);
                    }
                    break;
                case 'selectProject':
                    if (data.projectId) {
                        this._selectProject(data.projectId);
                    }
                    break;
                case 'loadProjects':
                    this._loadProjects();
                    break;
                case 'createCardUI':
                    this.createCardWithDetails();
                    break;
                case 'markNotificationRead':
                    if (data.notificationId) {
                        this._markNotificationRead(data.notificationId);
                    }
                    break;
                // AI Toolkit Features
                case 'switchTab':
                    if (data.tab) {
                        this._activeTab = data.tab;
                        this._updateView();
                    }
                    break;
                case 'useTemplate':
                    if (data.templateId) {
                        this._useTemplateWithEditor(data.templateId);
                    }
                    break;
                case 'updatePlayground':
                    if (data.settings) {
                        this._playgroundSettings = { ...this._playgroundSettings, ...data.settings };
                        this._updateView();
                    }
                    break;
                case 'sendWithPlayground':
                    if (data.message) {
                        this.sendMessageWithSettings(data.message, this._playgroundSettings);
                    }
                    break;
                case 'ragSearch':
                    if (data.query) {
                        this._performRAGSearch(data.query);
                    }
                    break;
                case 'connectMCP':
                    if (data.serverId) {
                        this._connectMCPServer(data.serverId);
                    }
                    break;
                case 'invokeMCPTool':
                    if (data.serverId && data.toolName) {
                        this._invokeMCPTool(data.serverId, data.toolName, data.args);
                    }
                    break;
                case 'sendAgentic':
                    // Agentic mode with tool support for task execution
                    // CRITICAL FIX: Check for undefined/null, NOT truthiness (projectId: 0 is falsy!)
                    console.log('[Extension] sendAgentic received:', { message: data.message?.substring(0, 50), projectId: data.projectId });
                    if (data.message?.trim() && data.projectId !== undefined && data.projectId !== null) {
                        console.log('[Extension] ✅ Calling sendAgenticMessage...');
                        await this.sendAgenticMessage(data.message, data.projectId);
                    } else {
                        console.error('[Extension] ❌ sendAgentic BLOCKED:', { hasMessage: !!data.message?.trim(), projectId: data.projectId });
                        vscode.window.showErrorMessage(`Cannot execute task: ${!data.message?.trim() ? 'No message' : 'No project ID'}`);
                    }
                    break;
            }
        });
    }

    /**
     * Send message in agentic mode with file tool support
     * Uses /api/chat/agentic endpoint
     */
    public async sendAgenticMessage(message: string, projectId: number) {
        if (!accessToken) {
            vscode.window.showWarningMessage('Login required for agentic mode');
            return;
        }

        const config = vscode.workspace.getConfiguration('enterprise-ai-chat');
        const serverUrl = config.get<string>('serverUrl') || 'https://192.168.1.123';
        const model = config.get<string>('claudeModel') || 'claude-sonnet-4-20250514';

        // Notify webview that we're loading
        this._view?.webview.postMessage({ type: 'streamStart' });

        try {
            const response = await fetch(`${serverUrl}/api/chat/agentic`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${accessToken}`
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
                    enableTools: true
                })
            });

            if (!response.ok) {
                const errBody = await response.json().catch(() => ({ error: 'Unknown error' })) as { error?: string };
                throw new Error(errBody.error || `HTTP ${response.status}`);
            }

            // Handle SSE stream
            const reader = response.body?.getReader();
            if (!reader) throw new Error('No response body');

            const decoder = new TextDecoder();
            let buffer = '';
            let chunkCount = 0;
            const streamStartTime = Date.now();

            outputChannel.appendLine(`[Agentic] TRACE: SSE stream connected, waiting for chunks...`);

            while (true) {
                const { done, value } = await reader.read();
                if (done) {
                    outputChannel.appendLine(`[Agentic] TRACE: Stream ended after ${Date.now() - streamStartTime}ms, ${chunkCount} chunks received`);
                    break;
                }

                const rawChunk = decoder.decode(value, { stream: true });
                chunkCount++;
                outputChannel.appendLine(`[Agentic] TRACE: Chunk #${chunkCount} received, size: ${rawChunk.length} bytes`);

                buffer += rawChunk;
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        const jsonStr = line.slice(6);
                        if (!jsonStr.trim()) continue;

                        try {
                            const data = JSON.parse(jsonStr);
                            outputChannel.appendLine(`[Agentic] TRACE: Parsed event - keys: ${Object.keys(data).join(', ')}`);

                            if (data.content) {
                                // Stream text content
                                this._view?.webview.postMessage({
                                    type: 'streamChunk',
                                    payload: { content: data.content }
                                });
                            }

                            if (data.toolUse) {
                                // Tool being used
                                this._view?.webview.postMessage({
                                    type: 'toolUse',
                                    payload: data.toolUse
                                });
                                outputChannel.appendLine(`[Agentic] Tool use: ${data.toolUse.name}`);
                            }

                            if (data.toolResult) {
                                // Tool result
                                this._view?.webview.postMessage({
                                    type: 'toolResult',
                                    payload: data.toolResult
                                });
                                outputChannel.appendLine(`[Agentic] Tool result: ${data.toolResult.name} - ${data.toolResult.success ? 'success' : 'error'}`);
                            }

                            if (data.error) {
                                this._view?.webview.postMessage({
                                    type: 'streamError',
                                    payload: { error: data.error }
                                });
                            }

                            if (data.done) {
                                this._view?.webview.postMessage({
                                    type: 'streamEnd',
                                    payload: { conversationId: data.conversationId, iterations: data.iterations }
                                });
                            }
                        } catch (e) {
                            // Skip invalid JSON
                        }
                    }
                }
            }
        } catch (err) {
            const errorMsg = err instanceof Error ? err.message : 'Unknown error';
            outputChannel.appendLine(`[Agentic] Error: ${errorMsg}`);
            this._view?.webview.postMessage({
                type: 'streamError',
                payload: { error: errorMsg }
            });
        }
    }

    private async _executeCommand(command: string) {
        const approval = await vscode.window.showWarningMessage(
            `Eseguire il comando?\n\n${command}`,
            { modal: true },
            'Esegui',
            'Annulla'
        );

        if (approval === 'Esegui') {
            // Create or get terminal
            const terminal = vscode.window.terminals.find(t => t.name === 'AI Commands')
                || vscode.window.createTerminal('AI Commands');
            terminal.show();
            terminal.sendText(command);
            outputChannel.appendLine(`Executed command: ${command}`);

            // Log to backend for admin monitoring
            this._logActivity('command_execution', { command });
        }
    }

    private async _logActivity(action: string, details: object) {
        try {
            await api.post('/api/activity/log', {
                action,
                details,
                source: 'vscode-extension',
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            // Silent fail - logging should not interrupt workflow
            outputChannel.appendLine(`Failed to log activity: ${error}`);
        }
    }

    // ==========================================
    // KANBAN METHODS
    // ==========================================

    private async _loadProjects() {
        // Guard against infinite loops
        if (this._isLoadingProjects) {
            outputChannel.appendLine('[ReactChatProvider] Skipping _loadProjects - already loading');
            return;
        }
        if (this._projectsLoaded && this._projects.length > 0) {
            outputChannel.appendLine('[ReactChatProvider] Skipping _loadProjects - already loaded');
            return;
        }

        this._isLoadingProjects = true;

        try {
            const response = await api.get('/api/projects');
            this._projects = response.data || [];
            this._projectsLoaded = true;
            outputChannel.appendLine(`[ReactChatProvider] Loaded ${this._projects.length} projects`);

            // Restore selected project
            const savedProject = this._context.globalState.get<number>('selectedProject');
            if (savedProject && this._projects.some(p => p.id === savedProject)) {
                this._selectedProject = savedProject;
                await this._loadKanbanColumns(savedProject);
            }

            this._updateView();
        } catch (error: any) {
            // Handle 429 Rate Limit
            if (error.response?.status === 429) {
                outputChannel.appendLine('[ReactChatProvider] Rate limited (429) - stopping further requests');
                this._projectsLoaded = true; // Prevent further attempts
                return;
            }
            outputChannel.appendLine(`[ReactChatProvider] Failed to load projects: ${error}`);
        } finally {
            this._isLoadingProjects = false;
        }
    }

    private async _selectProject(projectId: number) {
        this._selectedProject = projectId;
        await this._context.globalState.update('selectedProject', projectId);
        await this._loadKanbanColumns(projectId);
        this._logActivity('project_selected', { projectId });
        this._updateView();
    }

    private async _loadKanbanColumns(projectId: number) {
        try {
            const response = await api.get(`/api/projects/${projectId}`);
            const project = response.data;

            // Load project members
            this._projectMembers = project.members || [];

            // Get columns from first board
            if (project.boards && project.boards.length > 0) {
                const boardResponse = await api.get(`/api/projects/${projectId}/boards/${project.boards[0].id}`);
                this._kanbanColumns = boardResponse.data.columns || [];
            }

            outputChannel.appendLine(`Loaded ${this._kanbanColumns.length} columns, ${this._projectMembers.length} members`);
        } catch (error) {
            outputChannel.appendLine(`Failed to load kanban columns: ${error}`);
        }
    }

    private async _createKanbanCard(title: string, description?: string, columnId?: number, storyPoints?: number, assigneeId?: number) {
        if (!this._selectedProject) {
            vscode.window.showWarningMessage('Seleziona prima un progetto');
            return;
        }

        // Use first column if not specified
        const targetColumnId = columnId || (this._kanbanColumns.length > 0 ? this._kanbanColumns[0].id : null);
        if (!targetColumnId) {
            vscode.window.showErrorMessage('Nessuna colonna disponibile nel progetto');
            return;
        }

        try {
            const response = await api.post(`/api/projects/${this._selectedProject}/columns/${targetColumnId}/cards`, {
                title,
                description: description || '',
                priority: 'medium',
                estimated_hours: storyPoints || 0,
                assigned_to: assigneeId || null
            });

            const assigneeName = assigneeId ? this._projectMembers.find(m => m.id === assigneeId)?.name : null;
            let message = `✅ Card "${title}" creata`;
            if (storyPoints) message += ` (${storyPoints} SP)`;
            if (assigneeName) message += ` - Assegnata a ${assigneeName}`;

            vscode.window.showInformationMessage(message);
            this._logActivity('card_created', {
                cardId: response.data.id,
                title,
                projectId: this._selectedProject,
                storyPoints,
                assigneeId
            });

            // Add system message about card creation
            this._messages.push({
                role: 'assistant',
                content: message,
                timestamp: new Date()
            });
            this._updateView();
        } catch (error: any) {
            vscode.window.showErrorMessage(`Errore creazione card: ${error.message}`);
        }
    }

    public async createCardWithDetails() {
        if (!this._selectedProject) {
            vscode.window.showWarningMessage('Seleziona prima un progetto');
            return;
        }

        // Get title
        const title = await vscode.window.showInputBox({
            prompt: 'Titolo della card',
            placeHolder: 'Es: Implementare login OAuth'
        });
        if (!title) return;

        // Get description
        const description = await vscode.window.showInputBox({
            prompt: 'Descrizione (opzionale)',
            placeHolder: 'Descrivi il task...'
        });

        // Get story points
        const spInput = await vscode.window.showInputBox({
            prompt: 'Story Points (opzionale)',
            placeHolder: 'Es: 3',
            validateInput: (v) => v && isNaN(Number(v)) ? 'Inserisci un numero' : undefined
        });
        const storyPoints = spInput ? Number(spInput) : undefined;

        // Get assignee
        let assigneeId: number | undefined;
        if (this._projectMembers.length > 0) {
            const assigneeOptions = [
                { label: '-- Nessun assegnatario --', id: undefined },
                ...this._projectMembers.map(m => ({ label: `${m.name} (${m.email})`, id: m.id }))
            ];
            const selected = await vscode.window.showQuickPick(assigneeOptions, {
                placeHolder: 'Assegna a...'
            });
            assigneeId = selected?.id;
        }

        // Get column
        const columnOptions = this._kanbanColumns.map(c => ({ label: c.name, id: c.id }));
        const selectedColumn = await vscode.window.showQuickPick(columnOptions, {
            placeHolder: 'Colonna di destinazione'
        });

        await this._createKanbanCard(title, description, selectedColumn?.id, storyPoints, assigneeId);
    }

    private async _moveKanbanCard(cardId: number, columnId: number) {
        if (!this._selectedProject) {
            vscode.window.showWarningMessage('Seleziona prima un progetto');
            return;
        }
        await this._moveKanbanCardWithProject(cardId, columnId, this._selectedProject);
    }

    private async _moveKanbanCardWithProject(cardId: number, columnId: number, projectId: number) {
        // FAIL-SAFE: This function NEVER throws, NEVER shows errors
        // Card move is non-critical - AI generation must continue regardless
        try {
            outputChannel.appendLine(`[moveCard] Moving card ${cardId} to column ${columnId} in project ${projectId}`);

            const response = await api.post(`/api/projects/${projectId}/cards/${cardId}/move`, {
                column_id: columnId,
                sort_order: 0
            }).catch((err: any) => {
                // Silently log but never throw
                outputChannel.appendLine(`[moveCard] API error (ignored): ${err.message}`);
                return { data: { success: false, warning: err.message } };
            });

            if (response?.data?.success) {
                const columnName = this._kanbanColumns.find(c => c.id === columnId)?.name || 'nuova colonna';
                outputChannel.appendLine(`[moveCard] Card ${cardId} moved to "${columnName}"`);

                // Background refresh - don't await
                this._loadKanbanColumns(projectId).then(() => this._updateView()).catch(() => { });

                // Notify webview (non-blocking)
                this._view?.webview.postMessage({
                    type: 'kanbanCardMoved',
                    payload: { cardId, columnId, projectId, success: true }
                });
            } else {
                outputChannel.appendLine(`[moveCard] Backend warning: ${response?.data?.warning || 'unknown'}`);
                // Still notify webview but don't block anything
                this._view?.webview.postMessage({
                    type: 'kanbanCardMoved',
                    payload: { cardId, columnId, projectId, success: false, warning: response?.data?.warning }
                });
            }
        } catch (error: any) {
            // CRITICAL: Never throw, never show error message - just log silently
            outputChannel.appendLine(`[moveCard] Caught exception (swallowed): ${error.message}`);
            console.warn('[moveCard] Swallowed error:', error);
            // Do NOT show vscode.window.showErrorMessage - it interrupts the user
        }
    }

    private async _deleteKanbanCard(cardId: number) {
        if (!this._selectedProject) {
            vscode.window.showWarningMessage('Seleziona prima un progetto');
            return;
        }

        try {
            await api.delete(`/api/projects/${this._selectedProject}/cards/${cardId}`);
            vscode.window.showInformationMessage('Card eliminata con successo');
            this._logActivity('card_deleted', { cardId, projectId: this._selectedProject });

            // Refresh the board
            await this._loadKanbanColumns(this._selectedProject);
            this._updateView();
        } catch (error: any) {
            vscode.window.showErrorMessage(`Errore eliminazione card: ${error.message}`);
        }
    }

    private async _editKanbanCard(cardId: number, title?: string, description?: string, priority?: string) {
        if (!this._selectedProject) {
            vscode.window.showWarningMessage('Seleziona prima un progetto');
            return;
        }

        try {
            const updateData: Record<string, any> = {};
            if (title) updateData.title = title;
            if (description !== undefined) updateData.description = description;
            if (priority) updateData.priority = priority;

            await api.patch(`/api/projects/${this._selectedProject}/cards/${cardId}`, updateData);
            vscode.window.showInformationMessage('Card aggiornata con successo');
            this._logActivity('card_updated', { cardId, projectId: this._selectedProject, ...updateData });

            // Refresh the board
            await this._loadKanbanColumns(this._selectedProject);
            this._updateView();
        } catch (error: any) {
            vscode.window.showErrorMessage(`Errore aggiornamento card: ${error.message}`);
        }
    }

    // ==========================================
    // KANBAN NOTIFICATIONS
    // ==========================================

    private async _fetchNotifications() {
        try {
            const response = await api.get('/api/notifications');
            const newNotifications: KanbanNotification[] = response.data || [];

            // Check for new unread notifications
            const unreadNew = newNotifications.filter(n => !n.read && !this._notifications.some(existing => existing.id === n.id));

            if (unreadNew.length > 0) {
                // Show VS Code notification for new items
                for (const notif of unreadNew) {
                    const icon = this._getNotificationIcon(notif.type);
                    vscode.window.showInformationMessage(
                        `${icon} ${notif.message}`,
                        'Visualizza'
                    ).then(action => {
                        if (action === 'Visualizza') {
                            this._markNotificationRead(notif.id);
                            vscode.commands.executeCommand('enterprise-ai-chat.openChat');
                        }
                    });
                }
            }

            this._notifications = newNotifications;
            this._updateView();
            outputChannel.appendLine(`Fetched ${newNotifications.length} notifications (${unreadNew.length} new)`);
        } catch (error: any) {
            // Silent fail - don't interrupt if notifications endpoint doesn't exist
            outputChannel.appendLine(`Notifications fetch skipped: ${error.message}`);
        }
    }

    private _getNotificationIcon(type: string): string {
        switch (type) {
            case 'card_assigned': return '📋';
            case 'card_moved': return '➡️';
            case 'card_due': return '⏰';
            case 'mention': return '💬';
            default: return '🔔';
        }
    }

    private async _markNotificationRead(notificationId: number) {
        try {
            await api.patch(`/api/notifications/${notificationId}/read`);
            this._notifications = this._notifications.map(n =>
                n.id === notificationId ? { ...n, read: true } : n
            );
            this._updateView();
        } catch (error) {
            outputChannel.appendLine(`Failed to mark notification as read: ${error}`);
        }
    }

    public startNotificationPolling() {
        // Poll every 30 seconds for new notifications
        if (this._notificationInterval) {
            clearInterval(this._notificationInterval);
        }

        // Initial fetch
        this._fetchNotifications();

        // Set up polling
        this._notificationInterval = setInterval(() => {
            this._fetchNotifications();
        }, 30000);

        outputChannel.appendLine('Notification polling started');
    }

    public stopNotificationPolling() {
        if (this._notificationInterval) {
            clearInterval(this._notificationInterval);
            this._notificationInterval = undefined;
            outputChannel.appendLine('Notification polling stopped');
        }
    }

    private async _applyCode(code: string, language: string, filename?: string) {
        const editor = vscode.window.activeTextEditor;

        if (editor) {
            // Insert at cursor or replace selection
            const selection = editor.selection;
            await editor.edit(editBuilder => {
                if (selection.isEmpty) {
                    editBuilder.insert(selection.start, code);
                } else {
                    editBuilder.replace(selection, code);
                }
            });
            vscode.window.showInformationMessage('Codice inserito nell\'editor');
        } else {
            // Create new file with the code
            const doc = await vscode.workspace.openTextDocument({
                language: language,
                content: code
            });
            await vscode.window.showTextDocument(doc);
        }
    }

    public setAuthenticated(isAuthenticated: boolean, user?: { email: string; name: string }, models?: AvailableModel[], model?: string) {
        this._isAuthenticated = isAuthenticated;
        this._user = user;
        if (models) {
            this._availableModels = models;
        }
        if (model) {
            this._selectedModel = model;
        }

        // Load projects and start notifications after authentication
        if (isAuthenticated) {
            this._loadProjects();
            this.startNotificationPolling();
        } else {
            this.stopNotificationPolling();
            this._notifications = [];
        }

        this._updateView();
    }

    public setClaudeProAuthenticated(isAuthenticated: boolean) {
        this._isClaudeProAuthenticated = isAuthenticated;
        this._updateView();
    }

    public updateModels(models: AvailableModel[], selected?: string) {
        this._availableModels = models;
        if (selected) {
            this._selectedModel = selected;
        }
        this._updateView();
    }

    // AI Toolkit Configuration Update (from admin console)
    public updateAIToolkitConfig(
        enabled: boolean,
        playground: PlaygroundSettings,
        templates: PromptTemplate[],
        servers: MCPServer[]
    ) {
        this._aiToolkitEnabled = enabled;
        this._playgroundSettings = playground;
        this._promptTemplates = templates;
        this._mcpServers = servers;
        outputChannel.appendLine(`AI Toolkit config updated: enabled=${enabled}, templates=${templates.length}, servers=${servers.length}`);
        this._updateView();
    }

    // AI Toolkit - Use Prompt Template
    public async usePromptTemplate(templateId: string, variables: Record<string, string>) {
        const template = this._promptTemplates.find(t => t.id === templateId);
        if (!template) {
            vscode.window.showErrorMessage(`Template not found: ${templateId}`);
            return;
        }

        // Replace variables in template
        let prompt = template.template;
        for (const [key, value] of Object.entries(variables)) {
            prompt = prompt.replace(new RegExp(`{{${key}}}`, 'g'), value);
        }

        // Send the expanded prompt
        await this.sendMessage(prompt);

        // Handle prompt chaining
        if (template.chainNext) {
            outputChannel.appendLine(`Prompt chain: will execute ${template.chainNext} after response`);
        }
    }

    // AI Toolkit - Quick Template Selection
    public async selectAndUseTemplate() {
        if (this._promptTemplates.length === 0) {
            vscode.window.showWarningMessage('Nessun template disponibile. Contatta l\'amministratore.');
            return;
        }

        // Show template picker
        const items = this._promptTemplates.map(t => ({
            label: t.name,
            description: t.category,
            detail: t.description,
            template: t
        }));

        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: 'Seleziona un template prompt...',
            matchOnDescription: true,
            matchOnDetail: true
        });

        if (!selected) return;

        // Get current editor context
        const editor = vscode.window.activeTextEditor;
        const selectedText = editor?.document.getText(editor.selection) || '';
        const language = editor?.document.languageId || 'text';
        const filename = editor ? path.basename(editor.document.fileName) : '';

        // Collect variables
        const variables: Record<string, string> = {
            code: selectedText,
            language: language,
            filename: filename,
            error_context: '',
            test_framework: 'jest',
            doc_style: 'JSDoc',
            source_language: language,
            target_language: 'python'
        };

        // Ask for any missing required variables
        for (const varName of selected.template.variables) {
            if (!variables[varName] || variables[varName] === '') {
                const value = await vscode.window.showInputBox({
                    prompt: `Inserisci valore per: ${varName}`,
                    placeHolder: varName
                });
                if (value !== undefined) {
                    variables[varName] = value;
                }
            }
        }

        await this.usePromptTemplate(selected.template.id, variables);
    }

    // AI Toolkit - Update Playground Settings
    public updatePlaygroundSettings(settings: Partial<PlaygroundSettings>) {
        this._playgroundSettings = { ...this._playgroundSettings, ...settings };
        this._updateView();
    }

    // AI Toolkit - Use Template with Editor Context
    private async _useTemplateWithEditor(templateId: string) {
        const template = this._promptTemplates.find(t => t.id === templateId);
        if (!template) {
            vscode.window.showErrorMessage(`Template "${templateId}" non trovato`);
            return;
        }

        const editor = vscode.window.activeTextEditor;
        const selectedText = editor?.document.getText(editor.selection) || '';
        const language = editor?.document.languageId || 'text';
        const filename = editor ? path.basename(editor.document.fileName) : '';

        // Build variables from editor context
        const variables: Record<string, string> = {
            code: selectedText,
            language: language,
            filename: filename
        };

        // Ask for missing variables
        for (const varName of template.variables) {
            if (!variables[varName]) {
                const value = await vscode.window.showInputBox({
                    prompt: `Inserisci ${varName}`,
                    placeHolder: varName
                });
                if (value !== undefined) {
                    variables[varName] = value;
                }
            }
        }

        // Expand template
        let prompt = template.template;
        for (const [key, value] of Object.entries(variables)) {
            prompt = prompt.replace(new RegExp(`{{${key}}}`, 'g'), value);
        }

        await this.sendMessage(prompt);
    }

    // AI Toolkit - Send with Playground Settings
    public async sendMessageWithSettings(message: string, settings: PlaygroundSettings) {
        // Override default settings with playground settings
        const originalSettings = { ...this._playgroundSettings };
        this._playgroundSettings = settings;

        // Add user message
        this._messages.push({ role: 'user', content: message, timestamp: new Date() });
        this._isLoading = true;
        this._updateView();

        try {
            const config = vscode.workspace.getConfiguration('enterprise-ai-chat');
            const useDirectClaude = config.get<boolean>('useDirectClaude') ?? false;

            let content: string;

            if (useDirectClaude) {
                const claudeApiKey = config.get<string>('claudeApiKey') || '';
                content = await this._callClaudeWithPlayground(claudeApiKey, message, settings);
            } else {
                content = await this._callBackendWithPlayground(message, settings);
            }

            this._messages.push({ role: 'assistant', content, timestamp: new Date() });
        } catch (error: any) {
            this._messages.push({ role: 'assistant', content: `Errore: ${error.message}`, timestamp: new Date() });
        } finally {
            this._isLoading = false;
            this._playgroundSettings = originalSettings;
            this._updateView();
        }
    }

    private async _callClaudeWithPlayground(apiKey: string, message: string, settings: PlaygroundSettings): Promise<string> {
        const config = vscode.workspace.getConfiguration('enterprise-ai-chat');
        const model = config.get<string>('claudeModel') || 'claude-sonnet-4-20250514';

        const response = await axios.post(CLAUDE_API_URL, {
            model,
            max_tokens: settings.maxTokens,
            temperature: settings.temperature,
            top_p: settings.topP,
            messages: [{ role: 'user', content: message }]
        }, {
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01'
            }
        });

        const textBlock = response.data.content?.find((block: { type: string; text?: string }) => block.type === 'text');
        return textBlock?.text || 'Nessuna risposta';
    }

    private async _callBackendWithPlayground(message: string, settings: PlaygroundSettings): Promise<string> {
        const model = this._selectedModel || 'gpt-4o';

        const response = await api.post('/api/chat/completions', {
            model,
            message,
            temperature: settings.temperature,
            max_tokens: settings.maxTokens,
            top_p: settings.topP,
            frequency_penalty: settings.frequencyPenalty,
            presence_penalty: settings.presencePenalty
        }, {
            responseType: 'text',
            headers: {
                'Accept': 'text/event-stream',
                'Authorization': `Bearer ${accessToken}`
            }
        });

        let fullContent = '';
        const lines = response.data.split('\n');
        for (const line of lines) {
            if (line.startsWith('data: ')) {
                try {
                    const data = JSON.parse(line.slice(6));
                    if (data.content) {
                        fullContent += data.content;
                    }
                } catch {
                    // Ignore parse errors
                }
            }
        }
        return fullContent || 'Nessuna risposta';
    }

    // AI Toolkit - RAG Vector Search
    private async _performRAGSearch(query: string) {
        if (!this._ragConfig.enabled) {
            outputChannel.appendLine('RAG is disabled');
            return;
        }

        try {
            outputChannel.appendLine(`RAG search: "${query}"`);
            const response = await api.post('/api/rag/search', {
                query,
                top_k: this._ragConfig.topK,
                min_similarity: this._ragConfig.minSimilarity,
                include_metadata: this._ragConfig.includeMetadata
            }, {
                headers: { 'Authorization': `Bearer ${accessToken}` }
            });

            this._ragResults = response.data.results || [];
            outputChannel.appendLine(`RAG found ${this._ragResults.length} results`);

            // Add context from RAG results to the message
            if (this._ragResults.length > 0) {
                const contextParts = this._ragResults.map(r =>
                    `[${r.metadata.filename}:${r.metadata.chunk_index}] (${(r.similarity * 100).toFixed(1)}%)\n${r.content}`
                );
                const ragContext = `Contesto rilevante dalla codebase:\n\n${contextParts.join('\n\n---\n\n')}`;

                this._messages.push({
                    role: 'system',
                    content: ragContext,
                    timestamp: new Date()
                });
            }

            this._updateView();
        } catch (error: any) {
            outputChannel.appendLine(`RAG search failed: ${error.message}`);
        }
    }

    // AI Toolkit - MCP Server Connection
    private async _connectMCPServer(serverId: string) {
        const server = this._mcpServers.find(s => s.id === serverId);
        if (!server) {
            vscode.window.showErrorMessage(`MCP Server non trovato: ${serverId}`);
            return;
        }

        try {
            outputChannel.appendLine(`Connecting to MCP server: ${server.name}`);

            // Call backend to initialize MCP connection
            const response = await api.post('/api/mcp/connect', {
                server_id: serverId,
                type: server.type,
                command: server.command,
                url: server.url
            }, {
                headers: { 'Authorization': `Bearer ${accessToken}` }
            });

            if (response.data.success) {
                server.status = 'connected';
                server.tools = response.data.tools || [];
                vscode.window.showInformationMessage(`MCP Server "${server.name}" connesso (${server.tools.length} tools)`);
            } else {
                server.status = 'error';
                vscode.window.showErrorMessage(`Errore connessione MCP: ${response.data.error}`);
            }

            this._updateView();
        } catch (error: any) {
            server.status = 'error';
            outputChannel.appendLine(`MCP connection failed: ${error.message}`);
            vscode.window.showErrorMessage(`Errore MCP: ${error.message}`);
            this._updateView();
        }
    }

    // AI Toolkit - Invoke MCP Tool
    private async _invokeMCPTool(serverId: string, toolName: string, args: object) {
        const server = this._mcpServers.find(s => s.id === serverId);
        if (!server || server.status !== 'connected') {
            vscode.window.showErrorMessage('MCP Server non connesso');
            return;
        }

        try {
            outputChannel.appendLine(`Invoking MCP tool: ${toolName}`);

            const response = await api.post('/api/mcp/invoke', {
                server_id: serverId,
                tool_name: toolName,
                arguments: args
            }, {
                headers: { 'Authorization': `Bearer ${accessToken}` }
            });

            if (response.data.result) {
                // Add tool result to chat
                this._messages.push({
                    role: 'assistant',
                    content: `**MCP Tool: ${toolName}**\n\n\`\`\`json\n${JSON.stringify(response.data.result, null, 2)}\n\`\`\``,
                    timestamp: new Date()
                });
                this._updateView();
            }
        } catch (error: any) {
            outputChannel.appendLine(`MCP tool invocation failed: ${error.message}`);
            vscode.window.showErrorMessage(`Errore MCP tool: ${error.message}`);
        }
    }

    // Public method to switch tabs (for commands)
    public switchToTab(tab: 'chat' | 'playground' | 'templates' | 'mcp') {
        this._activeTab = tab;
        this._updateView();
    }

    // Public method for RAG search (for commands)
    public performRAGSearch(query: string) {
        this._performRAGSearch(query);
    }

    public clearChat() {
        this._messages = [];
        this._fileContexts = [];
        this._updateView();
    }

    public insertCode(fileName: string, language: string, code: string) {
        this._view?.webview.postMessage({
            type: 'insertCode',
            fileName,
            language,
            code
        });
    }

    public addFileContext(name: string, language: string, content: string) {
        this._fileContexts.push({ name, language, content });
        this._updateView();
    }

    public async sendMessage(message: string) {
        const config = vscode.workspace.getConfiguration('enterprise-ai-chat');
        const useDirectClaude = config.get<boolean>('useDirectClaude') ?? false;
        const claudeAuthMode = config.get<string>('claudeAuthMode') || 'pro';
        const claudeApiKey = config.get<string>('claudeApiKey') || '';

        // Check authentication based on mode
        if (useDirectClaude) {
            if (claudeAuthMode === 'pro') {
                // Check for Claude Pro OAuth token
                const storedToken = this._context.globalState.get<string>('claudeOAuthToken');
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
                claudeOAuthToken = storedToken;
            } else {
                // API key mode
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
        } else if (!accessToken) {
            vscode.window.showWarningMessage('Effettua il login per continuare');
            return;
        }

        // Add user message
        this._messages.push({ role: 'user', content: message, timestamp: new Date() });
        this._isLoading = true;
        this._updateView();

        try {
            // Build system prompt with file context
            let systemPrompt = `Sei un assistente AI per sviluppatori. Rispondi in italiano. Usa blocchi di codice markdown quando appropriato.`;

            if (this._fileContexts.length > 0) {
                systemPrompt += '\n\nFile nel contesto:';
                for (const fc of this._fileContexts) {
                    systemPrompt += `\n\n--- ${fc.name} ---\n\`\`\`${fc.language}\n${fc.content.substring(0, 5000)}\n\`\`\``;
                }
            }

            let content: string;

            if (useDirectClaude) {
                // Direct Claude API call (Pro subscription or API key)
                const token = claudeAuthMode === 'pro' ? claudeOAuthToken! : claudeApiKey;
                content = await this._callClaudeDirectly(token, message, systemPrompt, config);
            } else {
                // Backend server call
                content = await this._callBackendServer(message, systemPrompt, config);
            }

            this._messages.push({ role: 'assistant', content, timestamp: new Date() });

        } catch (error: any) {
            const errorMessage = error.message || 'Errore sconosciuto';
            this._messages.push({ role: 'assistant', content: `Errore: ${errorMessage}`, timestamp: new Date() });
        } finally {
            this._isLoading = false;
            this._updateView();
        }
    }

    private async _callClaudeDirectly(token: string, message: string, systemPrompt: string, config: vscode.WorkspaceConfiguration): Promise<string> {
        const model = config.get<string>('claudeModel') || 'claude-sonnet-4-20250514';

        // Build conversation history for Claude
        const conversationMessages = this._messages
            .filter(m => m.role !== 'system')
            .slice(-20)
            .map(m => ({
                role: m.role as 'user' | 'assistant',
                content: m.content
            }));

        // Add current message
        conversationMessages.push({ role: 'user', content: message });

        // Call Claude API directly with OAuth token or API key
        const isOAuthToken = token.startsWith('sk-ant-oat');

        // Build headers - OAuth tokens require anthropic-beta header
        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            'anthropic-version': '2023-06-01'
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
            messages: conversationMessages
        }, { headers });

        const textBlock = response.data.content?.find((block: { type: string; text?: string }) => block.type === 'text');
        return textBlock?.text || 'Nessuna risposta';
    }

    private async _callBackendServer(message: string, systemPrompt: string, config: vscode.WorkspaceConfiguration): Promise<string> {
        // Use selected model from admin-configured models, fallback to config
        const model = this._selectedModel || config.get<string>('defaultModel') || 'gpt-4o';
        outputChannel.appendLine(`Calling backend with model: ${model}`);
        outputChannel.appendLine(`Auth header set: ${!!api.defaults.headers.common['Authorization']}`);
        outputChannel.appendLine(`Access token: ${accessToken ? 'Present (' + accessToken.substring(0, 20) + '...)' : 'Missing'}`);

        const response = await api.post('/api/chat/completions', {
            model,
            message,
            systemPrompt
        }, {
            responseType: 'text',
            headers: {
                'Accept': 'text/event-stream',
                'Authorization': `Bearer ${accessToken}`
            }
        });

        // Parse SSE response
        let fullContent = '';
        const lines = response.data.split('\n');
        for (const line of lines) {
            if (line.startsWith('data: ')) {
                try {
                    const data = JSON.parse(line.slice(6));
                    if (data.content) {
                        fullContent += data.content;
                    }
                } catch {
                    // Ignore parse errors
                }
            }
        }

        return fullContent || 'Nessuna risposta';
    }

    private _updateView() {
        if (this._view) {
            this._view.webview.html = this._getHtml();
        }
    }

    private _getHtml(): string {
        outputChannel.appendLine('_getHtml called');
        outputChannel.appendLine('  isAuthenticated: ' + this._isAuthenticated);
        outputChannel.appendLine('  isClaudeProAuthenticated: ' + this._isClaudeProAuthenticated);

        // Check if React UI is enabled
        const config = vscode.workspace.getConfiguration('enterprise-ai-chat');
        const useReactUI = config.get<boolean>('useReactUI') ?? true;

        if (useReactUI && this._view) {
            return this._getReactHtml();
        }

        // DEBUG: Return super simple HTML to test if webview works
        const DEBUG_SIMPLE = false;
        if (DEBUG_SIMPLE) {
            return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="background:#1e1e1e;color:#fff;padding:20px;"><h1>TEST OK</h1><p>Webview funziona!</p></body></html>`;
        }

        try {
            const messagesHtml = this._messages.map(msg => {
                const isUser = msg.role === 'user';
                const escaped = this._escapeHtml(msg.content);
                const formatted = isUser ? escaped : this._formatMarkdown(escaped);

                return `
                    <div class="msg ${isUser ? 'user' : 'assistant'}">
                        <div class="role">${isUser ? 'Tu' : 'Claude'}</div>
                        <div class="content">${formatted}</div>
                    </div>
                `;
            }).join('');

            const loadingHtml = this._isLoading ? `
                <div class="msg assistant">
                    <div class="role">Claude</div>
                    <div class="content loading">Sto pensando...</div>
                </div>
            ` : '';

            const contextHtml = this._fileContexts.length > 0 ? `
                <div class="context">
                    ${this._fileContexts.map(f => `<span class="tag">${f.name}</span>`).join('')}
                </div>
            ` : '';

            // Check if using direct Claude mode
            const config = vscode.workspace.getConfiguration('enterprise-ai-chat');
            const useDirectClaude = config.get<boolean>('useDirectClaude') ?? false;
            const claudeAuthMode = config.get<string>('claudeAuthMode') || 'pro';

            outputChannel.appendLine('  useDirectClaude: ' + useDirectClaude);
            outputChannel.appendLine('  claudeAuthMode: ' + claudeAuthMode);

            // If using direct Claude with Pro mode, show Claude Pro login
            if (useDirectClaude && claudeAuthMode === 'pro' && !this._isClaudeProAuthenticated) {
                return `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <style>
        body { font-family: var(--vscode-font-family); padding: 20px; text-align: center; color: var(--vscode-foreground); }
        h2 { margin-bottom: 10px; }
        p { color: var(--vscode-descriptionForeground); margin-bottom: 15px; }
        button { padding: 10px 24px; background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; border-radius: 4px; cursor: pointer; font-size: 14px; margin: 5px; display: block; width: 100%; max-width: 250px; margin: 8px auto; }
        button:hover { background: var(--vscode-button-hoverBackground); }
        .subtitle { font-size: 11px; color: var(--vscode-descriptionForeground); margin-top: 20px; line-height: 1.6; }
        .warning { background: var(--vscode-inputValidation-warningBackground); border: 1px solid var(--vscode-inputValidation-warningBorder); padding: 10px; border-radius: 4px; margin: 15px 0; font-size: 12px; }
    </style>
</head>
<body>
    <h2>Claude AI</h2>
    <div class="warning">
        ⚠️ Claude Pro/Max OAuth è limitato a Claude Code ufficiale.<br>
        Per usare Claude qui, serve una API Key.
    </div>
    <button onclick="configureApiKey()">Configura API Key</button>
    <button onclick="openSettings()">Impostazioni</button>
    <p class="subtitle">
        Ottieni la tua API Key da:<br>
        <a href="#" onclick="openConsole()">console.anthropic.com</a>
    </p>
    <script>
        const vscode = acquireVsCodeApi();
        function configureApiKey() {
            vscode.postMessage({ type: 'configureApiKey' });
        }
        function openSettings() {
            vscode.postMessage({ type: 'openSettings' });
        }
        function openConsole() {
            vscode.postMessage({ type: 'openExternal', url: 'https://console.anthropic.com/settings/keys' });
        }
    </script>
</body>
</html>`;
            }

            // If using backend server mode, check backend auth
            if (!useDirectClaude && !this._isAuthenticated) {
                outputChannel.appendLine('Showing login screen (backend mode, not authenticated)');
                const nonce = getNonce();
                return `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
</head>
<body style="font-family: system-ui, sans-serif; padding: 30px; text-align: center; background: #1e1e1e; color: #ccc; margin: 0;">
    <h2 style="color: #fff; margin-bottom: 15px;">Enterprise AI Chat</h2>
    <p style="color: #888; margin-bottom: 25px;">Effettua il login al server per iniziare</p>
    <button id="loginBtn" style="padding: 12px 28px; background: #0e639c; color: #fff; border: none; border-radius: 4px; cursor: pointer; font-size: 14px;">
        Login
    </button>
    <p style="margin-top: 20px; font-size: 11px; color: #666;">Server: https://192.168.1.123</p>
    <script nonce="${nonce}">
        (function() {
            const vscode = acquireVsCodeApi();
            document.getElementById('loginBtn').addEventListener('click', function() {
                vscode.postMessage({ type: 'login' });
            });
        })();
    </script>
</body>
</html>`;
            }

            return `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            font-family: var(--vscode-font-family);
            font-size: 13px;
            color: var(--vscode-foreground);
            background: var(--vscode-editor-background);
            height: 100vh;
            display: flex;
            flex-direction: column;
        }
        .header {
            padding: 8px 12px;
            border-bottom: 1px solid var(--vscode-panel-border);
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        .header-title { font-weight: 600; }
        .header-user { font-size: 11px; color: var(--vscode-descriptionForeground); }
        .header-actions button {
            background: transparent;
            border: 1px solid var(--vscode-panel-border);
            color: var(--vscode-foreground);
            padding: 4px 8px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 11px;
            margin-left: 6px;
        }
        .messages {
            flex: 1;
            overflow-y: auto;
            padding: 12px;
        }
        .msg {
            margin-bottom: 16px;
        }
        .msg .role {
            font-size: 11px;
            font-weight: 600;
            margin-bottom: 4px;
        }
        .msg.user .role { color: var(--vscode-textLink-foreground); }
        .msg.assistant .role { color: #4ec9b0; }
        .msg .content {
            padding: 10px 12px;
            border-radius: 8px;
            line-height: 1.5;
            word-wrap: break-word;
        }
        .msg.user .content {
            background: var(--vscode-input-background);
            border: 1px solid var(--vscode-panel-border);
        }
        .msg.assistant .content {
            background: var(--vscode-sideBar-background);
        }
        .loading {
            color: var(--vscode-descriptionForeground);
            font-style: italic;
        }
        pre {
            background: #1e1e1e;
            padding: 10px;
            border-radius: 6px;
            overflow-x: auto;
            margin: 0;
            font-family: monospace;
            font-size: 12px;
        }
        code {
            font-family: monospace;
            background: #2d2d2d;
            padding: 2px 5px;
            border-radius: 3px;
        }
        pre code {
            background: transparent;
            padding: 0;
        }
        .code-block {
            margin: 8px 0;
            border-radius: 6px;
            overflow: hidden;
            border: 1px solid var(--vscode-panel-border);
        }
        .code-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 6px 10px;
            background: #2d2d2d;
            border-bottom: 1px solid var(--vscode-panel-border);
        }
        .code-lang {
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
            text-transform: uppercase;
        }
        .code-actions {
            display: flex;
            gap: 4px;
        }
        .code-action {
            font-size: 11px;
            padding: 3px 8px;
            background: transparent;
            color: var(--vscode-foreground);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 3px;
            cursor: pointer;
            opacity: 0.8;
        }
        .code-action:hover {
            opacity: 1;
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
        }
        .code-action.run {
            border-color: #4ec9b0;
        }
        .code-action.run:hover {
            background: #4ec9b0;
            color: #1e1e1e;
        }
        .code-action.apply {
            border-color: #569cd6;
        }
        .code-action.apply:hover {
            background: #569cd6;
            color: #1e1e1e;
        }
        .context {
            padding: 8px 12px;
            border-bottom: 1px solid var(--vscode-panel-border);
            display: flex;
            gap: 6px;
            flex-wrap: wrap;
        }
        .tag {
            font-size: 10px;
            padding: 3px 8px;
            background: var(--vscode-badge-background);
            color: var(--vscode-badge-foreground);
            border-radius: 4px;
        }
        .input-area {
            padding: 12px;
            border-top: 1px solid var(--vscode-panel-border);
        }
        .input-container {
            display: flex;
            gap: 8px;
        }
        textarea {
            flex: 1;
            min-height: 60px;
            max-height: 150px;
            padding: 10px;
            border: 1px solid var(--vscode-panel-border);
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border-radius: 6px;
            resize: none;
            font-family: inherit;
            font-size: 13px;
        }
        textarea:focus {
            outline: none;
            border-color: var(--vscode-focusBorder);
        }
        .send-btn {
            padding: 10px 16px;
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            border-radius: 6px;
            cursor: pointer;
            font-weight: 500;
        }
        .send-btn:hover {
            background: var(--vscode-button-hoverBackground);
        }
        .send-btn:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }
        .empty {
            text-align: center;
            padding: 40px 20px;
            color: var(--vscode-descriptionForeground);
        }
        .empty h3 {
            color: var(--vscode-foreground);
            margin-bottom: 8px;
        }
        .model-selector {
            padding: 8px 12px;
            border-bottom: 1px solid var(--vscode-panel-border);
            display: flex;
            align-items: center;
            gap: 8px;
        }
        .model-selector label {
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
        }
        .model-selector select {
            flex: 1;
            padding: 4px 8px;
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 4px;
            font-size: 12px;
            cursor: pointer;
        }
        .model-selector select:focus {
            outline: none;
            border-color: var(--vscode-focusBorder);
        }
        .btn-add-card {
            padding: 4px 10px;
            background: #10B981;
            color: white;
            border: none;
            border-radius: 4px;
            font-size: 11px;
            cursor: pointer;
            margin-left: 6px;
        }
        .btn-add-card:hover {
            background: #059669;
        }
        .notif-btn {
            position: relative;
            background: transparent;
            border: 1px solid #f59e0b;
            color: var(--vscode-foreground);
            padding: 4px 8px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 11px;
            margin-right: 6px;
        }
        .notif-badge {
            background: #ef4444;
            color: white;
            font-size: 10px;
            padding: 1px 5px;
            border-radius: 10px;
            margin-left: 4px;
        }
        .notifications-panel {
            position: absolute;
            top: 40px;
            right: 10px;
            width: 300px;
            max-height: 400px;
            background: var(--vscode-sideBar-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
            z-index: 100;
            overflow: hidden;
        }
        .notif-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 10px 12px;
            border-bottom: 1px solid var(--vscode-panel-border);
            font-weight: 600;
        }
        .notif-empty {
            padding: 20px;
            text-align: center;
            color: var(--vscode-descriptionForeground);
        }
        .notif-item {
            display: flex;
            gap: 10px;
            padding: 10px 12px;
            border-bottom: 1px solid var(--vscode-panel-border);
            cursor: pointer;
        }
        .notif-item:hover {
            background: var(--vscode-list-hoverBackground);
        }
        .notif-item.unread {
            background: rgba(59, 130, 246, 0.1);
        }
        .notif-icon {
            font-size: 16px;
        }
        .notif-content {
            flex: 1;
        }
        .notif-message {
            font-size: 12px;
            line-height: 1.4;
        }
        .notif-project {
            font-size: 10px;
            color: var(--vscode-descriptionForeground);
            margin-top: 2px;
        }
    </style>
</head>
<body>
    <div class="header">
        <div>
            <span class="header-title">AI Chat</span>
            <span class="header-user"> - ${this._user?.name || 'Utente'}</span>
        </div>
        <div class="header-actions">
            <button onclick="toggleNotifications()" class="notif-btn" title="Notifiche Kanban">
                🔔 ${this._notifications.filter(n => !n.read).length > 0 ? `<span class="notif-badge">${this._notifications.filter(n => !n.read).length}</span>` : ''}
            </button>
            ${this._availableModels.length > 0 ? `
            <select id="modelSelectHeader" onchange="selectModel(this.value)" style="padding: 4px 8px; border-radius: 4px; border: 1px solid var(--vscode-panel-border); background: var(--vscode-dropdown-background); color: var(--vscode-dropdown-foreground); font-size: 11px; margin-right: 6px;">
                ${this._availableModels.map(m => `
                    <option value="${m.id}" ${m.id === this._selectedModel ? 'selected' : ''}>
                        ${m.name}
                    </option>
                `).join('')}
            </select>
            ` : `<span style="font-size: 10px; color: var(--vscode-descriptionForeground); margin-right: 6px;">${this._selectedModel || 'Nessun modello'}</span>`}
            <button onclick="clearChat()">Nuova</button>
            <button onclick="logout()">Esci</button>
        </div>
    </div>

    <!-- Notifications Panel -->
    <div id="notificationsPanel" class="notifications-panel" style="display: none;">
        <div class="notif-header">
            <span>Notifiche</span>
            <button onclick="toggleNotifications()" style="background: none; border: none; color: var(--vscode-foreground); cursor: pointer;">✕</button>
        </div>
        ${this._notifications.length === 0 ? `
            <div class="notif-empty">Nessuna notifica</div>
        ` : this._notifications.slice(0, 10).map(n => `
            <div class="notif-item ${n.read ? 'read' : 'unread'}" onclick="markNotifRead(${n.id})">
                <span class="notif-icon">${this._getNotificationIcon(n.type)}</span>
                <div class="notif-content">
                    <div class="notif-message">${n.message}</div>
                    ${n.project_name ? `<div class="notif-project">${n.project_name}</div>` : ''}
                </div>
            </div>
        `).join('')}
    </div>

    ${this._projects.length > 0 ? `
    <div class="model-selector">
        <label>Progetto:</label>
        <select id="projectSelect" onchange="selectProject(this.value)">
            <option value="">-- Nessun progetto --</option>
            ${this._projects.map(p => `
                <option value="${p.id}" ${p.id === this._selectedProject ? 'selected' : ''}>
                    ${p.name} (${p.card_count} card)
                </option>
            `).join('')}
        </select>
        ${this._selectedProject ? `<button class="btn-add-card" onclick="createCard()">+ Card</button>` : ''}
    </div>
    ` : ''}

    ${contextHtml}

    <div class="messages" id="messages">
        ${this._messages.length === 0 ? `
            <div class="empty">
                <h3>Ciao!</h3>
                <p>Chiedimi qualsiasi cosa sul codice</p>
            </div>
        ` : messagesHtml + loadingHtml}
    </div>

    <div class="input-area">
        <div class="input-container">
            <textarea id="input" placeholder="Scrivi un messaggio..." ${this._isLoading ? 'disabled' : ''}></textarea>
            <button class="send-btn" onclick="send()" ${this._isLoading ? 'disabled' : ''}>Invia</button>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();

        function send() {
            const input = document.getElementById('input');
            const message = input.value.trim();
            if (message) {
                vscode.postMessage({ type: 'send', message });
                input.value = '';
            }
        }

        function clearChat() { vscode.postMessage({ type: 'clear' }); }
        function logout() { vscode.postMessage({ type: 'logout' }); }
        function selectModel(modelId) { vscode.postMessage({ type: 'selectModel', modelId }); }
        function selectProject(projectId) {
            if (projectId) {
                vscode.postMessage({ type: 'selectProject', projectId: parseInt(projectId) });
            }
        }

        function createCard() {
            vscode.postMessage({ type: 'createCardUI' });
        }

        function toggleNotifications() {
            const panel = document.getElementById('notificationsPanel');
            if (panel) {
                panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
            }
        }

        function markNotifRead(notifId) {
            vscode.postMessage({ type: 'markNotificationRead', notificationId: notifId });
        }

        function copyCode(code) {
            // Decode escaped characters
            const decoded = code.replace(/\\n/g, '\\n').replace(/\\'/g, "'");
            vscode.postMessage({ type: 'copy', text: decoded });
        }

        function runCommand(command) {
            const decoded = command.replace(/\\n/g, '\\n').replace(/\\'/g, "'");
            vscode.postMessage({ type: 'runCommand', command: decoded });
        }

        function applyCode(code, language) {
            const decoded = code.replace(/\\n/g, '\\n').replace(/\\'/g, "'");
            vscode.postMessage({ type: 'applyCode', code: decoded, language: language });
        }

        document.getElementById('input')?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send();
            }
        });

        // Handle messages from extension
        window.addEventListener('message', event => {
            const data = event.data;
            if (data.type === 'insertCode') {
                const input = document.getElementById('input');
                if (input) {
                    input.value += '\\n\\n\`\`\`' + data.language + '\\n' + data.code + '\\n\`\`\`';
                    input.focus();
                }
            }
        });

        // Auto-scroll
        const messages = document.getElementById('messages');
        if (messages) messages.scrollTop = messages.scrollHeight;

        // Focus input
        document.getElementById('input')?.focus();
    </script>
</body>
</html>`;
        } catch (error: any) {
            outputChannel.appendLine('ERROR in _getHtml: ' + error.message);
            return `<!DOCTYPE html><html><body style="padding:20px;color:#fff;background:#1e1e1e;">
                <h2>Error</h2><p>${error.message}</p>
            </body></html>`;
        }
    }

    private _escapeHtml(text: string): string {
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    /**
     * Generate React-based webview HTML (Claude Code-like UI)
     */
    private _getReactHtml(): string {
        if (!this._view) {
            return '<html><body>Loading...</body></html>';
        }

        const webview = this._view.webview;
        const nonce = getNonce();

        // Get the React bundle and CSS URIs
        const scriptUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._context.extensionUri, 'out', 'webview.js')
        );
        const styleUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._context.extensionUri, 'out', 'webview.css')
        );

        // Send initial state to React app after render
        setTimeout(() => {
            this._view?.webview.postMessage({
                type: 'setAuthenticated',
                payload: {
                    authenticated: this._isAuthenticated,
                    user: this._user,
                    models: this._availableModels
                }
            });
            if (this._selectedModel) {
                this._view?.webview.postMessage({
                    type: 'updateModels',
                    payload: {
                        models: this._availableModels,
                        selected: this._selectedModel
                    }
                });
            }
        }, 100);

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="
        default-src 'none';
        style-src ${webview.cspSource} 'unsafe-inline';
        script-src 'nonce-${nonce}';
        font-src ${webview.cspSource};
        img-src ${webview.cspSource} https: data:;
    ">
    <link rel="stylesheet" href="${styleUri}">
    <title>Enterprise AI Chat</title>
    <style>
        /* Loading state while React initializes */
        html, body, #root {
            margin: 0;
            padding: 0;
            width: 100%;
            height: 100%;
            overflow: hidden;
        }
        body {
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            color: var(--vscode-foreground);
            background: var(--vscode-editor-background);
        }
        .loading-app {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            height: 100vh;
            color: var(--vscode-descriptionForeground);
            gap: 16px;
        }
        .loading-spinner {
            width: 32px;
            height: 32px;
            border: 3px solid var(--vscode-textLink-foreground);
            border-radius: 50%;
            border-top-color: transparent;
            animation: spin 1s linear infinite;
        }
        @keyframes spin {
            to { transform: rotate(360deg); }
        }
    </style>
</head>
<body>
    <div id="root">
        <div class="loading-app">
            <div class="loading-spinner"></div>
            <span>Loading chat interface...</span>
        </div>
    </div>
    <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
    }

    private _formatMarkdown(text: string): string {
        // Code blocks with action buttons
        let codeBlockId = 0;
        text = text.replace(/```(\w*)\n([\s\S]*?)```/g, (match, lang, code) => {
            const id = codeBlockId++;
            const escapedCode = code.replace(/'/g, "\\'").replace(/\n/g, '\\n');
            const language = lang || 'text';

            // Determine which buttons to show
            const isBashCommand = ['bash', 'sh', 'shell', 'zsh', 'terminal'].includes(language.toLowerCase());
            const isCode = !isBashCommand && language !== 'text' && language !== '';

            let buttons = `<button class="code-action" onclick="copyCode('${escapedCode}')">📋 Copia</button>`;

            if (isBashCommand) {
                buttons += `<button class="code-action run" onclick="runCommand('${escapedCode}')">▶️ Esegui</button>`;
            }
            if (isCode) {
                buttons += `<button class="code-action apply" onclick="applyCode('${escapedCode}', '${language}')">📝 Applica</button>`;
            }

            return `<div class="code-block">
                <div class="code-header">
                    <span class="code-lang">${language}</span>
                    <div class="code-actions">${buttons}</div>
                </div>
                <pre><code>${code}</code></pre>
            </div>`;
        });
        // Inline code
        text = text.replace(/`([^`]+)`/g, '<code>$1</code>');
        // Bold
        text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
        // Newlines
        text = text.replace(/\n/g, '<br>');
        return text;
    }
}

// ============================================
// UTILITIES
// ============================================

function getNonce() {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}

// ============================================
// DEACTIVATION
// ============================================

export function deactivate() {
    outputChannel?.appendLine('Extension deactivating');
}
