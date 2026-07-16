<script lang="ts">
    import type { DownloadJobInfo } from '@shared/ipc';

    interface Props { jobs: DownloadJobInfo[]; full?: boolean }
    let { jobs, full = false }: Props = $props();

    const active = $derived(jobs.filter(j => j.status === 'running' || j.status === 'queued').length);

    function percent(job: DownloadJobInfo): number {
        return job.total > 0 ? Math.round((job.done / job.total) * 100) : 0;
    }
</script>

<section class="panel" class:full>
    <header>
        <span>Downloads {active > 0 ? `· ${active} active` : ''}</span>
        {#if jobs.some(j => j.status === 'completed' || j.status === 'failed' || j.status === 'cancelled')}
            <button class="link" onclick={() => window.hakuneko.downloads.clear()}>Clear finished</button>
        {/if}
    </header>

    {#if jobs.length === 0}
        <p class="empty">No downloads yet. Open a chapter and hit ⭳.</p>
    {:else}
        <ul>
            {#each jobs as job (job.id)}
                <li>
                    <div class="row">
                        <span class="title" title="{job.mangaTitle} — {job.chapterTitle}">
                            {job.chapterTitle}
                            <span class="sub">{job.mangaTitle}</span>
                        </span>
                        <span class="status status-{job.status}">
                            {#if job.status === 'running'}{job.done}/{job.total}
                            {:else if job.status === 'queued'}queued
                            {:else}{job.status}{/if}
                        </span>
                    </div>
                    {#if job.status === 'running' || job.status === 'completed'}
                        <div class="bar"><div class="fill" style="width: {job.status === 'completed' ? 100 : percent(job)}%"></div></div>
                    {/if}
                    {#if job.error}<p class="err">{job.error}</p>{/if}
                    <div class="actions">
                        {#if job.status === 'running' || job.status === 'queued'}
                            <button class="link" onclick={() => window.hakuneko.downloads.cancel(job.id)}>Cancel</button>
                        {:else if job.status === 'failed' || job.status === 'cancelled'}
                            <button class="link" onclick={() => window.hakuneko.downloads.retry(job.id)}>Retry</button>
                        {/if}
                    </div>
                </li>
            {/each}
        </ul>
    {/if}
</section>

<style>
    .panel { display: flex; flex-direction: column; min-height: 0; border-top: 1px solid var(--color-border); padding-top: var(--space-2); }
    .panel.full { border-top: none; height: 100%; }
    header { display: flex; justify-content: space-between; align-items: center; font-size: 12px; color: var(--color-text-muted); margin-bottom: var(--space-2); }
    .empty { color: var(--color-text-muted); font-size: 12px; margin: 0; }
    ul { list-style: none; margin: 0; padding: 0; overflow-y: auto; max-height: 34vh; }
    .panel.full ul { max-height: none; flex: 1; }
    li { padding: var(--space-2) 0; border-bottom: 1px solid var(--color-border); }
    .row { display: flex; justify-content: space-between; gap: var(--space-2); align-items: baseline; }
    .title { font-size: 13px; display: flex; flex-direction: column; overflow: hidden; }
    .title .sub { color: var(--color-text-muted); font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .status { font-size: 11px; white-space: nowrap; }
    .status-completed { color: var(--color-success); }
    .status-failed { color: var(--color-danger); }
    .status-running { color: var(--color-accent); }
    .status-queued, .status-cancelled { color: var(--color-text-muted); }
    .bar { height: 4px; background: var(--color-border); border-radius: 2px; margin: 6px 0 2px; overflow: hidden; }
    .fill { height: 100%; background: var(--color-accent); transition: width 0.2s ease; }
    .err { color: var(--color-danger); font-size: 11px; font-family: var(--font-mono); margin: 4px 0 0; word-break: break-word; }
    .actions { display: flex; gap: var(--space-2); }
    .link { background: none; border: none; color: var(--color-text-muted); cursor: pointer; font: inherit; font-size: 11px; padding: 2px 0; }
    .link:hover { color: var(--color-accent); }
</style>
