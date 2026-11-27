import {
  App,
  applyDocumentTheme,
  applyHostStyleVariables,
} from "@modelcontextprotocol/ext-apps";

export interface DeckBridge {
  app: App | null;
  isPreview: boolean;
  canMessage: boolean;
  sendMessage: (text: string, spawnNew?: boolean) => Promise<void>;
}

declare global {
  interface Window {
    __DECK_PREVIEW__?: {
      theme?: "light" | "dark";
      surface?: "inline" | "aux_pane" | "global";
      initialResult?: any;
      onSendMessage?: (text: string, spawnNew?: boolean) => void;
    };
  }
}

function applyThemeAttr(theme?: string) {
  if (theme === "dark" || theme === "light") {
    document.documentElement.dataset.theme = theme;
    document.documentElement.classList.toggle("dark", theme === "dark");
    document.documentElement.classList.toggle("light", theme === "light");
    applyDocumentTheme(theme);
  }
}

export async function connectDeckApp(
  appName: string,
  handlers: {
    onToolResult: (structured: any) => void;
    onToolInput?: (args: any) => void;
    onThemeChange?: (theme: "light" | "dark") => void;
  }
): Promise<DeckBridge> {
  if (window.__DECK_PREVIEW__) {
    const mock = window.__DECK_PREVIEW__;
    if (mock.theme) {
      applyThemeAttr(mock.theme);
      handlers.onThemeChange?.(mock.theme);
    }
    const isGlobal = (mock.surface ?? "inline") === "global";
    const bridge: DeckBridge = {
      app: null,
      isPreview: true,
      canMessage: !isGlobal,
      sendMessage: async (text, spawnNew) => {
        mock.onSendMessage?.(text, spawnNew);
      },
    };
    if (mock.initialResult) {
      queueMicrotask(() => handlers.onToolResult(mock.initialResult));
    }
    return bridge;
  }

  const app = new App({ name: appName, version: "1.0.0" }, {});

  app.ontoolinput = (params: any) => {
    handlers.onToolInput?.(params?.arguments ?? {});
  };
  app.ontoolresult = (result: any) => {
    handlers.onToolResult(result?.structuredContent ?? result ?? {});
  };
  app.onhostcontextchanged = (ctx: any) => {
    if (ctx?.theme) {
      applyThemeAttr(ctx.theme);
      handlers.onThemeChange?.(ctx.theme);
    }
    if (ctx?.styles?.variables) {
      applyHostStyleVariables(ctx.styles.variables);
    }
  };

  await app.connect();
  const ctx = app.getHostContext();
  if (ctx?.theme) {
    applyThemeAttr(ctx.theme);
    handlers.onThemeChange?.(ctx.theme);
  }
  if (ctx?.styles?.variables) {
    applyHostStyleVariables(ctx.styles.variables);
  }

  const caps: any = app.getHostCapabilities() ?? {};
  return {
    app,
    isPreview: false,
    canMessage: Boolean(caps.message),
    sendMessage: async (text, spawnNew = false) => {
      const payload: any = {
        role: "user",
        content: [{ type: "text", text }],
      };
      if (spawnNew) {
        payload._meta = { "com.google.antigravity/message": { target: "new" } };
      }
      await app.sendMessage(payload);
    },
  };
}

/**
 * Bespoke Antigravity geometric SVG icon kit.
 * 16x16 optical viewBox, uniform 1.5px stroke, round caps & joins, aria-hidden baked in.
 */
function svgIcon(body: string, size: 14 | 16 = 14, cls = ""): string {
  const c = cls ? `ag-ico ${cls}` : "ag-ico";
  return `<svg class="${c}" width="${size}" height="${size}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;
}

export const ICONS = {
  brandActions: svgIcon(
    `<rect x="2.25" y="2.25" width="11.5" height="11.5" rx="3"/><path d="M5.5 8h5M8.25 5.5 10.75 8l-2.5 2.5"/>`,
    16
  ),
  shield: svgIcon(
    `<path d="M8 2.25 13 4.2v3.6c0 3.05-2.05 5.3-5 6.2-2.95-.9-5-3.15-5-6.2V4.2L8 2.25Z"/><path d="M8 5.75v2.75M8 10.75h.01"/>`,
    16
  ),
  arrowRight: svgIcon(
    `<path d="M3.5 8h9M8.75 4.25 12.5 8l-3.75 3.75"/>`
  ),
  launch: svgIcon(
    `<path d="M6.5 3.5H4a1.5 1.5 0 0 0-1.5 1.5v7A1.5 1.5 0 0 0 4 13.5h7a1.5 1.5 0 0 0 1.5-1.5V9.5"/><path d="M9.25 2.5h4.25v4.25M13.25 2.75 7.5 8.5"/>`
  ),
  more: svgIcon(
    `<circle cx="4" cy="8" r="1.05"/><circle cx="8" cy="8" r="1.05"/><circle cx="12" cy="8" r="1.05"/>`
  ),
  file: svgIcon(
    `<path d="M4 2.25h5l3 3v8.5H4v-11.5Z"/><path d="M9 2.25v3h3"/>`
  ),
  check: svgIcon(
    `<path d="M3.25 8.4 6.5 11.65 12.75 4.6"/>`
  ),
  chevronDown: svgIcon(
    `<path d="m4.5 6.25 3.5 3.5 3.5-3.5"/>`
  ),
  statusRunning: svgIcon(
    `<path d="M8 2.5A5.5 5.5 0 1 1 2.5 8"/>`,
    14,
    "spin-icon"
  ),
  statusDone: svgIcon(
    `<circle cx="8" cy="8" r="5.5"/><path d="m5.6 8.15 1.65 1.65 3.35-3.45"/>`
  ),
};

export function esc(str: unknown): string {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
