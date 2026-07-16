import { app, session } from 'electron';

/**
 * Header rewriting for every request leaving the app (hidden scraping windows
 * and session fetches alike). Port of legacy Request.mjs
 * onBeforeSendHeadersHandler / onHeadersReceivedHandler.
 *
 * Connectors smuggle intended header values through `x-*` request headers
 * (browsers refuse to set Referer/Origin/Cookie directly); this module moves
 * them into the real headers in the privileged main process.
 */

/**
 * The real Chromium UA with Electron/app tokens stripped. Unlike legacy's
 * randomized fake UAs, this matches the actual TLS/JS fingerprint of the
 * runtime — which is what modern Cloudflare correlates against.
 */
export function defaultUserAgent(): string {
    return session.defaultSession.getUserAgent()
        .replace(new RegExp(`\\s${app.getName()}/[\\S]+`, 'i'), '')
        .replace(/\sElectron\/[\S]+/i, '');
}

function mergeCookies(original: string | undefined, extra: string): string {
    const jar = new Map<string, string>();
    for (const part of `${original ?? ''}; ${extra}`.split(';')) {
        const separator = part.indexOf('=');
        if (separator > 0) {
            jar.set(part.slice(0, separator).trim(), part.slice(separator + 1).trim());
        }
    }
    return [...jar.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
}

type Headers = Record<string, string>;

/** Move the value of a smuggled `x-` header into the real header, if present. */
function applySmuggled(headers: Headers, smuggled: string, real: string): void {
    const value = headers[smuggled];
    if (value !== undefined) {
        headers[real] = value;
    }
    delete headers[smuggled];
}

export function installHeaderRules(userAgent: string): void {
    const webRequest = session.defaultSession.webRequest;

    webRequest.onBeforeSendHeaders((details, callback) => {
        const headers: Headers = details.requestHeaders;
        const uri = new URL(details.url);

        // Remove headers accidentally added by an opened developer console
        for (const header of Object.keys(headers)) {
            if (header.startsWith('X-DevTools')) {
                delete headers[header];
            }
        }

        applySmuggled(headers, 'x-host', 'Host');

        // Never leak the Electron UA; allow per-request override
        if (headers['User-Agent']?.toLowerCase().includes('electron')) {
            headers['User-Agent'] = userAgent;
        }
        applySmuggled(headers, 'x-user-agent', 'User-Agent');

        // Never serve anti-bot challenges from cache (legacy intent; the
        // original assigned undefined by mistake — fixed here)
        headers['Cache-Control'] = 'no-cache';
        headers['Pragma'] = 'no-cache';

        /*
         * Overwrite the Referer, but NEVER during a Cloudflare challenge
         * redirect chain — that causes infinite redirects (legacy lesson).
         */
        if (!/(ch[kl]_jschl|challenge-platform)/i.test(uri.href)) {
            const referer = headers['x-referer'];
            if (referer !== undefined) {
                headers['Referer'] = referer;
            }
        }
        delete headers['x-referer'];

        applySmuggled(headers, 'x-origin', 'Origin');

        const extraCookie = headers['x-cookie'];
        if (extraCookie !== undefined) {
            headers['Cookie'] = mergeCookies(headers['Cookie'], extraCookie);
        }
        delete headers['x-cookie'];

        applySmuggled(headers, 'x-sec-fetch-dest', 'Sec-Fetch-Dest');
        applySmuggled(headers, 'x-sec-fetch-mode', 'Sec-Fetch-Mode');
        applySmuggled(headers, 'x-sec-fetch-site', 'Sec-Fetch-Site');
        applySmuggled(headers, 'x-sec-ch-ua', 'sec-ch-ua');

        // Some image CDNs (e.g. imgur) reject requests whose accept types
        // include non-image mimes => force an image accept header
        if (/i\.imgur\.com/i.test(uri.hostname) || /\.(jpg|jpeg|png|gif|webp)$/i.test(uri.pathname)) {
            headers['Accept'] = 'image/webp,image/apng,image/*,*/*';
            delete headers['accept'];
        }

        // Avoid detection through a non-standard lowercase accept header
        applySmuggled(headers, 'accept', 'Accept');

        callback({ requestHeaders: headers });
    });

    webRequest.onHeadersReceived((details, callback) => {
        const headers = details.responseHeaders ?? {};
        const uri = new URL(details.url);

        // Some hosts redirect via 'X-Redirect' instead of 'Location'
        const redirect = headers['X-Redirect'] || headers['x-redirect'];
        if (redirect) {
            headers['Location'] = redirect;
        }
        if (uri.hostname.includes('mp4upload')) {
            headers['Access-Control-Expose-Headers'] = ['Content-Length'];
        }
        if (uri.hostname.includes('comikey') && uri.pathname.includes('/read/')) {
            delete headers['content-security-policy'];
        }
        // TODO(phase2): port Cookie.applyCrossSiteCookies for cross-site video streams

        callback({ responseHeaders: headers });
    });
}
