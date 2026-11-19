/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** URL of the AI illustration worker. Empty = AI button hidden. */
  readonly VITE_AI_ENDPOINT?: string;
}
