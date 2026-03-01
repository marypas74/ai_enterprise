import * as vscode from 'vscode';
import { state, getOutputChannel, getApi } from '../utils/helpers';
import { ClaudeCodePanel } from '../ClaudeCodePanel';
import { fetchModelsForPanel } from '../models/ModelFetcher';
import type { ChatViewProvider } from '../providers/ChatViewProvider';

/**
 * Login to backend server (panel version - used by ClaudeCodePanel commands)
 */
export async function loginToBackend(context: vscode.ExtensionContext): Promise<void> {
    const outputChannel = getOutputChannel();
    const api = getApi();
    const config = vscode.workspace.getConfiguration('enterprise-ai-chat');
    const serverUrl = config.get<string>('serverUrl') || 'https://192.168.1.123';

    outputChannel.appendLine(`=== LOGIN ATTEMPT ===`);
    outputChannel.appendLine(`Server URL: ${serverUrl}`);

    const email = await vscode.window.showInputBox({
        prompt: 'Email',
        placeHolder: 'admin@enterprise.local',
        value: 'admin@enterprise.local',
    });
    if (!email) { return; }

    const password = await vscode.window.showInputBox({
        prompt: 'Password',
        password: true,
    });
    if (!password) { return; }

    try {
        outputChannel.appendLine(`Attempting login for: ${email}`);
        let response = await api.post('/api/auth/login', { email, password });

        outputChannel.appendLine(`Login response status: ${response.status}`);
        outputChannel.appendLine(`Response data keys: ${Object.keys(response.data).join(', ')}`);

        // Handle MFA
        if (response.data.mfa_required) {
            outputChannel.appendLine('MFA required, prompting for TOTP code');
            const totpCode = await vscode.window.showInputBox({
                prompt: 'Enter TOTP code from your authenticator app',
                placeHolder: '000000',
                validateInput: (v) => /^\d{6}$/.test(v) ? null : 'Enter a 6-digit code',
            });
            if (!totpCode) { return; }
            response = await api.post('/api/auth/login', { email, password, totp_code: totpCode });
            outputChannel.appendLine(`MFA login response status: ${response.status}`);
        }

        // Handle MFA setup required
        if (response.data.mfa_setup_required) {
            state.accessToken = response.data.accessToken;
            api.defaults.headers.common['Authorization'] = `Bearer ${state.accessToken}`;
            vscode.window.showWarningMessage(
                'MFA setup is mandatory. Please complete MFA setup in the web interface first.'
            );
            return;
        }

        state.accessToken = response.data.accessToken;
        state.currentUser = response.data.user;

        if (!state.accessToken) {
            outputChannel.appendLine('ERROR: No accessToken in response!');
            outputChannel.appendLine(`Full response: ${JSON.stringify(response.data)}`);
            vscode.window.showErrorMessage('Login failed: No access token received');
            return;
        }

        outputChannel.appendLine(`Access token received: ${state.accessToken.substring(0, 30)}...`);
        outputChannel.appendLine(`User: ${state.currentUser?.name} (${state.currentUser?.email})`);

        api.defaults.headers.common['Authorization'] = `Bearer ${state.accessToken}`;
        await context.globalState.update('accessToken', state.accessToken);
        await context.globalState.update('currentUser', state.currentUser);

        // Fetch available models from backend
        await fetchModelsForPanel(context);

        // Update panel if open
        const panel = ClaudeCodePanel.currentPanel;
        if (panel) {
            panel.setAuthenticated(true, state.currentUser, state.availableModels);
            if (state.selectedModel) {
                panel.updateModels(state.availableModels, state.selectedModel);
            }
        }

        // Update agent providers with new credentials
        const agentServerUrl = config.get<string>('serverUrl') || 'https://192.168.1.123';
        if (state.agentSessionsProvider) {
            state.agentSessionsProvider.updateCredentials(agentServerUrl, state.accessToken || null);
            outputChannel.appendLine('[Auth] AgentSessionsProvider credentials updated');
        }
        if (state.terminalSlotsProvider) {
            state.terminalSlotsProvider.updateCredentials(agentServerUrl, state.accessToken || null);
            outputChannel.appendLine('[Auth] TerminalSlotsProvider credentials updated');
        }
        if (state.agentDashboardProvider) {
            state.agentDashboardProvider.updateCredentials(agentServerUrl, state.accessToken || null);
            outputChannel.appendLine('[Auth] AgentDashboardProvider credentials updated');
        }
        if (state.agentApiService) {
            state.agentApiService.updateCredentials(agentServerUrl, state.accessToken || null);
            outputChannel.appendLine('[Auth] AgentApiService credentials updated');
        }

        vscode.window.showInformationMessage(`Connected as ${state.currentUser?.name}`);
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
 * Logout from backend (panel version)
 */
export async function logoutFromBackend(context: vscode.ExtensionContext): Promise<void> {
    const api = getApi();
    state.accessToken = undefined;
    state.currentUser = undefined;
    state.availableModels = [];
    state.selectedModel = undefined;
    api.defaults.headers.common['Authorization'] = '';
    await context.globalState.update('accessToken', undefined);
    await context.globalState.update('currentUser', undefined);
    vscode.window.showInformationMessage('Logged out');
}

/**
 * Login to backend (ChatViewProvider version - unified with panel version)
 */
export async function login(
    context: vscode.ExtensionContext,
    chatProvider: ChatViewProvider
): Promise<void> {
    const api = getApi();

    const email = await vscode.window.showInputBox({
        prompt: 'Email',
        placeHolder: 'admin@enterprise.local',
        value: 'admin@enterprise.local',
    });
    if (!email) { return; }

    const password = await vscode.window.showInputBox({
        prompt: 'Password',
        password: true,
    });
    if (!password) { return; }

    try {
        let response = await api.post('/api/auth/login', { email, password });

        if (response.data.mfa_required) {
            const totpCode = await vscode.window.showInputBox({
                prompt: 'Enter TOTP code from your authenticator app',
                placeHolder: '000000',
                validateInput: (v) => /^\d{6}$/.test(v) ? null : 'Enter a 6-digit code',
            });
            if (!totpCode) { return; }
            response = await api.post('/api/auth/login', { email, password, totp_code: totpCode });
        }

        if (response.data.mfa_setup_required) {
            vscode.window.showWarningMessage(
                'MFA setup is mandatory. Please complete MFA setup in the web interface first.'
            );
            return;
        }

        state.accessToken = response.data.accessToken;
        state.currentUser = response.data.user;
        api.defaults.headers.common['Authorization'] = `Bearer ${state.accessToken}`;
        await context.globalState.update('accessToken', state.accessToken);
        await context.globalState.update('currentUser', state.currentUser);

        // Fetch available models
        const { fetchAvailableModels, fetchAIToolkitConfig } = await import('../models/ModelFetcher');
        await fetchAvailableModels(context, chatProvider);
        await fetchAIToolkitConfig(chatProvider);

        vscode.window.showInformationMessage(`Connesso come ${state.currentUser?.name}`);
        chatProvider.setAuthenticated(true, state.currentUser, state.availableModels, state.selectedModel);
    } catch (error: any) {
        vscode.window.showErrorMessage(`Login fallito: ${error.response?.data?.error || error.message}`);
    }
}

/**
 * Logout (ChatViewProvider version)
 */
export async function logout(
    context: vscode.ExtensionContext,
    chatProvider: ChatViewProvider
): Promise<void> {
    const api = getApi();
    state.accessToken = undefined;
    state.currentUser = undefined;
    delete api.defaults.headers.common['Authorization'];
    await context.globalState.update('accessToken', undefined);
    await context.globalState.update('currentUser', undefined);
    vscode.window.showInformationMessage('Disconnesso');
    chatProvider.setAuthenticated(false, undefined);
}
