/**
 * RegisterCommands - Command registration extracted from activate()
 *
 * Extracted from extension.ts to keep each module under 800 LOC.
 * Contains the massive command registration block that was in activate().
 */

import * as vscode from 'vscode';
import { AxiosInstance } from 'axios';
import { ClaudeCodePanel } from '../ClaudeCodePanel';
import { codeActionWithPanel, addToChatPanel, addFileToContextPanel } from './CodeActions';
import { handleSendMessage, handleAgenticMessage, MessageHandlerDeps } from '../messaging/MessageHandler';

// ============================================
// TYPES
// ============================================

export interface RegisterCommandsDeps {
    context: vscode.ExtensionContext;
    api: AxiosInstance;
    outputChannel: vscode.OutputChannel;
    getAccessToken: () => string | undefined;
    setAccessToken: (token: string | undefined) => void;
    getCurrentUser: () => { email: string; name: string } | undefined;
    getSelectedModel: () => string | undefined;
    setSelectedModel: (model: string | undefined) => void;
    getAvailableModels: () => Array<{ id: string; name: string; provider: string }>;
    getPanel: () => ClaudeCodePanel;
    loginToBackend: (context: vscode.ExtensionContext) => Promise<void>;
    logoutFromBackend: (context: vscode.ExtensionContext) => Promise<void>;
    loginClaudeProPanel: (context: vscode.ExtensionContext) => Promise<void>;
    getCustomInstructions: () => Promise<string | null>;
    getColumnColor: (name: string) => string;
}

// ============================================
// REGISTER ALL COMMANDS
// ============================================

export function registerAllCommands(deps: RegisterCommandsDeps): vscode.Disposable[] {
    const {
        context, api, outputChannel,
        getAccessToken, setAccessToken, getCurrentUser,
        getSelectedModel, setSelectedModel, getAvailableModels,
        getPanel, loginToBackend, logoutFromBackend, loginClaudeProPanel,
        getCustomInstructions, getColumnColor,
    } = deps;

    const msgDeps = (): MessageHandlerDeps => ({
        accessToken: getAccessToken(),
        selectedModel: getSelectedModel(),
        outputChannel,
        getCustomInstructions,
    });

    const disposables: vscode.Disposable[] = [
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
            if (panel && getAccessToken() && getCurrentUser()) {
                panel.setAuthenticated(true, getCurrentUser(), getAvailableModels());
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

        // Code actions
        vscode.commands.registerCommand('enterprise-ai-chat.explainCode', () => codeActionWithPanel('explain', getPanel)),
        vscode.commands.registerCommand('enterprise-ai-chat.fixCode', () => codeActionWithPanel('fix', getPanel)),
        vscode.commands.registerCommand('enterprise-ai-chat.improveCode', () => codeActionWithPanel('improve', getPanel)),
        vscode.commands.registerCommand('enterprise-ai-chat.generateTests', () => codeActionWithPanel('tests', getPanel)),

        // Add to chat / file context
        vscode.commands.registerCommand('enterprise-ai-chat.addToChat', () => addToChatPanel(getPanel)),
        vscode.commands.registerCommand('enterprise-ai-chat.addFileToContext', () => addFileToContextPanel(getPanel)),

        // Inline Edit (Cursor Ctrl+K Style)
        vscode.commands.registerCommand('enterprise-ai-chat.inlineEdit', () =>
            handleInlineEdit(deps)
        ),

        // Context Tagging (@workspace, @file, @selection)
        vscode.commands.registerCommand('enterprise-ai-chat.chatWithContext', () =>
            handleChatWithContext(deps)
        ),

        // Settings
        vscode.commands.registerCommand('enterprise-ai-chat.configure', () => {
            vscode.commands.executeCommand('workbench.action.openSettings', 'enterprise-ai-chat');
        }),

        // Claude Pro login
        vscode.commands.registerCommand('enterprise-ai-chat.loginClaudePro', () => loginClaudeProPanel(context)),

        // AI Toolkit Commands (simplified)
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
                placeHolder: 'Enter your query...',
            });
            if (query) {
                const panel = getPanel();
                panel.addMessage('user', `RAG Search: ${query}`);
            }
        }),

        // Handle send message from panel
        vscode.commands.registerCommand('enterprise-ai-chat.sendMessage', async (message: string, chatMode?: string) => {
            await handleSendMessage(message, msgDeps(), chatMode);
        }),

        // Handle agentic message
        vscode.commands.registerCommand('enterprise-ai-chat.sendAgenticMessage', async (message: string, projectId: number) => {
            outputChannel.appendLine(`[Agentic Command] Received: message=${message?.substring(0, 50)}..., projectId=${projectId}`);
            const panel = getPanel();
            await handleAgenticMessage(panel, message, projectId, msgDeps());
        }),

        // Handle abort request
        vscode.commands.registerCommand('enterprise-ai-chat.abortRequest', () => {
            outputChannel.appendLine('[Abort] Request aborted by user');
        }),

        // Handle model selection
        vscode.commands.registerCommand('enterprise-ai-chat.selectModel', (modelId: string) => {
            setSelectedModel(modelId);
            context.globalState.update('selectedModel', modelId);
            outputChannel.appendLine(`Model selected: ${modelId}`);
        }),

        // Get version info
        vscode.commands.registerCommand('enterprise-ai-chat.getVersionInfo', async () => {
            const extensionVersion = '3.0.0';
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
                    backend: backendVersion,
                },
            });
        }),

        // Chat History Commands
        ...registerHistoryCommands(deps),

        // Kanban Commands
        ...registerKanbanCommands(deps),
    ];

    return disposables;
}

// ============================================
// INLINE EDIT COMMAND
// ============================================

async function handleInlineEdit(deps: RegisterCommandsDeps): Promise<void> {
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

    const instruction = await vscode.window.showInputBox({
        prompt: 'Describe the change you want to make',
        placeHolder: 'e.g., Add error handling, Convert to async/await, Add comments...',
        ignoreFocusOut: true,
    });

    if (!instruction) { return; }

    try {
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'Generating code edit...',
            cancellable: false,
        }, async () => {
            const customInstructions = await deps.getCustomInstructions();
            let systemPrompt = `You are a code editor assistant. When given code and an instruction, output ONLY the modified code without any explanation, markdown formatting, or code blocks. Output the raw code only.`;

            if (customInstructions) {
                systemPrompt += `\n\nProject-specific coding guidelines:\n${customInstructions}`;
            }

            const response = await deps.api.post('/api/chat/completions', {
                model: deps.getSelectedModel() || 'gpt-4o',
                messages: [
                    { role: 'system', content: systemPrompt },
                    {
                        role: 'user',
                        content: `Modify this ${editor.document.languageId} code according to the instruction.\n\nCode:\n${selectedText}\n\nInstruction: ${instruction}\n\nOutput only the modified code, nothing else:`,
                    },
                ],
                temperature: 0.3,
                max_tokens: 4096,
            });

            const newCode = response.data.choices?.[0]?.message?.content?.trim() || '';

            if (!newCode) {
                vscode.window.showErrorMessage('Failed to generate code edit');
                return;
            }

            const accept = await vscode.window.showInformationMessage(
                'Apply the AI-generated edit?',
                {
                    modal: true,
                    detail: `Original:\n${selectedText.substring(0, 100)}...\n\nNew:\n${newCode.substring(0, 100)}...`,
                },
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
        deps.outputChannel.appendLine(`Inline edit error: ${error.message}`);
        vscode.window.showErrorMessage(`Failed to generate edit: ${error.message}`);
    }
}

// ============================================
// CHAT WITH CONTEXT COMMAND
// ============================================

async function handleChatWithContext(deps: RegisterCommandsDeps): Promise<void> {
    const editor = vscode.window.activeTextEditor;

    const contextOptions = [
        { label: '@selection', description: 'Include selected code', picked: !!editor?.selection && !editor.selection.isEmpty },
        { label: '@file', description: 'Include current file', picked: !!editor },
        { label: '@workspace', description: 'Include workspace info', picked: false },
    ];

    const selectedContexts = await vscode.window.showQuickPick(contextOptions, {
        canPickMany: true,
        placeHolder: 'Select context to include in chat',
        title: 'Chat Context',
    });

    if (!selectedContexts || selectedContexts.length === 0) { return; }

    const message = await vscode.window.showInputBox({
        prompt: 'Enter your message',
        placeHolder: 'What would you like to ask?',
        ignoreFocusOut: true,
    });

    if (!message) { return; }

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

    const panel = deps.getPanel();
    panel.addMessage('user', `${message}\n${contextString}`);
}

// ============================================
// HISTORY COMMANDS
// ============================================

function registerHistoryCommands(deps: RegisterCommandsDeps): vscode.Disposable[] {
    const { api, outputChannel, getAccessToken, getPanel } = deps;

    return [
        vscode.commands.registerCommand('enterprise-ai-chat.loadHistory', async () => {
            const panel = getPanel();
            try {
                outputChannel.appendLine('[History] Loading chat history...');

                if (!getAccessToken()) {
                    outputChannel.appendLine('[History] No access token - user not authenticated');
                    panel.postMessage({
                        type: 'setHistory',
                        payload: { conversations: [], error: 'Please login first' },
                    });
                    return;
                }

                const authHeaders = { headers: { 'Authorization': `Bearer ${getAccessToken()}` } };
                const response = await api.get('/api/chat/conversations', {
                    ...authHeaders,
                    params: { archived: false, limit: 50, offset: 0 },
                });

                const conversations = response.data || [];
                outputChannel.appendLine(`[History] Loaded ${conversations.length} conversations`);

                panel.postMessage({
                    type: 'setHistory',
                    payload: { conversations },
                });
            } catch (error: any) {
                outputChannel.appendLine(`[History] Error loading history: ${error.message}`);
                panel.postMessage({
                    type: 'setHistory',
                    payload: { conversations: [], error: error.message },
                });
            }
        }),

        vscode.commands.registerCommand('enterprise-ai-chat.loadConversation', async (conversationId: number) => {
            try {
                outputChannel.appendLine(`[History] Loading conversation ${conversationId}...`);
                if (!getAccessToken()) {
                    outputChannel.appendLine('[History] No access token');
                    return;
                }

                const authHeaders = { headers: { 'Authorization': `Bearer ${getAccessToken()}` } };
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
                            timestamp: m.created_at,
                        })),
                    },
                });
            } catch (error: any) {
                outputChannel.appendLine(`[History] Error loading conversation: ${error.message}`);
            }
        }),

        vscode.commands.registerCommand('enterprise-ai-chat.deleteConversation', async (conversationId: number) => {
            try {
                outputChannel.appendLine(`[History] Deleting conversation ${conversationId}...`);
                if (!getAccessToken()) { return; }

                const authHeaders = { headers: { 'Authorization': `Bearer ${getAccessToken()}` } };
                await api.delete(`/api/chat/conversations/${conversationId}`, authHeaders);

                outputChannel.appendLine(`[History] Conversation ${conversationId} deleted`);
                vscode.commands.executeCommand('enterprise-ai-chat.loadHistory');
            } catch (error: any) {
                outputChannel.appendLine(`[History] Error deleting conversation: ${error.message}`);
            }
        }),
    ];
}

// ============================================
// KANBAN COMMANDS
// ============================================

function registerKanbanCommands(deps: RegisterCommandsDeps): vscode.Disposable[] {
    const { api, outputChannel, getAccessToken, getPanel, getColumnColor } = deps;

    // Kanban circuit breaker state
    let isLoadingProjects = false;
    let projectsLoaded = false;
    let lastProjectLoadTime = 0;
    const PROJECT_LOAD_COOLDOWN = 5000;
    let projectLoadCallCount = 0;
    let circuitBreakerWindowStart = 0;
    const CIRCUIT_BREAKER_MAX_CALLS = 10;
    const CIRCUIT_BREAKER_WINDOW_MS = 10000;
    let circuitBreakerTripped = false;
    let circuitBreakerTripTime = 0;
    const CIRCUIT_BREAKER_RESET_MS = 30000;

    return [
        vscode.commands.registerCommand('enterprise-ai-chat.loadProjects', async () => {
            const now = Date.now();

            if (circuitBreakerTripped && (now - circuitBreakerTripTime > CIRCUIT_BREAKER_RESET_MS)) {
                outputChannel.appendLine('[Kanban] CIRCUIT BREAKER AUTO-RESET after 30s cooldown');
                circuitBreakerTripped = false;
                projectLoadCallCount = 0;
                circuitBreakerWindowStart = now;
            }

            if (circuitBreakerTripped) {
                const remainingMs = CIRCUIT_BREAKER_RESET_MS - (now - circuitBreakerTripTime);
                outputChannel.appendLine(`[Kanban] CIRCUIT BREAKER ACTIVE - resets in ${Math.ceil(remainingMs / 1000)}s`);
                return;
            }

            if (now - circuitBreakerWindowStart > CIRCUIT_BREAKER_WINDOW_MS) {
                projectLoadCallCount = 0;
                circuitBreakerWindowStart = now;
            }

            projectLoadCallCount++;

            if (projectLoadCallCount > CIRCUIT_BREAKER_MAX_CALLS) {
                circuitBreakerTripped = true;
                circuitBreakerTripTime = now;
                outputChannel.appendLine(`[Kanban] CIRCUIT BREAKER TRIGGERED: ${projectLoadCallCount} calls in ${CIRCUIT_BREAKER_WINDOW_MS / 1000}s`);
                return;
            }

            if (isLoadingProjects) {
                outputChannel.appendLine('[Kanban] Skipping - already loading projects');
                return;
            }

            if (projectsLoaded && (now - lastProjectLoadTime) < PROJECT_LOAD_COOLDOWN) {
                outputChannel.appendLine(`[Kanban] Skipping - projects loaded ${now - lastProjectLoadTime}ms ago`);
                return;
            }

            isLoadingProjects = true;
            lastProjectLoadTime = now;

            try {
                outputChannel.appendLine('Loading Kanban projects...');

                if (!getAccessToken()) {
                    outputChannel.appendLine('WARNING: No access token');
                    vscode.window.showWarningMessage('Please login first to access Kanban');
                    return;
                }

                const authHeaders = { headers: { 'Authorization': `Bearer ${getAccessToken()}` } };

                try {
                    const accessResponse = await api.get('/api/projects/kanban-access', authHeaders);
                    if (!accessResponse.data.hasKanbanAccess) {
                        const panel = getPanel();
                        panel.postMessage({
                            type: 'kanbanAccessDenied',
                            payload: { message: 'Your user group does not have Kanban access', groups: accessResponse.data.groups },
                        });
                        return;
                    }
                } catch {
                    // Access check failed, continue anyway
                }

                const response = await api.get('/api/projects', authHeaders);
                const projects = response.data || [];
                outputChannel.appendLine(`Loaded ${projects.length} projects`);
                projectsLoaded = true;

                const panel = getPanel();
                panel.postMessage({ type: 'setProjects', payload: { projects } });
            } catch (error: any) {
                outputChannel.appendLine(`Error loading projects: ${error.message}`);

                if (error.response?.status === 429) {
                    projectsLoaded = true;
                    vscode.window.showWarningMessage('Rate limit exceeded. Please wait before retrying.');
                    return;
                }

                if (error.response?.status === 403 && error.response?.data?.error === 'Kanban access denied') {
                    const panel = getPanel();
                    panel.postMessage({
                        type: 'kanbanAccessDenied',
                        payload: { message: error.response.data.message || 'Kanban access denied' },
                    });
                    vscode.window.showWarningMessage('Your user group does not have Kanban access');
                } else {
                    vscode.window.showErrorMessage('Failed to load Kanban projects');
                }
            } finally {
                isLoadingProjects = false;
            }
        }),

        vscode.commands.registerCommand('enterprise-ai-chat.selectKanbanProject', async (projectId: number) => {
            try {
                if (!getAccessToken()) {
                    vscode.window.showWarningMessage('Please login first to access Kanban');
                    return;
                }

                outputChannel.appendLine(`Loading Kanban board for project ${projectId}...`);
                const authHeaders = { headers: { 'Authorization': `Bearer ${getAccessToken()}` } };

                const projectResponse = await api.get(`/api/projects/${projectId}`, authHeaders);
                const project = projectResponse.data;

                if (!project.boards || project.boards.length === 0) {
                    vscode.window.showWarningMessage('This project has no Kanban boards');
                    return;
                }

                const boardId = project.boards[0].id;
                const boardResponse = await api.get(`/api/projects/${projectId}/boards/${boardId}`, authHeaders);
                const board = boardResponse.data;

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
                        status: col.name,
                    })),
                }));

                const panel = getPanel();
                panel.postMessage({ type: 'setKanbanColumns', payload: { columns, boardId, projectId } });
            } catch (error: any) {
                outputChannel.appendLine(`Error loading Kanban board: ${error.message}`);
                vscode.window.showErrorMessage('Failed to load Kanban board');
            }
        }),

        vscode.commands.registerCommand('enterprise-ai-chat.moveKanbanCard', async (cardId: number, columnId: number, projectId?: number) => {
            try {
                if (!getAccessToken()) { return; }
                outputChannel.appendLine(`Moving card ${cardId} to column ${columnId}...`);
                const authHeaders = { headers: { 'Authorization': `Bearer ${getAccessToken()}` } };

                await api.post(`/api/projects/${projectId}/cards/${cardId}/move`, { column_id: columnId }, authHeaders);
                outputChannel.appendLine(`Card ${cardId} moved to column ${columnId}`);

                const panel = getPanel();
                panel.postMessage({ type: 'kanbanCardUpdated', payload: { cardId, columnId, success: true } });
            } catch (error: any) {
                outputChannel.appendLine(`Error moving card: ${error.message}`);
                vscode.window.showErrorMessage('Failed to move card');
            }
        }),

        vscode.commands.registerCommand('enterprise-ai-chat.completeTaskWithFeedback', async (taskId: number, feedback: string) => {
            try {
                outputChannel.appendLine(`Completing task ${taskId} with feedback...`);
                await api.patch(`/api/tasks/${taskId}`, {
                    status: 'Done',
                    feedback,
                    completed_at: new Date().toISOString(),
                });

                const panel = getPanel();
                panel.postMessage({ type: 'kanbanTaskCompleted', payload: { taskId, success: true } });
                vscode.window.showInformationMessage('Task completed with feedback');
            } catch (error: any) {
                outputChannel.appendLine(`Error completing task: ${error.message}`);
                vscode.window.showErrorMessage('Failed to complete task');
            }
        }),

        vscode.commands.registerCommand('enterprise-ai-chat.addKanbanComment', async (projectId: number, taskId: number, content: string) => {
            try {
                outputChannel.appendLine(`Adding note to task ${taskId}...`);
                await api.patch(`/api/tasks/${taskId}`, { ai_context: content });

                const panel = getPanel();
                panel.postMessage({ type: 'kanbanNoteAdded', payload: { taskId, success: true } });
                vscode.window.showInformationMessage('Development note added successfully');
            } catch (error: any) {
                outputChannel.appendLine(`Error adding comment: ${error.message}`);
                vscode.window.showErrorMessage('Failed to add development note');
            }
        }),
    ];
}
