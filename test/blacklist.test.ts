import { describe, it, expect } from 'vitest';
import { compileBlacklist } from '../src/main/Blacklist';

describe('ad/tracker blocklist matcher', () => {
    const bl = compileBlacklist();

    it('blocks known ad/tracker hosts and their subdomains', () => {
        expect(bl.shouldBlock('https://doubleclick.net/x')).toBe(true);
        expect(bl.shouldBlock('https://pagead2.googlesyndication.com/pagead/js/x.js')).toBe(true);
        expect(bl.shouldBlock('http://stats.g.doubleclick.net/collect')).toBe(true);
        expect(bl.shouldBlock('https://a.taboola.com/reco')).toBe(true);
    });

    it('does NOT block legitimate manga/CDN hosts', () => {
        expect(bl.shouldBlock('https://mangadex.org/title/abc')).toBe(false);
        expect(bl.shouldBlock('https://uploads.mangadex.org/data/hash/1.png')).toBe(false);
        expect(bl.shouldBlock('https://cdn.some-manga-site.com/chapter/1.jpg')).toBe(false);
    });

    it('honours path-specific rules without over-blocking the whole host', () => {
        // Only the specific tracking asset is blocked on cloudfront/jsdelivr…
        expect(bl.shouldBlock('https://d123.cloudfront.net/alpaca.min.css')).toBe(true);
        expect(bl.shouldBlock('https://cdn.jsdelivr.net/gh/vli-platform/adb-analytics.js')).toBe(true);
        // …not the rest of those CDNs (they host legit libraries/images).
        expect(bl.shouldBlock('https://d123.cloudfront.net/manga/page-1.jpg')).toBe(false);
        expect(bl.shouldBlock('https://cdn.jsdelivr.net/npm/vue/dist/vue.js')).toBe(false);
    });

    it('ignores malformed URLs', () => {
        expect(bl.shouldBlock('not a url')).toBe(false);
    });
});
