import type { Session } from 'electron';
import { logLine } from './log';

/**
 * Ad / tracker / malware request blocker — the modern successor to legacy
 * HakuNeko's `engine/Blacklist.mjs`. Legacy blocked these hosts at the network
 * layer so ad and tracker requests never fired while scraping; we do the same on
 * the shared Electron session (covers both `session.fetch` and the anti-bot
 * BrowserWindows). This speeds up scraping, cuts noise, and keeps malvertising
 * redirects (a real hazard on manga aggregator sites) from ever loading.
 *
 * The extractor's parse-time ad-noise filtering is the second layer; this is the
 * first — belt and suspenders.
 */

/**
 * Chrome/WebExtension match patterns (host + optional path). `*.host` matches the
 * host or any subdomain. Ported from legacy Blacklist.mjs (deduplicated), minus
 * the commented-out first-party CDNs legacy deliberately left enabled.
 */
export const BLACKLIST_PATTERNS: readonly string[] = [
    '*://*.2mdnsys.com/*', '*://*.24vunvrv.com/*', '*://*.33across.com/*', '*://*.360yield.com/*',
    '*://*.addthis.com/*', '*://*.addthisedge.com/*', '*://*.adf.ly/*', '*://*.adform.net/*',
    '*://*.admixer.net/*', '*://*.adnxs.com/*', '*://*.adriver.ru/*', '*://*.adsco.re/*',
    '*://*.adservice.google.com/*', '*://*.adskeeper.co.uk/*', '*://*.adsrvr.org/*', '*://*.adtrue.com/*',
    '*://*.advertising.com/*', '*://*.advinci.uno/*', '*://*.adxnexus.com/*', '*://*.ambient-platform.com/*',
    '*://*.amung.us/*', '*://*.arc.io/*', '*://*.audiencerun.com/*', '*://*.bebi.com/*',
    '*://*.bidgear.com/*', '*://*.bidswitch.net/*', '*://*.buysellads.com/*', '*://*.casalemedia.com/*',
    '*://*.chatango.com/*', '*://*.class2deal.com/*', '*://*.cloudfront.net/alpaca.min.css',
    '*://*.cnzz.com/*', '*://*.cobalten.com/*', '*://*.connect.facebook.net/*', '*://*.connectad.io/*',
    '*://*.consensu.org/*', '*://*.contextweb.com/*', '*://*.cpmstar.com/*', '*://*.criteo.net/*',
    '*://*.defpush.com/*', '*://*.digitru.st/*', '*://*.doubleclick.net/*', '*://*.dpypzvjarj.com/*',
    '*://*.dtscout.com/*', '*://*.e-v-e-n.me/*', '*://*.eehuzaih.com/*', '*://*.elasticad.net/*',
    '*://*.eventronbesed.info/*', '*://*.evergreensame.com/*', '*://*.exosrv.com/*', '*://*.fingahvf.top/*',
    '*://*.fqtag.com/*', '*://*.fundingchoices.google.com/*', '*://*.genieessp.com/*',
    '*://*.google-analytics.com/*', '*://*.google.com/ads/*', '*://*.google.com/adsense/*',
    '*://*.googlesyndication.com/*', '*://*.googletagmanager.com/*', '*://*.googletagservices.com/*',
    '*://*.graveuniversalapologies.com/*', '*://*.h12-media.com/*', '*://*.histats.com/*',
    '*://*.hotjar.com/*', '*://*.hunchmotherhooddefine.com/*', '*://*.ie8eamus.com/*',
    '*://*.immunepine.com/*', '*://*.imonomy.com/*', '*://*.infolinks.com/*', '*://*.inter1ads.com/*',
    '*://*.jeconotinhi.info/*', '*://*.jigsawthirsty.com/*', '*://*.jnyyryjarlwbj.top/*',
    '*://*.jsdelivr.net/gh/vli-platform/adb-analytics*', '*://*.juicyads.com/*', '*://*.koindut.com/*',
    '*://*.lkqd.net/*', '*://*.luckypushh.com/*', '*://*.mgid.com/*', '*://*.mineralscreamrobes.com/*',
    '*://*.moatads.com/*', '*://*.mobtrks.com/*', '*://*.nakamasweb.com/*', '*://*.onclasrv.com/*',
    '*://*.onesignal.com/*', '*://*.outbrain.com/*', '*://*.outbrainimg.com/*', '*://*.overkirliaan.com/*',
    '*://*.passeura.com/*', '*://*.pianistrefutationgoose.com/*', '*://*.popcash.net/*',
    '*://*.popmonetizer.net/*', '*://*.premiumvertising.com/*', '*://*.propellerads.com/*',
    '*://*.propellerclick.com/*', '*://*.prowlenthusiasticcongest.com/*', '*://*.pubmatic.com/*',
    '*://*.pubmine.com/*', '*://*.pubpress.net/*', '*://*.pvclouds.com/*', '*://*.radarconsultation.com/*',
    '*://*.revcontent.com/*', '*://*.revrtb.net/*', '*://*.rmcxyfqbm.com/*', '*://*.runative-syndicate.com/*',
    '*://*.runnersgunpowder.com/*', '*://*.sascdn.com/*', '*://*.scorecardresearch.com/*',
    '*://*.sharethis.com/*', '*://*.sharpconnatechamber.com/*', '*://*.shorte.st/*', '*://*.sitemaji.com/*',
    '*://*.sweaterwarmly.com/*', '*://*.taboola.com/*', '*://*.tradeadexchange.com/*', '*://*.tynt.com/*',
    '*://*.utmostsecond.com/*', '*://*.vdo.ai/*', '*://*.veruta.com/*', '*://*.vidible.tv/*',
    '*://*.vidoomy.com/*', '*://*.w55c.net/*', '*://*.womanlimitless.com/*', '*://*.yieldbird.com/*',
    '*://*.your-notice.com/*', '*://*.zap.buzz/*', '*://*.zdaptrksg.com/*', '*://*.zeusadx.com/*',
    '*://*.zryydi.com/*'
];

interface Rule {
    /** Bare host (no leading `*.`). */
    host: string;
    /** Whether the pattern matches subdomains of `host` as well. */
    anySub: boolean;
    /** Path prefix to match; `undefined` means "any path". */
    pathPrefix?: string;
    /** Exact path to match (patterns with no `*` in the path). */
    pathExact?: string;
}

function parsePattern(pattern: string): Rule | null {
    const m = /^(?:\*|https?):\/\/([^/]+)(\/.*)$/.exec(pattern);
    if (!m) {
        return null;
    }
    let host = m[1]!;
    const path = m[2]!;
    let anySub = false;
    if (host.startsWith('*.')) {
        anySub = true;
        host = host.slice(2);
    }
    const star = path.indexOf('*');
    if (star < 0) {
        return { host, anySub, pathExact: path };
    }
    const prefix = path.slice(0, star);
    return { host, anySub, pathPrefix: prefix === '/' ? undefined : prefix };
}

/** A compiled, fast blocklist: O(host-labels) lookup for the common any-path rules. */
export interface Blocklist {
    shouldBlock(rawUrl: string): boolean;
}

/** Compile match patterns into a blocklist matcher (pure — no Electron). */
export function compileBlacklist(patterns: readonly string[] = BLACKLIST_PATTERNS): Blocklist {
    /** Hosts that block every path (fast set lookup by host suffix). */
    const anyPathHosts = new Set<string>();
    /** Rules constrained by path (checked only when the host matches). */
    const pathRulesByHost = new Map<string, Rule[]>();

    for (const pattern of patterns) {
        const rule = parsePattern(pattern);
        if (!rule) {
            continue;
        }
        if (rule.pathPrefix === undefined && rule.pathExact === undefined) {
            anyPathHosts.add(rule.host);
        } else {
            const list = pathRulesByHost.get(rule.host) ?? [];
            list.push(rule);
            pathRulesByHost.set(rule.host, list);
        }
    }

    /** Yield the hostname and each parent domain suffix ("a.b.c" → a.b.c, b.c, c). */
    function* suffixes(hostname: string): Generator<string> {
        let h = hostname;
        yield h;
        let dot = h.indexOf('.');
        while (dot >= 0) {
            h = h.slice(dot + 1);
            yield h;
            dot = h.indexOf('.');
        }
    }

    return {
        shouldBlock(rawUrl: string): boolean {
            let url: URL;
            try {
                url = new URL(rawUrl);
            } catch {
                return false;
            }
            const hostname = url.hostname;
            const pathAndQuery = url.pathname + url.search;
            for (const suffix of suffixes(hostname)) {
                const anySubMatch = suffix !== hostname; // reached via a parent → subdomain match
                if (anyPathHosts.has(suffix)) {
                    // any-path rules are always `*.host` (anySub), so a suffix hit blocks.
                    return true;
                }
                const rules = pathRulesByHost.get(suffix);
                if (rules) {
                    for (const rule of rules) {
                        if (!rule.anySub && anySubMatch) {
                            continue;
                        }
                        if (rule.pathExact !== undefined) {
                            if (url.pathname === rule.pathExact) {
                                return true;
                            }
                        } else if (rule.pathPrefix !== undefined && pathAndQuery.startsWith(rule.pathPrefix)) {
                            return true;
                        }
                    }
                }
            }
            return false;
        }
    };
}

/**
 * Install the ad/tracker blocker on an Electron session. `isEnabled` is read on
 * every request, so the Settings toggle takes effect immediately with no
 * re-registration. Safe to call once at startup.
 */
export function installAdBlocker(session: Session, isEnabled: () => boolean): void {
    const blocklist = compileBlacklist();
    let blockedCount = 0;
    session.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
        if (isEnabled() && blocklist.shouldBlock(details.url)) {
            blockedCount++;
            if (blockedCount % 100 === 1) {
                logLine('net', `ad-blocker: blocked ${blockedCount} tracker/ad request(s) so far`);
            }
            callback({ cancel: true });
            return;
        }
        callback({ cancel: false });
    });
}
