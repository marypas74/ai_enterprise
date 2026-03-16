import * as vscode from 'vscode';
import { EventBus } from './core/EventBus';
import { ConfigService } from './core/ConfigService';
import { ApiClient } from './core/ApiClient';
import { AuthService } from './core/AuthService';
import { ChatPanel } from './modules/chat/ChatPanel';
import { registerChatCommands } from './modules/chat/ChatCommands';
import { registerCodeActionCommands } from './modules/code-actions/CodeActionCommands';
import { EnterpriseAICodeActionProvider } from './modules/code-actions/CodeActionProvider';
import { AgentService } from './modules/agents/AgentService';
import { AgentPanel } from './modules/agents/AgentPanel';
import { registerAgentCommands } from './modules/agents/AgentCommands';
import { OrchestratorService } from './modules/orchestrator/OrchestratorService';
import { OrchestratorStatusBar } from './modules/orchestrator/OrchestratorStatusBar';
import { OrchestratorPanel } from './modules/orchestrator/OrchestratorPanel';
import { DocumentService } from './modules/documents/DocumentService';
import { DocumentProvider } from './modules/documents/DocumentProvider';
import { registerDocumentCommands } from './modules/documents/DocumentCommands';
import { WorktreeService } from './modules/worktree/WorktreeService';
import { WorktreeScmProvider, WorktreeContentProvider } from './modules/worktree/WorktreeScmProvider';
import { registerWorktreeCommands } from './modules/worktree/WorktreeCommands';
import { OUTPUT_CHANNEL_NAME } from './utils/constants';
import type { ModuleContext } from './core/types';

export function activate(context: vscode.ExtensionContext): void {
  const startTime = Date.now();
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

  // Documents module
  const documentService = new DocumentService(apiClient, eventBus, outputChannel);

  // Chat panel (lazy)
  let chatPanel: ChatPanel | null = null;
  const getChatPanel = (): ChatPanel => {
    if (!chatPanel) {
      chatPanel = new ChatPanel(moduleContext);
      // Wire up document provider
      if (documentProvider) {
        chatPanel.setDocumentProvider(documentProvider);
      }
    }
    return chatPanel;
  };

  // DocumentProvider bridges webview <-> DocumentService
  const documentProvider = new DocumentProvider(moduleContext, documentService, getChatPanel);

  // Agents module
  const agentService = new AgentService(apiClient, eventBus, outputChannel);
  let agentPanel: AgentPanel | null = null;
  const getAgentPanel = (): AgentPanel => {
    if (!agentPanel) {
      agentPanel = new AgentPanel(moduleContext, agentService);
    }
    return agentPanel;
  };

  // Orchestrator module
  const orchestratorService = new OrchestratorService(apiClient, eventBus, configService, outputChannel);
  const orchestratorStatusBar = new OrchestratorStatusBar(eventBus, orchestratorService, configService);
  let orchestratorPanel: OrchestratorPanel | null = null;
  const getOrchestratorPanel = (): OrchestratorPanel => {
    if (!orchestratorPanel) {
      orchestratorPanel = new OrchestratorPanel(moduleContext, orchestratorService, orchestratorStatusBar);
    }
    return orchestratorPanel;
  };

  // Worktree module
  const worktreeService = new WorktreeService(apiClient, eventBus, outputChannel);
  let worktreeScmProvider: WorktreeScmProvider | null = null;
  const getScmProvider = (): WorktreeScmProvider => {
    if (!worktreeScmProvider) {
      worktreeScmProvider = new WorktreeScmProvider(worktreeService, eventBus, outputChannel);
      worktreeScmProvider.startPolling(configService.getWorktreePollingInterval());
      worktreeScmProvider.refresh();
    }
    return worktreeScmProvider;
  };

  // Register commands
  const disposables = [
    ...registerChatCommands(moduleContext, getChatPanel),
    ...registerCodeActionCommands(getChatPanel),
    ...registerAgentCommands(moduleContext, agentService, getAgentPanel),
    ...registerDocumentCommands(documentService),
    ...registerWorktreeCommands(getScmProvider),
    vscode.commands.registerCommand('enterprise-ai.openOrchestrator', () => {
      if (!authService.isAuthenticated()) {
        vscode.window.showWarningMessage('Login required to open orchestrator.');
        return;
      }
      getOrchestratorPanel().show();
    }),
    vscode.languages.registerCodeActionsProvider(
      { scheme: 'file' },
      new EnterpriseAICodeActionProvider(),
      { providedCodeActionKinds: EnterpriseAICodeActionProvider.providedCodeActionKinds },
    ),
    // Register worktree content provider for diff URIs
    vscode.workspace.registerTextDocumentContentProvider(
      'enterprise-ai-worktree',
      new WorktreeContentProvider(),
    ),
  ];

  context.subscriptions.push(
    ...disposables,
    orchestratorStatusBar,
    { dispose: () => orchestratorService.dispose() },
    { dispose: () => agentService.dispose() },
    { dispose: () => worktreeService.dispose() },
    { dispose: () => documentService.dispose() },
    { dispose: () => documentProvider.dispose() },
    outputChannel,
  );

  // Restore session
  authService.tryRestoreSession();

  // Initialize worktree SCM if already authenticated
  if (authService.isAuthenticated()) {
    getScmProvider();
  }

  // Start worktree SCM on login, stop on logout
  eventBus.on('auth:login', () => {
    getScmProvider();
  });

  eventBus.on('auth:logout', () => {
    if (worktreeScmProvider) {
      worktreeScmProvider.stopPolling();
    }
  });

  const elapsedMs = Date.now() - startTime;
  outputChannel.appendLine(`[Extension] Activated in ${elapsedMs}ms`);
  if (elapsedMs > 500) {
    outputChannel.appendLine(`[Extension] WARNING: Activation took ${elapsedMs}ms (threshold: 500ms)`);
  }
}

export function deactivate(): void {
  // Cleanup handled by disposables
}
