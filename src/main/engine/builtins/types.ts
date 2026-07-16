import type { PluginMeta } from '../CodePlugin';

/**
 * Metadata for a first-party built-in provider. Same shape as a user code
 * plugin's meta, plus an optional display `language` for the source list.
 */
export interface BuiltinMeta extends PluginMeta {
    language?: string;
}
