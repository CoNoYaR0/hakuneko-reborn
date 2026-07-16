<script lang="ts" generics="T">
    import type { Snippet } from 'svelte';

    // Inlined (not a named interface) so the generic T doesn't leak a private
    // type name into the component's exported signature (svelte-check quirk).
    let { items, rowHeight = 32, overscan = 6, row }: {
        items: T[];
        /** Fixed row height in px. */
        rowHeight?: number;
        /** Extra rows rendered above/below the viewport to avoid flashes. */
        overscan?: number;
        row: Snippet<[T, number]>;
    } = $props();

    let viewport = $state<HTMLDivElement | undefined>(undefined);
    let scrollTop = $state(0);
    let viewportHeight = $state(0);

    const total = $derived(items.length);
    const startIndex = $derived(Math.max(0, Math.floor(scrollTop / rowHeight) - overscan));
    const visibleCount = $derived(Math.ceil(viewportHeight / rowHeight) + overscan * 2);
    const endIndex = $derived(Math.min(total, startIndex + visibleCount));
    const slice = $derived(items.slice(startIndex, endIndex));

    function onScroll(): void {
        if (viewport) {
            scrollTop = viewport.scrollTop;
        }
    }

    // Track viewport height responsively.
    $effect(() => {
        if (!viewport) {
            return;
        }
        const observer = new ResizeObserver(entries => {
            viewportHeight = entries[0]?.contentRect.height ?? 0;
        });
        observer.observe(viewport);
        viewportHeight = viewport.clientHeight;
        return () => observer.disconnect();
    });
</script>

<div class="viewport" bind:this={viewport} onscroll={onScroll}>
    <div class="spacer" style="height: {total * rowHeight}px;">
        <div class="window" style="transform: translateY({startIndex * rowHeight}px);">
            {#each slice as item, i (startIndex + i)}
                <div class="row" style="height: {rowHeight}px;">
                    {@render row(item, startIndex + i)}
                </div>
            {/each}
        </div>
    </div>
</div>

<style>
    .viewport { overflow-y: auto; height: 100%; position: relative; }
    .spacer { position: relative; width: 100%; }
    .window { position: absolute; top: 0; left: 0; right: 0; will-change: transform; }
    .row { overflow: hidden; }
</style>
