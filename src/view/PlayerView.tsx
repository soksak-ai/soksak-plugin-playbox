import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type KeyboardEvent,
} from "react";
import { resolveUrl } from "@/resolve";
import { makeSpawn } from "@/spawn";
import { fmtTime, applyDomainMap, parseDomainMap } from "@/util";
import { resolveViaWebview, resolveViaWebviewHidden } from "@/webview-resolve";
import type { LibraryStore } from "@/store";
import type { Resolved } from "@/types";
import { attachHls } from "./hls";
import { proxiedUrl } from "@/proxy";

type Media = { mode: "video" | "hls" | "iframe"; src: string; title?: string };

export default function PlayerView({ app, store }: { app: any; store: LibraryStore | null }) {
  const [media, setMedia] = useState<Media | null>(null);
  const [currentInput, setCurrentInput] = useState<string | null>(null);
  const [clipStart, setClipStart] = useState<number | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (media?.mode === "hls" && videoRef.current) {
      return attachHls(videoRef.current, media.src);
    }
  }, [media]);

  const showFlash = useCallback((msg: string) => {
    setFlash(msg);
    window.setTimeout(() => setFlash((cur) => (cur === msg ? null : cur)), 2200);
  }, []);

  const playResolved = useCallback(
    async (r: Resolved, inputUrl: string | null) => {
      if (r.kind === "unsupported") {
        setError(r.reason ?? "재생할 수 없는 입력");
        return;
      }
      setError(null);
      setClipStart(null);
      setCurrentInput(inputUrl);
      if (r.kind === "youtube" && r.embedUrl) {
        setMedia({ mode: "iframe", src: r.embedUrl, title: r.title });
        return;
      }
      if (r.kind === "file" && r.filePath) {
        setMedia({ mode: "video", src: r.filePath, title: r.title });
        return;
      }
      const src = await proxiedUrl(app, r);
      setMedia({ mode: r.kind === "hls" ? "hls" : "video", src, title: r.title });
    },
    [app],
  );

  const playInput = useCallback(
    async (v: string) => {
      const raw = v.trim();
      if (!raw) return;
      setBusy(true);
      try {
        // 도메인 매핑 적용(설정 list, 사용자 입력만·소스에 사이트명 0) — 차단 호스트를 미러로.
        const input = applyDomainMap(raw, parseDomainMap(app?.settings?.get?.("domainMap")));
        // 경로 1: yt-dlp/직접/youtube/로컬.
        let r = await resolveUrl(input, makeSpawn(app));
        // 경로 2(R10): yt-dlp 가 못 뚫는 http(s) 페이지 → WebKit 브라우저 로드 + 코어 미디어 스니프.
        // 추출 방식은 설정(extractMode): hidden=오프스크린(기본·깔끔), tab=보이는 탭(사용자 개입 가능).
        if (r.kind === "unsupported" && /^https?:\/\//i.test(input)) {
          const tmo = Number(app?.settings?.get?.("sniffTimeoutMs") ?? 15000);
          const mode = String(app?.settings?.get?.("extractMode") ?? "hidden");
          r = mode === "tab"
            ? await resolveViaWebview(app, input, tmo)
            : await resolveViaWebviewHidden(app, input, tmo);
        }
        await playResolved(r, input);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [app, playResolved],
  );

  const playFile = useCallback((file: File) => {
    setError(null);
    setClipStart(null);
    setMedia({ mode: "video", src: URL.createObjectURL(file), title: file.name });
    setCurrentInput(file.name);
  }, []);

  // 사이드바 → 플레이어 재생 인텐트 소비(같은 store 인스턴스 공유).
  useEffect(() => {
    if (!store) return;
    const handle = () => {
      const p = store.consumePlay();
      if (p) {
        setUrl(p.inputUrl);
        void playInput(p.inputUrl);
      }
    };
    handle(); // 마운트 시 대기 중 인텐트 즉시 소비
    return store.subscribe(handle);
  }, [store, playInput]);

  const markStart = useCallback(() => {
    const t = videoRef.current?.currentTime;
    if (t == null) return;
    setClipStart(t);
    showFlash(`클립 시작 ${fmtTime(t)} — 끝 지점에서 ]`);
  }, [showFlash]);

  const markEnd = useCallback(async () => {
    const t = videoRef.current?.currentTime;
    if (t == null || clipStart == null || !currentInput) {
      showFlash("먼저 [ 로 시작 지점을 표시하세요");
      return;
    }
    const startSec = Math.min(clipStart, t);
    const endSec = Math.max(clipStart, t);
    if (endSec - startSec < 0.1) {
      showFlash("구간이 너무 짧습니다");
      return;
    }
    try {
      await app.commands.execute("clip.add", { inputUrl: currentInput, startSec, endSec });
      showFlash(`클립 저장 ${fmtTime(startSec)}–${fmtTime(endSec)}`);
    } catch {
      showFlash("클립 저장 실패");
    }
    setClipStart(null);
  }, [app, clipStart, currentInput, showFlash]);

  // 다운로드 — 현재 미디어를 download 커맨드로(프록시+ffmpeg). clipStart 가 표시돼 있으면 그 구간만,
  // 아니면 전체. iframe(YouTube 해석 실패)은 버튼이 없으니 여기 닿지 않는다. 저장 폴더는 설정(downloadDir).
  const downloadCurrent = useCallback(async () => {
    if (!currentInput) {
      showFlash("재생 중인 입력이 없습니다");
      return;
    }
    const dir = String(app?.settings?.get?.("downloadDir") ?? "").trim();
    if (!dir) {
      showFlash("설정에서 다운로드 폴더를 먼저 지정하세요");
      return;
    }
    const t = videoRef.current?.currentTime ?? null;
    const isClip = clipStart != null && t != null && Math.abs(t - clipStart) >= 0.1;
    const startSec = isClip ? Math.min(clipStart as number, t as number) : undefined;
    const endSec = isClip ? Math.max(clipStart as number, t as number) : undefined;
    const base = (media?.title || "video").replace(/[^\w.\-가-힣]+/g, "_").slice(0, 80) || "video";
    const tag = isClip ? `_${Math.round(startSec as number)}-${Math.round(endSec as number)}` : "";
    const outPath = `${dir.replace(/\/+$/, "")}/${base}${tag}.mp4`;
    showFlash(isClip ? "구간 다운로드 시작…" : "다운로드 시작…");
    try {
      const raw = await app.commands.execute("download", { inputUrl: currentInput, outPath, startSec, endSec });
      const res = (raw && typeof raw === "object" && "result" in raw ? (raw as any).result : raw) as
        | { ok?: boolean; path?: string; message?: string }
        | undefined;
      if (res?.ok) showFlash(`저장됨: ${res.path ?? outPath}`);
      else showFlash(`다운로드 실패: ${res?.message ?? "오류"}`);
    } catch (e) {
      showFlash(`다운로드 실패: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [app, currentInput, clipStart, media, showFlash]);

  const onMediaKey = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "[") {
        e.preventDefault();
        markStart();
      } else if (e.key === "]") {
        e.preventDefault();
        void markEnd();
      }
    },
    [markStart, markEnd],
  );

  const submitUrl = useCallback(() => {
    if (busy) return;
    void playInput(url);
  }, [busy, url, playInput]);

  const onDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const f = e.dataTransfer.files?.[0];
      if (f) {
        playFile(f);
        return;
      }
      const u = (e.dataTransfer.getData("text/uri-list") || e.dataTransfer.getData("text/plain")).trim();
      if (u) {
        setUrl(u);
        void playInput(u);
      }
    },
    [playFile, playInput],
  );

  if (media) {
    const canClip = media.mode !== "iframe";
    return (
      <div className="pb-root" tabIndex={0} onKeyDown={onMediaKey}>
        <div className="pb-header">
          <span className="pb-icon">▷</span>
          <span className="pb-row-title">{media.title ?? "Player"}</span>
          {canClip && (
            <>
              <button className="pb-btn pb-btn-ghost" data-node="clip-start" onClick={markStart}>
                [ 시작
              </button>
              <button className="pb-btn pb-btn-ghost" data-node="clip-end" onClick={() => void markEnd()}>
                ] 클립
              </button>
              <button className="pb-btn pb-btn-ghost" data-node="download" onClick={() => void downloadCurrent()}>
                ↓ 저장
              </button>
            </>
          )}
          <button className="pb-btn pb-btn-ghost" data-node="close" onClick={() => setMedia(null)}>
            ✕
          </button>
        </div>
        {flash && (
          <div className="pb-flash" data-node="flash">
            {flash}
          </div>
        )}
        <div className="pb-media">
          {media.mode === "iframe" ? (
            <iframe
              className="pb-frame"
              data-node="frame"
              src={media.src}
              allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
              allowFullScreen
            />
          ) : (
            <video
              ref={videoRef}
              className="pb-video"
              data-node="video"
              src={media.mode === "video" ? media.src : undefined}
              controls
              autoPlay
            />
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="pb-root">
      <div className="pb-header">
        <span className="pb-icon">▷</span>
        <span>Player</span>
      </div>
      <div
        className={"pb-body pb-empty" + (dragOver ? " pb-dragover" : "")}
        data-node="dropzone"
        onDragOver={(e: DragEvent) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
      >
        <div className="pb-url-row">
          <input
            className="pb-input"
            data-node="url-input"
            placeholder="비디오 URL 붙여넣기 — YouTube · m3u8 · mp4 · 웹페이지"
            value={url}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setUrl(e.target.value)}
            onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
              if (e.key === "Enter") submitUrl();
            }}
          />
          <button className="pb-btn" data-node="play" disabled={busy} onClick={submitUrl}>
            {busy ? "…" : "재생"}
          </button>
        </div>
        <div className="pb-drop">
          <div className="pb-drop-title">여기로 동영상 파일을 드래그</div>
          <div className="pb-drop-sub">또는</div>
          <button className="pb-btn pb-btn-ghost" data-node="open-file" onClick={() => fileRef.current?.click()}>
            파일 열기
          </button>
        </div>
        {error && (
          <div className="pb-error" data-node="error">
            {error}
          </div>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="video/*,.m3u8,.mkv,.mov"
          style={{ display: "none" }}
          onChange={(e: ChangeEvent<HTMLInputElement>) => {
            const f = e.target.files?.[0];
            if (f) playFile(f);
            e.target.value = "";
          }}
        />
      </div>
    </div>
  );
}
