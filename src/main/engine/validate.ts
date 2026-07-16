import type { SourceDefinition } from './types';

export interface ValidationResult {
    valid: boolean;
    errors: string[];
}

const ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;

/**
 * Focused validator for source-v1 definitions (see resources/schemas/source-v1.json).
 * Hand-rolled to avoid a schema-library dependency and to give the Source Studio
 * wizard friendly, field-level messages.
 */
export function validateDefinition(value: unknown, knownTemplates?: ReadonlySet<string>): ValidationResult {
    const errors: string[] = [];
    const record = value as Record<string, unknown> | null;

    if (typeof record !== 'object' || record === null || Array.isArray(record)) {
        return { valid: false, errors: ['Definition must be a JSON object.'] };
    }

    const id = record['id'];
    if (typeof id !== 'string' || !ID_PATTERN.test(id)) {
        errors.push('`id` must be a lowercase URL-safe string (a–z, 0–9, ., _, -).');
    }

    if (typeof record['label'] !== 'string' || (record['label'] as string).trim() === '') {
        errors.push('`label` is required and must be a non-empty string.');
    }

    const url = record['url'];
    if (typeof url !== 'string' || !/^https?:\/\//.test(url)) {
        errors.push('`url` must be an http(s) URL.');
    } else {
        try {
            new URL(url);
        } catch {
            errors.push('`url` is not a parseable URL.');
        }
    }

    const template = record['template'];
    if (typeof template !== 'string' || template.trim() === '') {
        errors.push('`template` is required.');
    } else if (knownTemplates && !knownTemplates.has(template)) {
        errors.push(`Unknown template "${template}". Known: ${[...knownTemplates].join(', ')}.`);
    }

    if (record['tags'] !== undefined && !isStringArray(record['tags'])) {
        errors.push('`tags` must be an array of strings.');
    }
    for (const key of ['path', 'language', 'icon'] as const) {
        if (record[key] !== undefined && typeof record[key] !== 'string') {
            errors.push(`\`${key}\` must be a string.`);
        }
    }
    for (const key of ['nsfw', 'disabled'] as const) {
        if (record[key] !== undefined && typeof record[key] !== 'boolean') {
            errors.push(`\`${key}\` must be a boolean.`);
        }
    }
    if (record['overrides'] !== undefined && (typeof record['overrides'] !== 'object' || record['overrides'] === null || Array.isArray(record['overrides']))) {
        errors.push('`overrides` must be an object.');
    }

    return { valid: errors.length === 0, errors };
}

/** Validate and narrow; throws with a combined message on failure. */
export function parseDefinition(value: unknown, knownTemplates?: ReadonlySet<string>): SourceDefinition {
    const result = validateDefinition(value, knownTemplates);
    if (!result.valid) {
        throw new Error(`Invalid source definition:\n- ${result.errors.join('\n- ')}`);
    }
    return value as SourceDefinition;
}

function isStringArray(value: unknown): value is string[] {
    return Array.isArray(value) && value.every(item => typeof item === 'string');
}
