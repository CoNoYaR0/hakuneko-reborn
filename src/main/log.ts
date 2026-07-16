/**
 * Lightweight diagnostics log — the "why isn't this source loading?" tool.
 *
 * Every entry goes to the console (visible in the terminal running the app) AND
 * into a ring buffer exposed to the UI (Settings → Diagnostics). Electron-free
 * so the engine can import it without breaking vitest.
 */

export type LogLevel = 'info' | 'warn' | 'error';

export interface LogEntry {
    t: number;
    scope: string;
    level: LogLevel;
    msg: string;
}

const MAX = 800;
const buffer: LogEntry[] = [];
let listener: (() => void) | undefined;

export function setLogListener(fn: (() => void) | undefined): void {
    listener = fn;
}

export function logLine(scope: string, msg: string, level: LogLevel = 'info'): void {
    const entry: LogEntry = { t: Date.now(), scope, level, msg };
    buffer.push(entry);
    if (buffer.length > MAX) {
        buffer.shift();
    }
    const tag = `[${scope}]`;
    if (level === 'error') {
        console.error(tag, msg);
    } else if (level === 'warn') {
        console.warn(tag, msg);
    } else {
        console.log(tag, msg);
    }
    listener?.();
}

export function getLogs(): LogEntry[] {
    return [...buffer];
}

export function clearLogs(): void {
    buffer.length = 0;
    listener?.();
}
