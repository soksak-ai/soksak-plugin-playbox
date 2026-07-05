// Playbox 커맨드 표면 — 모든 기능을 registry 로 노출(R1). 같은 코드 경로를 CLI/MCP/UI 가 공유.
// 사이트 지식 0(R2) — 해석은 resolveUrl(yt-dlp 위임). 라이브러리는 app.data 만(R4).
import { resolveUrl, type SpawnFn } from "@/resolve";
import { makeSpawn } from "@/spawn";
import { runDownload } from "@/download";
import { classify, fmtTime, downloadDir } from "@/util";
import type { PlayerSignal } from "@/signal";
import type { LibraryItem } from "@/types";
import { type DataApi, addItem, deleteLibraryItem, loadLibrary, patchItem, searchLibrary } from "@/data";

function probe(spawn: SpawnFn, cmd: string, args: string[]): Promise<{ found: boolean; version?: string }> {
  return spawn(cmd, args)
    .then((r) => (r.code === 0 ? { found: true, version: (r.stdout.split("\n")[0] || "").trim() } : { found: false }))
    .catch(() => ({ found: false }));
}

function platformInstall(tool: string): { cmd: string; args: string[] } | null {
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  if (/Mac/i.test(ua)) return { cmd: "brew", args: ["install", tool] };
  if (/Win/i.test(ua)) return { cmd: "winget", args: ["install", tool === "yt-dlp" ? "yt-dlp.yt-dlp" : tool] };
  // Linux: yt-dlp 는 pip 권장, ffmpeg 는 배포판 패키지(여기선 pip/apt 추정 — 미설치 시 안내).
  if (tool === "yt-dlp") return { cmd: "pip", args: ["install", "-U", "yt-dlp"] };
  return null;
}

export function registerCommands(
  ctx: any,
  getSignal: (projectId: string) => PlayerSignal,
  app: any,
): void {
  const spawn = makeSpawn(app);
  const reg = (name: string, spec: Record<string, unknown>) =>
    ctx.subscriptions.push(app.commands.register(name, spec));

  // 데이터 커맨드는 app.data(단일 진실)를 data.ts 로 직접 읽고 쓴다 — 뷰 미러 비의존이라 "생성 직후 빈
  // 목록" 레이스가 구조적으로 없다(항상 최신). 시그널 커맨드(play/player.*)만 getStore 의 뷰 간 채널을 쓴다.
  // projectId 파라미터(생략=활성 프로젝트)로 scope 를 호출 시점에 1회 결정론적으로 해소.
  const scopeFor = (p?: { projectId?: unknown }): string =>
    String(p?.projectId ?? app.project?.current?.()?.id ?? "default");
  const data = (): DataApi => app.data as DataApi;
  const sig = (p?: { projectId?: unknown }): PlayerSignal => getSignal(scopeFor(p)); // 뷰 간 시그널 채널
  const projectIdParam = { type: "string", description: "프로젝트 id(생략=활성 프로젝트)" };

  // 진단 — scope 의 app.data 항목수(직접) + 시그널 store instanceId. 뷰 debug 노드와 대조(멱등 CLI 검증).
  reg("debug", {
    description: "인스턴스 진단 — { instanceId, scope, count, downloadDir }. 뷰 debug 노드와 대조.",
    params: { projectId: projectIdParam },
    returns: "{ instanceId, scope, count, downloadDir }",
    message: (d: any) => `scope ${d?.scope} 에 항목 ${d?.count ?? 0}개.`,
    handler: async (p: any) => {
      const items = await loadLibrary(data(), scopeFor(p));
      return { instanceId: sig(p).id(), scope: scopeFor(p), count: items.length, downloadDir: downloadDir(app) };
    },
  });

  reg("favorite.add", {
    description: "URL 을 즐겨찾기로 라이브러리에 추가(해석은 재생 시). inputUrl 필수.",
    params: {
      inputUrl: { type: "string", description: "비디오 URL 또는 파일 경로", required: true },
      title: { type: "string", description: "표시 제목(생략 시 자동)" },
      projectId: projectIdParam,
    },
    returns: "{ id, item }",
    message: (d: any) => `즐겨찾기 "${d?.item?.title}" 을(를) 추가했습니다.`,
    handler: async (p: any) => {
      const input = String(p?.inputUrl ?? "").trim();
      if (!input) return { ok: false, code: "INVALID_PARAMS", message: "inputUrl 필요" };
      const c = classify(input);
      const item = await addItem(data(), scopeFor(p), {
        kind: "favorite",
        title: String(p?.title ?? c.title),
        inputUrl: input,
        source: c.source,
      });
      return { id: item.id, item };
    },
  });

  reg("favorite.remove", {
    description: "라이브러리 항목 삭제(즐겨찾기/클립 공통). id 필수.",
    params: { id: { type: "string", description: "항목 id", required: true }, projectId: projectIdParam },
    returns: "{ removed }",
    message: (d: any) => (d?.removed ? "항목을 삭제했습니다." : "삭제할 항목이 없습니다."),
    danger: "destructive",
    handler: async (p: any) => ({ removed: await deleteLibraryItem(data(), scopeFor(p), String(p?.id ?? "")) }),
  });

  reg("library.list", {
    description: "라이브러리 목록(즐겨찾기+클립). kind 로 좁힌다(favorite|clip).",
    params: { kind: { type: "string", description: "favorite | clip (생략=전체)" }, projectId: projectIdParam },
    returns: "{ items, count }",
    message: (d: any) => `${d?.count ?? 0}개.`,
    handler: async (p: any) => {
      const kind = p?.kind as string | undefined;
      const all = await loadLibrary(data(), scopeFor(p));
      const items = all.filter((i) => !kind || i.kind === kind);
      return { items, count: items.length };
    },
  });

  reg("library.filter", {
    description: "라이브러리 필터 — CJK 전문검색(title/inputUrl) + kind 종류. 단일 목록.",
    params: {
      text: { type: "string", description: "검색어(빈 값=전체)" },
      kind: { type: "string", description: "favorite | clip" },
      projectId: projectIdParam,
    },
    returns: "{ items, count }",
    message: (d: any) => `${d?.count ?? 0}개를 찾았습니다.`,
    handler: async (p: any) => {
      let items = await searchLibrary(data(), scopeFor(p), String(p?.text ?? ""));
      const kind = p?.kind as string | undefined;
      if (kind) items = items.filter((i) => i.kind === kind);
      return { items, count: items.length };
    },
  });

  reg("resolve", {
    description: "입력 URL 1회 해석 → {kind, mediaUrl|embedUrl|filePath, needsProxy, referer}. 임의 페이지는 yt-dlp 위임.",
    params: { inputUrl: { type: "string", description: "비디오 URL/경로", required: true } },
    returns: "Resolved",
    message: (d: any) => `${d?.kind} 로 해석했습니다.`,
    handler: async (p: any) => {
      const input = String(p?.inputUrl ?? "").trim();
      if (!input) return { ok: false, code: "INVALID_PARAMS", message: "inputUrl 필요" };
      return await resolveUrl(input, spawn);
    },
  });

  reg("play", {
    description: "열린 플레이어에 재생 요청(사이드바→플레이어). 해석 결과도 반환. inputUrl 필수.",
    params: {
      inputUrl: { type: "string", description: "비디오 URL/경로", required: true },
      title: { type: "string", description: "표시 제목" },
      startSec: { type: "number", description: "클립 시작 초(있으면 구간 반복 재생)" },
      endSec: { type: "number", description: "클립 종료 초" },
      projectId: projectIdParam,
    },
    returns: "{ requested, resolved }",
    message: () => "재생을 요청했습니다.",
    danger: "inject",
    handler: async (p: any) => {
      const input = String(p?.inputUrl ?? "").trim();
      if (!input) return { ok: false, code: "INVALID_PARAMS", message: "inputUrl 필요" };
      const hasRange = Number.isFinite(p?.startSec) && Number.isFinite(p?.endSec) && p.endSec > p.startSec;
      sig(p).requestPlay({
        inputUrl: input,
        title: p?.title as string | undefined,
        startSec: hasRange ? Number(p.startSec) : undefined,
        endSec: hasRange ? Number(p.endSec) : undefined,
      });
      const resolved = await resolveUrl(input, spawn);
      return { requested: true, resolved };
    },
  });

  reg("clip.add", {
    description: "클립(시간 구간) 추가 — 같은 inputUrl 의 [startSec, endSec] 를 라이브러리에 저장(북마크).",
    params: {
      inputUrl: { type: "string", description: "원본 URL/경로", required: true },
      startSec: { type: "number", description: "시작 초", required: true },
      endSec: { type: "number", description: "종료 초", required: true },
      title: { type: "string", description: "제목(생략 시 자동)" },
      parentId: { type: "string", description: "부모 즐겨찾기 id(있으면)" },
      projectId: projectIdParam,
    },
    returns: "{ id, item }",
    message: (d: any) => `클립 "${d?.item?.title}" 을(를) 추가했습니다.`,
    handler: async (p: any) => {
      const inputUrl = String(p?.inputUrl ?? "").trim();
      const startSec = Number(p?.startSec);
      const endSec = Number(p?.endSec);
      if (!inputUrl || !Number.isFinite(startSec) || !Number.isFinite(endSec)) {
        return { ok: false, code: "INVALID_PARAMS", message: "inputUrl·startSec·endSec 필요" };
      }
      if (endSec <= startSec) return { ok: false, code: "INVALID_PARAMS", message: "endSec > startSec 이어야 함" };
      const c = classify(inputUrl);
      const title = String(p?.title ?? `${c.title} [${fmtTime(startSec, true)}–${fmtTime(endSec, true)}]`);
      const item = await addItem(data(), scopeFor(p), {
        kind: "clip",
        title,
        inputUrl,
        source: c.source,
        startSec,
        endSec,
        parentId: p?.parentId as string | undefined,
      });
      return { id: item.id, item };
    },
  });

  reg("clip.list", {
    description: "클립만 목록(라이브러리 kind=clip).",
    params: { projectId: projectIdParam },
    returns: "{ items, count }",
    message: (d: any) => `클립 ${d?.count ?? 0}개.`,
    handler: async (p: any) => {
      const items = (await loadLibrary(data(), scopeFor(p))).filter((i) => i.kind === "clip");
      return { items, count: items.length };
    },
  });

  reg("clip.update", {
    description: "클립 구간/제목 수정 — id 의 startSec/endSec/title 변경(초.00 정밀). 둘 다 줄 땐 end>start 필요.",
    params: {
      id: { type: "string", description: "클립 id", required: true },
      startSec: { type: "number", description: "새 시작 초(.00)" },
      endSec: { type: "number", description: "새 종료 초(.00)" },
      title: { type: "string", description: "새 제목(생략 시 유지)" },
      projectId: projectIdParam,
    },
    returns: "{ ok, item }",
    message: () => "클립을 수정했습니다.",
    handler: async (p: any) => {
      const id = String(p?.id ?? "");
      if (!id) return { ok: false, code: "INVALID_PARAMS", message: "id 필요" };
      const patch: Partial<LibraryItem> = {};
      if (Number.isFinite(p?.startSec)) patch.startSec = Number(p.startSec);
      if (Number.isFinite(p?.endSec)) patch.endSec = Number(p.endSec);
      if (typeof p?.title === "string") patch.title = p.title;
      if (patch.startSec != null && patch.endSec != null && patch.endSec <= patch.startSec) {
        return { ok: false, code: "INVALID_PARAMS", message: "endSec > startSec 이어야 함" };
      }
      const item = await patchItem(data(), scopeFor(p), id, patch);
      return item ? { ok: true, item } : { ok: false, code: "NOT_FOUND", message: "클립 없음" };
    },
  });

  reg("player.state", {
    description: "현재 플레이어 재생 상태 — { open, inputUrl, currentTime, duration, paused, clip, loop }. read-only.",
    params: { projectId: projectIdParam },
    returns: "{ open, ...PlayerState }",
    message: (d: any) => (d?.open ? "재생 중입니다." : "플레이어가 닫혀 있습니다."),
    handler: async (p: any) => {
      const s = sig(p).getPlayerState();
      return s ? { open: true, ...s } : { open: false };
    },
  });

  reg("player.control", {
    description: "플레이어 제어 — action: play|pause|seek|toggleLoop. seek 는 seconds(초.00) 필요. 열린 플레이어에 적용.",
    params: {
      action: { type: "string", description: "play | pause | seek | toggleLoop", required: true },
      seconds: { type: "number", description: "seek 대상 초(.00)" },
      projectId: projectIdParam,
    },
    returns: "{ ok }",
    message: () => "플레이어에 적용했습니다.",
    danger: "inject",
    handler: async (p: any) => {
      const action = String(p?.action ?? "");
      if (action !== "play" && action !== "pause" && action !== "seek" && action !== "toggleLoop") {
        return { ok: false, code: "INVALID_PARAMS", message: "action: play|pause|seek|toggleLoop" };
      }
      sig(p).requestControl({ action, seconds: Number.isFinite(p?.seconds) ? Number(p.seconds) : undefined });
      return { ok: true };
    },
  });

  reg("download", {
    description:
      "미디어를 로컬 mp4 로 저장 — 코어 프록시 경유 HLS/직접/로컬을 ffmpeg 로 묶음. 전체 또는 [startSec,endSec] 구간. yt-dlp 비개입(해석만). iframe(YouTube 해석 실패)은 저장 불가. ffmpeg 필요.",
    params: {
      inputUrl: { type: "string", description: "비디오 URL/경로", required: true },
      outPath: { type: "string", description: "저장 절대경로(.mp4)", required: true },
      startSec: { type: "number", description: "구간 시작 초(생략=전체)" },
      endSec: { type: "number", description: "구간 종료 초" },
    },
    returns: "{ ok, path }",
    message: (d: any) => `${d?.path} 에 저장했습니다.`,
    danger: "inject",
    handler: async (p: any) =>
      runDownload(app, spawn, {
        inputUrl: String(p?.inputUrl ?? ""),
        outPath: String(p?.outPath ?? ""),
        startSec: typeof p?.startSec === "number" ? p.startSec : undefined,
        endSec: typeof p?.endSec === "number" ? p.endSec : undefined,
      }),
  });

  reg("doctor", {
    description: "외부 의존성(yt-dlp, ffmpeg) 탐지·버전 보고. ready = yt-dlp 사용 가능 여부. read-only.",
    params: {},
    returns: "{ ytdlp:{found,version}, ffmpeg:{found,version}, ready }",
    message: (d: any) => (d?.ready ? "yt-dlp 사용 가능합니다." : "yt-dlp 를 찾지 못했습니다."),
    handler: async () => {
      const [ytdlp, ffmpeg] = await Promise.all([
        probe(spawn, "yt-dlp", ["--version"]),
        probe(spawn, "ffmpeg", ["-version"]),
      ]);
      return { ytdlp, ffmpeg, ready: ytdlp.found, note: ffmpeg.found ? undefined : "ffmpeg 는 download(전체/구간 저장)에만 필요 — 재생엔 불요" };
    },
  });

  reg("setup", {
    description:
      "yt-dlp/ffmpeg 설치 점검 및 설치. 기본은 계획만 반환(무엇이 없고 어떤 명령으로 설치하는지). install:true 면 실제 설치 시도.",
    params: { install: { type: "boolean", description: "true 면 실제 설치 실행(기본 false=계획만)" } },
    returns: "{ ytdlp, ffmpeg, actions, installed? }",
    message: (d: any) => (d?.installed ? "설치를 시도했습니다." : `설치 계획 ${(d?.actions ?? []).length}건.`),
    danger: "inject",
    handler: async (p: any) => {
      const doInstall = p?.install === true;
      const tools = ["yt-dlp", "ffmpeg"] as const;
      const result: Record<string, unknown> = {};
      const actions: { tool: string; cmd: string }[] = [];
      for (const tool of tools) {
        const found = await probe(spawn, tool, tool === "yt-dlp" ? ["--version"] : ["-version"]);
        if (found.found) {
          result[tool] = { found: true, version: found.version };
          continue;
        }
        const plan = platformInstall(tool);
        if (!plan) {
          result[tool] = { found: false, guidance: `${tool} 를 패키지 매니저로 설치하세요` };
          continue;
        }
        const cmdStr = `${plan.cmd} ${plan.args.join(" ")}`;
        actions.push({ tool, cmd: cmdStr });
        if (doInstall) {
          const r = await spawn(plan.cmd, plan.args).catch((e) => ({ code: 1, stdout: "", stderr: String(e) }));
          const after = await probe(spawn, tool, tool === "yt-dlp" ? ["--version"] : ["-version"]);
          result[tool] = { found: after.found, version: after.version, installExit: r.code };
        } else {
          result[tool] = { found: false, plan: cmdStr };
        }
      }
      return { ...result, actions, installed: doInstall };
    },
  });
}
