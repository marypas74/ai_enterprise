"use strict";
/**
 * TypeScript Interfaces matching MariaDB Schema
 * Enterprise AI Chat - VS Code Extension
 *
 * These interfaces align exactly with the database tables defined in:
 * /home/mpasqui/enterprise-ai-chat/k8s/mariadb/init-configmap.yaml
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.isApiError = isApiError;
exports.isStreamChunk = isStreamChunk;
// ============================================
// TYPE GUARDS
// ============================================
function isApiError(obj) {
    return typeof obj === 'object' && obj !== null && 'error' in obj;
}
function isStreamChunk(obj) {
    return (typeof obj === 'object' &&
        obj !== null &&
        'content' in obj &&
        'done' in obj);
}
//# sourceMappingURL=schema.js.map