import type { Resolved } from "@/types";

// needsProxy 미디어 → 코어 미디어 프록시 URL. 코어 미반영이면 원본 직접(fallback). 재생·다운로드 공통
// 단일 진실(inline 재정의 금지) — PlayerView 와 download 가 같이 쓴다. m3u8=재귀 리라이트, 그 외=stream.
export async function proxiedUrl(app: any, r: Resolved): Promise<string> {
  if (!r.needsProxy || !r.mediaUrl) return r.mediaUrl ?? "";
  try {
    const out = await app.commands.execute("media.proxy.info");
    const base = out?.base ?? out?.result?.base;
    if (!base) return r.mediaUrl;
    const kind = r.kind === "hls" ? "m3u8" : "stream";
    let u = `${base}/${kind}?url=${encodeURIComponent(r.mediaUrl)}`;
    if (r.referer) u += `&referer=${encodeURIComponent(r.referer)}`;
    if (r.userAgent) u += `&ua=${encodeURIComponent(r.userAgent)}`;
    return u;
  } catch {
    return r.mediaUrl;
  }
}
