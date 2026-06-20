// soksak-plugin-media-player 엔트리 — loader 가 blob-URL 로 import 하는 단일 ESM(react/hls.js 인라인).
// 뷰는 Shadow DOM 에 마운트(soksak chrome 격리). 헤드리스 커맨드는 뷰 미오픈에도 동작 —
// sok plugin.soksak-plugin-media-player.* / MCP / 소켓 E2E. 단일 진실 스토어 = app.data "library".
import { Component, type ErrorInfo, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import App from "@/view/App";
import { GLOBAL_CSS } from "@/styles";
import { createStore, type LibraryStore } from "@/store";
import { registerCommands } from "@/commands";

class ErrBoundary extends Component<{ children: ReactNode }, { err: Error | null }> {
  state: { err: Error | null } = { err: null };
  static getDerivedStateFromError(err: Error) {
    return { err };
  }
  componentDidCatch(err: Error, info: ErrorInfo) {
    console.error("[playbox] App 렌더 오류:", err, info.componentStack);
  }
  render() {
    if (this.state.err) {
      return (
        <div style={{ padding: 16, color: "#f88", fontFamily: "system-ui", fontSize: 13 }}>
          Playbox 렌더 오류: {this.state.err.message || String(this.state.err)}
        </div>
      );
    }
    return this.props.children;
  }
}

const mounts = new WeakMap<HTMLElement, { root: Root }>();
let pluginApp: unknown = null;
let pluginStore: LibraryStore | null = null;

function mountView(container: HTMLElement, viewId: string) {
  unmountView(container);
  container.style.position = "relative";
  // Shadow DOM 격리 — soksak chrome 전역 스타일 오염 방지. attachShadow 는 요소당 1회.
  const shadow = container.shadowRoot ?? container.attachShadow({ mode: "open" });
  shadow.replaceChildren();

  const style = document.createElement("style");
  style.textContent = GLOBAL_CSS;
  shadow.appendChild(style);

  const host = document.createElement("div");
  host.style.position = "absolute";
  host.style.inset = "0";
  shadow.appendChild(host);

  try {
    const root = createRoot(host);
    root.render(
      <ErrBoundary>
        <App viewId={viewId} app={pluginApp as never} store={pluginStore as never} />
      </ErrBoundary>,
    );
    mounts.set(container, { root });
  } catch (e) {
    host.textContent = "[playbox] mount 실패: " + (e instanceof Error ? e.message : String(e));
    host.style.color = "#f88";
    host.style.padding = "16px";
    console.error("[playbox] mount 실패:", e);
  }
}

function unmountView(container: HTMLElement) {
  const state = mounts.get(container);
  if (!state) return;
  state.root.unmount();
  mounts.delete(container);
}

export default {
  activate(ctx: any) {
    const app = ctx.app;
    pluginApp = app;

    // 단일 진실 스토어 — app.data 하이드레이트 + cross-window watch.
    const store = createStore(app);
    pluginStore = store;
    void store.init().catch((e: unknown) => console.error("[playbox] store init 실패:", e));
    ctx.subscriptions.push({ dispose: () => store.dispose() });

    for (const viewId of ["library", "player"]) {
      ctx.subscriptions.push(
        app.ui.registerView(viewId, {
          mount(container: HTMLElement) {
            mountView(container, viewId);
          },
          unmount(container: HTMLElement) {
            unmountView(container);
          },
        }),
      );
    }

    if (app.commands?.register) {
      ctx.subscriptions.push(
        app.commands.register("ping", {
          description: "플러그인 적재/버전 확인(E2E)",
          handler: async () => ({ ok: true, plugin: "soksak-plugin-media-player", version: "0.0.1", phase: "M1" }),
        }),
      );
      registerCommands(ctx, store, app);
    }
  },
  deactivate() {
    pluginStore?.dispose();
    pluginStore = null;
  },
};
