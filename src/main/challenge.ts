/**
 * Anti-bot challenge detection — pure logic, kept free of Electron so it can be
 * used by the engine and unit-tested without the Electron runtime.
 */

/** Markers that a response body is an anti-bot interstitial, not real content. */
const CHALLENGE_MARKERS = /just a moment|cf-browser-verification|challenge-platform|__cf_chl|cf[_-]?chl|ddos-?guard|checking your browser|attention required|verify you are human|_Incapsula_|sucuri_cloudproxy/i;

/**
 * Does this response look like a Cloudflare/DDoS-Guard/WAF challenge rather
 * than real content? Used to decide whether to pop the anti-bot window.
 */
export function isChallenge(status: number, body: string): boolean {
    if (status === 403 || status === 429 || status === 503) {
        return true;
    }
    return CHALLENGE_MARKERS.test(body.slice(0, 4000));
}
