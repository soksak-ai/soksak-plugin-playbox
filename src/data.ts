// 데이터 레이어 — 단일 진실 = app.data "library" 컬렉션. 모든 읽기/쓰기는 여기로 직접(미러 비의존).
// 커맨드(헤드리스)와 뷰 스토어가 공유한다. app.data 는 항상 최신이라 "hydrate 전 빈 목록" 레이스가 없다.
import type { LibraryItem } from "@/types";

export interface Disposable {
  dispose(): void;
}
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

export const COLL = "library";
export const COLL_INDEXES = ["kind", "source", "favorite", "status", "createdAt"];
export const COLL_FTS = ["title", "inputUrl"];

// 추가 입력 — id/createdAt/favorite 는 buildItem 이 채운다.
export type NewItem = Omit<LibraryItem, "id" | "createdAt" | "favorite"> & {
  id?: string;
  createdAt?: number;
  favorite?: number;
};

function asStr(v: unknown, d = ""): string {
  return typeof v === "string" ? v : d;
}
function asNum(v: unknown, d = 0): number {
  return typeof v === "number" && Number.isFinite(v) ? v : d;
}

export function genId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return "i-" + Date.now().toString(36) + "-" + Math.floor(Math.random() * 1e9).toString(36);
  }
}

export function disposeOf(d: Disposable | (() => void)): void {
  if (typeof d === "function") d();
  else if (d && typeof d.dispose === "function") d.dispose();
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

// 단조 증가 createdAt(같은 ms 다중 생성 순서 보존) — 모듈 전역(모든 store/커맨드 공유).
let lastTs = 0;
function nextTs(): number {
  const t = Math.max(Date.now(), lastTs + 1);
  lastTs = t;
  return t;
}

export function buildItem(input: NewItem): LibraryItem {
  return {
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
    createdAt: input.createdAt ?? nextTs(),
  };
}

export async function ensureDefined(data: DataApi): Promise<void> {
  await data.define(COLL, { indexes: COLL_INDEXES, fts: COLL_FTS });
}

// scope 의 전체 라이브러리(즐겨찾기 + 클립), createdAt 내림차순. 항상 app.data 최신.
export async function loadLibrary(data: DataApi, scope: string): Promise<LibraryItem[]> {
  const rows = await data.query(COLL, { scope, order: "createdAt", desc: true, limit: 100000 });
  return rows
    .map(rowToItem)
    .filter((n): n is LibraryItem => n != null)
    .sort((a, b) => b.createdAt - a.createdAt);
}

// CJK 전문검색(FTS) → 실패/0건이면 client-side 부분일치 폴백.
export async function searchLibrary(data: DataApi, scope: string, text: string): Promise<LibraryItem[]> {
  const q = text.trim();
  if (!q) return loadLibrary(data, scope);
  if (data.search) {
    try {
      const rows = await data.search(COLL, text, { scope, limit: 1000 });
      const found = rows.map(rowToItem).filter((n): n is LibraryItem => n != null);
      if (found.length) return found.sort((a, b) => b.createdAt - a.createdAt);
    } catch {
      /* FTS 미가용 → client-side */
    }
  }
  const ql = q.toLowerCase();
  const lib = await loadLibrary(data, scope);
  return lib.filter((i) => i.title.toLowerCase().includes(ql) || i.inputUrl.toLowerCase().includes(ql));
}

export async function putItem(data: DataApi, scope: string, item: LibraryItem): Promise<void> {
  await data.put(COLL, item as unknown as Record<string, unknown>, { scope, id: item.id });
}

export async function addItem(data: DataApi, scope: string, input: NewItem): Promise<LibraryItem> {
  const item = buildItem(input);
  await putItem(data, scope, item);
  return item;
}

export async function patchItem(
  data: DataApi,
  scope: string,
  id: string,
  patch: Partial<LibraryItem>,
): Promise<LibraryItem | null> {
  const lib = await loadLibrary(data, scope);
  const cur = lib.find((i) => i.id === id);
  if (!cur) return null;
  const updated: LibraryItem = { ...cur, ...patch, id };
  await putItem(data, scope, updated);
  return updated;
}

export async function deleteLibraryItem(data: DataApi, scope: string, id: string): Promise<boolean> {
  return data.delete(COLL, id, { scope });
}
