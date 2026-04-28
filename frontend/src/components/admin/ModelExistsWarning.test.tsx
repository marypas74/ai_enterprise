import { describe, it, expect } from 'vitest';
import { isModelNotFoundOnProvider } from './ModelExistsWarning';

/**
 * Pure logic tests for the 422 type guard.
 * Rendering tests are gated on @testing-library/dom which is currently
 * missing from frontend devDependencies (pre-existing issue, see handoff).
 */
describe('isModelNotFoundOnProvider', () => {
    it('accepts the documented envelope', () => {
        expect(
            isModelNotFoundOnProvider({
                code: 'MODEL_NOT_FOUND_ON_PROVIDER',
                model_id: 'gpt-typo',
                provider: 'openai',
                suggestion: 'sample suggestion',
            }),
        ).toBe(true);
    });

    it('accepts the envelope with optional reason field', () => {
        expect(
            isModelNotFoundOnProvider({
                code: 'MODEL_NOT_FOUND_ON_PROVIDER',
                model_id: 'gpt-typo',
                provider: 'openai',
                suggestion: 'sample',
                reason: 'http_404',
            }),
        ).toBe(true);
    });

    it('rejects null / undefined / non-objects', () => {
        expect(isModelNotFoundOnProvider(null)).toBe(false);
        expect(isModelNotFoundOnProvider(undefined)).toBe(false);
        expect(isModelNotFoundOnProvider('error')).toBe(false);
        expect(isModelNotFoundOnProvider(42)).toBe(false);
    });

    it('rejects payloads with the wrong code', () => {
        expect(
            isModelNotFoundOnProvider({
                code: 'OTHER_ERROR',
                model_id: 'x',
                provider: 'openai',
                suggestion: 's',
            }),
        ).toBe(false);
    });

    it('rejects payloads missing required fields', () => {
        expect(
            isModelNotFoundOnProvider({ code: 'MODEL_NOT_FOUND_ON_PROVIDER', model_id: 'x' }),
        ).toBe(false);
        expect(
            isModelNotFoundOnProvider({
                code: 'MODEL_NOT_FOUND_ON_PROVIDER',
                model_id: 'x',
                provider: 42,
                suggestion: 's',
            }),
        ).toBe(false);
    });
});
