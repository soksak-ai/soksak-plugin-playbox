import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type KeyboardEvent,
} from "react";
import { makeSpawn } from "@/spawn";
import { fmtTime, classify, downloadDir } from "@/util";
import { resolveFull } from "@/resolveFull";
import type { PlayerSignal } from "@/signal";
import { addItem } from "@/data";
import { runDownload } from "@/download";
import type { Resolved } from "@/types";
import { attachHls } from "./hls";
import { proxiedUrl } from "@/proxy";

type Media = { mode: "video" | "hls" | "iframe"; src: string; title?: string };

export default function PlayerView({ app, scope, signal }: { app: any; scope: string; signal: PlayerSignal | null }) {
  const [media, setMedia] = useState<Media | null>(null);
  const [currentInput, setCurrentInput] = useState<string | null>(null);
  const [clipStart, setClipStart] = useState<number | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState("");
  const [dragOver, setDragOver] = useState(false);
  // 실제 재생 상태(currentTime/일시정지/readyState) — DOM 노드로 노출해 E2E 가 "진짜 재생 중"을 단언.
  // 가짜 URL 인텐트가 아니라 비디오가 프레임을 그리며 t 가 진행하는지를 본다.
  const [pstate, setPstate] = useState({ t: 0, paused: true, ready: 0 });
  // 클립 구간 재생 — 라이브러리에서 클립을 누르면 [start,end] 가 들어온다. seek + (loop 시) 구간 반복.
  const [clipRange, setClipRange] = useState<{ start: number; end: number } | null>(null);
  const [loop, setLoop] = useState(true);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (media?.mode === "hls" && videoRef.current) {
      return attachHls(videoRef.current, media.src);
    }
  }, [media]);

  const onVideoState = useCallback(
    (e: { currentTarget: HTMLVideoElement }) => {
      const v = e.currentTarget;
      setPstate({ t: v.currentTime, paused: v.paused, ready: v.readyState });
      // 라이브 상태를 시그널 채널에 publish — player.state 커맨드가 read(CLI/MCP). read 전용(notify X).
      signal?.setPlayerState({
        inputUrl: currentInput,
        currentTime: v.currentTime,
        duration: Number.isFinite(v.duration) ? v.duration : 0,
        paused: v.paused,
        clip: clipRange,
        loop,
      });
      // 구간 끝 도달 — 반복이면 시작으로 되감기, 아니면 정지. 클립 구간 재생/반복의 핵심.
      if (clipRange && v.currentTime >= clipRange.end - 0.05) {
        if (loop) {
          try {
            v.currentTime = clipRange.start;
            void v.play();
          } catch {
            /* seek 실패 무시 */
          }
        } else {
          v.pause();
        }
      }
    },
    [clipRange, loop, signal, currentInput],
  );

  // 메타데이터 로드 시 클립 시작점으로 seek(구간 재생 시작). 비클립이면 그대로 0.
  const onLoadedMeta = useCallback(
    (e: { currentTarget: HTMLVideoElement }) => {
      const v = e.currentTarget;
      if (clipRange) {
        try {
          v.currentTime = clipRange.start;
          void v.play();
        } catch {
          /* seek 실패 무시 */
        }
      }
      setPstate({ t: v.currentTime, paused: v.paused, ready: v.readyState });
    },
    [clipRange],
  );

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
        // 재생·다운로드 공통 해석(도메인매핑 → yt-dlp → webview 폴백). 단일진실 resolveFull.
        const { resolved: r, input } = await resolveFull(app, raw, makeSpawn(app));
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
    setClipRange(null); // 일반 파일 재생 — 구간/반복 해제
    setMedia({ mode: "video", src: URL.createObjectURL(file), title: file.name });
    setCurrentInput(file.name);
  }, []);

  // 사이드바 → 플레이어 재생 인텐트 소비(같은 시그널 채널 공유).
  useEffect(() => {
    if (!signal) return;
    const handle = () => {
      const p = signal.consumePlay();
      if (p) {
        setUrl(p.inputUrl);
        // 클립이면 구간을 잡고 기본 반복 ON. 일반 재생이면 구간 해제.
        const hasRange = typeof p.startSec === "number" && typeof p.endSec === "number";
        setClipRange(hasRange ? { start: p.startSec as number, end: p.endSec as number } : null);
        setLoop(hasRange);
        void playInput(p.inputUrl);
      }
    };
    handle(); // 마운트 시 대기 중 인텐트 즉시 소비
    return signal.subscribe(handle);
  }, [signal, playInput]);

  // player.control 커맨드 → 비디오 조작(play/pause/seek/반복토글). CLI/MCP 가 재생을 직접 제어한다.
  useEffect(() => {
    if (!signal) return;
    const handle = () => {
      // 비디오가 마운트된(재생 중인) 플레이어만 제어를 소비한다 — 빈/숨김 뷰가 인텐트를 삼켜 버리지 않게.
      // consumeControl 은 1회성이므로, 비디오 없는 뷰는 소비조차 하지 않고 둬서 보이는 뷰가 받게 한다.
      const v = videoRef.current;
      if (!v) return;
      const c = signal.consumeControl();
      if (!c) return;
      if (c.action === "toggleLoop") setLoop((l) => !l);
      else if (c.action === "play") void v.play();
      else if (c.action === "pause") v.pause();
      else if (c.action === "seek" && typeof c.seconds === "number") v.currentTime = c.seconds;
    };
    return signal.subscribe(handle);
  }, [signal]);

  // 미디어가 닫히면 player.state 를 비운다 — CLI/MCP 가 "재생 없음" 을 읽게.
  useEffect(() => {
    if (!media) signal?.setPlayerState(null);
  }, [media, signal]);

  const markStart = useCallback(() => {
    const t = videoRef.current?.currentTime;
    if (t == null) return;
    setClipStart(t);
    showFlash(`클립 시작 ${fmtTime(t, true)} — 끝 지점에서 ]`);
  }, [showFlash]);

  const markEnd = useCallback(async () => {
    const t = videoRef.current?.currentTime;
    if (t == null || clipStart == null || !currentInput || !app?.data) {
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
      // 커맨드 우회 없이 data.ts 로 app.data 에 직접 저장(이 뷰의 scope) — 단일 진실.
      const c = classify(currentInput);
      const title = `${c.title} [${fmtTime(startSec, true)}–${fmtTime(endSec, true)}]`;
      await addItem(app.data, scope, { kind: "clip", title, inputUrl: currentInput, source: c.source, startSec, endSec });
      showFlash(`클립 저장 ${fmtTime(startSec, true)}–${fmtTime(endSec, true)}`);
    } catch {
      showFlash("클립 저장 실패");
    }
    setClipStart(null);
  }, [app, scope, clipStart, currentInput, showFlash]);

  // 다운로드 — 현재 미디어를 runDownload(프록시+ffmpeg) 직접. clipStart 가 표시돼 있으면 그 구간만,
  // 아니면 전체. 커맨드 우회 없음(뷰는 함수, 커맨드는 CLI/MCP 용 — 동일 로직). 폴더 미지정 시 {프로젝트}/playbox/clip.
  const downloadCurrent = useCallback(async () => {
    if (!currentInput) {
      showFlash("재생 중인 입력이 없습니다");
      return;
    }
    const dir = downloadDir(app);
    const t = videoRef.current?.currentTime ?? null;
    const isClip = clipStart != null && t != null && Math.abs(t - clipStart) >= 0.1;
    const startSec = isClip ? Math.min(clipStart as number, t as number) : undefined;
    const endSec = isClip ? Math.max(clipStart as number, t as number) : undefined;
    const base = (media?.title || "video").replace(/[^\w.\-가-힣]+/g, "_").slice(0, 80) || "video";
    const tag = isClip ? `_${Math.round(startSec as number)}-${Math.round(endSec as number)}` : "";
    const outPath = `${dir.replace(/\/+$/, "")}/${base}${tag}.mp4`;
    showFlash(isClip ? "구간 다운로드 시작…" : "다운로드 시작…");
    try {
      const res = await runDownload(app, makeSpawn(app), { inputUrl: currentInput, outPath, startSec, endSec });
      showFlash(res.ok ? `저장됨: ${res.path ?? outPath}` : `다운로드 실패: ${res.message ?? "오류"}`);
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
    setClipRange(null); // URL 바 재생 — 구간/반복 해제
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
        setClipRange(null); // 드롭 URL 재생 — 구간/반복 해제
        void playInput(u);
      }
    },
    [playFile, playInput],
  );

  if (media) {
    const canClip = media.mode !== "iframe";
    return (
      <div className="pb-root" tabIndex={0} onKeyDown={onMediaKey}>
        <span data-node={`debug/${signal?.id() ?? "nil"}/${scope}/${currentInput ? 1 : 0}`} style={{ display: "none" }} />
        {/* 진짜 재생 상태 — playstate/<centiseconds>/<paused 0|1>/<readyState>. E2E 가 t 진행을 폴링해 실재생 단언. */}
        <span data-node={`playstate/${Math.round(pstate.t * 100)}/${pstate.paused ? 1 : 0}/${pstate.ready}`} style={{ display: "none" }} />
        {/* 클립 구간/반복 상태 — clipstate/<start cs|-1>/<end cs|-1>/<loop 0|1>. E2E 가 구간 재생·반복 단언. */}
        <span data-node={`clipstate/${clipRange ? Math.round(clipRange.start * 100) : -1}/${clipRange ? Math.round(clipRange.end * 100) : -1}/${loop ? 1 : 0}`} style={{ display: "none" }} />
        <div className="pb-header">
          <span className="pb-icon">▷</span>
          <span className="pb-row-title">{media.title ?? "Player"}</span>
          {canClip && (
            <>
              {clipRange && (
                <button
                  className="pb-btn pb-btn-ghost"
                  data-node="loop"
                  onClick={() => setLoop((l) => !l)}
                  title={loop ? "구간 반복 끄기" : "구간 반복 켜기"}
                  style={{ opacity: loop ? 1 : 0.45 }}
                >
                  ⟳ {loop ? "반복" : "1회"}
                </button>
              )}
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
              onTimeUpdate={onVideoState}
              onPlay={onVideoState}
              onPause={onVideoState}
              onLoadedData={onVideoState}
              onLoadedMetadata={onLoadedMeta}
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
