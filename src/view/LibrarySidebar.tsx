import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from "react";
import type { LibraryStore } from "@/store";
import type { ItemKind, LibraryItem } from "@/types";
import { classify } from "@/util";

type Filter = "all" | ItemKind;

// 라이브러리 사이드바 — 즐겨찾기 + 클립 단일 필터 목록. 추가/필터/클릭재생/삭제. store(app.data) 구독.
export default function LibrarySidebar({ app, store }: { app: any; store: LibraryStore | null }) {
  const [, setTick] = useState(0);
  const [url, setUrl] = useState("");
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<Filter>("all");

  // store 변경 구독 → 리렌더.
  useEffect(() => {
    if (!store) return;
    return store.subscribe(() => setTick((t) => t + 1));
  }, [store]);

  const all: LibraryItem[] = store ? store.get() : [];
  const items = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return all.filter((i) => {
      if (kind !== "all" && i.kind !== kind) return false;
      if (!needle) return true;
      return i.title.toLowerCase().includes(needle) || i.inputUrl.toLowerCase().includes(needle);
    });
  }, [all, q, kind]);

  const add = useCallback(async () => {
    const v = url.trim();
    if (!v || !store) return;
    const c = classify(v);
    await store.add({ kind: "favorite", title: c.title, inputUrl: v, source: c.source });
    setUrl("");
  }, [url, store]);

  const play = useCallback(
    (item: LibraryItem) => {
      // 재생 인텐트를 store 로 전달(같은 창 플레이어가 소비) + 플레이어 뷰 오픈.
      store?.requestPlay({ inputUrl: item.inputUrl, title: item.title });
      app?.ui?.openView?.("player", "content");
    },
    [app, store],
  );

  const remove = useCallback(
    (e: { stopPropagation: () => void }, id: string) => {
      e.stopPropagation();
      void store?.remove(id);
    },
    [store],
  );

  return (
    <div className="pb-root">
      <div className="pb-header">
        <span className="pb-icon">▶</span>
        <span>Playbox</span>
      </div>
      <div className="pb-body">
        <div style={{ padding: "10px 10px 6px" }}>
          <div className="pb-url-row">
            <input
              className="pb-input"
              data-node="lib-input"
              placeholder="URL 추가 — 즐겨찾기"
              value={url}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setUrl(e.target.value)}
              onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
                if (e.key === "Enter") void add();
              }}
            />
            <button className="pb-btn" data-node="lib-add" onClick={() => void add()}>
              추가
            </button>
          </div>
          <div className="pb-url-row" style={{ marginTop: 6 }}>
            <input
              className="pb-input"
              data-node="lib-filter"
              placeholder="필터"
              value={q}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setQ(e.target.value)}
            />
            <select
              className="pb-input"
              data-node="lib-kind"
              style={{ flex: "0 0 auto", width: 90 }}
              value={kind}
              onChange={(e: ChangeEvent<HTMLSelectElement>) => setKind(e.target.value as Filter)}
            >
              <option value="all">전체</option>
              <option value="favorite">즐겨찾기</option>
              <option value="clip">클립</option>
            </select>
          </div>
        </div>

        {items.length === 0 ? (
          <div className="pb-hint">
            {all.length === 0
              ? "URL 을 추가하거나, 플레이어에서 재생 중 [ / ] 로 클립을 만들어 보세요."
              : "필터에 맞는 항목이 없습니다."}
          </div>
        ) : (
          <div className="pb-list" data-node="list">
            {items.map((i) => (
              <div
                key={i.id}
                className="pb-row"
                data-node={`item/${i.id}`}
                onClick={() => play(i)}
                title={i.inputUrl}
              >
                <span className="pb-row-kind">{i.kind === "clip" ? "CLIP" : "★"}</span>
                <span className="pb-row-title">{i.title}</span>
                <button
                  className="pb-btn pb-btn-ghost"
                  data-node={`remove/${i.id}`}
                  onClick={(e) => remove(e, i.id)}
                  style={{ padding: "2px 7px" }}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
