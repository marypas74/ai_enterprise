"use strict";
/**
 * ApiService - Singleton API Client for Enterprise AI Chat
 *
 * CRITICAL: All requests go through the Kubernetes Ingress which routes:
 *   - /api/* -> Backend Service (port 3000)
 *   - /*     -> Frontend Service (port 80)
 *
 * The /api prefix is MANDATORY per the Ingress definition.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.api = exports.ApiService = void 0;
const vscode = __importStar(require("vscode"));
const axios_1 = __importDefault(require("axios"));
const https = __importStar(require("https"));
const schema_1 = require("../types/schema");
// ============================================
// SINGLETON API SERVICE
// ============================================
class ApiService {
    static instance;
    axiosInstance;
    accessToken = null;
    refreshToken = null;
    currentUser = null;
    baseUrl;
    outputChannel;
    /**
     * Private constructor - use getInstance() instead
     */
    constructor() {
        this.outputChannel = vscode.window.createOutputChannel('Enterprise AI API');
        // Get base URL from VS Code settings
        const config = vscode.workspace.getConfiguration('enterprise-ai-chat');
        const serverUrl = config.get('serverUrl') || 'https://192.168.1.123';
        // CRITICAL: Ensure we have the /api prefix for all backend calls
        // The Ingress routes /api/* to the backend service
        this.baseUrl = serverUrl.replace(/\/+$/, ''); // Remove trailing slashes
        this.log(`ApiService initialized with base URL: ${this.baseUrl}`);
        // Create axios instance with TLS certificate handling
        const allowSelfSigned = config.get('allowSelfSignedCerts', true);
        this.axiosInstance = axios_1.default.create({
            baseURL: this.baseUrl,
            timeout: 30000,
            httpsAgent: new https.Agent({
                rejectUnauthorized: !allowSelfSigned,
            }),
            headers: {
                'Content-Type': 'application/json',
            },
        });
        // Request interceptor - add auth token
        this.axiosInstance.interceptors.request.use((config) => {
            if (this.accessToken) {
                config.headers.Authorization = `Bearer ${this.accessToken}`;
            }
            this.log(`→ ${config.method?.toUpperCase()} ${config.url}`);
            return config;
        }, (error) => {
            this.log(`Request error: ${error.message}`);
            return Promise.reject(error);
        });
        // Response interceptor - handle token refresh
        this.axiosInstance.interceptors.response.use((response) => {
            this.log(`← ${response.status} ${response.config.url}`);
            return response;
        }, async (error) => {
            const originalRequest = error.config;
            // If 401 and we have a refresh token, try to refresh
            if (error.response?.status === 401 && this.refreshToken && !originalRequest._retry) {
                originalRequest._retry = true;
                try {
                    await this.refreshAccessToken();
                    if (originalRequest.headers) {
                        originalRequest.headers.Authorization = `Bearer ${this.accessToken}`;
                    }
                    return this.axiosInstance(originalRequest);
                }
                catch (refreshError) {
                    this.log(`Token refresh failed: ${refreshError}`);
                    this.clearAuth();
                }
            }
            this.logError(error);
            return Promise.reject(error);
        });
    }
    /**
     * Get singleton instance
     */
    static getInstance() {
        if (!ApiService.instance) {
            ApiService.instance = new ApiService();
        }
        return ApiService.instance;
    }
    /**
     * Update base URL (when settings change)
     */
    updateBaseUrl(url) {
        this.baseUrl = url.replace(/\/+$/, '');
        this.axiosInstance.defaults.baseURL = this.baseUrl;
        this.log(`Base URL updated to: ${this.baseUrl}`);
    }
    // ============================================
    // AUTHENTICATION
    // ============================================
    /**
     * Login with email and password
     * Endpoint: POST /api/auth/login
     */
    async login(credentials) {
        const response = await this.axiosInstance.post('/api/auth/login', credentials);
        this.accessToken = response.data.accessToken;
        this.currentUser = response.data.user;
        // Store refresh token from cookie if available
        const setCookie = response.headers['set-cookie'];
        if (setCookie) {
            const refreshMatch = setCookie.find((c) => c.startsWith('refreshToken='));
            if (refreshMatch) {
                this.refreshToken = refreshMatch.split('=')[1].split(';')[0];
            }
        }
        this.log(`Logged in as: ${this.currentUser.email}`);
        return response.data;
    }
    /**
     * Logout
     * Endpoint: POST /api/auth/logout
     */
    async logout() {
        try {
            await this.axiosInstance.post('/api/auth/logout');
        }
        catch (error) {
            // Ignore errors on logout
        }
        this.clearAuth();
        this.log('Logged out');
    }
    /**
     * Refresh access token
     * Endpoint: POST /api/auth/refresh
     */
    async refreshAccessToken() {
        const response = await this.axiosInstance.post('/api/auth/refresh', {}, {
            headers: {
                Cookie: `refreshToken=${this.refreshToken}`,
            },
        });
        this.accessToken = response.data.accessToken;
        this.log('Access token refreshed');
    }
    /**
     * Get current user profile
     * Endpoint: GET /api/auth/me
     */
    async getCurrentUser() {
        const response = await this.axiosInstance.get('/api/auth/me');
        this.currentUser = response.data;
        return response.data;
    }
    /**
     * Set tokens from external source (e.g., VS Code storage)
     */
    setTokens(accessToken, refreshToken) {
        this.accessToken = accessToken;
        if (refreshToken) {
            this.refreshToken = refreshToken;
        }
    }
    /**
     * Get current access token
     */
    getAccessToken() {
        return this.accessToken;
    }
    /**
     * Check if authenticated
     */
    isAuthenticated() {
        return !!this.accessToken;
    }
    /**
     * Get cached user
     */
    getCachedUser() {
        return this.currentUser;
    }
    /**
     * Clear authentication state
     */
    clearAuth() {
        this.accessToken = null;
        this.refreshToken = null;
        this.currentUser = null;
    }
    // ============================================
    // CHAT & CONVERSATIONS
    // ============================================
    /**
     * Get available AI models
     * Endpoint: GET /api/chat/models
     */
    async getModels() {
        const response = await this.axiosInstance.get('/api/chat/models');
        return response.data;
    }
    /**
     * Get user conversations
     * Endpoint: GET /api/chat/conversations
     */
    async getConversations(archived = false, limit = 20, offset = 0) {
        const response = await this.axiosInstance.get('/api/chat/conversations', {
            params: { archived, limit, offset },
        });
        return response.data;
    }
    /**
     * Get conversation with messages
     * Endpoint: GET /api/chat/conversations/:id/messages
     */
    async getConversationMessages(conversationId) {
        const response = await this.axiosInstance.get(`/api/chat/conversations/${conversationId}/messages`);
        return response.data;
    }
    /**
     * Delete conversation
     * Endpoint: DELETE /api/chat/conversations/:id
     */
    async deleteConversation(conversationId) {
        await this.axiosInstance.delete(`/api/chat/conversations/${conversationId}`);
    }
    /**
     * Archive/unarchive conversation
     * Endpoint: PATCH /api/chat/conversations/:id/archive
     */
    async archiveConversation(conversationId, archived) {
        await this.axiosInstance.patch(`/api/chat/conversations/${conversationId}/archive`, { archived });
    }
    /**
     * Send message with SSE streaming
     * Endpoint: POST /api/chat/completions
     *
     * This is the core method that handles the streaming response
     * from the backend, mimicking the Claude Code typing effect.
     */
    async sendMessageStream(request, onChunk, onError, onComplete) {
        const url = `${this.baseUrl}/api/chat/completions`;
        this.log(`Starting SSE stream to: ${url}`);
        try {
            // Use fetch for SSE streaming (axios doesn't handle streams well)
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${this.accessToken}`,
                },
                body: JSON.stringify(request),
            });
            if (!response.ok) {
                const errorText = await response.text();
                let errorObj;
                try {
                    errorObj = JSON.parse(errorText);
                }
                catch {
                    errorObj = {
                        error: `HTTP ${response.status}`,
                        message: errorText || response.statusText,
                        statusCode: response.status,
                    };
                }
                onError(errorObj);
                return;
            }
            // Get conversation ID from header
            const conversationIdHeader = response.headers.get('X-Conversation-Id');
            // Read the SSE stream
            const reader = response.body?.getReader();
            if (!reader) {
                onError({ error: 'No response body', statusCode: 500 });
                return;
            }
            const decoder = new TextDecoder();
            let buffer = '';
            let finalConversationId;
            while (true) {
                const { done, value } = await reader.read();
                if (done)
                    break;
                buffer += decoder.decode(value, { stream: true });
                // Process complete SSE messages
                const lines = buffer.split('\n');
                buffer = lines.pop() || ''; // Keep incomplete line in buffer
                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        const jsonStr = line.slice(6).trim();
                        if (jsonStr) {
                            try {
                                const chunk = JSON.parse(jsonStr);
                                onChunk(chunk);
                                if (chunk.done && chunk.conversationId) {
                                    finalConversationId = chunk.conversationId;
                                }
                            }
                            catch (parseError) {
                                this.log(`Failed to parse SSE chunk: ${jsonStr}`);
                            }
                        }
                    }
                }
            }
            // Call onComplete with conversation ID
            const convId = finalConversationId ||
                (conversationIdHeader ? parseInt(conversationIdHeader, 10) : 0);
            onComplete(convId);
            this.log(`Stream completed. Conversation ID: ${convId}`);
        }
        catch (error) {
            const err = error;
            this.log(`Stream error: ${err.message}`);
            // Detect specific error types for user-friendly messages
            if (err.message.includes('Failed to fetch') || err.message.includes('NetworkError')) {
                onError({
                    error: 'Connection to cluster failed',
                    message: 'Unable to reach the backend server. Check your network connection.',
                    statusCode: 0,
                });
            }
            else {
                onError({
                    error: err.name || 'Stream Error',
                    message: err.message,
                });
            }
        }
    }
    /**
     * Send message without streaming (fallback)
     */
    async sendMessage(request) {
        // For non-streaming, we still use the same endpoint but collect all chunks
        return new Promise((resolve, reject) => {
            let fullContent = '';
            let conversationId = 0;
            this.sendMessageStream(request, (chunk) => {
                fullContent += chunk.content;
            }, (error) => {
                reject(new Error(error.message || error.error));
            }, (convId) => {
                conversationId = convId;
                resolve({ content: fullContent, conversationId });
            });
        });
    }
    // ============================================
    // HEALTH CHECK
    // ============================================
    /**
     * Check backend health
     * Endpoint: GET /health
     */
    async healthCheck() {
        try {
            const response = await this.axiosInstance.get('/health', {
                timeout: 5000,
            });
            return response.data?.status === 'ok';
        }
        catch {
            return false;
        }
    }
    // ============================================
    // LOGGING
    // ============================================
    log(message) {
        const timestamp = new Date().toISOString();
        this.outputChannel.appendLine(`[${timestamp}] ${message}`);
    }
    logError(error) {
        const status = error.response?.status || 'N/A';
        const url = error.config?.url || 'unknown';
        const data = error.response?.data;
        let errorMessage = `← ERROR ${status} ${url}`;
        if ((0, schema_1.isApiError)(data)) {
            errorMessage += ` - ${data.error}`;
        }
        else if (error.message) {
            errorMessage += ` - ${error.message}`;
        }
        this.log(errorMessage);
        // Show specific messages for common errors
        if (status === 404) {
            this.log('HINT: 404 error - Check that the URL includes /api prefix. ' +
                'Ingress routes /api/* to backend.');
        }
        else if (status === 502) {
            this.log('HINT: 502 Bad Gateway - Backend pods may be down or restarting.');
        }
    }
}
exports.ApiService = ApiService;
// Export singleton instance
exports.api = ApiService.getInstance();
//# sourceMappingURL=ApiService.js.map