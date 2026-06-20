import type { Resolved } from "@/types";

// 주입 가능한 spawn 인터페이스(순수 테스트). 실 구현은 app.process.spawn 래퍼(commands 계층).
export interface SpawnResult {
  code: number;
  stdout: string;
  stderr: string;
}
export type SpawnFn = (cmd: string, args: string[]) => Promise<SpawnResult>;

export interface YtFormat {
  url?: string;
  manifest_url?: string;
  protocol?: string;
  vcodec?: string;
  acodec?: string;
  ext?: string;
  tbr?: number;
  http_headers?: Record<string, string>;
}
export interface YtInfo {
  title?: string;
  url?: string;
  protocol?: string;
  http_headers?: Record<string, string>;
  formats?: YtFormat[];
}

// stderr 에서 의미 있는 한 줄만 뽑는다 — 마지막 ERROR 줄 우선, 경고/버전 나그 무시.
export function cleanYtdlpError(stderr: string, code: number): string {
  const lines = stderr
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const errLine = [...lines].reverse().find((l) => /(^|\b)ERROR\b/i.test(l));
  const pick = errLine ?? lines[lines.length - 1] ?? `종료 코드 ${code}`;
  return pick.replace(/^ERROR:\s*/i, "").replace(/^\[[^\]]+\]\s*/, "").trim().slice(0, 280);
}

const isHlsProto = (p?: string, u?: string) =>
  (p || "").includes("m3u8") || (u || "").includes(".m3u8");
const isCombined = (f: YtFormat) =>
  !!f.vcodec && f.vcodec !== "none" && !!f.acodec && f.acodec !== "none";
const score = (f: YtFormat) => f.tbr || 0;

// yt-dlp -J 출력에서 단일 재생 가능 스트림 선택. 선호: 결합(오디오+비디오) HLS → 결합 프로그레시브 →
// top-level url → 임의 HLS 마스터(적응형은 hls.js 가 트랙 결합). 사이트 지식 0(yt-dlp 가 이미 추출).
// 순수 — 픽스처로 결정.
export function pickStream(
  info: YtInfo,
): { url: string; isHls: boolean; headers: Record<string, string> } | null {
  const base = info.http_headers || {};
  const wrap = (f: YtFormat, url: string, isHls: boolean) => ({
    url,
    isHls,
    headers: { ...base, ...(f.http_headers || {}) },
  });
  const fmts = (info.formats || []).filter((f) => f.url || f.manifest_url);
  const best = (pred: (f: YtFormat) => boolean) =>
    fmts.filter(pred).sort((a, b) => score(b) - score(a))[0];

  const combinedHls = best((f) => isCombined(f) && isHlsProto(f.protocol, f.url));
  if (combinedHls) return wrap(combinedHls, (combinedHls.url || combinedHls.manifest_url)!, true);

  const combinedProg = best((f) => isCombined(f) && !isHlsProto(f.protocol, f.url));
  if (combinedProg) return wrap(combinedProg, combinedProg.url!, false);

  if (info.url) {
    return { url: info.url, isHls: isHlsProto(info.protocol, info.url), headers: base };
  }

  const anyHls = best((f) => isHlsProto(f.protocol, f.url));
  if (anyHls) return wrap(anyHls, (anyHls.url || anyHls.manifest_url)!, true);

  return null;
}

// Cloudflare/anti-bot 의 연결 리셋·차단 추정 패턴(레거시가 curl --http1.1 로 우회하던 그 문제).
const BLOCK_RE = /connection reset|connection aborted|cloudflare|http error 40[39]|transporterror|timed out|forbidden|tls/i;
// curl_cffi 미설치로 --impersonate 가 불가한 경우.
const NO_IMPERSONATE_RE = /impersonate target.*not available|impersonation is not available|no impersonate|requires curl_cffi/i;

// 임의 페이지 URL → 미디어 URL+헤더. yt-dlp 에 site 지식 전부 위임(R2). 실패는 unsupported 로 표면화(R9).
// 리셋/차단 추정 시 --impersonate chrome 으로 1회 재시도(실제 브라우저 TLS 지문 = 레거시 curl 우회의 정공법).
export async function resolveYtdlp(
  input: string,
  spawn: SpawnFn,
  ytdlpPath = "yt-dlp",
): Promise<Resolved> {
  const unsupported = (reason: string): Resolved => ({ kind: "unsupported", reason, source: "ytdlp" });
  const base = ["-J", "--no-playlist", "--no-warnings"]; // --no-warnings: 노이즈 제거(ERROR 만)
  const run = (extra: string[]) => spawn(ytdlpPath, [...base, ...extra, input]);

  let res: SpawnResult;
  try {
    res = await run([]);
  } catch (e) {
    return unsupported(`yt-dlp 실행 실패: ${e instanceof Error ? e.message : String(e)}`);
  }

  if (res.code !== 0 && BLOCK_RE.test(res.stderr)) {
    let retry: SpawnResult | null = null;
    try {
      retry = await run(["--impersonate", "chrome"]);
    } catch {
      retry = null;
    }
    if (retry) {
      if (retry.code === 0) {
        res = retry;
      } else if (NO_IMPERSONATE_RE.test(retry.stderr)) {
        return unsupported(
          `${cleanYtdlpError(res.stderr, res.code)} — Cloudflare 차단 추정. setup 으로 curl_cffi 설치 후 재시도(yt-dlp --impersonate)`,
        );
      } else {
        res = retry; // 위장으로도 실패 → 그 에러 표면화
      }
    }
  }
  if (res.code !== 0) {
    return unsupported(`yt-dlp: ${cleanYtdlpError(res.stderr, res.code)}`);
  }
  let info: YtInfo;
  try {
    info = JSON.parse(res.stdout) as YtInfo;
  } catch {
    return { kind: "unsupported", reason: "yt-dlp JSON 파싱 실패", source: "ytdlp" };
  }
  const picked = pickStream(info);
  if (!picked) {
    return { kind: "unsupported", reason: "재생 가능한 스트림 없음", source: "ytdlp" };
  }
  const referer = picked.headers["Referer"] || picked.headers["referer"];
  const userAgent = picked.headers["User-Agent"] || picked.headers["user-agent"];
  return {
    kind: picked.isHls ? "hls" : "direct",
    mediaUrl: picked.url,
    needsProxy: true, // yt-dlp 해석 미디어는 보통 Referer/CORS 보호 → 프록시 경유.
    referer,
    userAgent,
    title: info.title,
    source: "ytdlp",
  };
}
