import { describe, it, expect } from 'vitest';
import { pickTitle, formatChapterTitle, meta } from '../src/main/engine/builtins/MangaDex';

describe('MangaDex built-in', () => {
    it('is bundled child-safe (not flagged nsfw)', () => {
        expect(meta.id).toBe('mangadex');
        expect(meta.nsfw).toBe(false);
    });

    describe('pickTitle', () => {
        it('prefers the English title', () => {
            expect(pickTitle({ id: 'x', attributes: { title: { en: 'Berserk', ja: 'ベルセルク' } } })).toBe('Berserk');
        });
        it('falls back to any title, then an English alt-title, then the id', () => {
            expect(pickTitle({ id: 'x', attributes: { title: { ja: 'ベルセルク' } } })).toBe('ベルセルク');
            expect(pickTitle({ id: 'x', attributes: { title: {}, altTitles: [{ en: 'Alt' }] } })).toBe('Alt');
            expect(pickTitle({ id: 'id-only', attributes: { title: {} } })).toBe('id-only');
        });
    });

    describe('formatChapterTitle', () => {
        it('builds "Vol.X Ch.Y - Title (lang) [Group]"', () => {
            expect(formatChapterTitle(
                { volume: '2', chapter: '14', title: 'The End', translatedLanguage: 'en' },
                ['Scans Inc']
            )).toBe('Vol.2 Ch.14 - The End (en) [Scans Inc]');
        });
        it('handles chapter-only and oneshots', () => {
            expect(formatChapterTitle({ chapter: '5', translatedLanguage: 'fr' }, [])).toBe('Ch.5 (fr)');
            expect(formatChapterTitle({ translatedLanguage: 'en' }, [])).toBe('Oneshot (en)');
        });
        it('joins multiple scanlation groups', () => {
            expect(formatChapterTitle({ chapter: '1' }, ['A', 'B'])).toBe('Ch.1 [A, B]');
        });
    });
});
