import { describe, it, expect } from 'vitest';
import { mapModelExistsErrorBody } from './modelExistsCheck.js';

describe('mapModelExistsErrorBody', () => {
    it('returns the documented 422 envelope', () => {
        const body = mapModelExistsErrorBody('gpt-typo', 'openai', 'http_404');
        expect(body.code).toBe('MODEL_NOT_FOUND_ON_PROVIDER');
        expect(body.model_id).toBe('gpt-typo');
        expect(body.provider).toBe('openai');
        expect(body.reason).toBe('http_404');
        expect(body.suggestion).toContain('gpt-typo');
        expect(body.suggestion).toContain('force=true');
    });

    it('omits the reason gracefully when undefined', () => {
        const body = mapModelExistsErrorBody('claude-x', 'anthropic', undefined);
        expect(body.reason).toBeUndefined();
        expect(body.code).toBe('MODEL_NOT_FOUND_ON_PROVIDER');
    });
});
