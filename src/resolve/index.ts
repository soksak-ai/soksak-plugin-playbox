import type { Resolved } from "@/types";
import { isLocal, resolveLocal } from "./local";
import { isDirectMedia, resolveDirect } from "./direct";
import { isYouTube, resolveYouTube } from "./youtube";
import { resolveYtdlp, type SpawnFn } from "./ytdlp";

export type { SpawnFn, SpawnResult } from "./ytdlp";

// 단일패스 디스패치(R10). 사이트 지식 0(R2/R11) — 임의 http(s) 페이지(YouTube 포함)는 전부 yt-dlp 위임.
// 로컬/직접 미디어만 yt-dlp 불필요. YouTube 도 특수취급 없이 yt-dlp → 진짜 <video>(클립 가능). yt-dlp
// 해석 실패 시에만 iframe 임베드로 폴백(재생 자체는 보장).
export async function resolveUrl(
  input: string,
  spawn: SpawnFn,
  ytdlpPath?: string,
): Promise<Resolved> {
  const s = input.trim();
  if (!s) return { kind: "unsupported", reason: "빈 입력", source: "none" };
  if (isLocal(s)) return resolveLocal(s);
  if (isDirectMedia(s)) return resolveDirect(s);
  if (isYouTube(s)) {
    const r = await resolveYtdlp(s, spawn, ytdlpPath);
    if (r.kind !== "unsupported") return { ...r, source: "youtube" };
    return resolveYouTube(s); // yt-dlp 실패 → iframe 폴백
  }
  if (/^https?:\/\//i.test(s)) return resolveYtdlp(s, spawn, ytdlpPath);
  return { kind: "unsupported", reason: "지원하지 않는 입력 형식", source: "none" };
}
