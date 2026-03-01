/**
 * CodeActions - Functions for code-related commands (explain, fix, improve, tests)
 *
 * Extracted from extension.ts to keep each module under 800 LOC.
 * Contains both panel-based and ChatViewProvider-based code actions.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { ClaudeCodePanel } from '../ClaudeCodePanel';

// Forward-declared type to avoid circular dependency with ChatViewProvider
export interface IChatViewProvider {
    sendMessage(message: string): Promise<void>;
    insertCode(fileName: string, language: string, code: string): void;
    addFileContext(name: string, language: string, content: string): void;
}

// ============================================
// PANEL-BASED CODE ACTIONS (ClaudeCodePanel)
// ============================================

/**
 * Code action with panel (explain, fix, improve, tests)
 */
export async function codeActionWithPanel(
    action: string,
    getPanel: () => ClaudeCodePanel
): Promise<void> {
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
        tests: `Generate tests for this ${language} code:\n\n\`\`\`${language}\n${code}\n\`\`\``,
    };

    const panel = getPanel();
    panel.addMessage('user', prompts[action] || prompts.explain);

    vscode.commands.executeCommand('enterprise-ai-chat.sendMessage', prompts[action] || prompts.explain);
}

/**
 * Add selected code to chat panel
 */
export function addToChatPanel(getPanel: () => ClaudeCodePanel): void {
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
export function addFileToContextPanel(getPanel: () => ClaudeCodePanel): void {
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

// ============================================
// CHATVIEWPROVIDER-BASED CODE ACTIONS (legacy sidebar)
// ============================================

/**
 * Code action for ChatViewProvider (explain, fix, improve, tests)
 */
export async function codeAction(
    action: string,
    chatProvider: IChatViewProvider
): Promise<void> {
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
        tests: `Genera unit test per questo codice ${language}:\n\n\`\`\`${language}\n${selectedText}\n\`\`\``,
    };

    chatProvider.sendMessage(prompts[action]);
}

/**
 * Add selected text to chat (ChatViewProvider)
 */
export async function addToChat(chatProvider: IChatViewProvider): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) { return; }

    const selectedText = editor.document.getText(editor.selection);
    if (!selectedText) { return; }

    const fileName = path.basename(editor.document.fileName);
    const language = editor.document.languageId;

    chatProvider.insertCode(fileName, language, selectedText);
}

/**
 * Add file to context (ChatViewProvider)
 */
export async function addFileToContext(chatProvider: IChatViewProvider): Promise<void> {
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
