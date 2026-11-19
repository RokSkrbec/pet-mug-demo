/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** URL of the AI illustration worker. Empty = AI button hidden. */
  readonly VITE_AI_ENDPOINT?: string;
  /** Cloudflare Turnstile site key (public). Empty = no bot check. */
  readonly VITE_TURNSTILE_SITEKEY?: string;
}
