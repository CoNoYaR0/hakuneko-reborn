import * as cheerio from 'cheerio';
import type { CheerioAPI, Cheerio } from 'cheerio';
import type { AnyNode } from 'domhandler';
import type { RequestBridge } from '../RequestBridge';
import { isChallenge } from '../challenge';
import { logLine } from '../log';
import type { FetchOptions, SourceDefinition } from './types';

/**
 * Everything a template needs to scrape a site, injected as dependencies
 * (replacing legacy's `Engine.*` globals + browser `window`/`document`).
 *
 * DOM work runs in Node via cheerio; network goes through the anti-bot
 * RequestBridge in the main process. Templates never touch Electron directly.
 */
export class SourceContext {

    readonly url: string;
    readonly path: string;
    /** Merged template defaults + definition overrides; templates read selectors here. */
    readonly config: Record<string, unknown>;
    readonly definition: SourceDefinition;

    readonly #bridge: RequestBridge;

    constructor(bridge: RequestBridge, definition: SourceDefinition, defaults: Record<string, unknown>) {
        this.#bridge = bridge;
        this.definition = definition;
        this.url = definition.url.replace(/\/+$/, '');
        this.path = definition.path ?? (defaults['path'] as string | undefined) ?? '';
        this.config = { ...defaults, ...(definition.overrides ?? {}) };
    }

    /** Read a string-valued config/override (template selector), with a fallback. */
    str(key: string, fallback = ''): string {
        const value = this.config[key];
        return typeof value === 'string' ? value : fallback;
    }

    /** Diagnostics line tagged with this source's id (templates report selector match counts here). */
    debug(msg: string, level: 'info' | 'warn' = 'info'): void {
        logLine('scrape', `[${this.definition.id}] ${msg}`, level);
    }

    /** Absolute URL from a href/src relative to a base (port of getAbsolutePath). */
    absolute(reference: string, base: string): string {
        return new URL(reference, base).href;
    }

    /** Same-host links collapse to a root-relative path; cross-host stay absolute (legacy port). */
    rootRelativeOrAbsolute(reference: string, base: string): string {
        const uri = new URL(reference, base);
        const baseHost = new URL(base).hostname;
        return uri.hostname === baseHost ? uri.pathname + uri.search + uri.hash : uri.href;
    }

    async fetchText(url: string, options: FetchOptions = {}): Promise<string> {
        return this.#fetchText(url, options, true);
    }

    async #fetchText(url: string, options: FetchOptions, allowClear: boolean): Promise<string> {
        const retries = options.retries ?? 0;
        const doFetch = (): Promise<import('@shared/ipc').FetchResponse> => this.#bridge.fetch({
            url,
            method: options.method,
            headers: this.#headers(options),
            body: options.body
        });
        const decode = (base64: string): string => new TextDecoder(options.encoding ?? 'utf-8').decode(Buffer.from(base64, 'base64'));

        let response = await doFetch();
        let text = decode(response.bodyBase64);
        logLine('net', `${(options.method ?? 'GET').toUpperCase()} ${url} → ${response.status} ${text.length}b`,
            response.ok ? 'info' : 'warn');

        // Anti-bot wall? Pop the window so the user solves it once, then carry on
        // using the SAME cleared session.
        if (allowClear && isChallenge(response.status, text)) {
            logLine('net', `anti-bot challenge on ${new URL(url).host} → opening verification window`, 'warn');
            await this.#bridge.ensureCleared(url);   // visible popup; human clicks; cookie set
            response = await doFetch();               // retry the request with the clearance cookie
            text = decode(response.bodyBase64);
            const stillWalled = isChallenge(response.status, text);
            logLine('net', `after verification: ${url} → ${response.status} ${text.length}b${stillWalled ? ' (still walled)' : ' ✓'}`,
                stillWalled ? 'warn' : 'info');

            // Still walled after solving? For a GET, read it straight from a real
            // browser window in the same cleared session — the most reliable way
            // to take advantage of the human having just solved the challenge.
            if (stillWalled && (options.method ?? 'GET').toUpperCase() === 'GET' && !options.body) {
                try {
                    logLine('net', `reading ${url} through the cleared browser window…`);
                    const { result } = await this.#bridge.fetchWindow<{ html: string }>({ url });
                    return result.html;
                } catch {
                    /* fall through and return whatever we got */
                }
            }
        }
        if (response.status >= 500 && retries > 0) {
            await SourceContext.#wait(2500);
            return this.#fetchText(url, { ...options, retries: retries - 1 }, allowClear);
        }
        return text;
    }

    async fetchJson<T = unknown>(url: string, options: FetchOptions = {}): Promise<T> {
        const text = await this.fetchText(url, options);
        return JSON.parse(text) as T;
    }

    /** Fetch and parse HTML; returns the cheerio root so templates can query freely. */
    async fetchDom(url: string, options: FetchOptions = {}): Promise<CheerioAPI> {
        const html = await this.fetchText(url, options);
        return cheerio.load(SourceContext.prepareHtml(html));
    }

    /**
     * Faithful port of legacy Connector.createDOM's markup rewrite: replace
     * <img>/<use> with <source> so image tags don't trigger loads and so the
     * many `queryPages` selectors that target `source` keep working. Also
     * strips iframe attributes. This is load-bearing — Madara/MangaReaderCMS
     * page selectors depend on it.
     */
    /** Prepare + parse HTML into a cheerio root (same pipeline as fetchDom). */
    static parse(content: string): CheerioAPI {
        return cheerio.load(SourceContext.prepareHtml(content));
    }

    static prepareHtml(content: string): string {
        return content
            .replace(/<img/g, '<source')
            .replace(/<\/img/g, '</source')
            .replace(/<use/g, '<source')
            .replace(/<\/use/g, '</source')
            .replace(/<iframe[^<]*?>/g, '<iframe>');
    }

    /**
     * Render a page in the hidden anti-bot window and run a script in page
     * context. For sites whose data only exists after JS runs (e.g. Mangastream
     * `ts_reader.params.sources`). Port of Engine.Request.fetchUI usage.
     */
    async fetchWindow<T = unknown>(url: string, script: string, referer?: string): Promise<T> {
        const { result } = await this.#bridge.fetchWindow<T>({ url, script, referer, images: false });
        return result;
    }

    /** Convenience: cheerio nodes matched by selector, as an array. */
    static elements($: CheerioAPI, selector: string): AnyNode[] {
        return $(selector).toArray();
    }

    #headers(options: FetchOptions): Record<string, string> {
        const headers: Record<string, string> = { ...options.headers };
        if (options.referer) {
            headers['x-referer'] = options.referer;
        }
        return headers;
    }

    static #wait(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

export type { CheerioAPI, Cheerio, AnyNode };
