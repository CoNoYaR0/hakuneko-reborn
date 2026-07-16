import fs from 'node:fs';
import path from 'node:path';
import { isChallenge } from './challenge';
import { mangaCandidatesFromHtml } from './engine/templates/Adaptive';
import { logLine } from './log';
import type { RequestBridge } from './RequestBridge';
import type { SourceDefinition } from './engine/types';

/**
 * One-time functional catalog cleaner (run via `electron . --verify-catalog`).
 *
 * Tests each source by ACTUALLY fetching it and trying to extract a manga list
 * (structure-based, so it works regardless of template). The user's rule:
 *  - a site that serves manga (a name/list) is ALIVE
 *  - a site behind anti-bot is ALIVE (dead sites don't have Cloudflare — the
 *    challenge itself proves the site exists and is legit)
 *  - a site that responds with real HTML but has no manga and no anti-bot is DEAD
 *  - a site that never responds is UNREACHABLE
 * JS-rendered shells are kept (ambiguous) to avoid false removals.
 *
 * No windows are opened — this uses the plain fetch path only, so 300+ sources
 * can be checked quickly and unattended. `--apply` removes dead/unreachable
 * (archived to catalog-removed.json); without it, only a report is written.
 */

type Verdict = 'alive' | 'protected' | 'js-shell' | 'dead' | 'unreachable';

interface ProbeResult {
    verdict: Verdict;
    evidence: string;
    sample?: string;
}

const SPA_MARKERS = /__NEXT_DATA__|__NUXT__|data-reactroot|id=["']root["']|ng-app|<div id=["']app["']|window\.__INITIAL|window\.__NUXT/i;

async function fetchOnce(bridge: RequestBridge, url: string): Promise<{ status: number; body: string } | undefined> {
    try {
        const res = await bridge.fetch({ url });
        return { status: res.status, body: Buffer.from(res.bodyBase64, 'base64').toString('utf-8') };
    } catch {
        return undefined;
    }
}

async function probe(bridge: RequestBridge, def: SourceDefinition): Promise<ProbeResult> {
    const base = def.url.replace(/\/+$/, '');
    const urls = [...new Set([base + (def.path ?? ''), base + '/', base + '/manga/'].map(u => u || `${base}/`))];

    let anyResponse = false;
    let sawSpa = false;
    let biggest = 0;
    let lastStatus = 0;

    for (const url of urls) {
        const res = await fetchOnce(bridge, url);
        if (!res) continue;
        anyResponse = true;
        lastStatus = res.status;
        biggest = Math.max(biggest, res.body.length);

        if (isChallenge(res.status, res.body)) {
            return { verdict: 'protected', evidence: `anti-bot challenge (HTTP ${res.status}) — site is live` };
        }
        if (SPA_MARKERS.test(res.body)) sawSpa = true;
        if (res.status >= 400) continue; // 404 etc. → try the next candidate URL

        const mangas = mangaCandidatesFromHtml(res.body, url);
        if (mangas.length >= 1) {
            return { verdict: 'alive', evidence: `${mangas.length} manga found`, sample: mangas[0]!.title };
        }
    }

    if (!anyResponse) {
        return { verdict: 'unreachable', evidence: 'no HTTP response (DNS / refused / timeout)' };
    }
    if (sawSpa || biggest < 3000) {
        return { verdict: 'js-shell', evidence: `responds (${biggest}b, HTTP ${lastStatus}) but content is JS-rendered — kept` };
    }
    return { verdict: 'dead', evidence: `responds (${biggest}b, HTTP ${lastStatus}) but no manga and no anti-bot` };
}

export async function verifyCatalog(bridge: RequestBridge, catalogPath: string, apply: boolean, concurrency = 8): Promise<void> {
    const catalog: SourceDefinition[] = JSON.parse(fs.readFileSync(catalogPath, 'utf-8'));
    logLine('verify', `Functionally testing ${catalog.length} sources (concurrency ${concurrency})…`);

    const results = new Array<ProbeResult & { id: string; label: string; url: string; template: string }>(catalog.length);
    let next = 0;
    let done = 0;
    const worker = async (): Promise<void> => {
        while (next < catalog.length) {
            const i = next++;
            const def = catalog[i]!;
            const r = await probe(bridge, def);
            results[i] = { id: def.id, label: def.label, url: def.url, template: def.template, ...r };
            done++;
            if (done % 25 === 0) logLine('verify', `…${done}/${catalog.length}`);
        }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, catalog.length) }, worker));

    const counts: Record<string, number> = {};
    for (const r of results) counts[r.verdict] = (counts[r.verdict] ?? 0) + 1;
    logLine('verify', `Verdicts: ${JSON.stringify(counts)}`);

    const dir = path.dirname(catalogPath);
    const reportPath = path.join(dir, 'verify-report.json');
    fs.writeFileSync(reportPath, JSON.stringify({ generatedAt: new Date().toISOString(), counts, results }, null, 2) + '\n');
    logLine('verify', `Report → ${reportPath}`);

    if (!apply) {
        const removable = results.filter(r => r.verdict === 'dead' || r.verdict === 'unreachable').length;
        logLine('verify', `Dry run. ${removable} sources are dead/unreachable. Re-run with --apply to remove them.`);
        return;
    }

    const removeIds = new Set(results.filter(r => r.verdict === 'dead' || r.verdict === 'unreachable').map(r => r.id));
    const keep = catalog.filter(d => !removeIds.has(d.id));
    const removed = catalog.filter(d => removeIds.has(d.id)).map(d => ({
        ...d,
        removedAt: new Date().toISOString(),
        removedBecause: results.find(r => r.id === d.id)?.verdict
    }));
    const removedPath = path.join(dir, 'catalog-removed.json');
    const archive = fs.existsSync(removedPath) ? JSON.parse(fs.readFileSync(removedPath, 'utf-8')) : [];
    fs.writeFileSync(removedPath, JSON.stringify([...archive, ...removed], null, 2) + '\n');
    fs.writeFileSync(catalogPath, JSON.stringify(keep, null, 2) + '\n');
    logLine('verify', `Applied: catalog ${catalog.length} → ${keep.length} (removed ${removed.length}, archived in catalog-removed.json)`);
}
