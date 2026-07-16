import type { RequestBridge } from '../src/main/RequestBridge';
import type { FetchRequest, FetchResponse, FetchWindowRequest, FetchWindowResponse } from '@shared/ipc';

export interface FakeRoute {
    /** Return HTML (or throw) for a matching request; return undefined to skip. */
    match(request: FetchRequest): string | undefined;
}

/**
 * A RequestBridge stand-in for tests: no network. `fetch` routes are tried in
 * order; `windowResults` answers fetchWindow by URL substring.
 */
export function fakeBridge(options: {
    routes: FakeRoute[];
    windowResults?: Array<{ urlIncludes: string; result: unknown }>;
}): RequestBridge {
    const bridge = {
        async fetch(request: FetchRequest): Promise<FetchResponse> {
            for (const route of options.routes) {
                const html = route.match(request);
                if (html !== undefined) {
                    return {
                        ok: true,
                        status: 200,
                        statusText: 'OK',
                        finalUrl: request.url,
                        headers: { 'content-type': 'text/html' },
                        bodyBase64: Buffer.from(html, 'utf-8').toString('base64')
                    };
                }
            }
            throw new Error(`No fake route for ${request.method ?? 'GET'} ${request.url}`);
        },
        async fetchWindow<T>(request: FetchWindowRequest): Promise<FetchWindowResponse<T>> {
            const hit = options.windowResults?.find(w => request.url.includes(w.urlIncludes));
            if (!hit) {
                throw new Error(`No fake window result for ${request.url}`);
            }
            return { finalUrl: request.url, result: hit.result as T, elapsedMs: 1 };
        }
    };
    return bridge as unknown as RequestBridge;
}

/** Route that matches when every provided predicate matches. */
export function route(html: string, when: (r: FetchRequest) => boolean): FakeRoute {
    return { match: (r) => (when(r) ? html : undefined) };
}
