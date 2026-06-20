// 다운로드 — 해석(resolveUrl) → 코어 프록시 URL(또는 로컬/직접) → ffmpeg 로 mp4 묶음(전체/구간).
// yt-dlp 는 개입 안 함(YouTube 해석에만). 어떤 사이트든 프록시를 통과한 HLS 면 같은 경로로 저장된다(R3).
// 차단 사이트는 webview-sniff 가 준 m3u8 이 needsProxy → 프록시 → 여기로 들어와 저장됨.
import { type SpawnFn } from "@/resolve";
import { resolveFull } from "@/resolveFull";
import { proxiedUrl } from "@/proxy";

export interface DownloadOpts {
  inputUrl: string;
  outPath: string;
  startSec?: number;
  endSec?: number;
}

export interface DownloadResult {
  ok: boolean;
  path?: string;
  code?: string;
  message?: string;
}

// ffmpeg 인자 — 전체면 -i + -c copy(재인코딩 0). 구간이면 입력측 -ss(빠른 시킹) + -t(길이).
// -c copy 라 키프레임 경계 시킹(v1 충분). 무효 구간(end<=start)은 전체로 폴백.
export function buildFfmpegArgs(src: string, outPath: string, startSec?: number, endSec?: number): string[] {
  const a = ["-y"];
  const clip =
    typeof startSec === "number" &&
    typeof endSec === "number" &&
    Number.isFinite(startSec) &&
    Number.isFinite(endSec) &&
    endSec > startSec;
  if (clip) a.push("-ss", String(startSec));
  a.push("-i", src);
  if (clip) a.push("-t", String((endSec as number) - (startSec as number)));
  a.push("-c", "copy", outPath);
  return a;
}

export async function runDownload(app: any, spawn: SpawnFn, opts: DownloadOpts): Promise<DownloadResult> {
  const input = String(opts?.inputUrl ?? "").trim();
  const outPath = String(opts?.outPath ?? "").trim();
  if (!input) return { ok: false, code: "INVALID_PARAMS", message: "inputUrl 필요" };
  if (!outPath) return { ok: false, code: "INVALID_PARAMS", message: "outPath 필요" };

  // 재생과 동일 해석(yt-dlp → webview 폴백) — Cloudflare/SNI 사이트도 webview 스니프로 닿는다.
  const { resolved: r } = await resolveFull(app, input, spawn);
  // iframe 임베드(YouTube yt-dlp 해석 실패 폴백)는 다운로드할 스트림이 없음 — 정직하게 거부(R9).
  if (r.kind === "youtube") {
    return { ok: false, code: "NO_STREAM", message: "iframe 임베드는 다운로드 불가(스트림 URL 없음)" };
  }
  const hasMedia = Boolean(r.mediaUrl) || Boolean(r.filePath);
  if (r.kind === "unsupported" || !hasMedia) {
    return { ok: false, code: "NO_STREAM", message: r.reason ?? "다운로드할 스트림을 찾지 못함" };
  }

  // 로컬 파일은 그대로, 그 외는 프록시 경유(needsProxy) 또는 원본 직접(needsProxy=false).
  // omitUa: ffmpeg URL 파서가 ua(공백/괄호)에서 깨지므로 다운로드는 ua 생략(프록시 DEFAULT_UA 사용).
  const src = r.filePath ? r.filePath : await proxiedUrl(app, r, { omitUa: true });
  const args = buildFfmpegArgs(src, outPath, opts.startSec, opts.endSec);
  const res = await spawn("ffmpeg", args).catch((e) => ({ code: 1, stdout: "", stderr: String(e) }));
  if (res.code !== 0) {
    return { ok: false, code: "FFMPEG_FAILED", message: (res.stderr || "").slice(-400) || "ffmpeg 실패" };
  }
  return { ok: true, path: outPath };
}
