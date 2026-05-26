/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Bot username without the leading `@`. Defaults to `hobagame_bot`. */
  readonly VITE_TELEGRAM_BOT_USERNAME?: string;
  /**
   * BotFather `/newapp` short name. When set, share links become
   * Direct Link Mini App form (`t.me/<bot>/<short>?startapp=…`) which
   * auto-launches the Mini App with `start_param` on modern clients.
   */
  readonly VITE_TELEGRAM_APP_SHORT_NAME?: string;
  /** API target used by Vite dev-server proxy. */
  readonly VITE_API_TARGET?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
