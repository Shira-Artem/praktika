/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GAME_API_MODE?: "mock" | "live";
  readonly VITE_GAME_API_URL?: string;
  readonly VITE_EVENT_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
