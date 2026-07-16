/**
 * Per-host concurrency limiter so a burst of requests cannot hammer a single
 * site (successor of the legacy connector lock()/unlock() mechanism).
 */
export class HostLimiter {

    #maxConcurrent: number;
    readonly #active = new Map<string, number>();
    readonly #waiting = new Map<string, Array<() => void>>();

    constructor(maxConcurrent = 4) {
        this.#maxConcurrent = maxConcurrent;
    }

    /** Adjust the per-host cap at runtime (from Settings). Raising it releases waiters. */
    setMax(maxConcurrent: number): void {
        this.#maxConcurrent = Math.max(1, Math.floor(maxConcurrent));
        // Wake queued waiters that now fit under the raised cap.
        for (const [host, queue] of this.#waiting) {
            while (queue.length > 0 && (this.#active.get(host) ?? 0) < this.#maxConcurrent) {
                const next = queue.shift();
                if (!next) break;
                this.#active.set(host, (this.#active.get(host) ?? 0) + 1);
                next();
            }
            if (queue.length === 0) {
                this.#waiting.delete(host);
            }
        }
    }

    async run<T>(url: string, task: () => Promise<T>): Promise<T> {
        const host = new URL(url).hostname;
        await this.#acquire(host);
        try {
            return await task();
        } finally {
            this.#release(host);
        }
    }

    #acquire(host: string): Promise<void> {
        const active = this.#active.get(host) ?? 0;
        if (active < this.#maxConcurrent) {
            this.#active.set(host, active + 1);
            return Promise.resolve();
        }
        return new Promise(resolve => {
            const queue = this.#waiting.get(host) ?? [];
            queue.push(resolve);
            this.#waiting.set(host, queue);
        });
    }

    #release(host: string): void {
        const next = this.#waiting.get(host)?.shift();
        if (next) {
            next();
            return;
        }
        const active = (this.#active.get(host) ?? 1) - 1;
        if (active <= 0) {
            this.#active.delete(host);
        } else {
            this.#active.set(host, active);
        }
    }
}
