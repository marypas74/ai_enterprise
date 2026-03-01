/**
 * ChatViewKanban - Kanban board methods extracted from ChatViewProvider
 *
 * Extracted from extension.ts to keep each module under 800 LOC.
 * Contains: project loading, card CRUD, kanban column operations, notifications.
 */

import * as vscode from 'vscode';
import { AxiosInstance } from 'axios';

// ============================================
// TYPES
// ============================================

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

export interface Project {
    id: number;
    name: string;
    description: string;
    color: string;
    board_count: number;
    card_count: number;
}

export interface KanbanState {
    projects: Project[];
    selectedProject?: number;
    kanbanColumns: KanbanColumn[];
    projectMembers: ProjectMember[];
    notifications: KanbanNotification[];
    isLoadingProjects: boolean;
    projectsLoaded: boolean;
    notificationInterval?: NodeJS.Timeout;
}

export interface KanbanDeps {
    api: AxiosInstance;
    accessToken: string | undefined;
    outputChannel: vscode.OutputChannel;
    context: vscode.ExtensionContext;
    postMessage: (msg: any) => void;
    updateView: () => void;
    logActivity: (action: string, details: object) => void;
    addAssistantMessage: (content: string) => void;
}

// ============================================
// PROJECT LOADING
// ============================================

export async function loadProjects(
    state: KanbanState,
    deps: KanbanDeps
): Promise<void> {
    if (state.isLoadingProjects) {
        deps.outputChannel.appendLine('[ReactChatProvider] Skipping _loadProjects - already loading');
        return;
    }
    if (state.projectsLoaded && state.projects.length > 0) {
        deps.outputChannel.appendLine('[ReactChatProvider] Skipping _loadProjects - already loaded');
        return;
    }

    state.isLoadingProjects = true;

    try {
        const response = await deps.api.get('/api/projects');
        state.projects = response.data || [];
        state.projectsLoaded = true;
        deps.outputChannel.appendLine(`[ReactChatProvider] Loaded ${state.projects.length} projects`);

        const savedProject = deps.context.globalState.get<number>('selectedProject');
        if (savedProject && state.projects.some(p => p.id === savedProject)) {
            state.selectedProject = savedProject;
            await loadKanbanColumns(state, deps, savedProject);
        }

        deps.updateView();
    } catch (error: any) {
        if (error.response?.status === 429) {
            deps.outputChannel.appendLine('[ReactChatProvider] Rate limited (429) - stopping further requests');
            state.projectsLoaded = true;
            return;
        }
        deps.outputChannel.appendLine(`[ReactChatProvider] Failed to load projects: ${error}`);
    } finally {
        state.isLoadingProjects = false;
    }
}

export async function selectProject(
    state: KanbanState,
    deps: KanbanDeps,
    projectId: number
): Promise<void> {
    state.selectedProject = projectId;
    await deps.context.globalState.update('selectedProject', projectId);
    await loadKanbanColumns(state, deps, projectId);
    deps.logActivity('project_selected', { projectId });
    deps.updateView();
}

export async function loadKanbanColumns(
    state: KanbanState,
    deps: KanbanDeps,
    projectId: number
): Promise<void> {
    try {
        const response = await deps.api.get(`/api/projects/${projectId}`);
        const project = response.data;

        state.projectMembers = project.members || [];

        if (project.boards && project.boards.length > 0) {
            const boardResponse = await deps.api.get(`/api/projects/${projectId}/boards/${project.boards[0].id}`);
            state.kanbanColumns = boardResponse.data.columns || [];
        }

        deps.outputChannel.appendLine(
            `Loaded ${state.kanbanColumns.length} columns, ${state.projectMembers.length} members`
        );
    } catch (error) {
        deps.outputChannel.appendLine(`Failed to load kanban columns: ${error}`);
    }
}

// ============================================
// CARD OPERATIONS
// ============================================

export async function createKanbanCard(
    state: KanbanState,
    deps: KanbanDeps,
    title: string,
    description?: string,
    columnId?: number,
    storyPoints?: number,
    assigneeId?: number
): Promise<void> {
    if (!state.selectedProject) {
        vscode.window.showWarningMessage('Seleziona prima un progetto');
        return;
    }

    const targetColumnId = columnId || (state.kanbanColumns.length > 0 ? state.kanbanColumns[0].id : null);
    if (!targetColumnId) {
        vscode.window.showErrorMessage('Nessuna colonna disponibile nel progetto');
        return;
    }

    try {
        const response = await deps.api.post(
            `/api/projects/${state.selectedProject}/columns/${targetColumnId}/cards`,
            {
                title,
                description: description || '',
                priority: 'medium',
                estimated_hours: storyPoints || 0,
                assigned_to: assigneeId || null,
            }
        );

        const assigneeName = assigneeId
            ? state.projectMembers.find(m => m.id === assigneeId)?.name
            : null;

        let message = `Card "${title}" creata`;
        if (storyPoints) { message += ` (${storyPoints} SP)`; }
        if (assigneeName) { message += ` - Assegnata a ${assigneeName}`; }

        vscode.window.showInformationMessage(message);
        deps.logActivity('card_created', {
            cardId: response.data.id,
            title,
            projectId: state.selectedProject,
            storyPoints,
            assigneeId,
        });

        deps.addAssistantMessage(message);
        deps.updateView();
    } catch (error: any) {
        vscode.window.showErrorMessage(`Errore creazione card: ${error.message}`);
    }
}

export async function createCardWithDetails(
    state: KanbanState,
    deps: KanbanDeps
): Promise<void> {
    if (!state.selectedProject) {
        vscode.window.showWarningMessage('Seleziona prima un progetto');
        return;
    }

    const title = await vscode.window.showInputBox({
        prompt: 'Titolo della card',
        placeHolder: 'Es: Implementare login OAuth',
    });
    if (!title) { return; }

    const description = await vscode.window.showInputBox({
        prompt: 'Descrizione (opzionale)',
        placeHolder: 'Descrivi il task...',
    });

    const spInput = await vscode.window.showInputBox({
        prompt: 'Story Points (opzionale)',
        placeHolder: 'Es: 3',
        validateInput: (v) => v && isNaN(Number(v)) ? 'Inserisci un numero' : undefined,
    });
    const storyPoints = spInput ? Number(spInput) : undefined;

    let assigneeId: number | undefined;
    if (state.projectMembers.length > 0) {
        const assigneeOptions = [
            { label: '-- Nessun assegnatario --', id: undefined as number | undefined },
            ...state.projectMembers.map(m => ({ label: `${m.name} (${m.email})`, id: m.id as number | undefined })),
        ];
        const selected = await vscode.window.showQuickPick(assigneeOptions, {
            placeHolder: 'Assegna a...',
        });
        assigneeId = selected?.id;
    }

    const columnOptions = state.kanbanColumns.map(c => ({ label: c.name, id: c.id }));
    const selectedColumn = await vscode.window.showQuickPick(columnOptions, {
        placeHolder: 'Colonna di destinazione',
    });

    await createKanbanCard(state, deps, title, description, selectedColumn?.id, storyPoints, assigneeId);
}

export async function moveKanbanCard(
    state: KanbanState,
    deps: KanbanDeps,
    cardId: number,
    columnId: number
): Promise<void> {
    if (!state.selectedProject) {
        vscode.window.showWarningMessage('Seleziona prima un progetto');
        return;
    }
    await moveKanbanCardWithProject(state, deps, cardId, columnId, state.selectedProject);
}

export async function moveKanbanCardWithProject(
    state: KanbanState,
    deps: KanbanDeps,
    cardId: number,
    columnId: number,
    projectId: number
): Promise<void> {
    // FAIL-SAFE: Never throws, never shows errors
    try {
        deps.outputChannel.appendLine(`[moveCard] Moving card ${cardId} to column ${columnId} in project ${projectId}`);

        const response = await deps.api.post(`/api/projects/${projectId}/cards/${cardId}/move`, {
            column_id: columnId,
            sort_order: 0,
        }).catch((err: any) => {
            deps.outputChannel.appendLine(`[moveCard] API error (ignored): ${err.message}`);
            return { data: { success: false, warning: err.message } };
        });

        if (response?.data?.success) {
            const columnName = state.kanbanColumns.find(c => c.id === columnId)?.name || 'nuova colonna';
            deps.outputChannel.appendLine(`[moveCard] Card ${cardId} moved to "${columnName}"`);

            loadKanbanColumns(state, deps, projectId).then(() => deps.updateView()).catch(() => { /* ignore */ });

            deps.postMessage({
                type: 'kanbanCardMoved',
                payload: { cardId, columnId, projectId, success: true },
            });
        } else {
            deps.outputChannel.appendLine(`[moveCard] Backend warning: ${response?.data?.warning || 'unknown'}`);
            deps.postMessage({
                type: 'kanbanCardMoved',
                payload: { cardId, columnId, projectId, success: false, warning: response?.data?.warning },
            });
        }
    } catch (error: any) {
        deps.outputChannel.appendLine(`[moveCard] Caught exception (swallowed): ${error.message}`);
        console.warn('[moveCard] Swallowed error:', error);
    }
}

export async function deleteKanbanCard(
    state: KanbanState,
    deps: KanbanDeps,
    cardId: number
): Promise<void> {
    if (!state.selectedProject) {
        vscode.window.showWarningMessage('Seleziona prima un progetto');
        return;
    }

    try {
        await deps.api.delete(`/api/projects/${state.selectedProject}/cards/${cardId}`);
        vscode.window.showInformationMessage('Card eliminata con successo');
        deps.logActivity('card_deleted', { cardId, projectId: state.selectedProject });

        await loadKanbanColumns(state, deps, state.selectedProject);
        deps.updateView();
    } catch (error: any) {
        vscode.window.showErrorMessage(`Errore eliminazione card: ${error.message}`);
    }
}

export async function editKanbanCard(
    state: KanbanState,
    deps: KanbanDeps,
    cardId: number,
    title?: string,
    description?: string,
    priority?: string
): Promise<void> {
    if (!state.selectedProject) {
        vscode.window.showWarningMessage('Seleziona prima un progetto');
        return;
    }

    try {
        const updateData: Record<string, any> = {};
        if (title) { updateData.title = title; }
        if (description !== undefined) { updateData.description = description; }
        if (priority) { updateData.priority = priority; }

        await deps.api.patch(`/api/projects/${state.selectedProject}/cards/${cardId}`, updateData);
        vscode.window.showInformationMessage('Card aggiornata con successo');
        deps.logActivity('card_updated', { cardId, projectId: state.selectedProject, ...updateData });

        await loadKanbanColumns(state, deps, state.selectedProject);
        deps.updateView();
    } catch (error: any) {
        vscode.window.showErrorMessage(`Errore aggiornamento card: ${error.message}`);
    }
}

// ============================================
// NOTIFICATIONS
// ============================================

export async function fetchNotifications(
    state: KanbanState,
    deps: KanbanDeps
): Promise<void> {
    try {
        const response = await deps.api.get('/api/notifications');
        const newNotifications: KanbanNotification[] = response.data || [];

        const unreadNew = newNotifications.filter(
            n => !n.read && !state.notifications.some(existing => existing.id === n.id)
        );

        if (unreadNew.length > 0) {
            for (const notif of unreadNew) {
                const icon = getNotificationIcon(notif.type);
                vscode.window.showInformationMessage(
                    `${icon} ${notif.message}`,
                    'Visualizza'
                ).then(action => {
                    if (action === 'Visualizza') {
                        markNotificationRead(state, deps, notif.id);
                        vscode.commands.executeCommand('enterprise-ai-chat.openChat');
                    }
                });
            }
        }

        state.notifications = newNotifications;
        deps.updateView();
        deps.outputChannel.appendLine(`Fetched ${newNotifications.length} notifications (${unreadNew.length} new)`);
    } catch (error: any) {
        deps.outputChannel.appendLine(`Notifications fetch skipped: ${error.message}`);
    }
}

function getNotificationIcon(type: string): string {
    switch (type) {
        case 'card_assigned': return '\u{1F4CB}';
        case 'card_moved': return '\u{27A1}\u{FE0F}';
        case 'card_due': return '\u{23F0}';
        case 'mention': return '\u{1F4AC}';
        default: return '\u{1F514}';
    }
}

export async function markNotificationRead(
    state: KanbanState,
    deps: KanbanDeps,
    notificationId: number
): Promise<void> {
    try {
        await deps.api.patch(`/api/notifications/${notificationId}/read`);
        state.notifications = state.notifications.map(n =>
            n.id === notificationId ? { ...n, read: true } : n
        );
        deps.updateView();
    } catch (error) {
        deps.outputChannel.appendLine(`Failed to mark notification as read: ${error}`);
    }
}

export function startNotificationPolling(
    state: KanbanState,
    deps: KanbanDeps
): void {
    if (state.notificationInterval) {
        clearInterval(state.notificationInterval);
    }

    fetchNotifications(state, deps);

    state.notificationInterval = setInterval(() => {
        fetchNotifications(state, deps);
    }, 30000);

    deps.outputChannel.appendLine('Notification polling started');
}

export function stopNotificationPolling(
    state: KanbanState,
    deps: KanbanDeps
): void {
    if (state.notificationInterval) {
        clearInterval(state.notificationInterval);
        state.notificationInterval = undefined;
        deps.outputChannel.appendLine('Notification polling stopped');
    }
}
