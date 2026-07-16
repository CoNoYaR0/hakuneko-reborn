import { describe, it, expect } from 'vitest';
import { sourceLanguages, availableLanguages } from '../src/renderer/src/lib/languages';

describe('sourceLanguages', () => {
    it('detects language from tags', () => {
        expect(sourceLanguages({ tags: ['manga', 'english'] })).toEqual(['English']);
        expect(sourceLanguages({ tags: ['webtoon', 'spanish', 'hentai'] })).toEqual(['Spanish']);
    });

    it('detects language from the language field (ISO code)', () => {
        expect(sourceLanguages({ tags: ['manga'], language: 'fr' })).toEqual(['French']);
        expect(sourceLanguages({ tags: [], language: 'pt-br' })).toEqual(['Portuguese']);
    });

    it('merges and de-dupes field + tags', () => {
        expect(sourceLanguages({ tags: ['english', 'en'], language: 'en' })).toEqual(['English']);
    });

    it('returns multiple languages sorted', () => {
        expect(sourceLanguages({ tags: ['french', 'english'] })).toEqual(['English', 'French']);
    });

    it('ignores non-language tags', () => {
        expect(sourceLanguages({ tags: ['manga', 'webtoon', 'scanlation', 'high-quality'] })).toEqual([]);
    });
});

describe('availableLanguages', () => {
    it('counts languages across sources, most common first', () => {
        const sources = [
            { tags: ['manga', 'english'] },
            { tags: ['webtoon', 'english'] },
            { tags: ['manga', 'french'] },
            { tags: ['manga'], language: 'es' }
        ];
        expect(availableLanguages(sources)).toEqual([
            { name: 'English', count: 2 },
            { name: 'French', count: 1 },
            { name: 'Spanish', count: 1 }
        ]);
    });

    it('returns empty for sources with no language signal', () => {
        expect(availableLanguages([{ tags: ['manga'] }, { tags: [] }])).toEqual([]);
    });
});
