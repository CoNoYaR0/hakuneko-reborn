import { BrowserWindow, session } from 'electron';
import { HostLimiter } from './HostLimiter';
import type {
    FetchRequest, FetchResponse,
    FetchWindowRequest, FetchWindowResponse
} from '@shared/ipc';

/**
 * All network access for the application. Port of legacy Request.mjs.
 *
 * Two paths:
 *  - fetch():       Chromium network stack via session.fetch — fast path,
 *                   shares cookies (e.g. cf_clearance) with fetchWindow().
 *  - fetchWindow(): hidden BrowserWindow rendering the page — the anti-bot
 *                   workhorse (Cloudflare, DDoS-Guard, JS-rendered sites).
 *                   Port of fetchUI: automatic challenges are waited out
 *                   (each challenge redirect re-triggers did-finish-load),
 *                   interactive challenges pop the window so a human can
 *                   solve the captcha, then scraping continues.
 */
export class RequestBridge {

    readonly #userAgent: string;
    readonly #limiter = new HostLimiter();
    /** In-flight clearance per host, so parallel requests share one window. */
    readonly #clearing = new Map<string, Promise<void>>();
    /** When each host was last cleared, so we don't reopen the window repeatedly. */
    readonly #clearedAt = new Map<string, number>();
    static readonly #CLEAR_COOLDOWN_MS = 60_000;

    constructor(userAgent: string) {
        this.#userAgent = userAgent;
    }

    /** Update the per-host concurrency cap (from Settings). */
    setMaxConcurrentPerHost(max: number): void {
        this.#limiter.setMax(max);
    }

    /**
     * Make sure the given host is cleared through any anti-bot challenge. Opens
     * the site's origin in the anti-bot window (shown to the user if the
     * challenge is interactive — the "Verify you are human" checkbox). On
     * success the clearance cookie lands in the shared session, so the caller's
     * `fetch()` — and every later request to that host — succeeds.
     *
     * Deduped per host and best-effort: if the user closes the window or it
     * times out, this resolves anyway and the caller's retry surfaces the error.
     */
    ensureCleared(url: string): Promise<void> {
        const host = new URL(url).host;
        // Just cleared this host? Don't reopen the window — the cookie is fresh,
        // and if the site still 403s the caller falls back to browser-read. This
        // stops hard hosts from flooding the user with verification popups.
        const clearedAt = this.#clearedAt.get(host);
        if (clearedAt && Date.now() - clearedAt < RequestBridge.#CLEAR_COOLDOWN_MS) {
            return Promise.resolve();
        }
        let pending = this.#clearing.get(host);
        if (!pending) {
            pending = this.#clearWindow(new URL(url).origin)
                .then(() => { this.#clearedAt.set(host, Date.now()); })
                .catch(() => undefined)
                .finally(() => this.#clearing.delete(host));
            this.#clearing.set(host, pending);
        }
        return pending;
    }

    /**
     * Detects whether the currently-loaded page is an anti-bot interstitial
     * (as opposed to the real site). Deliberately does NOT key off the
     * `/cdn-cgi/challenge-platform/` script — Cloudflare injects that on EVERY
     * page of a protected site, even after clearance, so it gives false
     * positives. Uses the interstitial title, the challenge UI containers, and
     * captcha iframes instead.
     */
    static readonly #challengePresentScript = `(() => {
        const title = (document.title || '').toLowerCase();
        const interstitial = ['just a moment', 'attention required', 'un instant', 'ddos-guard', 'checking your browser', 'verifying you are human'];
        if (interstitial.some(x => title.includes(x))) return true;
        if (document.querySelector('#challenge-form, #challenge-running, #challenge-stage, #cf-challenge-running, .cf-browser-verification')) return true;
        if (document.querySelector('iframe[src*="challenges.cloudflare.com"], iframe[src*="hcaptcha.com"], iframe[title*="captcha" i]')) return true;
        const body = document.body ? document.body.innerText.trim() : '';
        if (body.length < 800 && /verify you are human|checking your browser|cf-browser-verification|human verification|vérif/i.test(body)) return true;
        return false;
    })();`;

    /**
     * Open the site in a real window and keep it OPEN and VISIBLE while an
     * anti-bot challenge is present, so the user can click "Verify you are
     * human". Polls (and re-checks on each navigation) until the challenge
     * clears — then closes automatically. The clearance cookie is set in the
     * shared session, so the caller's retried fetch (and all later requests)
     * succeed. This is the reliable path: it never leaves the window hidden.
     */
    #clearWindow(origin: string): Promise<void> {
        return new Promise((resolve) => {
            const win = new BrowserWindow({
                show: false,
                width: 1000,
                height: 760,
                title: 'Site verification — pass the check and this window closes by itself',
                autoHideMenuBar: true,
                // A NORMAL browser context: the user is solving a Cloudflare
                // Turnstile / captcha here, so web security must stay ON. Turning
                // it off (as the scraping windows do) breaks the cross-origin
                // challenge iframe and triggers "bad IPC message" renderer crashes.
                webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, images: true }
            });

            let settled = false;
            let shown = false;
            const finish = (): void => {
                if (settled) return;
                settled = true;
                clearInterval(poll);
                clearTimeout(timer);
                if (!win.isDestroyed()) {
                    win.destroy();
                }
                resolve();
            };
            const timer = setTimeout(finish, 180_000);
            win.on('closed', finish); // user closed it manually → give up gracefully

            // Give automatic ("managed") challenges a few seconds to pass on
            // their own before showing the window — so the user only ever sees a
            // popup for challenges that genuinely need a human click.
            let firstChallengeAt = 0;
            const GRACE_MS = 6000;

            const check = async (): Promise<void> => {
                if (settled || win.isDestroyed()) return;
                try {
                    const challenged = await win.webContents.executeJavaScript(RequestBridge.#challengePresentScript) as boolean;
                    if (!challenged) {
                        // Real page reached → cleared. Stop polling and give the
                        // clearance cookie a moment to commit to the shared
                        // session before the caller retries its request.
                        clearInterval(poll);
                        setTimeout(finish, 500);
                        return;
                    }
                    if (firstChallengeAt === 0) {
                        firstChallengeAt = Date.now();
                    }
                    if (!shown && Date.now() - firstChallengeAt >= GRACE_MS) {
                        shown = true; // still challenged after the grace period → needs a human
                        win.center();
                        win.show();
                        win.focus();
                    }
                } catch {
                    /* page mid-navigation; the next tick/load will re-check */
                }
            };

            const poll = setInterval(check, 1000);
            win.webContents.on('did-finish-load', () => void check());
            win.loadURL(origin, { userAgent: this.#userAgent }).catch(() => { /* did-fail-load handles it; poll continues */ });
        });
    }

    /** Strip `onerror` handlers so broken trackers can't disturb scraping (legacy port). */
    static readonly #domPreparationScript = `
        {
            for(const image of [...document.querySelectorAll('img[onerror]')]) {
                image.removeAttribute('onerror');
                image.onerror = undefined;
            }
        }
    `;

    /**
     * Detect anti-bot interstitials. Resolves to:
     *   undefined     → real page, continue scraping
     *   'automatic'   → challenge solves itself, wait for next page load
     *   'interactive' → human needed (captcha), show the window
     * Port of the legacy scraping-check script (obfuscated site-specific
     * blocks dropped) + detection for current Cloudflare managed challenges.
     */
    static readonly #scrapingCheckScript = `
        new Promise(async (resolve, reject) => {
            const automatic = () => resolve('automatic');
            const interactive = () => resolve('interactive');

            // Generic meta refresh redirect
            if(document.querySelector('meta[http-equiv="refresh"][content*="="]')) {
                return automatic();
            }

            // Cloudflare hard error page => scraping cannot continue
            const cfCode = document.querySelector('.cf-error-code');
            if(cfCode) {
                return reject(new Error('CloudFlare Error ' + cfCode.innerText));
            }
            // Cloudflare legacy JS/captcha challenges
            if(document.querySelector('form#challenge-form[action*="_jschl_"]')) {
                return automatic();
            }
            if(document.querySelector('form#challenge-form[action*="_captcha_"]')) {
                return interactive();
            }
            // Cloudflare managed challenge / Turnstile ("Just a moment...")
            if(document.querySelector('script[src*="/cdn-cgi/challenge-platform/"]') || document.querySelector('#challenge-running, #challenge-stage')) {
                await new Promise(r => setTimeout(r, 4000));
                return document.querySelector('iframe[src*="challenges.cloudflare.com"]') ? interactive() : automatic();
            }

            // DDoS-Guard
            const title = document.querySelector('title');
            if(title && title.text === 'DDOS-GUARD') {
                await new Promise(r => setTimeout(r, 7000));
                return document.querySelector('div#h-captcha') ? interactive() : automatic();
            }

            // Aniwave-style WAF
            if(title && title.text === 'WAF' && document.documentElement.innerHTML.indexOf('/waf-js-run') !== -1) {
                await new Promise(r => setTimeout(r, 5000));
                return automatic();
            }

            resolve(undefined);
        });
    `;

    /** Returned when the caller provides no script of its own. */
    static readonly #defaultResultScript = `
        ({
            title: document.title,
            url: window.location.href,
            html: document.documentElement ? document.documentElement.outerHTML : ''
        });
    `;

    async fetch(request: FetchRequest): Promise<FetchResponse> {
        return this.#limiter.run(request.url, async () => {
            const response = await session.defaultSession.fetch(request.url, {
                method: request.method ?? 'GET',
                headers: { 'User-Agent': this.#userAgent, ...request.headers },
                body: request.body,
                credentials: 'include',
                redirect: 'follow'
            });
            const headers: Record<string, string> = {};
            response.headers.forEach((value, key) => {
                headers[key] = value;
            });
            const body = Buffer.from(await response.arrayBuffer());
            return {
                ok: response.ok,
                status: response.status,
                statusText: response.statusText,
                finalUrl: response.url,
                headers,
                bodyBase64: body.toString('base64')
            };
        });
    }

    async fetchWindow<T = unknown>(request: FetchWindowRequest): Promise<FetchWindowResponse<T>> {
        return this.#limiter.run(request.url, () => this.#fetchWindow(request));
    }

    #fetchWindow<T>(request: FetchWindowRequest): Promise<FetchWindowResponse<T>> {
        const timeout = request.timeout ?? 60_000;
        const script = request.script ?? RequestBridge.#defaultResultScript;
        const started = Date.now();

        return new Promise((resolve, reject) => {
            const win = new BrowserWindow({
                show: false,
                title: 'Complete the site verification, then this window closes automatically',
                autoHideMenuBar: true,
                webPreferences: {
                    nodeIntegration: false,
                    contextIsolation: true,
                    sandbox: true,
                    // Scraping reads the page's OWN DOM (same-origin) via an
                    // isolated-world script, so web security can stay ON — which
                    // closes a narrow cross-origin cookie-read risk from a
                    // malicious source. contextIsolation bypasses page CSP for
                    // our injected script regardless.
                    webSecurity: true,
                    images: request.images ?? false
                }
            });

            // Once settled, no other event may resolve/reject (legacy semantics)
            let settled = false;
            const finish = (action: () => void) => {
                if (!settled) {
                    settled = true;
                    clearTimeout(abortTimer);
                    if (!win.isDestroyed()) {
                        win.destroy();
                    }
                    action();
                }
            };

            const abortTimer = setTimeout(() => {
                finish(() => reject(new Error(
                    `Failed to load "${request.url}" within the given timeout of ${Math.floor(timeout / 1000)} seconds!`
                )));
            }, timeout);

            win.webContents.on('dom-ready', () => {
                win.webContents.executeJavaScript(RequestBridge.#domPreparationScript).catch(() => undefined);
            });

            win.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
                // fires for any blocked/failed subresource too => only fail on the main document
                if (errorCode && errorCode !== -3 && (isMainFrame || validatedURL === request.url)) {
                    finish(() => reject(new Error(`${errorDescription} ${validatedURL}`)));
                }
            });

            win.webContents.on('did-finish-load', async () => {
                try {
                    const verdict = await win.webContents.executeJavaScript(RequestBridge.#scrapingCheckScript) as string | undefined;
                    if (verdict === 'automatic') {
                        return; // challenge redirects on its own; next load re-enters here
                    }
                    if (verdict === 'interactive') {
                        win.setSize(1280, 720);
                        win.center();
                        win.show();
                        win.focus();
                        return; // human solves the captcha; next load re-enters here
                    }
                    const result = await win.webContents.executeJavaScript(script) as T;
                    const finalUrl = win.webContents.getURL();
                    finish(() => resolve({ finalUrl, result, elapsedMs: Date.now() - started }));
                } catch (error) {
                    finish(() => reject(error instanceof Error ? error : new Error(String(error))));
                }
            });

            win.loadURL(request.url, {
                userAgent: request.userAgent ?? this.#userAgent,
                httpReferrer: request.referer
            }).catch(() => {
                /* rejection surfaces through did-fail-load with a proper error code */
            });
        });
    }
}
