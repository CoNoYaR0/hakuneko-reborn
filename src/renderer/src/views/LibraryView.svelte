<script lang="ts">
    import type { Bookmark, ChapterWithNew, Manga, Page } from '@shared/ipc';
    import { store } from '../store.svelte';
    import VirtualList from '../lib/VirtualList.svelte';
    import PageThumb from '../lib/PageThumb.svelte';

    let query = $state('');
    let selected = $state<Bookmark | undefined>(undefined);
    let chapters = $state<ChapterWithNew[]>([]);
    let pages = $state<Page[]>([]);
    let selectedChapter = $state<ChapterWithNew | undefined>(undefined);
    let loading = $state<'chapters' | 'pages' | undefined>(undefined);
    let error = $state('');

    const filtered = $derived(
        query.trim() === '' ? store.bookmarks
            : store.bookmarks.filter(b =>
                b.title.toLowerCase().includes(query.toLowerCase())
                || b.sourceLabel.toLowerCase().includes(query.toLowerCase()))
    );

    function sourceUsable(b: Bookmark): boolean {
        return store.sources.some(s => s.id === b.sourceId && s.usable);
    }

    async function openBookmark(b: Bookmark): Promise<void> {
        selected = b; chapters = []; pages = []; selectedChapter = undefined; error = '';
        if (!sourceUsable(b)) {
            error = `The source "${b.sourceLabel}" for this bookmark isn't installed.`;
            return;
        }
        loading = 'chapters';
        try {
            const manga: Manga = { id: b.mangaId, title: b.title };
            chapters = await window.hakuneko.library.chapters(b.sourceId, manga);
        } catch (e) { error = e instanceof Error ? e.message : String(e); }
        finally { loading = undefined; }
    }

    // Svelte 5 $state proxies can't cross Electron IPC — send plain objects.
    function plainChapter(chapter: ChapterWithNew): { id: string; title: string; language?: string } {
        return { id: chapter.id, title: chapter.title, language: chapter.language };
    }

    async function openChapter(chapter: ChapterWithNew): Promise<void> {
        if (!selected) return;
        selectedChapter = chapter; pages = []; error = ''; loading = 'pages';
        try {
            pages = await window.hakuneko.sources.pages(selected.sourceId, plainChapter(chapter));
        } catch (e) { error = e instanceof Error ? e.message : String(e); }
        finally { loading = undefined; }
    }

    async function removeBookmark(b: Bookmark, event: MouseEvent): Promise<void> {
        event.stopPropagation();
        await window.hakuneko.bookmarks.remove(b.sourceId, b.mangaId);
        if (selected?.mangaId === b.mangaId && selected?.sourceId === b.sourceId) {
            selected = undefined; chapters = []; pages = [];
        }
    }

    function download(chapter: ChapterWithNew, event: MouseEvent): void {
        event.stopPropagation();
        if (!selected) return;
        void window.hakuneko.downloads.enqueue({
            sourceId: selected.sourceId,
            manga: { id: selected.mangaId, title: selected.title },
            chapter: plainChapter(chapter),
            format: 'cbz'
        });
    }


    const newCount = $derived(chapters.filter(c => c.isNew).length);

    // --- Favorites (bookmarks) import / export ---
    let ioMsg = $state('');

    async function exportFavorites(): Promise<void> {
        const json = await window.hakuneko.bookmarks.exportLegacy();
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'hakuneko-favorites.json';
        a.click();
        URL.revokeObjectURL(url);
        ioMsg = `Exported ${store.bookmarks.length} favorites.`;
    }

    async function importFavorites(event: Event): Promise<void> {
        ioMsg = '';
        const input = event.target as HTMLInputElement;
        const file = input.files?.[0];
        if (!file) return;
        try {
            const result = await window.hakuneko.bookmarks.importLegacy(await file.text());
            ioMsg = `Imported ${result.added} favorite${result.added === 1 ? '' : 's'} (${result.skipped} skipped of ${result.total}).`;
        } catch (e) {
            ioMsg = `Import failed: ${e instanceof Error ? e.message : String(e)}`;
        } finally {
            input.value = '';
        }
    }
</script>

<div class="library">
    <div class="rail">
        <div class="rail-head">
            <h2>Library</h2>
            <span class="muted">{store.bookmarks.length} bookmarked</span>
        </div>
        <div class="io">
            <label class="io-btn" title="Import favorites from a file">
                Import
                <input type="file" accept="application/json,.json" onchange={importFavorites} hidden />
            </label>
            <button class="io-btn" title="Export favorites to a file" onclick={exportFavorites} disabled={store.bookmarks.length === 0}>Export</button>
        </div>
        {#if ioMsg}<p class="io-msg">{ioMsg}</p>{/if}
        <input class="filter" type="search" placeholder="Filter bookmarks…" bind:value={query} />
        {#if store.bookmarks.length === 0}
            <p class="empty">No bookmarks yet. Browse a source and tap ☆ on a manga to add it here. You can also import a legacy HakuNeko bookmark file from Settings.</p>
        {:else}
            <div class="vlist">
                <VirtualList items={filtered} rowHeight={46}>
                    {#snippet row(b: Bookmark)}
                        <div class="bm-row" class:active={selected?.sourceId === b.sourceId && selected?.mangaId === b.mangaId} class:stale={!sourceUsable(b)}>
                            <button class="bm-main" onclick={() => openBookmark(b)}>
                                <span class="bm-title" title={b.title}>{b.title}</span>
                                <span class="bm-src">{b.sourceLabel}</span>
                            </button>
                            <button class="bm-remove" title="Remove bookmark" aria-label="Remove bookmark" onclick={(e) => removeBookmark(b, e)}>✕</button>
                        </div>
                    {/snippet}
                </VirtualList>
            </div>
        {/if}
    </div>

    <div class="content">
        {#if !selected}
            <div class="placeholder">
                <h3>Your library</h3>
                <p>Bookmarked manga from every source live here. Open one to see its chapters — new chapters since your last visit are marked <span class="new">NEW</span>.</p>
            </div>
        {:else}
            <header>
                <h3>{selected.title}</h3>
                <span class="muted">{selected.sourceLabel}{newCount ? ` · ${newCount} new` : ''}</span>
            </header>
            {#if error}<p class="error">{error}</p>{/if}
            <div class="columns">
                <section>
                    <div class="col-head"><span>Chapters {chapters.length ? `(${chapters.length})` : ''}</span>{#if loading === 'chapters'}<span class="spinner" role="status">loading…</span>{/if}</div>
                    <ul>
                        {#each chapters as chapter (chapter.id)}
                            <li class:active={chapter.id === selectedChapter?.id}>
                                <button class="grow" onclick={() => openChapter(chapter)}>
                                    {chapter.title}{#if chapter.isNew}<span class="new">NEW</span>{/if}
                                </button>
                                <button class="dl" title="Download as .cbz" aria-label="Download {chapter.title}" onclick={(e) => download(chapter, e)}>⭳</button>
                            </li>
                        {/each}
                    </ul>
                </section>
                <section>
                    <div class="col-head"><span>Pages {pages.length ? `(${pages.length})` : ''}</span>{#if loading === 'pages'}<span class="spinner" role="status">loading…</span>{/if}</div>
                    <div class="pages">
                        {#each pages as page, i (i)}
                            <PageThumb {page} index={i} />
                        {/each}
                    </div>
                </section>
            </div>
        {/if}
    </div>
</div>

<style>
    .library { display: grid; grid-template-columns: 300px 1fr; height: 100%; min-height: 0; }
    .rail { display: flex; flex-direction: column; min-height: 0; border-right: 1px solid var(--color-border); background: var(--color-surface); padding: var(--space-3); }
    .rail-head { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: var(--space-2); }
    .rail-head h2 { margin: 0; font-size: 16px; }
    .muted { color: var(--color-text-muted); font-size: 12px; }
    .io { display: flex; gap: var(--space-2); margin-bottom: var(--space-2); }
    .io-btn { flex: 1; text-align: center; border: 1px solid var(--color-border); border-radius: var(--radius-sm); background: transparent; color: var(--color-text); padding: 5px var(--space-2); font: inherit; font-size: 12px; cursor: pointer; }
    .io-btn:hover { border-color: var(--color-accent); color: var(--color-accent); }
    .io-btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .io-msg { color: var(--color-success); font-size: 11px; margin: 0 0 var(--space-2); }
    .filter { margin-bottom: var(--space-2); background: var(--color-bg); border: 1px solid var(--color-border); border-radius: var(--radius-sm); color: var(--color-text); padding: 6px var(--space-2); font: inherit; font-size: 13px; }
    .vlist { flex: 1; min-height: 0; }
    .empty { color: var(--color-text-muted); font-size: 13px; }
    .bm-row { display: flex; align-items: center; height: 100%; border-radius: var(--radius-sm); }
    .bm-row:hover { background: var(--color-surface-raised); }
    .bm-row.active { background: var(--color-surface-raised); }
    .bm-row.stale { opacity: 0.55; }
    .bm-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; align-items: flex-start; background: none; border: none; color: var(--color-text); padding: 5px var(--space-3); cursor: pointer; font: inherit; }
    .bm-title { font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
    .bm-src { font-size: 11px; color: var(--color-text-muted); }
    .bm-remove { background: none; border: none; color: var(--color-text-muted); cursor: pointer; padding: 0 var(--space-2); opacity: 0; }
    .bm-row:hover .bm-remove { opacity: 1; }
    .bm-remove:hover { color: var(--color-danger); }
    .content { padding: var(--space-4); min-height: 0; display: flex; flex-direction: column; }
    .placeholder { max-width: 440px; margin: 12vh auto 0; text-align: center; }
    .placeholder h3 { margin: 0 0 var(--space-2); font-size: 20px; }
    .placeholder p { color: var(--color-text-muted); }
    header { display: flex; align-items: baseline; gap: var(--space-3); margin-bottom: var(--space-3); }
    header h3 { margin: 0; font-size: 18px; }
    .columns { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-3); flex: 1; min-height: 0; }
    section { display: flex; flex-direction: column; min-height: 0; border: 1px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-surface); }
    .col-head { display: flex; justify-content: space-between; padding: var(--space-2) var(--space-3); border-bottom: 1px solid var(--color-border); font-size: 12px; color: var(--color-text-muted); }
    .spinner { color: var(--color-accent); }
    ul { list-style: none; margin: 0; padding: 0; overflow-y: auto; flex: 1; }
    li { display: flex; align-items: stretch; }
    li button { text-align: left; background: none; border: none; color: var(--color-text); padding: 6px var(--space-3); cursor: pointer; font: inherit; font-size: 13px; }
    li button.grow { flex: 1; display: flex; align-items: center; gap: var(--space-2); }
    li:hover { background: var(--color-surface-raised); }
    li.active { background: var(--color-surface-raised); }
    li.active button { color: var(--color-accent); }
    .new { background: var(--color-success); color: var(--color-accent-contrast); font-size: 9px; font-weight: 700; padding: 1px 5px; border-radius: 4px; letter-spacing: 0.04em; }
    li button.dl { color: var(--color-text-muted); padding: 6px var(--space-2); opacity: 0; }
    li:hover button.dl { opacity: 1; }
    li button.dl:hover { color: var(--color-accent); }
    .pages { overflow-y: auto; flex: 1; padding: var(--space-2) 0; }
    .error { color: var(--color-danger); font-family: var(--font-mono); font-size: 12px; }
</style>
