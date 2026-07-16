/// <reference types="svelte" />
/// <reference types="vite/client" />

import type { HakunekoApi } from '@shared/ipc';

declare global {
    interface Window {
        hakuneko: HakunekoApi;
    }
}

export {};
