import * as vscode from 'vscode';
import { EventBus } from './core/EventBus';
import { ConfigService } from './core/ConfigService';
import { ApiClient } from './core/ApiClient';
import { AuthService } from './core/AuthService';
import { ChatPanel } from './modules/chat/ChatPanel';
import { registerChatCommands } from './modules/chat/ChatCommands';
import { registerCodeActionCommands } from './modules/code-actions/CodeActionCommands';
import { EnterpriseAICodeActionProvider } from './modules/code-actions/CodeActionProvider';
import { OUTPUT_CHANNEL_NAME } from './utils/constants';
import type { ModuleContext } from './core/types';

export function activate(context: vscode.ExtensionContext): void {
  const outputChannel = vscode.window.createOutputChannel(OUTPUT_CHANNEL_NAME);
  outputChannel.appendLine('[Extension] Activating Enterprise AI...');

  // Core services
  const eventBus = new EventBus();
  const configService = new ConfigService(eventBus);
  const apiClient = new ApiClient(configService, eventBus, outputChannel);
  const authService = new AuthService(apiClient, eventBus, context, outputChannel);

  const moduleContext: ModuleContext = {
    extensionContext: context,
    apiClient,
    authService,
    configService,
    eventBus,
    outputChannel,
  };

  // Chat panel (lazy)
  let chatPanel: ChatPanel | null = null;
  const getPanel = (): ChatPanel => {
    if (!chatPanel) {
      chatPanel = new ChatPanel(moduleContext);
    }
    return chatPanel;
  };

  // Register commands
  const disposables = [
    ...registerChatCommands(moduleContext, getPanel),
    ...registerCodeActionCommands(getPanel),
    vscode.languages.registerCodeActionsProvider(
      { scheme: 'file' },
      new EnterpriseAICodeActionProvider(),
      { providedCodeActionKinds: EnterpriseAICodeActionProvider.providedCodeActionKinds },
    ),
  ];

  context.subscriptions.push(...disposables, outputChannel);

  // Restore session
  authService.tryRestoreSession();
  outputChannel.appendLine('[Extension] Activated');
}

export function deactivate(): void {
  // Cleanup handled by disposables
}
