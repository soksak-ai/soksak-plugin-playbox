import Hls from "hls.js";

// hls.js 부착 — 네이티브 HLS(Safari/WebKit) 우선, 아니면 hls.js. 정리 함수 반환.
export function attachHls(video: HTMLVideoElement, src: string): () => void {
  if (video.canPlayType("application/vnd.apple.mpegurl")) {
    video.src = src;
    return () => {
      video.removeAttribute("src");
      video.load();
    };
  }
  if (Hls.isSupported()) {
    const hls = new Hls({ enableWorker: true, lowLatencyMode: false });
    hls.loadSource(src);
    hls.attachMedia(video);
    return () => hls.destroy();
  }
  video.src = src;
  return () => {
    video.removeAttribute("src");
    video.load();
  };
}
