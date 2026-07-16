<script lang="ts">
    import type { Page } from '@shared/ipc';

    interface Props { page: Page; index: number }
    let { page, index }: Props = $props();

    let src = $state('');
    let status = $state<'idle' | 'loading' | 'done' | 'failed'>('idle');
    let el = $state<HTMLDivElement | undefined>(undefined);

    const url = $derived(typeof page === 'string' ? page : page.url);

    // Lazy-load: only fetch the image (through the bridge, referer/anti-bot
    // aware) once the thumbnail scrolls near the viewport.
    $effect(() => {
        if (!el) return;
        const observer = new IntersectionObserver((entries) => {
            if (entries.some(e => e.isIntersecting) && status === 'idle') {
                void load();
            }
        }, { rootMargin: '300px' });
        observer.observe(el);
        return () => observer.disconnect();
    });

    async function load(): Promise<void> {
        status = 'loading';
        try {
            const data = await window.hakuneko.sources.pageImage(page);
            if (data) { src = data; status = 'done'; }
            else { status = 'failed'; }
        } catch {
            status = 'failed';
        }
    }
</script>

<div class="page" bind:this={el}>
    <span class="num">{index + 1}</span>
    <div class="frame">
        {#if status === 'done'}
            <img {src} alt="Page {index + 1}" />
        {:else if status === 'failed'}
            <button class="retry" onclick={load} title="Failed to load — click to retry">retry</button>
        {:else}
            <span class="ph">{status === 'loading' ? '…' : ''}</span>
        {/if}
    </div>
    <a class="src" href={url} target="_blank" rel="noreferrer" title={url}>{url}</a>
</div>

<style>
    .page { display: grid; grid-template-columns: 24px 96px 1fr; gap: var(--space-2); align-items: center; padding: var(--space-1) var(--space-3); }
    .num { color: var(--color-text-muted); font-size: 12px; text-align: right; }
    .frame { width: 96px; height: 128px; background: var(--color-bg); border: 1px solid var(--color-border); border-radius: var(--radius-sm); display: flex; align-items: center; justify-content: center; overflow: hidden; }
    .frame img { width: 100%; height: 100%; object-fit: contain; }
    .ph { color: var(--color-text-muted); font-size: 18px; }
    .retry { background: none; border: none; color: var(--color-danger); cursor: pointer; font: inherit; font-size: 11px; }
    .src { font-family: var(--font-mono); font-size: 11px; color: var(--color-text-muted); word-break: break-all; text-decoration: none; }
    .src:hover { color: var(--color-accent); }
</style>
