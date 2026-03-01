import * as vscode from 'vscode';
import {
    state,
    getOutputChannel,
    getApi,
    PlaygroundSettings,
    PromptTemplate,
    MCPServer,
    PROMPT_TEMPLATES,
} from '../utils/helpers';
import { ClaudeCodePanel } from '../ClaudeCodePanel';
import type { ChatViewProvider } from '../providers/ChatViewProvider';

/**
 * Fetch available models (panel version - used by ClaudeCodePanel)
 */
export async function fetchModelsForPanel(context: vscode.ExtensionContext): Promise<void> {
    const outputChannel = getOutputChannel();
    const api = getApi();

    try {
        outputChannel.appendLine('Fetching available models from backend...');
        const response = await api.get('/api/chat/models');
        const rawModels = response.data || [];

        state.availableModels = rawModels.map((m: any) => ({
            id: m.id || m.model_id || 'unknown',
            name: m.name || m.display_name || m.id || 'Unknown Model',
            provider: m.provider || m.provider_type || 'unknown',
        }));

        // Restore or set selected model
        const savedModel = context.globalState.get<string>('selectedModel');
        if (savedModel && state.availableModels.some(m => m.id === savedModel)) {
            state.selectedModel = savedModel;
        } else if (state.availableModels.length > 0) {
            state.selectedModel = state.availableModels[0].id;
            await context.globalState.update('selectedModel', state.selectedModel);
        }

        // Update panel if open
        const panel = ClaudeCodePanel.currentPanel;
        if (panel) {
            panel.updateModels(state.availableModels, state.selectedModel);
        }
    } catch (error: any) {
        outputChannel.appendLine(`Failed to fetch models: ${error.message}`);
        state.availableModels = [];
    }
}

/**
 * Fetch available models (ChatViewProvider version)
 */
export async function fetchAvailableModels(
    context: vscode.ExtensionContext,
    chatProvider: ChatViewProvider
): Promise<void> {
    const outputChannel = getOutputChannel();
    const api = getApi();

    try {
        outputChannel.appendLine('Fetching available models from backend...');
        const response = await api.get('/api/chat/models');
        outputChannel.appendLine(`RAW RESPONSE: ${JSON.stringify(response.data)}`);

        const rawModels = response.data || [];

        state.availableModels = rawModels.map((m: any) => ({
            id: m.id || m.model_id || 'unknown',
            name: m.name || m.display_name || m.id || 'Unknown Model',
            provider: m.provider || m.provider_type || 'unknown',
        }));

        outputChannel.appendLine(`MAPPED MODELS: ${JSON.stringify(state.availableModels.slice(0, 3))}`);

        // Restore or set selected model
        const savedModel = context.globalState.get<string>('selectedModel');
        if (savedModel && state.availableModels.some(m => m.id === savedModel)) {
            state.selectedModel = savedModel;
        } else if (state.availableModels.length > 0) {
            state.selectedModel = state.availableModels[0].id;
            await context.globalState.update('selectedModel', state.selectedModel);
        }

        chatProvider.updateModels(state.availableModels, state.selectedModel);
    } catch (error: any) {
        outputChannel.appendLine(`Failed to fetch models: ${error.message}`);
        state.availableModels = [];
    }
}

/**
 * Fetch AI Toolkit configuration from admin console
 */
export async function fetchAIToolkitConfig(chatProvider: ChatViewProvider): Promise<void> {
    const outputChannel = getOutputChannel();
    const api = getApi();

    try {
        outputChannel.appendLine('Fetching AI Toolkit configuration from admin...');
        const response = await api.get('/api/admin/ai-toolkit/config');

        if (response.data) {
            state.aiToolkitEnabled = response.data.enabled ?? false;
            outputChannel.appendLine(`AI Toolkit enabled: ${state.aiToolkitEnabled}`);

            if (response.data.playground) {
                state.playgroundSettings = {
                    temperature: response.data.playground.temperature ?? 0.7,
                    maxTokens: response.data.playground.max_tokens ?? 4096,
                    topP: response.data.playground.top_p ?? 1.0,
                    frequencyPenalty: response.data.playground.frequency_penalty ?? 0,
                    presencePenalty: response.data.playground.presence_penalty ?? 0,
                    stopSequences: response.data.playground.stop_sequences ?? [],
                };
                outputChannel.appendLine(`Playground settings loaded: temp=${state.playgroundSettings.temperature}`);
            }

            if (response.data.prompt_templates && Array.isArray(response.data.prompt_templates)) {
                state.adminPromptTemplates = response.data.prompt_templates.map((t: any) => ({
                    id: t.id || `template-${Date.now()}`,
                    name: t.name || 'Unnamed Template',
                    description: t.description || '',
                    template: t.template || '',
                    variables: t.variables || [],
                    category: t.category || 'custom',
                    chainNext: t.chain_next,
                }));
                outputChannel.appendLine(`Loaded ${state.adminPromptTemplates.length} admin prompt templates`);
            }

            if (response.data.mcp_servers && Array.isArray(response.data.mcp_servers)) {
                state.mcpServers = response.data.mcp_servers.map((s: any) => ({
                    id: s.id,
                    name: s.name,
                    type: s.type || 'stdio',
                    command: s.command,
                    url: s.url,
                    tools: s.tools || [],
                    status: 'disconnected' as const,
                }));
                outputChannel.appendLine(`Loaded ${state.mcpServers.length} MCP server configurations`);
            }

            chatProvider.updateAIToolkitConfig(
                state.aiToolkitEnabled,
                state.playgroundSettings,
                state.adminPromptTemplates,
                state.mcpServers
            );
        }
    } catch (error: any) {
        outputChannel.appendLine(`AI Toolkit config not available: ${error.message}`);
        chatProvider.updateAIToolkitConfig(true, state.playgroundSettings, PROMPT_TEMPLATES, []);
    }
}
