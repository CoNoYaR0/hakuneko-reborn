#!/usr/bin/env node
/**
 * Smart dead-source cleaner for the bundled catalog.
 *
 * Philosophy: a source is only removed on POSITIVE evidence of death.
 * Silence (timeout, DNS hiccup, bot-blocking, Cloudflare challenge) is NEVER
 * treated as dead — those are the classic false negatives.
 *
 * Verdicts:
 *   alive        HTTP response, real content                      → keep
 *   protected    HTTP response with CF/DDoS-Guard challenge       → keep (site works in the app's anti-bot window)
 *   moved        redirects to a different registrable domain      → keep + report target
 *   tls-broken   server exists but TLS handshake fails            → keep (review)
 *   unknown      timeout / DNS busy / transient errors, all passes → keep (review)
 *   origin-down  CDN answers but origin is gone (CF 52x), all passes → keep (review; often temporary)
 *   nxdomain     DNS: domain does not exist (every pass)          → REMOVE with --apply
 *   parked       parking / for-sale / expired-domain lander       → REMOVE with --apply
 *   refused      TCP connection actively refused (every pass)     → REMOVE with --apply
 *
 * Usage:
 *   node scripts/health-check.mjs                  probe + write resources/health-report.json
 *   node scripts/health-check.mjs --apply          also remove proven-dead from catalog.json
 *                                                  (removed entries archived in catalog-removed.json)
 *   node scripts/health-check.mjs --passes 3 --concurrency 24 --timeout 12000
 */
import fs from 'node:fs';
import path from 'node:path';
import dns from 'node:dns/promises';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const resourcesDir = path.resolve(__dirname, '../resources');
const catalogPath = path.join(resourcesDir, 'catalog.json');
const reportPath = path.join(resourcesDir, 'health-report.json');
const removedPath = path.join(resourcesDir, 'catalog-removed.json');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const PASSES = intArg('--passes', 3);
const CONCURRENCY = intArg('--concurrency', 24);
const TIMEOUT = intArg('--timeout', 12_000);
const PASS_DELAY = intArg('--pass-delay', 20_000);

function intArg(name, fallback) {
    const at = args.indexOf(name);
    return at >= 0 ? Number(args[at + 1]) : fallback;
}

const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

// Positive-proof-of-death markers on parking/for-sale landers.
const PARKED_PATTERNS = [
    /domain (?:name )?(?:is )?for sale/i,
    /buy this domain/i,
    /this domain (?:has )?expired/i,
    /domain has been registered/i,
    /sedoparking|sedo\.com\/search/i,
    /parkingcrew|parking-page|img\.sedoparking/i,
    /hugedomains\.com|dan\.com\/buy|afternic\.com/i,
    /godaddy\.com\/domainsearch|wsimg\.com\/parking/i,
    /porkbun\.com.*parked|namesilo.*parking/i,
    /window\.park\s*=/i
];

// Anti-bot challenge markers => the site is alive behind protection.
const PROTECTED_PATTERNS = [
    /just a moment/i,
    /cf-browser-verification|challenge-platform|__cf_chl|cf_chl_/i,
    /ddos-?guard/i,
    /checking your browser|verify you are human|attention required/i,
    /_Incapsula_|sucuri_cloudproxy/i
];

// Cloudflare "origin is gone" error page (server up, site down — often temporary).
const ORIGIN_DOWN = /error code (?:52[0-6]|1016|1001)|origin is unreachable|host error/i;

// A "moved" target on one of these domains means the source was hijacked/expired
// into cam/porn/malware/ad traffic — dead as a manga source, safe to remove.
const JUNK_REDIRECT_DOMAINS = [
    'stripchat.com', 'chaturbate.com', 'nudify.now', 'plexstorm.com', 'go.mayzaent.com',
    'collectbladders.com', 'okiklan.top', 'onclickalgo.com', 'popcash.net', 'propellerads.com',
    'hosmervetclinic.com', 'sandalwoodmedical.ca'
];

function registrableDomain(hostname) {
    // crude eTLD+1 (good enough for a report): last two labels, three for common ccSLDs
    const parts = hostname.toLowerCase().split('.');
    const ccSld = /^(com?|org|net|gov|edu|ac)\.[a-z]{2}$/;
    if (parts.length >= 3 && ccSld.test(parts.slice(-2).join('.'))) {
        return parts.slice(-3).join('.');
    }
    return parts.slice(-2).join('.');
}

async function dnsProbe(hostname) {
    try {
        await dns.lookup(hostname);
        return 'resolves';
    } catch (error) {
        if (error.code === 'ENOTFOUND') return 'nxdomain';
        return 'dns-transient'; // EAI_AGAIN, timeouts, servfail…
    }
}

async function httpProbe(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT);
    try {
        const response = await fetch(url, {
            method: 'GET',
            redirect: 'follow',
            signal: controller.signal,
            headers: {
                'User-Agent': UA,
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.8'
            }
        });
        let body = '';
        try {
            body = (await response.text()).slice(0, 120_000);
        } catch {
            /* body read failed: headers were enough */
        }
        return { kind: 'http', status: response.status, finalUrl: response.url, body };
    } catch (error) {
        const code = error?.cause?.code ?? error?.code ?? (error.name === 'AbortError' || error.name === 'TimeoutError' ? 'TIMEOUT' : 'UNKNOWN');
        return { kind: 'error', code: String(code) };
    } finally {
        clearTimeout(timer);
    }
}

/** One probe attempt → partial verdict + evidence. */
async function probe(def) {
    const hostname = new URL(def.url).hostname;

    const dnsResult = await dnsProbe(hostname);
    if (dnsResult === 'nxdomain') {
        return { verdict: 'nxdomain', evidence: 'DNS: NXDOMAIN' };
    }
    if (dnsResult === 'dns-transient') {
        return { verdict: 'unknown', evidence: 'DNS transient failure' };
    }

    const http = await httpProbe(def.url);
    if (http.kind === 'error') {
        switch (http.code) {
            case 'ECONNREFUSED':
                return { verdict: 'refused', evidence: 'TCP connection refused' };
            case 'CERT_HAS_EXPIRED':
            case 'DEPTH_ZERO_SELF_SIGNED_CERT':
            case 'UNABLE_TO_VERIFY_LEAF_SIGNATURE':
            case 'ERR_TLS_CERT_ALTNAME_INVALID':
                return { verdict: 'tls-broken', evidence: `TLS: ${http.code}` };
            default:
                // TIMEOUT, ECONNRESET, EHOSTUNREACH, UND_ERR_CONNECT_TIMEOUT…
                return { verdict: 'unknown', evidence: `net: ${http.code}` };
        }
    }

    const sample = http.body.slice(0, 60_000);
    if (PROTECTED_PATTERNS.some(rx => rx.test(sample))) {
        return { verdict: 'protected', evidence: `HTTP ${http.status} + challenge page` };
    }
    if (ORIGIN_DOWN.test(sample)) {
        return { verdict: 'origin-down', evidence: `HTTP ${http.status} + CDN origin-down page` };
    }
    if (PARKED_PATTERNS.some(rx => rx.test(sample))) {
        return { verdict: 'parked', evidence: `HTTP ${http.status} + parking-page markers` };
    }

    const fromDomain = registrableDomain(hostname);
    const toHost = new URL(http.finalUrl).hostname;
    const toDomain = registrableDomain(toHost);
    if (fromDomain !== toDomain) {
        if (JUNK_REDIRECT_DOMAINS.some(junk => toHost === junk || toHost.endsWith(`.${junk}`))) {
            return { verdict: 'hijacked', evidence: `redirects to junk domain ${toDomain}`, movedTo: http.finalUrl };
        }
        return { verdict: 'moved', evidence: `redirects to ${toDomain}`, movedTo: http.finalUrl };
    }

    return { verdict: 'alive', evidence: `HTTP ${http.status}, ${http.body.length}b` };
}

/** true when a verdict is settled and needs no further passes. */
const SETTLED = new Set(['alive', 'protected', 'moved', 'parked', 'hijacked']);
/** verdicts that justify removal — positive proof of death only. */
const DEAD = new Set(['nxdomain', 'parked', 'refused', 'hijacked']);

async function runPool(items, worker) {
    let next = 0;
    const lanes = Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
        while (next < items.length) {
            const index = next++;
            await worker(items[index], index);
        }
    });
    await Promise.all(lanes);
}

async function main() {
    const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf-8'));
    console.log(`Health-checking ${catalog.length} sources (${PASSES} passes, ${CONCURRENCY} parallel, ${TIMEOUT}ms timeout)…`);

    /** id → { def, results: [{verdict, evidence}] } */
    const state = new Map(catalog.map(def => [def.id, { def, results: [] }]));

    for (let pass = 1; pass <= PASSES; pass++) {
        const pending = [...state.values()].filter(({ results }) => {
            const last = results[results.length - 1];
            return !last || !SETTLED.has(last.verdict);
        });
        if (pending.length === 0) break;
        console.log(`\nPass ${pass}/${PASSES}: probing ${pending.length} sources…`);
        let done = 0;
        await runPool(pending, async entry => {
            entry.results.push(await probe(entry.def));
            done++;
            if (done % 100 === 0) console.log(`  …${done}/${pending.length}`);
        });
        const unsettled = pending.filter(({ results }) => !SETTLED.has(results[results.length - 1].verdict)).length;
        console.log(`  pass ${pass} done; ${unsettled} still unsettled`);
        if (pass < PASSES && unsettled > 0) {
            console.log(`  waiting ${PASS_DELAY / 1000}s before retrying (busy servers get another chance)…`);
            await new Promise(r => setTimeout(r, PASS_DELAY));
        }
    }

    // Final verdict per source: dead only if EVERY pass agreed on the same dead cause.
    const report = [];
    for (const { def, results } of state.values()) {
        const verdicts = results.map(r => r.verdict);
        const last = results[results.length - 1];
        let final = last.verdict;
        if (DEAD.has(final) && !verdicts.every(v => v === final)) {
            final = 'unknown'; // flapped between states → not proven dead
        }
        report.push({
            id: def.id,
            label: def.label,
            url: def.url,
            template: def.template,
            verdict: final,
            evidence: last.evidence,
            movedTo: last.movedTo,
            passes: verdicts
        });
    }

    const counts = {};
    for (const r of report) counts[r.verdict] = (counts[r.verdict] ?? 0) + 1;
    console.log('\n=== Verdicts ===');
    for (const [verdict, count] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
        console.log(`  ${verdict.padEnd(12)} ${count}`);
    }

    fs.writeFileSync(reportPath, JSON.stringify({
        generatedAt: new Date().toISOString(),
        passes: PASSES,
        counts,
        sources: report.sort((a, b) => a.verdict.localeCompare(b.verdict) || a.id.localeCompare(b.id))
    }, null, 2) + '\n');
    console.log(`\nReport → ${path.relative(process.cwd(), reportPath)}`);

    const moved = report.filter(r => r.verdict === 'moved');
    if (moved.length > 0) {
        console.log(`\n${moved.length} sources have MOVED (kept; consider updating urls):`);
        for (const m of moved.slice(0, 15)) console.log(`  ${m.id}: ${m.url} → ${m.movedTo}`);
        if (moved.length > 15) console.log(`  … and ${moved.length - 15} more (see report)`);
    }

    const dead = report.filter(r => DEAD.has(r.verdict));
    if (!APPLY) {
        console.log(`\n${dead.length} sources are provably dead. Re-run with --apply to remove them from the catalog.`);
        return;
    }

    // --apply: remove proven-dead, archive them for resurrection.
    const deadIds = new Set(dead.map(r => r.id));
    const keep = catalog.filter(def => !deadIds.has(def.id));
    const removedNow = catalog.filter(def => deadIds.has(def.id)).map(def => ({
        ...def,
        removedAt: new Date().toISOString(),
        removedBecause: report.find(r => r.id === def.id)?.verdict
    }));
    let archive = [];
    if (fs.existsSync(removedPath)) {
        archive = JSON.parse(fs.readFileSync(removedPath, 'utf-8'));
    }
    fs.writeFileSync(removedPath, JSON.stringify([...archive, ...removedNow], null, 2) + '\n');
    fs.writeFileSync(catalogPath, JSON.stringify(keep, null, 2) + '\n');
    console.log(`\nApplied: catalog ${catalog.length} → ${keep.length} sources`);
    console.log(`Removed ${removedNow.length} (archived in ${path.relative(process.cwd(), removedPath)}):`);
    const byCause = {};
    for (const r of removedNow) byCause[r.removedBecause] = (byCause[r.removedBecause] ?? 0) + 1;
    for (const [cause, count] of Object.entries(byCause)) console.log(`  ${cause}: ${count}`);
}

await main();
