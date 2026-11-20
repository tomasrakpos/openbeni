/// <reference types="vite/client" />

/**
 * Injected by `vite.config.ts` at build time: true when the server has both
 * `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`, i.e. the admin API can write
 * to the real database. Development builds fall back to the shared preview
 * store (`.dev-admin/state.json`) only when this is false.
 */
declare const __SERVER_DB__: boolean;
