import { SourceContext } from '../SourceContext';
import * as MangaDex from './MangaDex';
import type { RequestBridge } from '../../RequestBridge';
import type { PluginProvider } from '../CodePlugin';
import type { BuiltinMeta } from './types';

/**
 * First-party built-in providers: the small set of legacy "custom" connectors
 * that are API-driven (not HTML) and so can't be expressed as a JSON template
 * or handled by the adaptive extractor. They ship with the app as trusted code
 * and are registered through the same provider path as user code plugins — but
 * bundled and without the install-time security warning.
 *
 * To add one: create engine/builtins/Foo.ts exporting `meta: BuiltinMeta` and
 * `create(ctx): PluginProvider`, then add the module here.
 */
interface BuiltinModule {
    meta: BuiltinMeta;
    create(ctx: SourceContext): PluginProvider;
}

const MODULES: BuiltinModule[] = [MangaDex];

export interface BuiltinProvider {
    meta: BuiltinMeta;
    provider: PluginProvider;
}

/** Instantiate every built-in provider, each with its own scraping context. */
export function createBuiltinProviders(bridge: RequestBridge): BuiltinProvider[] {
    return MODULES.map(mod => {
        const ctx = new SourceContext(
            bridge,
            { id: mod.meta.id, label: mod.meta.label, url: mod.meta.url, template: 'custom', origin: 'bundled' },
            {}
        );
        return { meta: mod.meta, provider: mod.create(ctx) };
    });
}

export const BUILTIN_METAS: readonly BuiltinMeta[] = MODULES.map(m => m.meta);
export type { BuiltinMeta };
