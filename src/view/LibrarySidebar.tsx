import { useCallback, useMemo, useState, type ChangeEvent, type KeyboardEvent } from "react";
import type { PlayerSignal } from "@/signal";
import type { ItemKind, LibraryItem } from "@/types";
import { addItem, deleteLibraryItem, patchItem } from "@/data";
import { runDownload } from "@/download";
import { makeSpawn } from "@/spawn";
import { classify, fmtTime, parseTime, downloadDir } from "@/util";
import { useLibrary } from "./useLibrary";

type Filter = "all" | ItemKind;

// 라이브러리 사이드바 — 즐겨찾기 + 클립 단일 필터 목록. 데이터는 app.data 직접 구독(useLibrary, 미러 없음),
// 변이는 data.ts 직접, 재생 인텐트는 시그널 채널. 추가/필터/클릭재생/수정/다운로드/삭제.
export default function LibrarySidebar({ app, scope, signal }: { app: any; scope: string; signal: PlayerSignal | null }) {
  const [url, setUrl] = useState("");
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<Filter>("all");
  // 클립 구간 인라인 편집 — 수정 아이콘으로 진입, 시작/종료를 초.00 까지 바꾼다.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editStart, setEditStart] = useState("");
  const [editEnd, setEditEnd] = useState("");
  const [flash, setFlash] = useState<string | null>(null);
  // 다운로드 결과(기계판독) — dlstate 노드로 노출해 E2E 가 UI 다운로드 버튼이 실제로 동작했는지 단언.
  const [dlState, setDlState] = useState<"idle" | "busy" | "ok" | "fail">("idle");
  const showFlash = useCallback((m: string) => {
    setFlash(m);
    window.setTimeout(() => setFlash((c) => (c === m ? null : c)), 2600);
  }, []);

  // app.data 직접 구독(미러 없음) — 변경(자기 창 변이 + 타 창 watch) 시 재쿼리·재렌더.
  const all = useLibrary(app?.data, scope);
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
    if (!v || !app?.data) return;
    const c = classify(v);
    await addItem(app.data, scope, { kind: "favorite", title: c.title, inputUrl: v, source: c.source });
    setUrl("");
  }, [url, app, scope]);

  const play = useCallback(
    (item: LibraryItem) => {
      // 재생 인텐트를 시그널 채널로 전달(같은 창 플레이어가 소비) + 플레이어 뷰 오픈.
      // 클립이면 구간(startSec/endSec)도 실어 보낸다 — 플레이어가 그 구간을 seek·반복 재생.
      signal?.requestPlay({
        inputUrl: item.inputUrl,
        title: item.title,
        startSec: item.kind === "clip" ? item.startSec : undefined,
        endSec: item.kind === "clip" ? item.endSec : undefined,
      });
      app?.ui?.openView?.("player", "content");
    },
    [app, signal],
  );

  const remove = useCallback(
    (e: { stopPropagation: () => void }, id: string) => {
      e.stopPropagation();
      if (app?.data) void deleteLibraryItem(app.data, scope, id);
    },
    [app, scope],
  );

  const startEdit = useCallback((e: { stopPropagation: () => void }, item: LibraryItem) => {
    e.stopPropagation();
    setEditingId(item.id);
    // 시:분:초.00 형식으로 편집 — 초는 .00(센티초)까지.
    setEditStart(fmtTime(item.startSec ?? 0, true));
    setEditEnd(fmtTime(item.endSec ?? 0, true));
  }, []);

  const saveEdit = useCallback(
    async (item: LibraryItem) => {
      const start = parseTime(editStart);
      const end = parseTime(editEnd);
      if (!app?.data || start == null || end == null || end <= start) {
        showFlash("시간 형식: 분:초.00 (예 1:23.50)");
        return;
      }
      // 제목의 기존 [구간] 꼬리표를 새 구간(.00)으로 교체 — 사용자 베이스 제목은 보존.
      const base = item.title.replace(/\s*\[[^\]]*\]\s*$/, "");
      const title = `${base} [${fmtTime(start, true)}–${fmtTime(end, true)}]`;
      await patchItem(app.data, scope, item.id, { startSec: start, endSec: end, title });
      setEditingId(null);
    },
    [app, scope, editStart, editEnd, showFlash],
  );

  const cancelEdit = useCallback(() => setEditingId(null), []);

  // 행 다운로드 — 클립이면 [start,end] 구간, 즐겨찾기면 전체. download 커맨드(프록시+ffmpeg) 위임.
  const downloadItem = useCallback(
    async (e: { stopPropagation: () => void }, item: LibraryItem) => {
      e.stopPropagation();
      const dir = downloadDir(app); // 미지정이면 {프로젝트}/playbox/clip
      const isClip = item.kind === "clip" && typeof item.startSec === "number" && typeof item.endSec === "number";
      const base = (item.title || "video").replace(/[^\w.\-가-힣]+/g, "_").slice(0, 80) || "video";
      const tag = isClip ? `_${Math.round(item.startSec as number)}-${Math.round(item.endSec as number)}` : "";
      const outPath = `${dir.replace(/\/+$/, "")}/${base}${tag}.mp4`;
      showFlash(isClip ? "구간 다운로드 시작…" : "다운로드 시작…");
      setDlState("busy");
      try {
        // 커맨드 우회 없이 runDownload 함수를 직접 호출(뷰는 함수, 커맨드는 CLI/MCP 용 — 동일 로직).
        const res = await runDownload(app, makeSpawn(app), {
          inputUrl: item.inputUrl,
          outPath,
          startSec: isClip ? item.startSec : undefined,
          endSec: isClip ? item.endSec : undefined,
        });
        setDlState(res.ok ? "ok" : "fail");
        showFlash(res.ok ? `저장됨: ${res.path ?? outPath}` : `다운로드 실패: ${res.message ?? "오류"}`);
      } catch (err) {
        setDlState("fail");
        showFlash(`다운로드 실패: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
    [app, scope, showFlash],
  );

  return (
    <div className="pb-root">
      {/* 진단: 이 뷰가 묶인 store instanceId/scope/항목수를 주소에 실어 노출(ui.tree 로 읽어 커맨드와 대조). */}
      <span data-node={`debug/${signal?.id() ?? "nil"}/${scope}/${all.length}`} style={{ display: "none" }} />
      {/* 다운로드 결과(기계판독) — dlstate/<idle|busy|ok|fail>. E2E 가 UI 다운로드 버튼 동작을 단언. */}
      <span data-node={`dlstate/${dlState}`} style={{ display: "none" }} />
      <div className="pb-header">
        <span className="pb-icon">▶</span>
        <span>Playbox</span>
      </div>
      {flash && (
        <div className="pb-flash" data-node="lib-flash">
          {flash}
        </div>
      )}
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
              <div key={i.id}>
                <div
                  className="pb-row"
                  data-node={`item/${i.id}`}
                  onClick={() => (editingId === i.id ? undefined : play(i))}
                  title={i.inputUrl}
                >
                  <span className="pb-row-kind">{i.kind === "clip" ? "CLIP" : "★"}</span>
                  <span className="pb-row-title">{i.title}</span>
                  {i.kind === "clip" && (
                    <button
                      className="pb-btn pb-btn-ghost"
                      data-node={`edit/${i.id}`}
                      onClick={(e) => startEdit(e, i)}
                      title="시작/종료 수정"
                      style={{ padding: "2px 7px" }}
                    >
                      ✎
                    </button>
                  )}
                  <button
                    className="pb-btn pb-btn-ghost"
                    data-node={`download/${i.id}`}
                    onClick={(e) => void downloadItem(e, i)}
                    title={i.kind === "clip" ? "구간 다운로드" : "다운로드"}
                    style={{ padding: "2px 7px" }}
                  >
                    ⬇
                  </button>
                  <button
                    className="pb-btn pb-btn-ghost"
                    data-node={`remove/${i.id}`}
                    onClick={(e) => remove(e, i.id)}
                    style={{ padding: "2px 7px" }}
                  >
                    ✕
                  </button>
                </div>
                {editingId === i.id && (
                  <div
                    className="pb-edit"
                    data-node={`edit-panel/${i.id}`}
                    onClick={(e) => e.stopPropagation()}
                    style={{ display: "flex", gap: 6, padding: "6px 10px", alignItems: "center", flexWrap: "wrap" }}
                  >
                    <input
                      className="pb-input"
                      data-node="clip-edit-start"
                      type="text"
                      inputMode="decimal"
                      value={editStart}
                      onChange={(e: ChangeEvent<HTMLInputElement>) => setEditStart(e.target.value)}
                      placeholder="0:00.00"
                      title="시작 — 시:분:초.00 (예 1:23.50)"
                      style={{ width: 92 }}
                    />
                    <span>–</span>
                    <input
                      className="pb-input"
                      data-node="clip-edit-end"
                      type="text"
                      inputMode="decimal"
                      value={editEnd}
                      onChange={(e: ChangeEvent<HTMLInputElement>) => setEditEnd(e.target.value)}
                      placeholder="0:00.00"
                      title="종료 — 시:분:초.00 (예 1:23.50)"
                      style={{ width: 92 }}
                    />
                    <button className="pb-btn" data-node="clip-edit-save" onClick={() => void saveEdit(i)}>
                      저장
                    </button>
                    <button className="pb-btn pb-btn-ghost" data-node="clip-edit-cancel" onClick={cancelEdit}>
                      취소
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
