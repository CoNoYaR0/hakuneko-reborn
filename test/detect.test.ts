import { describe, it, expect } from 'vitest';
import * as cheerio from 'cheerio';
import { rankTemplates } from '../src/main/engine/detect';

function rank(html: string): ReturnType<typeof rankTemplates> {
    return rankTemplates(html, cheerio.load(html));
}

describe('rankTemplates fingerprinting', () => {
    it('detects WordPress Madara', () => {
        const html = `
            <html><head><link href="/wp-content/themes/madara/style.css"></head>
            <body>
                <div class="post-title"><h3><a href="/manga/x/">X</a></h3></div>
                <div id="manga-chapters-holder" data-id="42"></div>
                <script>var o = { action: 'madara_load_more' }; // wp-manga</script>
            </body></html>`;
        const [best] = rank(html);
        expect(best?.template).toBe('wordpress-madara');
        expect(best?.confidence).toBeGreaterThanOrEqual(1);
        expect(best?.reasons.length).toBeGreaterThanOrEqual(3);
    });

    it('detects WordPress Mangastream and suggests a list path', () => {
        const html = `
            <html><head><meta name="generator" content="Themesia"></head>
            <body>
                <div id="chapterlist"><ul><li><div class="eph-num"><a href="/x/ch-1">1</a></div></li></ul></div>
                <div class="soralist"><ul><li><a class="series" href="/manga/x">X</a></li></ul></div>
                <a href="/manga/list-mode/">List</a>
                <script>var ts_reader = {};</script>
            </body></html>`;
        const [best] = rank(html);
        expect(best?.template).toBe('wordpress-mangastream');
        expect(best?.path).toBe('/manga/list-mode/');
    });

    it('detects MangaReader CMS', () => {
        const html = `
            <html><body>
                <ul class="manga-list"><li><a href="/manga/x">X</a></li></ul>
                <ul class="chapters"><li><h5 class="chapter-title-rtl"><a href="/x/1">1</a></h5></li></ul>
                <script>fetch('/changeMangaList?type=text')</script>
            </body></html>`;
        const [best] = rank(html);
        expect(best?.template).toBe('mangareader-cms');
    });

    it('detects FoolSlide', () => {
        const html = `
            <html><body>
                <div class="list"><div class="group"><div class="title"><a href="/reader/series/x/">X</a></div></div></div>
                <a href="/directory/2/">next</a>
                <script>/* foolslide */ var pages = [];</script>
            </body></html>`;
        const [best] = rank(html);
        expect(best?.template).toBe('foolslide');
    });

    it('returns no candidates for an unrelated page', () => {
        const html = '<html><body><h1>Just a blog</h1><p>hello</p></body></html>';
        expect(rank(html)).toHaveLength(0);
    });

    it('detects MangaReaderCMS from its list endpoint markup (secondary probe)', () => {
        // What GET /changeMangaList?type=text returns — the homepage lacks these.
        const listHtml = '<ul class="manga-list"><li><a href="/one-piece">One Piece</a></li></ul>';
        const [best] = rank(listHtml);
        expect(best?.template).toBe('mangareader-cms');
    });

    it('detects FoolSlide from its /directory/ markup (secondary probe)', () => {
        const dirHtml = '<div class="list"><div class="element"><div class="title"><a href="/reader/series/x/">X</a></div></div></div>';
        const [best] = rank(dirHtml);
        expect(best?.template).toBe('foolslide');
    });

    it('ranks the stronger match first when markers overlap', () => {
        // A Madara page that also happens to contain a /manga/ link
        const html = `
            <html><head><link href="/wp-content/themes/madara/x.css"></head>
            <body>
                <div class="post-title"><h3><a href="/manga/x/">X</a></h3></div>
                <div id="manga-chapters-holder" data-id="1"></div>
                <!-- wp-manga -->
                <a href="/manga/">all</a>
            </body></html>`;
        const ranked = rank(html);
        expect(ranked[0]?.template).toBe('wordpress-madara');
    });
});
