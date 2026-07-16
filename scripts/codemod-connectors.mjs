#!/usr/bin/env node
/**
 * Codemod: convert legacy HakuNeko connectors (.mjs classes) into declarative
 * v2 JSON source definitions.
 *
 * Strategy (deliberately conservative for a trustworthy catalog):
 *   - Parse each connector with acorn.
 *   - Convert ONLY when the class:
 *       * directly extends a supported template, and
 *       * has no members other than a constructor, and
 *       * that constructor contains nothing but super(...) and assignments of
 *         *literal* values (string / number / bool / array-of-literals) to
 *         this.X / super.X.
 *   - Anything else (custom logic, non-literal values, unsupported template,
 *     connector-extends-connector chains) is skipped and listed in a report,
 *     so nothing is silently mis-migrated.
 *
 * Output:
 *   resources/catalog.json          → array of SourceDefinition
 *   resources/codemod-report.json   → { migrated, skipped[], stats }
 *
 * Usage:  node scripts/codemod-connectors.mjs [legacyConnectorsDir]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as acorn from 'acorn';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const v2Root = path.resolve(__dirname, '..');
const legacyDir = process.argv[2]
    ? path.resolve(process.argv[2])
    : path.resolve(v2Root, '../src/web/mjs/connectors');
const outDir = path.join(v2Root, 'resources');

// Legacy template class name → v2 template name (must exist in engine/templates/index.ts)
const TEMPLATE_MAP = {
    WordPressMadara: 'wordpress-madara',
    WordPressMangastream: 'wordpress-mangastream',
    FoolSlide: 'foolslide',
    MangaReaderCMS: 'mangareader-cms'
};

// Constructor fields that map to top-level definition keys (not overrides)
const CORE_FIELDS = new Set(['id', 'label', 'tags', 'url', 'path', 'language']);

function literalValue(node) {
    // Returns { ok:true, value } for representable literals, else { ok:false }
    if (!node) return { ok: false };
    switch (node.type) {
        case 'Literal':
            if (['string', 'number', 'boolean'].includes(typeof node.value)) {
                return { ok: true, value: node.value };
            }
            return { ok: false };
        case 'ArrayExpression': {
            const items = [];
            for (const el of node.elements) {
                const lit = literalValue(el);
                if (!lit.ok) return { ok: false };
                items.push(lit.value);
            }
            return { ok: true, value: items };
        }
        case 'TemplateLiteral':
            // only a template literal with no interpolations is a constant
            if (node.expressions.length === 0 && node.quasis.length === 1) {
                return { ok: true, value: node.quasis[0].value.cooked };
            }
            return { ok: false };
        case 'UnaryExpression':
            if (node.operator === '-' || node.operator === '+') {
                const inner = literalValue(node.argument);
                if (inner.ok && typeof inner.value === 'number') {
                    return { ok: true, value: node.operator === '-' ? -inner.value : inner.value };
                }
            }
            return { ok: false };
        default:
            return { ok: false };
    }
}

function analyze(source, fileName) {
    let ast;
    try {
        ast = acorn.parse(source, { ecmaVersion: 2022, sourceType: 'module' });
    } catch (error) {
        return { ok: false, reason: `parse-error: ${error.message}` };
    }

    const classNode = ast.body.find(n => n.type === 'ExportDefaultDeclaration' && n.declaration.type === 'ClassDeclaration')?.declaration
        ?? ast.body.find(n => n.type === 'ClassDeclaration');
    if (!classNode) return { ok: false, reason: 'no-class' };

    const superName = classNode.superClass?.type === 'Identifier' ? classNode.superClass.name : undefined;
    if (!superName) return { ok: false, reason: 'no-superclass' };
    const template = TEMPLATE_MAP[superName];
    if (!template) return { ok: false, reason: `unsupported-template:${superName}` };

    const members = classNode.body.body;
    const nonCtor = members.filter(m => !(m.type === 'MethodDefinition' && m.kind === 'constructor'));
    if (nonCtor.length > 0) {
        return { ok: false, reason: 'has-custom-members', template: superName };
    }
    const ctor = members.find(m => m.type === 'MethodDefinition' && m.kind === 'constructor');
    if (!ctor) return { ok: false, reason: 'no-constructor', template: superName };

    const fields = {};
    const overrides = {};
    for (const stmt of ctor.value.body.body) {
        // allow: super();
        if (stmt.type === 'ExpressionStatement' && stmt.expression.type === 'CallExpression' && stmt.expression.callee.type === 'Super') {
            continue;
        }
        // require: (this|super).X = <literal>;
        if (stmt.type === 'ExpressionStatement'
            && stmt.expression.type === 'AssignmentExpression'
            && stmt.expression.operator === '='
            && stmt.expression.left.type === 'MemberExpression'
            && (stmt.expression.left.object.type === 'ThisExpression' || stmt.expression.left.object.type === 'Super')
            && stmt.expression.left.property.type === 'Identifier') {
            const key = stmt.expression.left.property.name;
            const lit = literalValue(stmt.expression.right);
            if (!lit.ok) {
                return { ok: false, reason: `non-literal-assignment:${key}`, template: superName };
            }
            if (CORE_FIELDS.has(key)) {
                fields[key] = lit.value;
            } else {
                overrides[key] = lit.value;
            }
            continue;
        }
        return { ok: false, reason: 'non-trivial-statement', template: superName };
    }

    if (!fields.id || !fields.label || !fields.url) {
        return { ok: false, reason: 'missing-core-fields', template: superName };
    }

    const definition = {
        id: String(fields.id),
        label: String(fields.label),
        url: String(fields.url),
        template
    };
    if (Array.isArray(fields.tags)) definition.tags = fields.tags.map(String);
    if (fields.path !== undefined) definition.path = String(fields.path);
    if (fields.language !== undefined) definition.language = String(fields.language);
    if (Object.keys(overrides).length > 0) definition.overrides = overrides;
    definition.origin = 'bundled';

    return { ok: true, definition, fileName };
}

function main() {
    const files = fs.readdirSync(legacyDir).filter(f => f.endsWith('.mjs') && !f.startsWith('.') && f !== '@Samples.mjs');
    const migrated = [];
    const skipped = [];
    const byId = new Map();

    for (const file of files) {
        const full = path.join(legacyDir, file);
        if (fs.statSync(full).isDirectory()) continue;
        const source = fs.readFileSync(full, 'utf-8');
        const result = analyze(source, file);
        if (result.ok) {
            const def = result.definition;
            if (byId.has(def.id)) {
                skipped.push({ file, reason: `duplicate-id:${def.id}` });
                continue;
            }
            byId.set(def.id, def);
            migrated.push(def);
        } else {
            skipped.push({ file, reason: result.reason, template: result.template });
        }
    }

    migrated.sort((a, b) => a.label.toLowerCase().localeCompare(b.label.toLowerCase()));

    // stats: group skip reasons
    const skipReasons = {};
    for (const s of skipped) {
        const key = s.reason.split(':')[0];
        skipReasons[key] = (skipReasons[key] ?? 0) + 1;
    }
    const perTemplate = {};
    for (const d of migrated) {
        perTemplate[d.template] = (perTemplate[d.template] ?? 0) + 1;
    }

    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'catalog.json'), JSON.stringify(migrated, null, 2) + '\n');
    fs.writeFileSync(path.join(outDir, 'codemod-report.json'), JSON.stringify({
        generatedAt: new Date().toISOString(),
        legacyDir,
        stats: { totalFiles: files.length, migrated: migrated.length, skipped: skipped.length, perTemplate, skipReasons },
        skipped
    }, null, 2) + '\n');

    console.log(`Scanned ${files.length} legacy connectors.`);
    console.log(`Migrated ${migrated.length} → resources/catalog.json`);
    for (const [tpl, n] of Object.entries(perTemplate).sort((a, b) => b[1] - a[1])) {
        console.log(`   ${tpl}: ${n}`);
    }
    console.log(`Skipped ${skipped.length} (see resources/codemod-report.json). Top reasons:`);
    for (const [reason, n] of Object.entries(skipReasons).sort((a, b) => b[1] - a[1]).slice(0, 8)) {
        console.log(`   ${reason}: ${n}`);
    }
}

main();
