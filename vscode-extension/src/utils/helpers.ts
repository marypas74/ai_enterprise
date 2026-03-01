import * as vscode from 'vscode';
import * as https from 'https';
import axios, { AxiosInstance } from 'axios';
import {
    AgentSessionsProvider,
    TerminalSlotsProvider,
    AgentDashboardProvider,
    AgentApiService,
} from '../AgentPanel';

// ============================================
// TYPES & INTERFACES
// ============================================

export interface ChatMessage {
    role: 'user' | 'assistant' | 'system';
    content: string;
    timestamp: Date;
}

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
    tools: MCPTool[];
    status: 'connected' | 'disconnected' | 'error';
}

export interface MCPTool {
    name: string;
    description: string;
    inputSchema: object;
}

export interface VectorSearchResult {
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

export interface RAGConfig {
    enabled: boolean;
    provider: 'pinecone' | 'qdrant' | 'chroma' | 'weaviate' | 'backend';
    topK: number;
    minSimilarity: number;
    includeMetadata: boolean;
}

export interface Project {
    id: number;
    name: string;
    description: string;
    color: string;
    board_count: number;
    card_count: number;
}

export interface KanbanColumn {
    id: number;
    name: string;
    color: string;
}

export interface ProjectMember {
    id: number;
    name: string;
    email: string;
    role: string;
}

export interface KanbanNotification {
    id: number;
    type: 'card_assigned' | 'card_moved' | 'card_due' | 'mention';
    message: string;
    card_id?: number;
    card_title?: string;
    project_name?: string;
    created_at: string;
    read: boolean;
}

// ============================================
// CONSTANTS
// ============================================

export const CLAUDE_OAUTH_CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';
export const CLAUDE_OAUTH_AUTHORIZE_URL = 'https://claude.ai/oauth/authorize';
export const CLAUDE_OAUTH_TOKEN_URL = 'https://console.anthropic.com/v1/oauth/token';
export const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';

// Kanban loading guard constants
export const PROJECT_LOAD_COOLDOWN = 5000;
export const CIRCUIT_BREAKER_MAX_CALLS = 10;
export const CIRCUIT_BREAKER_WINDOW_MS = 10000;
export const CIRCUIT_BREAKER_RESET_MS = 30000;

// ============================================
// GLOBAL MUTABLE STATE
// ============================================

export const state = {
    api: undefined as AxiosInstance | undefined,
    accessToken: undefined as string | undefined,
    currentUser: undefined as { email: string; name: string } | undefined,
    outputChannel: undefined as vscode.OutputChannel | undefined,
    claudeOAuthToken: undefined as string | undefined,
    claudeRefreshToken: undefined as string | undefined,
    availableModels: [] as AvailableModel[],
    selectedModel: undefined as string | undefined,

    // Agent providers
    agentSessionsProvider: undefined as AgentSessionsProvider | undefined,
    terminalSlotsProvider: undefined as TerminalSlotsProvider | undefined,
    agentDashboardProvider: undefined as AgentDashboardProvider | undefined,
    agentApiService: undefined as AgentApiService | undefined,

    // AI Toolkit Features
    playgroundSettings: {
        temperature: 0.7,
        maxTokens: 4096,
        topP: 1.0,
        frequencyPenalty: 0,
        presencePenalty: 0,
        stopSequences: [],
    } as PlaygroundSettings,
    mcpServers: [] as MCPServer[],
    adminPromptTemplates: [] as PromptTemplate[],
    aiToolkitEnabled: false,

    // Kanban circuit breaker
    isLoadingProjects: false,
    projectsLoaded: false,
    lastProjectLoadTime: 0,
    projectLoadCallCount: 0,
    circuitBreakerWindowStart: 0,
    circuitBreakerTripped: false,
    circuitBreakerTripTime: 0,

    // RAG Configuration
    ragConfig: {
        enabled: false,
        provider: 'backend',
        topK: 5,
        minSimilarity: 0.7,
        includeMetadata: true,
    } as RAGConfig,

    // Claude OAuth pending references
    pendingOAuthContext: undefined as vscode.ExtensionContext | undefined,
    pendingOAuthChatProvider: undefined as any, // ChatViewProvider - avoid circular import
};

// ============================================
// UTILITY FUNCTIONS
// ============================================

export function getNonce(): string {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}

export function getOutputChannel(): vscode.OutputChannel {
    return state.outputChannel!;
}

export function getApi(): AxiosInstance {
    return state.api!;
}

export function getColumnColor(columnName: string): string {
    const colors: Record<string, string> = {
        'Backlog': '#6B7280',
        'To Do': '#6B7280',
        'In Progress': '#F59E0B',
        'Review': '#8B5CF6',
        'Done': '#10B981',
        'Completato': '#10B981',
    };
    return colors[columnName] || '#6B7280';
}

// ============================================
// API INITIALIZATION
// ============================================

export function initializeApi(): void {
    const config = vscode.workspace.getConfiguration('enterprise-ai-chat');
    const serverUrl = config.get<string>('serverUrl') || 'https://192.168.1.123';
    const allowSelfSigned = config.get<boolean>('allowSelfSignedCerts', true);

    if (allowSelfSigned) {
        process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
    }

    const httpsAgent = new https.Agent({
        rejectUnauthorized: !allowSelfSigned,
    });

    state.api = axios.create({
        baseURL: serverUrl,
        headers: { 'Content-Type': 'application/json' },
        httpsAgent: httpsAgent,
        timeout: 300000,
    });

    if (state.accessToken) {
        state.api.defaults.headers.common['Authorization'] = `Bearer ${state.accessToken}`;
    }
}

// ============================================
// CUSTOM INSTRUCTIONS
// ============================================

let cachedCustomInstructions: string | null = null;
let customInstructionsLoaded = false;

async function loadCustomInstructions(): Promise<string | null> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) { return null; }

    const instructionPaths = [
        '.github/copilot-instructions.md',
        '.enterprise-ai/instructions.md',
        'STYLE.md',
        '.cursorrules',
        '.ai-instructions.md',
    ];

    for (const folder of workspaceFolders) {
        for (const instructionPath of instructionPaths) {
            const fullPath = vscode.Uri.joinPath(folder.uri, instructionPath);
            try {
                const content = await vscode.workspace.fs.readFile(fullPath);
                const text = new TextDecoder().decode(content);
                getOutputChannel().appendLine(`Loaded custom instructions from: ${instructionPath}`);
                return text;
            } catch {
                continue;
            }
        }
    }

    return null;
}

export async function getCustomInstructions(): Promise<string | null> {
    if (!customInstructionsLoaded) {
        cachedCustomInstructions = await loadCustomInstructions();
        customInstructionsLoaded = true;
    }
    return cachedCustomInstructions;
}

export function invalidateCustomInstructionsCache(): void {
    customInstructionsLoaded = false;
}

// ============================================
// BUILT-IN PROMPT TEMPLATES
// ============================================

export const PROMPT_TEMPLATES: PromptTemplate[] = [
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
        category: 'code',
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
        category: 'debug',
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
        category: 'refactor',
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
        category: 'test',
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
        category: 'document',
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
        category: 'code',
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
        category: 'code',
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
        chainNext: 'prompt-chain-fix',
    },
];
