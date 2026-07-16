#!/usr/bin/env node
/**
 * Catalog child-safety pass:
 *   1. Remove sources that now redirect to cam/porn/malware landers
 *      (dead as manga sources; unsafe regardless of age) → archived.
 *   2. Stamp `nsfw: true` on adult sources so the app can age-gate them.
 *
 * The NSFW lists MUST mirror src/main/engine/nsfw.ts (guarded by test/nsfw.test.ts).
 *
 * Usage:
 *   node scripts/classify-nsfw.mjs            report only
 *   node scripts/classify-nsfw.mjs --apply    rewrite catalog.json + archive removals
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const resourcesDir = path.resolve(__dirname, '../resources');
const catalogPath = path.join(resourcesDir, 'catalog.json');
const removedPath = path.join(resourcesDir, 'catalog-removed.json');
const APPLY = process.argv.includes('--apply');

// Mirror of engine/nsfw.ts (keep in sync — test/nsfw.test.ts checks this).
const ADULT_TAGS = ['hentai', 'porn', 'adult', 'nsfw', 'r18', '18+', 'smut', 'doujin', 'doujinshi', 'erotic', 'ecchi', 'xxx'];
const ADULT_KEYWORDS = ['hentai', 'hentay', 'porn', 'xxx', 'r18', '18plus', 'adult', 'nsfw', 'doujin', 'milftoon', 'lewd', 'smut', 'erotic', 'nhentai', 'fakku', 'ecchi', 'boobs', 'sex'];

function isAdult(def) {
    if (typeof def.nsfw === 'boolean') return def.nsfw;
    const tags = (def.tags ?? []).map(t => t.toLowerCase());
    if (tags.some(t => ADULT_TAGS.includes(t))) return true;
    const hay = `${def.id} ${def.label} ${def.url}`.toLowerCase();
    return ADULT_KEYWORDS.some(k => hay.includes(k));
}

// Confirmed hijacked into cam/nudify/ad-malware traffic (health-check "moved"
// targets). These no longer serve manga and must go.
const HIJACKED_IDS = new Set([
    'manytoon', 'manytooncom', 'manytoonkr',
    'manhwaraw', 'mangahentai', 'manhwahentaime', 'painfulnightz'
]);

const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf-8'));

const removed = catalog.filter(d => HIJACKED_IDS.has(d.id));
const kept = catalog.filter(d => !HIJACKED_IDS.has(d.id));

let stamped = 0;
for (const def of kept) {
    if (isAdult(def)) {
        if (def.nsfw !== true) stamped++;
        def.nsfw = true;
    }
}

console.log(`Catalog: ${catalog.length} sources`);
console.log(`Hijacked/junk to remove: ${removed.length} (${removed.map(d => d.id).join(', ')})`);
console.log(`NSFW sources flagged: ${kept.filter(isAdult).length} (${stamped} newly stamped)`);

if (!APPLY) {
    console.log('\nRe-run with --apply to write changes.');
    console.log('NSFW list:', kept.filter(isAdult).map(d => d.id).join(', '));
    process.exit(0);
}

// Order NSFW flag right after label for readable diffs; keep field order stable.
const normalized = kept.map(d => {
    const { origin, ...rest } = d;
    return { ...rest, origin };
});
fs.writeFileSync(catalogPath, JSON.stringify(normalized, null, 2) + '\n');

let archive = fs.existsSync(removedPath) ? JSON.parse(fs.readFileSync(removedPath, 'utf-8')) : [];
const already = new Set(archive.map(a => a.id));
const newlyRemoved = removed
    .filter(d => !already.has(d.id))
    .map(d => ({ ...d, removedAt: new Date().toISOString(), removedBecause: 'hijacked' }));
fs.writeFileSync(removedPath, JSON.stringify([...archive, ...newlyRemoved], null, 2) + '\n');

console.log(`\nApplied: catalog ${catalog.length} → ${normalized.length} sources`);
console.log(`Archived ${newlyRemoved.length} hijacked sources in ${path.relative(process.cwd(), removedPath)}`);
