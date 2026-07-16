<script lang="ts">
    import type { LogEntry } from '@shared/ipc';

    let logs = $state<LogEntry[]>([]);
    let paused = $state(false);
    let scope = $state<'all' | 'source' | 'scrape' | 'net'>('all');

    async function refresh(): Promise<void> {
        if (!paused) {
            logs = await window.hakuneko.logs.list();
        }
    }

    void refresh();
    const unsub = window.hakuneko.logs.onChanged(() => { void refresh(); });
    $effect(() => () => unsub());

    const filtered = $derived(scope === 'all' ? logs : logs.filter(l => l.scope === scope));

    function time(t: number): string {
        return new Date(t).toLocaleTimeString();
    }
    async function clear(): Promise<void> {
        await window.hakuneko.logs.clear();
        logs = [];
    }
</script>

<div class="diag">
    <div class="bar">
        <select bind:value={scope} aria-label="Filter log scope">
            <option value="all">All</option>
            <option value="source">Sources</option>
            <option value="scrape">Scraping</option>
            <option value="net">Network</option>
        </select>
        <label class="pause"><input type="checkbox" bind:checked={paused} /> Pause</label>
        <button class="ghost" onclick={clear}>Clear</button>
    </div>
    <div class="log">
        {#if filtered.length === 0}
            <p class="empty">No activity yet. Open a source to see what it fetches and what it matches.</p>
        {:else}
            {#each filtered.slice(-300) as entry (entry.t + entry.msg)}
                <div class="line {entry.level}">
                    <span class="ts">{time(entry.t)}</span>
                    <span class="sc">{entry.scope}</span>
                    <span class="msg">{entry.msg}</span>
                </div>
            {/each}
        {/if}
    </div>
</div>

<style>
    .diag { display: flex; flex-direction: column; gap: var(--space-2); }
    .bar { display: flex; align-items: center; gap: var(--space-2); }
    select { background: var(--color-bg); border: 1px solid var(--color-border); border-radius: var(--radius-sm); color: var(--color-text); padding: 4px var(--space-2); font: inherit; font-size: 12px; }
    .pause { display: flex; align-items: center; gap: 4px; font-size: 12px; color: var(--color-text-muted); }
    .ghost { background: transparent; border: 1px solid var(--color-border); border-radius: var(--radius-sm); color: var(--color-text); padding: 4px var(--space-3); font: inherit; font-size: 12px; cursor: pointer; }
    .log { max-height: 320px; overflow-y: auto; background: var(--color-bg); border: 1px solid var(--color-border); border-radius: var(--radius-sm); padding: var(--space-2); font-family: var(--font-mono); font-size: 11px; }
    .empty { color: var(--color-text-muted); margin: 0; }
    .line { display: grid; grid-template-columns: 62px 52px 1fr; gap: var(--space-2); padding: 1px 0; word-break: break-word; }
    .line.warn { color: #d9a441; }
    .line.error { color: var(--color-danger); }
    .ts { color: var(--color-text-muted); }
    .sc { color: var(--color-accent); }
    .msg { color: inherit; white-space: pre-wrap; }
</style>
