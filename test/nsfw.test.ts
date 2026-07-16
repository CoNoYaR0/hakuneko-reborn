import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isAdultSource, ADULT_TAGS, ADULT_KEYWORDS } from '../src/main/engine/nsfw';

describe('isAdultSource', () => {
    it('respects an explicit nsfw flag over heuristics', () => {
        expect(isAdultSource({ id: 'x', label: 'Wholesome', url: 'https://a.com', nsfw: true, tags: ['manga'] })).toBe(true);
        expect(isAdultSource({ id: 'hentaisite', label: 'H', url: 'https://hentai.com', nsfw: false, tags: ['hentai'] })).toBe(false);
    });

    it('flags adult tags', () => {
        expect(isAdultSource({ id: 's', label: 'S', url: 'https://s.com', tags: ['manga', 'hentai'] })).toBe(true);
        expect(isAdultSource({ id: 's', label: 'S', url: 'https://s.com', tags: ['webtoon', 'porn'] })).toBe(true);
    });

    it('flags adult keywords in id/label/url', () => {
        expect(isAdultSource({ id: 'milftoon', label: 'Milftoon', url: 'https://milftoon.xxx', tags: [] })).toBe(true);
        expect(isAdultSource({ id: 's', label: 'S', url: 'https://nhentai.net', tags: [] })).toBe(true);
    });

    it('does not flag ordinary manga sources', () => {
        expect(isAdultSource({ id: 'mangaread', label: 'MangaRead', url: 'https://www.mangaread.org', tags: ['manga', 'english'] })).toBe(false);
        expect(isAdultSource({ id: 'weeb', label: 'Weeb Central', url: 'https://weebcentral.com', tags: ['webtoon'] })).toBe(false);
    });

    it('classifies every nsfw-flagged catalog entry as adult (and no others)', () => {
        const catalogPath = fileURLToPath(new URL('../resources/catalog.json', import.meta.url));
        const catalog = JSON.parse(readFileSync(catalogPath, 'utf-8')) as Array<Parameters<typeof isAdultSource>[0]>;
        for (const def of catalog) {
            // The shipped `nsfw` field must agree with the runtime classifier.
            expect(isAdultSource(def)).toBe(isAdultSource({ ...def, nsfw: undefined }));
        }
    });

    it('keeps the script mirror of the keyword lists in sync', () => {
        // scripts/classify-nsfw.mjs must inline the same lists (it runs without TS).
        const scriptPath = fileURLToPath(new URL('../scripts/classify-nsfw.mjs', import.meta.url));
        const script = readFileSync(scriptPath, 'utf-8');
        for (const tag of ADULT_TAGS) {
            expect(script, `ADULT_TAGS "${tag}" missing from classify-nsfw.mjs`).toContain(`'${tag}'`);
        }
        for (const keyword of ADULT_KEYWORDS) {
            expect(script, `ADULT_KEYWORDS "${keyword}" missing from classify-nsfw.mjs`).toContain(`'${keyword}'`);
        }
    });
});
