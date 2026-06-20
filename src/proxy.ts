import type { Resolved } from "@/types";

// needsProxy 미디어 → 코어 미디어 프록시 URL. 코어 미반영이면 원본 직접(fallback). 재생·다운로드 공통
// 단일 진실(inline 재정의 금지) — PlayerView 와 download 가 같이 쓴다. m3u8=재귀 리라이트, 그 외=stream.
//
// omitUa: ua 쿼리 파라미터를 생략한다. UA 값은 공백·괄호를 담아 ffmpeg 의 URL 파서를 깨뜨린다(curl 은
// 관대, ffmpeg 는 "Invalid data found"로 입력 자체를 못 엶 — 라이브로 격리 확인). 다운로드(ffmpeg)는
// UA 헤더를 직접 못 실으므로 ua 를 빼고 프록시 DEFAULT_UA 에 맡긴다(YouTube 등 검증됨). 재생(webview
// hls.js)은 UA 가 forbidden header 라 ua 쿼리로만 실을 수 있어 유지한다.
export async function proxiedUrl(app: any, r: Resolved, opts?: { omitUa?: boolean }): Promise<string> {
  if (!r.needsProxy || !r.mediaUrl) return r.mediaUrl ?? "";
  try {
    const out = await app.commands.execute("media.proxy.info");
    const base = out?.base ?? out?.result?.base;
    if (!base) return r.mediaUrl;
    const kind = r.kind === "hls" ? "m3u8" : "stream";
    let u = `${base}/${kind}?url=${encodeURIComponent(r.mediaUrl)}`;
    if (r.referer) u += `&referer=${encodeURIComponent(r.referer)}`;
    if (r.userAgent && !opts?.omitUa) u += `&ua=${encodeURIComponent(r.userAgent)}`;
    return u;
  } catch {
    return r.mediaUrl;
  }
}
