/**
 * TypeScript Interfaces matching MariaDB Schema
 * Enterprise AI Chat - VS Code Extension
 *
 * These interfaces align exactly with the database tables defined in:
 * /home/mpasqui/enterprise-ai-chat/k8s/mariadb/init-configmap.yaml
 */

// ============================================
// USER & AUTHENTICATION
// ============================================

export interface IUser {
    id: number;
    email: string;
    name: string;
    role: 'admin' | 'user';
    is_active: boolean;
    created_at: string; // ISO 8601
    last_login_at?: string; // ISO 8601
    groups?: string[]; // Group names
}

export interface ILoginRequest {
    email: string;
    password: string;
}

export interface ILoginResponse {
    accessToken: string;
    user: IUser;
}

export interface IRefreshTokenResponse {
    accessToken: string;
}

export interface IRegisterRequest {
    email: string;
    password: string;
    name: string;
}

// ============================================
// CONVERSATIONS & MESSAGES
// ============================================

export interface IConversation {
    id: number;
    user_id: number;
    title: string;
    model: string;
    provider: string;
    system_prompt?: string;
    is_archived: boolean;
    created_at: string; // ISO 8601
    updated_at: string; // ISO 8601
    message_count?: number; // Computed field from API
}

export interface IMessage {
    id: number;
    conversation_id: number;
    role: 'system' | 'user' | 'assistant';
    content: string;
    tokens_input?: number;
    tokens_output?: number;
    created_at: string; // ISO 8601
}

export interface IConversationWithMessages {
    conversation: IConversation;
    messages: IMessage[];
}

// ============================================
// CHAT COMPLETIONS (Streaming)
// ============================================

export interface IChatCompletionRequest {
    conversationId?: number; // Optional for new conversations
    model: string;
    message: string;
    systemPrompt?: string;
}

export interface IStreamChunk {
    content: string;
    done: boolean;
    conversationId?: number; // Only on final chunk
}

// ============================================
// MODELS
// ============================================

export interface IModel {
    id: string;
    name: string;
    provider: string;
}

// ============================================
// TOKEN USAGE & TRACKING
// ============================================

export interface ITokenUsage {
    id: number;
    user_id: number;
    conversation_id?: number;
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    model: string;
    provider: string;
    cost?: number;
    created_at: string; // ISO 8601
}

export interface IMonthlyUsage {
    id: number;
    user_id: number;
    provider: string;
    month: string; // YYYY-MM format
    total_tokens: number;
    total_cost: number;
}

// ============================================
// GROUPS & PERMISSIONS
// ============================================

export interface IGroup {
    id: number;
    name: string;
    description?: string;
    token_quota?: number;
    model_access?: string; // JSON array of model IDs
    rate_limit?: number;
    created_at: string;
}

export interface IUserGroup {
    user_id: number;
    group_id: number;
    role: 'admin' | 'member';
}

// ============================================
// AUDIT LOG
// ============================================

export interface IAuditLog {
    id: number;
    user_id?: number;
    user_email?: string;
    user_name?: string;
    action: string;
    entity_type?: string;
    entity_id?: number;
    details?: string; // JSON
    ip_address?: string;
    created_at: string;
}

// ============================================
// API KEYS
// ============================================

export interface IApiKey {
    id: number;
    user_id: number;
    name: string;
    key_hash: string;
    permissions: string; // JSON
    is_active: boolean;
    last_used_at?: string;
    expires_at?: string;
    created_at: string;
}

// ============================================
// ERROR RESPONSES
// ============================================

export interface IApiError {
    error: string;
    message?: string;
    statusCode?: number;
}

// ============================================
// PROVIDERS (Admin)
// ============================================

export interface IProvider {
    id: number;
    name: string;
    display_name: string;
    provider_type: 'openai' | 'anthropic' | 'google' | 'ollama' | 'custom';
    is_enabled: boolean;
    is_local: boolean;
    config_schema?: Record<string, unknown>;
    created_at: string;
    updated_at: string;
}

// ============================================
// TYPE GUARDS
// ============================================

export function isApiError(obj: unknown): obj is IApiError {
    return typeof obj === 'object' && obj !== null && 'error' in obj;
}

export function isStreamChunk(obj: unknown): obj is IStreamChunk {
    return (
        typeof obj === 'object' &&
        obj !== null &&
        'content' in obj &&
        'done' in obj
    );
}
