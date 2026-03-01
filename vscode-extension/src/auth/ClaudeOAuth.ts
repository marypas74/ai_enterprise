import * as vscode from 'vscode';
import axios from 'axios';
import {
    state,
    getOutputChannel,
    CLAUDE_OAUTH_CLIENT_ID,
    CLAUDE_OAUTH_TOKEN_URL,
} from '../utils/helpers';
import type { ChatViewProvider } from '../providers/ChatViewProvider';

/**
 * Claude OAuth URI Handler for Pro/Max subscription login
 */
export class ClaudeOAuthUriHandler implements vscode.UriHandler {
    async handleUri(uri: vscode.Uri): Promise<void> {
        const outputChannel = getOutputChannel();
        outputChannel.appendLine('OAuth callback received: ' + uri.toString());

        if (uri.path !== '/oauth-callback') {
            return;
        }

        const params = new URLSearchParams(uri.query);
        const code = params.get('code');
        const uriState = params.get('state');
        const error = params.get('error');

        if (error) {
            vscode.window.showErrorMessage(`OAuth error: ${error}`);
            return;
        }

        if (!code || !uriState) {
            vscode.window.showErrorMessage('OAuth callback missing code or state');
            return;
        }

        if (!state.pendingOAuthContext || !state.pendingOAuthChatProvider) {
            vscode.window.showErrorMessage('OAuth context lost. Please try again.');
            return;
        }

        // Verify state
        const savedState = state.pendingOAuthContext.globalState.get<string>('claudeOAuthState');
        if (uriState !== savedState) {
            vscode.window.showErrorMessage('OAuth state mismatch. Please try again.');
            return;
        }

        // Exchange code for token
        try {
            const codeVerifier = state.pendingOAuthContext.globalState.get<string>('claudeCodeVerifier');
            const redirectUri = 'vscode://enterprise-ai.enterprise-ai-chat/oauth-callback';

            outputChannel.appendLine('Exchanging code for token...');

            const response = await axios.post(CLAUDE_OAUTH_TOKEN_URL, {
                grant_type: 'authorization_code',
                client_id: CLAUDE_OAUTH_CLIENT_ID,
                code: code,
                redirect_uri: redirectUri,
                code_verifier: codeVerifier,
            }, {
                headers: { 'Content-Type': 'application/json' },
            });

            const accessTokenResult = response.data.access_token;
            const refreshToken = response.data.refresh_token;

            if (accessTokenResult) {
                state.claudeOAuthToken = accessTokenResult;
                state.claudeRefreshToken = refreshToken;
                await state.pendingOAuthContext.globalState.update('claudeOAuthToken', accessTokenResult);
                await state.pendingOAuthContext.globalState.update('claudeRefreshToken', refreshToken);

                vscode.window.showInformationMessage('Login Claude Pro completato!');
                state.pendingOAuthChatProvider.setClaudeProAuthenticated(true);

                outputChannel.appendLine('OAuth token obtained successfully');
            } else {
                throw new Error('No access token in response');
            }
        } catch (err: any) {
            outputChannel.appendLine('Token exchange error: ' + JSON.stringify(err.response?.data || err.message));
            vscode.window.showErrorMessage(`Token exchange failed: ${err.response?.data?.error || err.message}`);
        }
    }
}

/**
 * Claude Pro OAuth login (ChatViewProvider version)
 */
export async function loginClaudePro(
    context: vscode.ExtensionContext,
    chatProvider: ChatViewProvider
): Promise<void> {
    const choice = await vscode.window.showInformationMessage(
        'Claude Pro/Max OAuth \u00e8 limitato a Claude Code ufficiale.\n\n' +
        'Per usare Claude in questa estensione:\n' +
        '1. Usa una API Key (console.anthropic.com)\n' +
        '2. Oppure usa l\'estensione Claude Code ufficiale',
        'Configura API Key',
        'Pi\u00f9 info'
    );

    if (choice === 'Configura API Key') {
        await vscode.workspace.getConfiguration('enterprise-ai-chat').update('claudeAuthMode', 'api', true);
        vscode.commands.executeCommand('workbench.action.openSettings', 'enterprise-ai-chat.claudeApiKey');
    } else if (choice === 'Pi\u00f9 info') {
        vscode.env.openExternal(vscode.Uri.parse('https://support.claude.com/en/articles/9876003'));
    }
    return;

    /* NOTA: OAuth flow disabilitato - token Pro/Max sono restricted lato server */
}

/**
 * Claude Pro OAuth login (panel version)
 */
export async function loginClaudeProPanel(context: vscode.ExtensionContext): Promise<void> {
    vscode.window.showInformationMessage(
        'Claude Pro OAuth is not fully supported for programmatic access. Please use API key authentication instead.',
        'Open Settings'
    ).then(selection => {
        if (selection === 'Open Settings') {
            vscode.commands.executeCommand('workbench.action.openSettings', 'enterprise-ai-chat.claudeApiKey');
        }
    });
}
