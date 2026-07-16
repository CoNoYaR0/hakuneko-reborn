import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { resolve } from 'node:path';

export default defineConfig({
    main: {
        plugins: [externalizeDepsPlugin()],
        resolve: {
            alias: { '@shared': resolve(__dirname, 'src/shared') }
        }
    },
    preload: {
        plugins: [externalizeDepsPlugin()],
        resolve: {
            alias: { '@shared': resolve(__dirname, 'src/shared') }
        }
    },
    renderer: {
        plugins: [svelte()],
        resolve: {
            alias: { '@shared': resolve(__dirname, 'src/shared') }
        }
    }
});
