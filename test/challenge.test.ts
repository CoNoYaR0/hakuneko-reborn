import { describe, it, expect } from 'vitest';
import { isChallenge } from '../src/main/challenge';

describe('isChallenge', () => {
    it('flags Cloudflare/WAF block status codes', () => {
        expect(isChallenge(403, '')).toBe(true);
        expect(isChallenge(429, '')).toBe(true);
        expect(isChallenge(503, '')).toBe(true);
    });

    it('flags challenge markers in a 200 body (JS interstitial)', () => {
        expect(isChallenge(200, '<title>Just a moment...</title>')).toBe(true);
        expect(isChallenge(200, 'cf-browser-verification in progress')).toBe(true);
        expect(isChallenge(200, '<div>DDoS-Guard</div>')).toBe(true);
        expect(isChallenge(200, 'Verify you are human')).toBe(true);
    });

    it('does not flag ordinary successful content', () => {
        expect(isChallenge(200, '<html><body><ul class="manga-list">…</ul></body></html>')).toBe(false);
        expect(isChallenge(404, 'Not Found')).toBe(false);
    });
});
