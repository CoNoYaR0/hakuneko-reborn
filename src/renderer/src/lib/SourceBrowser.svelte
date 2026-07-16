<script lang="ts">
    import type { SourceSummary, Manga, ChapterWithNew, Page } from '@shared/ipc';
    import { store } from '../store.svelte';
    import VirtualList from './VirtualList.svelte';
    import PageThumb from './PageThumb.svelte';

    interface Props { source: SourceSummary }
    let { source }: Props = $props();

    let mangas = $state<Manga[]>([]);
    let chapters = $state<ChapterWithNew[]>([]);
    let pages = $state<Page[]>([]);
    let selectedManga = $state<Manga | undefined>(undefined);
    let selectedChapter = $state<ChapterWithNew | undefined>(undefined);
    let mangaQuery = $state('');
    let loading = $state<'mangas' | 'chapters' | 'pages' | undefined>(undefined);
    let refreshing = $state(false);
    let error = $state('');

    const filteredMangas = $derived(
        mangaQuery.trim() === '' ? mangas
            : mangas.filter(m => m.title.toLowerCase().includes(mangaQuery.toLowerCase()))
    );

    async function loadMangas(refresh = false): Promise<void> {
        mangas = []; chapters = []; pages = [];
        selectedManga = undefined; selectedChapter = undefined; error = '';
        loading = 'mangas';
        refreshing = refresh;
        try {
            mangas = await window.hakuneko.library.mangas(source.id, refresh);
        } catch (e) {
            error = e instanceof Error ? e.message : String(e);
        } finally {
            loading = undefined;
            refreshing = false;
        }
    }

    // Reload when the source changes.
    let loadedFor = $state('');
    $effect(() => {
        if (source.id !== loadedFor) {
            loadedFor = source.id;
            void loadMangas(false);
        }
    });

    // Svelte 5 wraps $state values in Proxies, which Electron IPC can't
    // structured-clone ("An object could not be cloned"). Convert to plain
    // objects before sending anything over IPC.
    function plainManga(manga: Manga): Manga {
        return { id: manga.id, title: manga.title };
    }
    function plainChapter(chapter: ChapterWithNew): { id: string; title: string; language?: string } {
        return { id: chapter.id, title: chapter.title, language: chapter.language };
    }

    async function openManga(manga: Manga): Promise<void> {
        selectedManga = manga; chapters = []; pages = []; selectedChapter = undefined;
        error = ''; loading = 'chapters';
        try {
            chapters = await window.hakuneko.library.chapters(source.id, plainManga(manga));
        } catch (e) { error = e instanceof Error ? e.message : String(e); }
        finally { loading = undefined; }
    }

    async function openChapter(chapter: ChapterWithNew): Promise<void> {
        selectedChapter = chapter; pages = []; error = ''; loading = 'pages';
        try {
            pages = await window.hakuneko.sources.pages(source.id, plainChapter(chapter));
        } catch (e) { error = e instanceof Error ? e.message : String(e); }
        finally { loading = undefined; }
    }

    function download(chapter: ChapterWithNew, event: MouseEvent): void {
        event.stopPropagation();
        if (!selectedManga) return;
        void window.hakuneko.downloads.enqueue({ sourceId: source.id, manga: plainManga(selectedManga), chapter: plainChapter(chapter), format: 'cbz' });
    }

    function isBookmarked(manga: Manga): boolean {
        return store.bookmarks.some(b => b.sourceId === source.id && b.mangaId === manga.id);
    }

    async function toggleBookmark(manga: Manga, event: MouseEvent): Promise<void> {
        event.stopPropagation();
        if (isBookmarked(manga)) {
            await window.hakuneko.bookmarks.remove(source.id, manga.id);
        } else {
            await window.hakuneko.bookmarks.add(source.id, plainManga(manga));
        }
    }
</script>

<div class="browser">
    <header>
        <h2>{source.label}</h2>
        <a class="url" href={source.url} target="_blank" rel="noreferrer">{source.url}</a>
    </header>

    {#if error}<p class="error">{error}</p>{/if}

    <div class="columns">
        <section>
            <div class="col-head">
                <span>Manga {mangas.length ? `(${mangas.length})` : ''}</span>
                <div class="col-actions">
                    {#if loading === 'mangas'}<span class="spinner" role="status">loading…</span>{/if}
                    <button class="mini" title="Refresh list from site" aria-label="Refresh manga list from site" onclick={() => loadMangas(true)} disabled={refreshing}>⟳</button>
                </div>
            </div>
            <input class="filter" type="search" placeholder="Filter titles…" bind:value={mangaQuery} />
            <div class="vlist">
                <VirtualList items={filteredMangas} rowHeight={34}>
                    {#snippet row(manga: Manga)}
                        <div class="manga-row" class:active={manga.id === selectedManga?.id}>
                            <button class="manga-title" onclick={() => openManga(manga)} title={manga.title}>{manga.title}</button>
                            <button class="bm" class:on={isBookmarked(manga)} title={isBookmarked(manga) ? 'Remove bookmark' : 'Bookmark'} aria-label="Bookmark {manga.title}" onclick={(e) => toggleBookmark(manga, e)}>
                                {isBookmarked(manga) ? '★' : '☆'}
                            </button>
                        </div>
                    {/snippet}
                </VirtualList>
            </div>
        </section>

        <section>
            <div class="col-head">
                <span>Chapters {chapters.length ? `(${chapters.length})` : ''}</span>
                {#if loading === 'chapters'}<span class="spinner" role="status">loading…</span>{/if}
            </div>
            <ul>
                {#each chapters as chapter (chapter.id)}
                    <li class:active={chapter.id === selectedChapter?.id}>
                        <button class="grow" onclick={() => openChapter(chapter)}>
                            {chapter.title}{#if chapter.isNew}<span class="new">NEW</span>{/if}
                        </button>
                        <button class="dl" title="Download {chapter.title} as .cbz" aria-label="Download {chapter.title}" onclick={(e) => download(chapter, e)}>⭳</button>
                    </li>
                {/each}
            </ul>
        </section>

        <section>
            <div class="col-head">
                <span>Pages {pages.length ? `(${pages.length})` : ''}</span>
                {#if loading === 'pages'}<span class="spinner" role="status">loading…</span>{/if}
            </div>
            <div class="pages">
                {#each pages as page, i (i)}
                    <PageThumb {page} index={i} />
                {/each}
            </div>
        </section>
    </div>
</div>

<style>
    .browser { display: flex; flex-direction: column; height: 100%; min-height: 0; }
    header { display: flex; align-items: baseline; gap: var(--space-3); margin-bottom: var(--space-3); }
    h2 { margin: 0; font-size: 18px; }
    .url { color: var(--color-text-muted); font-size: 12px; text-decoration: none; }
    .url:hover { color: var(--color-accent); }
    .columns { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: var(--space-3); flex: 1; min-height: 0; }
    section { display: flex; flex-direction: column; min-height: 0; border: 1px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-surface); }
    .col-head { display: flex; justify-content: space-between; align-items: center; padding: var(--space-2) var(--space-3); border-bottom: 1px solid var(--color-border); font-size: 12px; color: var(--color-text-muted); }
    .col-actions { display: flex; align-items: center; gap: var(--space-2); }
    .mini { background: none; border: none; color: var(--color-text-muted); cursor: pointer; font-size: 14px; padding: 0; }
    .mini:hover { color: var(--color-accent); }
    .mini:disabled { opacity: 0.5; cursor: wait; }
    .spinner { color: var(--color-accent); }
    .filter { margin: var(--space-2); background: var(--color-bg); border: 1px solid var(--color-border); border-radius: var(--radius-sm); color: var(--color-text); padding: 6px var(--space-2); font: inherit; font-size: 13px; }
    .vlist { flex: 1; min-height: 0; }
    ul { list-style: none; margin: 0; padding: 0; overflow-y: auto; flex: 1; }
    .manga-row { display: flex; align-items: center; height: 100%; }
    .manga-row.active { background: var(--color-surface-raised); }
    .manga-row:hover { background: var(--color-surface-raised); }
    .manga-title { flex: 1; text-align: left; background: none; border: none; color: var(--color-text); padding: 6px var(--space-3); cursor: pointer; font: inherit; font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .manga-row.active .manga-title { color: var(--color-accent); }
    .bm { background: none; border: none; color: var(--color-text-muted); cursor: pointer; padding: 0 var(--space-2); font-size: 14px; }
    .bm.on { color: var(--color-accent); }
    li { display: flex; align-items: stretch; }
    li button { text-align: left; background: none; border: none; color: var(--color-text); padding: 6px var(--space-3); cursor: pointer; font: inherit; font-size: 13px; }
    li button.grow { flex: 1; display: flex; align-items: center; gap: var(--space-2); }
    .new { background: var(--color-success); color: var(--color-accent-contrast); font-size: 9px; font-weight: 700; padding: 1px 5px; border-radius: 4px; letter-spacing: 0.04em; }
    li button.dl { color: var(--color-text-muted); padding: 6px var(--space-2); opacity: 0; }
    li:hover button.dl { opacity: 1; }
    li button.dl:hover { color: var(--color-accent); }
    li:hover { background: var(--color-surface-raised); }
    li.active { background: var(--color-surface-raised); }
    li.active button { color: var(--color-accent); }
    .pages { overflow-y: auto; flex: 1; padding: var(--space-2) 0; }
    .error { color: var(--color-danger); font-family: var(--font-mono); font-size: 12px; }
</style>
