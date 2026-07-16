import { describe, it, expect } from 'vitest';
import { Adaptive } from '../src/main/engine/templates/Adaptive';
import { SourceContext } from '../src/main/engine/SourceContext';
import type { RequestBridge } from '../src/main/RequestBridge';

/**
 * Drive the adaptive template against fixture HTML by stubbing the bridge's
 * fetch to return canned pages. This exercises the real structure heuristics
 * (link clustering, chapter-text detection, reader-image extraction).
 */
function ctxFor(pages: Record<string, string>, url = 'https://example.test'): SourceContext {
    const bridge = {
        fetch: async ({ url: u }: { url: string }) => {
            const path = new URL(u).pathname + new URL(u).search;
            const html = pages[path] ?? pages[u] ?? '';
            return { ok: true, status: 200, statusText: 'OK', finalUrl: u, headers: {}, bodyBase64: Buffer.from(html).toString('base64') };
        }
    } as unknown as RequestBridge;
    return new SourceContext(bridge, { id: 'x', label: 'X', url, template: 'auto' }, Adaptive.defaults);
}

describe('Adaptive template', () => {
    it('extracts a manga list from the dominant detail-link cluster', async () => {
        const list = `<html><body>
            <nav><a href="/">Home</a><a href="/about">About</a></nav>
            <ul class="grid">
                <li><a href="/manga/one-piece">One Piece</a></li>
                <li><a href="/manga/naruto">Naruto</a></li>
                <li><a href="/manga/bleach">Bleach</a></li>
                <li><a href="/manga/berserk">Berserk</a></li>
                <li><a href="/manga/vagabond">Vagabond</a></li>
                <li><a href="/manga/gantz">Gantz</a></li>
            </ul></body></html>`;
        const ctx = ctxFor({ '/': list });
        const mangas = await Adaptive.getMangas(ctx);
        expect(mangas.length).toBe(6);
        expect(mangas.map(m => m.title)).toContain('One Piece');
        expect(mangas[0]?.id).toMatch(/^\/manga\//);
    });

    it('collapses "latest update" chapter links back to their manga (user insight)', async () => {
        // A homepage whose "latest" section lists chapter links, plus nav noise.
        const home = `<html><body>
            <nav><a href="/">Accueil</a><a href="/populaire">Populaire</a><a href="/aleatoire">Aléatoire</a></nav>
            <section class="latest">
                <a href="/manga/grand-blue/74">Grand Blue 74</a>
                <a href="/manga/grand-blue/73">Grand Blue 73</a>
                <a href="/manga/soloist-in-a-cage/20">Soloist in A Cage 20</a>
                <a href="/manga/temple/24">Temple 24</a>
                <a href="/manga/blades/90">Blades of the guardians 90</a>
                <a href="/manga/mononokean/5">Fukigen na Mononokean 5</a>
            </section></body></html>`;
        const ctx = ctxFor({ '/': home });
        const mangas = await Adaptive.getMangas(ctx);
        const titles = mangas.map(m => m.title);
        // Chapter links collapsed to the manga, number stripped, deduped.
        expect(titles).toContain('Grand Blue');
        expect(titles).toContain('Temple');
        expect(titles).not.toContain('Grand Blue 74');   // number stripped
        expect(titles).not.toContain('Accueil');          // nav excluded
        expect(mangas.find(m => m.title === 'Grand Blue')?.id).toBe('/manga/grand-blue');
        expect(mangas.filter(m => m.title === 'Grand Blue').length).toBe(1); // deduped
    });

    it('detects chapter links by text/href patterns (multilingual)', async () => {
        const mangaPage = `<html><body>
            <h1>Some Manga</h1>
            <div class="also-read"><a href="/manga/other">Other Manga</a></div>
            <ul class="chapters">
                <li><a href="/manga/some/chapitre-3">Chapitre 3</a></li>
                <li><a href="/manga/some/chapitre-2">Chapitre 2</a></li>
                <li><a href="/manga/some/chapitre-1">Chapitre 1</a></li>
            </ul></body></html>`;
        const ctx = ctxFor({ '/manga/some': mangaPage });
        const chapters = await Adaptive.getChapters(ctx, { id: '/manga/some', title: 'Some Manga' });
        expect(chapters.length).toBe(3);
        expect(chapters[0]?.title).toBe('Chapitre 3');
        // The "Other Manga" also-read link is not chapter-like → excluded.
        expect(chapters.some(c => c.title === 'Other Manga')).toBe(false);
    });

    it('extracts reader page images (lazy-src aware), skipping chrome', async () => {
        const chapterPage = `<html><body>
            <header><img src="/assets/logo.png"></header>
            <div id="readerarea">
                <img data-src="https://cdn.example.test/uploads/ch1/01.webp" src="/blank.gif">
                <img data-src="https://cdn.example.test/uploads/ch1/02.webp" src="/blank.gif">
                <img data-src="https://cdn.example.test/uploads/ch1/03.webp" src="/blank.gif">
            </div>
            <footer><img src="/assets/banner.jpg"></footer>
        </body></html>`;
        const ctx = ctxFor({ '/manga/some/chapitre-1': chapterPage });
        const pages = await Adaptive.getPages(ctx, { id: '/manga/some/chapitre-1', title: 'Chapitre 1' });
        expect(pages.length).toBe(3);
        const first = pages[0];
        expect(typeof first === 'object' && first.url).toBe('https://cdn.example.test/uploads/ch1/01.webp');
        // logo/banner excluded
        expect(pages.some(p => (typeof p === 'object' ? p.url : p).includes('logo'))).toBe(false);
    });

    it('returns empty (not a crash) on a page with no manga structure', async () => {
        const ctx = ctxFor({ '/': '<html><body><p>hello world</p></body></html>' });
        expect(await Adaptive.getMangas(ctx)).toEqual([]);
    });
});
