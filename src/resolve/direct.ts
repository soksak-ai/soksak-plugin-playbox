import type { Resolved } from "@/types";

// 직접 미디어 URL — 확장자로 판별. m3u8 만 HLS(hls.js); 나머지는 브라우저 native <video>.
const MEDIA_EXT = /\.(m3u8|mp4|m4v|webm|ogg|ogv|mov|mkv|ts|mpd)(\?|#|$)/i;

export function isDirectMedia(url: string): boolean {
  return /^https?:\/\//i.test(url) && MEDIA_EXT.test(url);
}

export function resolveDirect(url: string): Resolved {
  const isHls = /\.m3u8(\?|#|$)/i.test(url);
  const title = url.split(/[?#]/)[0].split("/").pop() || url;
  return {
    kind: isHls ? "hls" : "direct",
    mediaUrl: url,
    // HLS 는 세그먼트 CORS/리라이트 위해 프록시 경유; 직접 mp4 등은 그대로 재생 시도.
    needsProxy: isHls,
    title,
    source: "direct",
  };
}
