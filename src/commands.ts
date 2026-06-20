// Playbox 커맨드 표면 — 모든 기능을 registry 로 노출(R1). 같은 코드 경로를 CLI/MCP/UI 가 공유.
// 사이트 지식 0(R2) — 해석은 resolveUrl(yt-dlp 위임). 라이브러리는 app.data 만(R4).
import { resolveUrl, type SpawnFn } from "@/resolve";
import { makeSpawn } from "@/spawn";
import { classify, fmtTime } from "@/util";
import type { LibraryStore } from "@/store";

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

export function registerCommands(ctx: any, store: LibraryStore, app: any): void {
  const spawn = makeSpawn(app);
  const reg = (name: string, spec: Record<string, unknown>) =>
    ctx.subscriptions.push(app.commands.register(name, spec));

  reg("favorite.add", {
    description: "URL 을 즐겨찾기로 라이브러리에 추가(해석은 재생 시). inputUrl 필수.",
    params: {
      inputUrl: { type: "string", description: "비디오 URL 또는 파일 경로", required: true },
      title: { type: "string", description: "표시 제목(생략 시 자동)" },
    },
    returns: "{ id, item }",
    handler: async (p: any) => {
      const input = String(p?.inputUrl ?? "").trim();
      if (!input) return { ok: false, code: "INVALID_PARAMS", message: "inputUrl 필요" };
      const c = classify(input);
      const item = await store.add({
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
    params: { id: { type: "string", description: "항목 id", required: true } },
    returns: "{ removed }",
    danger: "destructive",
    handler: async (p: any) => ({ removed: await store.remove(String(p?.id ?? "")) }),
  });

  reg("library.list", {
    description: "라이브러리 목록(즐겨찾기+클립). kind 로 좁힌다(favorite|clip).",
    params: { kind: { type: "string", description: "favorite | clip (생략=전체)" } },
    returns: "{ items, count }",
    handler: async (p: any) => {
      const kind = p?.kind as string | undefined;
      const items = store.get().filter((i) => !kind || i.kind === kind);
      return { items, count: items.length };
    },
  });

  reg("library.filter", {
    description: "라이브러리 필터 — CJK 전문검색(title/inputUrl) + kind 종류. 단일 목록.",
    params: {
      text: { type: "string", description: "검색어(빈 값=전체)" },
      kind: { type: "string", description: "favorite | clip" },
    },
    returns: "{ items, count }",
    handler: async (p: any) => {
      let items = await store.search(String(p?.text ?? ""));
      const kind = p?.kind as string | undefined;
      if (kind) items = items.filter((i) => i.kind === kind);
      return { items, count: items.length };
    },
  });

  reg("resolve", {
    description: "입력 URL 1회 해석 → {kind, mediaUrl|embedUrl|filePath, needsProxy, referer}. 임의 페이지는 yt-dlp 위임.",
    params: { inputUrl: { type: "string", description: "비디오 URL/경로", required: true } },
    returns: "Resolved",
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
    },
    returns: "{ requested, resolved }",
    danger: "inject",
    handler: async (p: any) => {
      const input = String(p?.inputUrl ?? "").trim();
      if (!input) return { ok: false, code: "INVALID_PARAMS", message: "inputUrl 필요" };
      store.requestPlay({ inputUrl: input, title: p?.title as string | undefined });
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
    },
    returns: "{ id, item }",
    handler: async (p: any) => {
      const inputUrl = String(p?.inputUrl ?? "").trim();
      const startSec = Number(p?.startSec);
      const endSec = Number(p?.endSec);
      if (!inputUrl || !Number.isFinite(startSec) || !Number.isFinite(endSec)) {
        return { ok: false, code: "INVALID_PARAMS", message: "inputUrl·startSec·endSec 필요" };
      }
      if (endSec <= startSec) return { ok: false, code: "INVALID_PARAMS", message: "endSec > startSec 이어야 함" };
      const c = classify(inputUrl);
      const title = String(p?.title ?? `${c.title} [${fmtTime(startSec)}–${fmtTime(endSec)}]`);
      const item = await store.add({
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
    params: {},
    returns: "{ items, count }",
    handler: async () => {
      const items = store.get().filter((i) => i.kind === "clip");
      return { items, count: items.length };
    },
  });

  reg("doctor", {
    description: "외부 의존성(yt-dlp, ffmpeg) 탐지·버전 보고. ready = yt-dlp 사용 가능 여부. read-only.",
    params: {},
    returns: "{ ytdlp:{found,version}, ffmpeg:{found,version}, ready }",
    handler: async () => {
      const [ytdlp, ffmpeg] = await Promise.all([
        probe(spawn, "yt-dlp", ["--version"]),
        probe(spawn, "ffmpeg", ["-version"]),
      ]);
      return { ytdlp, ffmpeg, ready: ytdlp.found, note: ffmpeg.found ? undefined : "ffmpeg 는 다운로드/클립컷에만 필요" };
    },
  });

  reg("setup", {
    description:
      "yt-dlp/ffmpeg 설치 점검 및 설치. 기본은 계획만 반환(무엇이 없고 어떤 명령으로 설치하는지). install:true 면 실제 설치 시도.",
    params: { install: { type: "boolean", description: "true 면 실제 설치 실행(기본 false=계획만)" } },
    returns: "{ ytdlp, ffmpeg, actions, installed? }",
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
