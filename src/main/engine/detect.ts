import * as cheerio from 'cheerio';
import { TEMPLATES } from './templates';
import { isAdultSource } from './nsfw';
import { SourceContext } from './SourceContext';
import { isChallenge } from '../challenge';
import type { RequestBridge } from '../RequestBridge';
import type { SourceDefinition } from './types';

/**
 * Source auto-detection: fetch a site's homepage and figure out everything
 * needed to build a SourceDefinition — which template it uses, its name, icon,
 * language, and whether it looks adult. This is what makes "paste a URL" work.
 */

export interface TemplateCandidate {
    template: string;
    /** 0..1 confidence from matched fingerprint markers. */
    confidence: number;
    /** Human-readable markers that matched, for the wizard to show. */
    reasons: string[];
    /** Suggested path override for this template (e.g. Mangastream list path). */
    path?: string;
}

export interface DetectionResult {
    url: string;
    reachable: boolean;
    error?: string;
    /** Ranked best-first; empty when nothing matched (user picks manually). */
    candidates: TemplateCandidate[];
    suggested: {
        id: string;
        label: string;
        language?: string;
        icon?: string;
        tags: string[];
        nsfw: boolean;
    };
}

/** A fingerprint scores a fetched homepage for one template. */
interface Fingerprint {
    template: string;
    /**
     * Sub-path to fetch and re-score when the homepage shows no markers. Some
     * templates (FoolSlide, MangaReaderCMS) keep their tells on a list page or
     * AJAX endpoint rather than the root.
     */
    probePath?: string;
    score(html: string, $: cheerio.CheerioAPI): { hits: string[]; path?: string };
}

const FINGERPRINTS: Fingerprint[] = [
    {
        template: 'wordpress-madara',
        score(html, $) {
            const hits: string[] = [];
            if (/themes\/madara/i.test(html)) hits.push('madara theme asset');
            if (/madara_load_more|manga_get_chapters/i.test(html)) hits.push('madara ajax action');
            if ($('[id^="manga-chapters-holder"]').length) hits.push('manga-chapters-holder element');
            if ($('div.post-title h3 a, div.post-title h5 a').length) hits.push('post-title listing');
            if (/wp-manga/i.test(html)) hits.push('wp-manga post type');
            return { hits };
        }
    },
    {
        template: 'wordpress-mangastream',
        score(html, $) {
            const hits: string[] = [];
            if (/ts_reader/i.test(html)) hits.push('ts_reader script');
            if (/themesia|mangastream/i.test(html)) hits.push('themesia/mangastream theme');
            if ($('div#chapterlist').length) hits.push('#chapterlist element');
            if ($('div.soralist a.series').length) hits.push('soralist series links');
            if ($('div#readerarea').length) hits.push('#readerarea element');
            // Common Mangastream list paths
            const path = $('a[href*="/manga/list-mode"]').length ? '/manga/list-mode/'
                : $('a[href$="/manga/"]').length ? '/manga/' : undefined;
            return { hits, path };
        }
    },
    {
        template: 'mangareader-cms',
        probePath: '/changeMangaList?type=text',
        score(html, $) {
            const hits: string[] = [];
            if ($('ul.manga-list').length) hits.push('ul.manga-list');
            if (/changeMangaList/i.test(html)) hits.push('changeMangaList endpoint');
            if ($('div#all source.img-responsive, div#all img.img-responsive').length) hits.push('#all reader images');
            if ($('ul.chapters li').length) hits.push('ul.chapters listing');
            return { hits };
        }
    },
    {
        template: 'foolslide',
        probePath: '/directory/',
        score(html, $) {
            const hits: string[] = [];
            if (/foolslide|foolslide2|fools_?slide/i.test(html)) hits.push('foolslide marker');
            if ($('div.list div.group div.title a, div.list div.element div.title a').length) hits.push('foolslide listing');
            if ($('a[href*="/directory/"]').length) hits.push('/directory/ link');
            if (/var\s+pages\s*=/.test(html)) hits.push('inline pages array');
            return { hits };
        }
    }
];

/** Adult-content signals in homepage text (beyond tag/keyword metadata). */
const ADULT_CONTENT = /\b(hentai|nsfw|18\+|adults?\s+only|explicit content|porn|xxx|r-?18|ecchi)\b/i;

/**
 * Rank templates by fingerprint hits against already-parsed HTML. Pure and
 * bridge-free so it can be unit-tested with fixture pages.
 */
export function rankTemplates(html: string, $: cheerio.CheerioAPI): TemplateCandidate[] {
    const candidates: TemplateCandidate[] = [];
    for (const fp of FINGERPRINTS) {
        if (!TEMPLATES.has(fp.template)) {
            continue;
        }
        const { hits, path } = fp.score(html, $);
        if (hits.length > 0) {
            candidates.push({
                template: fp.template,
                confidence: Math.min(1, hits.length / 3),
                reasons: hits,
                path
            });
        }
    }
    return candidates.sort((a, b) => b.confidence - a.confidence);
}

export async function detectSource(bridge: RequestBridge, rawUrl: string): Promise<DetectionResult> {
    const url = normalizeUrl(rawUrl);
    const host = new URL(url).hostname;
    const fallback: DetectionResult = {
        url,
        reachable: false,
        candidates: [],
        suggested: { id: slugify(host), label: prettyHost(host), tags: ['manga'], nsfw: false }
    };

    // Fetch the homepage. The plain path is fast; but Cloudflare/DDoS-Guard
    // answer bot-suspicious requests with 403/429/503 rather than throwing, so
    // treat those (and any thrown error) as "needs the anti-bot window".
    async function fetchViaWindow(): Promise<string | undefined> {
        try {
            const { result } = await bridge.fetchWindow<{ html: string }>({ url, timeout: 60_000, images: true });
            return SourceContext.prepareHtml(result.html);
        } catch {
            return undefined;
        }
    }

    const decode = (base64: string): string => SourceContext.prepareHtml(Buffer.from(base64, 'base64').toString('utf-8'));

    let html: string | undefined;
    let staticError: string | undefined;
    try {
        let response = await bridge.fetch({ url });
        let body = decode(response.bodyBase64);
        // Cloudflare/DDoS-Guard? Pop the solve window (once), then retry — so
        // "add link" gets past anti-bot exactly like normal browsing does.
        if (!response.ok || isChallenge(response.status, body)) {
            staticError = `Site returned HTTP ${response.status}`;
            await bridge.ensureCleared(url);
            response = await bridge.fetch({ url });
            body = decode(response.bodyBase64);
        }
        if (response.ok && !isChallenge(response.status, body)) {
            html = body;
        } else {
            html = await fetchViaWindow(); // still blocked, or JS-rendered → render in a window
        }
    } catch (error) {
        staticError = error instanceof Error ? error.message : String(error);
        html = await fetchViaWindow();
    }
    if (html === undefined) {
        return { ...fallback, error: staticError ?? 'Could not reach that site.' };
    }

    const $ = cheerio.load(html);
    const candidates = rankTemplates(html, $);

    // Secondary probe: templates whose markers live on a list page/endpoint
    // rather than the homepage (FoolSlide /directory/, MangaReaderCMS ajax).
    if (candidates.length === 0) {
        const matchedTemplates = new Set(candidates.map(c => c.template));
        for (const fp of FINGERPRINTS) {
            if (!fp.probePath || matchedTemplates.has(fp.template) || !TEMPLATES.has(fp.template)) {
                continue;
            }
            try {
                const probe = await bridge.fetch({ url: new URL(fp.probePath, url).href });
                if (!probe.ok) {
                    continue;
                }
                const probeHtml = SourceContext.prepareHtml(Buffer.from(probe.bodyBase64, 'base64').toString('utf-8'));
                const { hits } = fp.score(probeHtml, cheerio.load(probeHtml));
                if (hits.length > 0) {
                    candidates.push({
                        template: fp.template,
                        confidence: Math.min(1, hits.length / 3),
                        reasons: hits.map(h => `${h} (at ${fp.probePath})`)
                    });
                }
            } catch {
                /* probe path unreachable — skip this template */
            }
        }
        candidates.sort((a, b) => b.confidence - a.confidence);
    }

    // No specific engine recognised → offer the structure-based adaptive
    // extractor so the source can still be added and will just work.
    if (candidates.length === 0) {
        candidates.push({
            template: 'auto',
            confidence: 0.5,
            reasons: ['no specific engine detected — using the adaptive structure-based extractor']
        });
    }

    // Extract metadata for prefill.
    const label = $('meta[property="og:site_name"]').attr('content')?.trim()
        || cleanTitle($('title').first().text())
        || prettyHost(host);
    const language = normalizeLang($('html').attr('lang'));
    const icon = await resolveFavicon(bridge, url, $);

    const nsfwByText = ADULT_CONTENT.test($('title').text() + ' ' + $('meta[name="description"]').attr('content'));
    const nsfwByMeta = isAdultSource({ id: slugify(host), label, url, tags: [] });

    return {
        url,
        reachable: true,
        candidates,
        suggested: {
            id: slugify(host),
            label,
            language,
            icon,
            tags: ['manga'],
            nsfw: nsfwByText || nsfwByMeta
        }
    };
}

/** Turn a detection + chosen template into a ready-to-save definition. */
export function buildDefinition(result: DetectionResult, template: string, overrides?: Partial<SourceDefinition>): SourceDefinition {
    const candidate = result.candidates.find(c => c.template === template);
    return {
        id: result.suggested.id,
        label: result.suggested.label,
        url: result.url,
        template,
        tags: result.suggested.tags,
        ...(candidate?.path ? { path: candidate.path } : {}),
        ...(result.suggested.language ? { language: result.suggested.language } : {}),
        ...(result.suggested.icon ? { icon: result.suggested.icon } : {}),
        nsfw: result.suggested.nsfw,
        origin: 'user',
        ...overrides
    };
}

function normalizeUrl(raw: string): string {
    let value = raw.trim();
    if (!/^https?:\/\//i.test(value)) {
        value = `https://${value}`;
    }
    const parsed = new URL(value);
    return `${parsed.protocol}//${parsed.host}`;
}

function slugify(host: string): string {
    return host.replace(/^www\./, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'source';
}

function prettyHost(host: string): string {
    const base = host.replace(/^www\./, '').split('.')[0] ?? host;
    return base.charAt(0).toUpperCase() + base.slice(1);
}

function cleanTitle(title: string): string {
    // Strip common suffixes like " - Read Manga Online"
    return title.split(/[|\-–—]/)[0]?.trim() ?? title.trim();
}

function normalizeLang(lang: string | undefined): string | undefined {
    if (!lang) {
        return undefined;
    }
    return lang.trim().slice(0, 2).toLowerCase() || undefined;
}

async function resolveFavicon(bridge: RequestBridge, baseUrl: string, $: cheerio.CheerioAPI): Promise<string | undefined> {
    const href = $('link[rel~="icon"]').first().attr('href') || '/favicon.ico';
    try {
        const iconUrl = new URL(href, baseUrl).href;
        const response = await bridge.fetch({ url: iconUrl });
        if (!response.ok) {
            return undefined;
        }
        const bytes = Buffer.from(response.bodyBase64, 'base64');
        if (bytes.length === 0 || bytes.length > 200_000) {
            return undefined; // skip empty or oversized icons
        }
        const mime = response.headers['content-type']?.split(';')[0]?.trim() || 'image/x-icon';
        return `data:${mime};base64,${response.bodyBase64}`;
    } catch {
        return undefined;
    }
}

export { FINGERPRINTS };
