import { describe, it, expect } from 'vitest';
import { validateDefinition } from '../src/main/engine/validate';

const templates = new Set(['wordpress-madara', 'foolslide']);

describe('validateDefinition', () => {
    it('accepts a minimal valid definition', () => {
        const result = validateDefinition({
            id: 'my-site', label: 'My Site', url: 'https://example.com', template: 'wordpress-madara'
        }, templates);
        expect(result.valid).toBe(true);
        expect(result.errors).toEqual([]);
    });

    it('rejects a non-object', () => {
        expect(validateDefinition('nope').valid).toBe(false);
        expect(validateDefinition(null).valid).toBe(false);
        expect(validateDefinition([]).valid).toBe(false);
    });

    it('rejects a bad id', () => {
        const result = validateDefinition({ id: 'Bad Id!', label: 'x', url: 'https://x.com', template: 'foolslide' }, templates);
        expect(result.valid).toBe(false);
        expect(result.errors.join(' ')).toContain('id');
    });

    it('rejects a non-http url', () => {
        const result = validateDefinition({ id: 'x', label: 'x', url: 'ftp://x.com', template: 'foolslide' }, templates);
        expect(result.valid).toBe(false);
    });

    it('rejects an unknown template when the set is provided', () => {
        const result = validateDefinition({ id: 'x', label: 'x', url: 'https://x.com', template: 'nope' }, templates);
        expect(result.valid).toBe(false);
        expect(result.errors.join(' ')).toContain('Unknown template');
    });

    it('accepts any template when no set is given', () => {
        expect(validateDefinition({ id: 'x', label: 'x', url: 'https://x.com', template: 'anything' }).valid).toBe(true);
    });

    it('rejects wrong-typed optional fields', () => {
        const result = validateDefinition({
            id: 'x', label: 'x', url: 'https://x.com', template: 'foolslide', tags: 'not-an-array', nsfw: 'yes'
        }, templates);
        expect(result.valid).toBe(false);
        expect(result.errors.length).toBeGreaterThanOrEqual(2);
    });
});
