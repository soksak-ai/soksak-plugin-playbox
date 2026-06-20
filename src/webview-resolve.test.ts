import { describe, it, expect } from "vitest";
import { mediaFromEmbedSrc, pickEmbedMedia } from "./webview-resolve";

// 픽스처는 전부 중립(example/cdn.example) — 대상 사이트명 비포함(R11).
describe("mediaFromEmbedSrc — embed 플레이어 src 에서 미디어 URL", () => {
  it("iframe src 의 url= 파라미터에 박힌 mp4 추출", () => {
    const src = "https://player.example/embed.php?url=https://cdn.example/v/clip.mp4";
    expect(mediaFromEmbedSrc(src)).toBe("https://cdn.example/v/clip.mp4");
  });
  it("url= 값이 한 번 더 인코딩돼도 추출", () => {
    const src = "https://player.example/p.php?url=" + encodeURIComponent("https://cdn.example/a%20b/clip.mp4");
    expect(mediaFromEmbedSrc(src)).toContain("cdn.example");
    expect(mediaFromEmbedSrc(src)).toMatch(/\.mp4$/);
  });
  it("src 자체가 m3u8 이면 그대로", () => {
    expect(mediaFromEmbedSrc("https://cdn.example/v/play.m3u8")).toBe("https://cdn.example/v/play.m3u8");
  });
  it("미디어 아닌 iframe(광고/소셜) → null", () => {
    expect(mediaFromEmbedSrc("https://ads.example/banner.html?id=5")).toBeNull();
    expect(mediaFromEmbedSrc("https://www.youtube.com/embed/abc")).toBeNull();
  });
  it("빈/비문자열 → null", () => {
    expect(mediaFromEmbedSrc("")).toBeNull();
    expect(mediaFromEmbedSrc(undefined as never)).toBeNull();
  });
});

describe("pickEmbedMedia — 수집 src 목록에서 첫 미디어", () => {
  it("광고 iframe 들 사이의 미디어 url= 를 고른다", () => {
    const srcs = [
      "https://ads.example/a.html",
      "https://player.example/e.php?url=https://cdn.example/x.mp4",
      "https://cdn.example/y.m3u8",
    ];
    expect(pickEmbedMedia(srcs)).toBe("https://cdn.example/x.mp4");
  });
  it("미디어 없으면 null", () => {
    expect(pickEmbedMedia(["https://ads.example/a.html"])).toBeNull();
    expect(pickEmbedMedia("nope" as never)).toBeNull();
  });
});
