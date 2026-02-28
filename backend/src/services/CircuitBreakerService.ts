/**
 * CircuitBreakerService — Provider health tracking with automatic fallback
 * Tracks provider errors and disables unhealthy providers temporarily.
 */

interface ProviderState {
  count: number;
  lastError: number;
}

const providerErrors = new Map<string, ProviderState>();
const THRESHOLD = 3;      // Errors before circuit opens
const RESET_MS = 60000;   // Time before circuit half-opens (60s)

/**
 * Check if a provider is considered healthy.
 * Returns true if error count is below threshold or reset timeout has elapsed.
 */
export function isProviderHealthy(provider: string): boolean {
  const state = providerErrors.get(provider);
  if (!state) return true;
  if (Date.now() - state.lastError > RESET_MS) {
    providerErrors.delete(provider);
    return true;
  }
  return state.count < THRESHOLD;
}

/**
 * Record a provider error. Increments error count.
 */
export function recordProviderError(provider: string): void {
  const state = providerErrors.get(provider) || { count: 0, lastError: 0 };
  providerErrors.set(provider, {
    count: state.count + 1,
    lastError: Date.now(),
  });
}

/**
 * Record a provider success. Resets error tracking.
 */
export function recordProviderSuccess(provider: string): void {
  providerErrors.delete(provider);
}

/**
 * Get current health status of all tracked providers.
 */
export function getProviderHealthStatus(): Record<string, { healthy: boolean; errorCount: number; lastError: number }> {
  const status: Record<string, { healthy: boolean; errorCount: number; lastError: number }> = {};
  for (const [provider, state] of providerErrors.entries()) {
    status[provider] = {
      healthy: isProviderHealthy(provider),
      errorCount: state.count,
      lastError: state.lastError,
    };
  }
  return status;
}

/**
 * Reset all provider health tracking.
 */
export function resetAllProviders(): void {
  providerErrors.clear();
}
