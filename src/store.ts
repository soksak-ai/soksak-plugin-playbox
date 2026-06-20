// 라이브러리 스토어 — app.data "library" 컬렉션(즐겨찾기 + 클립 단일 목록) 위 in-memory 미러.
// 단일 진실 = app.data. 변이는 낙관적 미러 갱신 + notify 후 영속, data.watch 로 타 창 재수화.
// 뷰 간(사이드바→플레이어) 재생 인텐트도 같은 스토어 인스턴스로 전달(공유 채널, bus 비의존).
import type { LibraryItem } from "@/types";

export interface DataApi {
  define(coll: string, opts: { indexes?: string[]; fts?: string[] }): Promise<void>;
  put(coll: string, doc: Record<string, unknown>, opts?: { scope?: string; id?: string }): Promise<string>;
  delete(coll: string, id: string, opts?: { scope?: string }): Promise<boolean>;
  query(
    coll: string,
    opts?: { scope?: string; where?: Record<string, unknown>; order?: string; desc?: boolean; limit?: number },
  ): Promise<unknown[]>;
  search?(coll: string, text: string, opts?: { scope?: string; limit?: number }): Promise<unknown[]>;
  watch(coll: string, opts: { scope?: string } | undefined, cb: (e: unknown) => void): Disposable | (() => void);
}
export interface Disposable {
  dispose(): void;
}
export interface AppLike {
  data?: DataApi;
  project?: { current?: () => { id: string; root: string | null } | null };
}

const COLL = "library";

function asStr(v: unknown, d = ""): string {
  return typeof v === "string" ? v : d;
}
function asNum(v: unknown, d = 0): number {
  return typeof v === "number" && Number.isFinite(v) ? v : d;
}

// app.data 원시 doc → LibraryItem(방어적 coercion). id 없으면 null.
export function rowToItem(raw: unknown): LibraryItem | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string") return null;
  const status = ["none", "downloading", "done", "error"].includes(r.status as string)
    ? (r.status as LibraryItem["status"])
    : undefined;
  return {
    id: r.id,
    kind: r.kind === "clip" ? "clip" : "favorite",
    title: asStr(r.title, r.id),
    inputUrl: asStr(r.inputUrl),
    source: asStr(r.source, "none"),
    parentId: typeof r.parentId === "string" ? r.parentId : undefined,
    startSec: typeof r.startSec === "number" ? r.startSec : undefined,
    endSec: typeof r.endSec === "number" ? r.endSec : undefined,
    filePath: typeof r.filePath === "string" ? r.filePath : undefined,
    status,
    favorite: asNum(r.favorite, 1),
    createdAt: asNum(r.createdAt, 0),
  };
}

function disposeOf(d: Disposable | (() => void)): void {
  if (typeof d === "function") d();
  else if (d && typeof d.dispose === "function") d.dispose();
}

function genId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return "i-" + Date.now().toString(36) + "-" + Math.floor(Math.random() * 1e9).toString(36);
  }
}

export type NewItem = Omit<LibraryItem, "id" | "createdAt" | "favorite"> & {
  id?: string;
  createdAt?: number;
  favorite?: number;
};
export interface PlayIntent {
  inputUrl: string;
  title?: string;
}

export interface LibraryStore {
  get(): LibraryItem[];
  scope(): string;
  subscribe(cb: () => void): () => void;
  add(item: NewItem): Promise<LibraryItem>;
  update(id: string, patch: Partial<LibraryItem>): Promise<LibraryItem | null>;
  remove(id: string): Promise<boolean>;
  search(text: string): Promise<LibraryItem[]>;
  requestPlay(p: PlayIntent): void;
  consumePlay(): PlayIntent | null;
  init(): Promise<void>;
  dispose(): void;
}

export function createStore(app: AppLike): LibraryStore {
  const data = app.data;
  const scope: string = app.project?.current?.()?.id ?? "default";
  let items: LibraryItem[] = [];
  let writing = 0;
  let pendingPlay: PlayIntent | null = null;
  const subs = new Set<() => void>();
  let watchSub: Disposable | (() => void) | null = null;
  const notify = () => {
    for (const cb of subs) cb();
  };
  // 단조 증가 타임스탬프(같은 ms 다중 생성 순서 보존).
  let lastTs = 0;
  const now = () => {
    const t = Math.max(Date.now(), lastTs + 1);
    lastTs = t;
    return t;
  };

  async function hydrate() {
    if (!data) return;
    const rows = await data.query(COLL, { scope, order: "createdAt", desc: true, limit: 100000 });
    items = rows
      .map(rowToItem)
      .filter((n): n is LibraryItem => n != null)
      .sort((a, b) => b.createdAt - a.createdAt);
    notify();
  }

  async function persistPut(item: LibraryItem) {
    if (!data) return;
    writing++;
    try {
      await data.put(COLL, item as unknown as Record<string, unknown>, { scope, id: item.id });
    } finally {
      writing--;
    }
  }

  return {
    get: () => items,
    scope: () => scope,
    subscribe(cb) {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    async add(input) {
      const item: LibraryItem = {
        id: input.id ?? genId(),
        kind: input.kind,
        title: input.title,
        inputUrl: input.inputUrl,
        source: input.source,
        parentId: input.parentId,
        startSec: input.startSec,
        endSec: input.endSec,
        filePath: input.filePath,
        status: input.status,
        favorite: input.favorite ?? 1,
        createdAt: input.createdAt ?? now(),
      };
      items = [item, ...items];
      notify();
      await persistPut(item);
      return item;
    },
    async update(id, patch) {
      const idx = items.findIndex((i) => i.id === id);
      if (idx < 0) return null;
      const updated: LibraryItem = { ...items[idx], ...patch, id };
      items = [...items.slice(0, idx), updated, ...items.slice(idx + 1)];
      notify();
      await persistPut(updated);
      return updated;
    },
    async remove(id) {
      const had = items.some((i) => i.id === id);
      items = items.filter((i) => i.id !== id);
      notify();
      if (data && had) {
        writing++;
        try {
          await data.delete(COLL, id, { scope });
        } finally {
          writing--;
        }
      }
      return had;
    },
    async search(text) {
      const q = text.trim().toLowerCase();
      if (!q) return items;
      if (data?.search) {
        try {
          const rows = await data.search(COLL, text, { scope, limit: 1000 });
          const found = rows.map(rowToItem).filter((n): n is LibraryItem => n != null);
          if (found.length) return found.sort((a, b) => b.createdAt - a.createdAt);
        } catch {
          /* FTS 미가용 → client-side */
        }
      }
      return items.filter(
        (i) => i.title.toLowerCase().includes(q) || i.inputUrl.toLowerCase().includes(q),
      );
    },
    requestPlay(p) {
      pendingPlay = p;
      notify();
    },
    consumePlay() {
      const p = pendingPlay;
      pendingPlay = null;
      return p;
    },
    async init() {
      if (!data) return;
      await data.define(COLL, {
        indexes: ["kind", "source", "favorite", "status", "createdAt"],
        fts: ["title", "inputUrl"],
      });
      await hydrate();
      watchSub = data.watch(COLL, { scope }, () => {
        if (writing === 0) void hydrate();
      });
    },
    dispose() {
      if (watchSub) disposeOf(watchSub);
      watchSub = null;
      subs.clear();
    },
  };
}
