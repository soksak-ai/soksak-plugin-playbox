import { describe, it, expect } from "vitest";
import { resolveUrl, type SpawnFn } from "./index";
import { isLocal, resolveLocal } from "./local";
import { isDirectMedia, resolveDirect } from "./direct";
import { isYouTube, youTubeId, resolveYouTube } from "./youtube";
import { pickStream, resolveYtdlp, type YtInfo } from "./ytdlp";

// 픽스처는 전부 중립(example.com / 합성 yt-dlp JSON) — 대상 사이트명 비포함(R11).

describe("local", () => {
  it("detects file:// and absolute paths", () => {
    expect(isLocal("file:///Users/x/clip.mp4")).toBe(true);
    expect(isLocal("/var/media/a.mkv")).toBe(true);
    expect(isLocal("C:\\Videos\\a.mp4")).toBe(true);
    expect(isLocal("https://example.com/a.mp4")).toBe(false);
  });
  it("resolves file:// to a path + title", () => {
    const r = resolveLocal("file:///Users/x/My%20Clip.mp4");
    expect(r.kind).toBe("file");
    expect(r.filePath).toBe("/Users/x/My Clip.mp4");
    expect(r.title).toBe("My Clip.mp4");
  });
});

describe("direct media", () => {
  it("detects media extensions over http(s)", () => {
    expect(isDirectMedia("https://example.com/v/play.m3u8")).toBe(true);
    expect(isDirectMedia("https://example.com/v/clip.mp4?t=1")).toBe(true);
    expect(isDirectMedia("https://example.com/page")).toBe(false);
  });
  it("routes m3u8 to hls+proxy, mp4 to direct", () => {
    const hls = resolveDirect("https://example.com/v/play.m3u8");
    expect(hls.kind).toBe("hls");
    expect(hls.needsProxy).toBe(true);
    const mp4 = resolveDirect("https://example.com/v/clip.mp4");
    expect(mp4.kind).toBe("direct");
    expect(mp4.needsProxy).toBe(false);
  });
});

describe("youtube", () => {
  it("extracts id from watch / youtu.be / embed / shorts", () => {
    expect(youTubeId("https://www.youtube.com/watch?v=abc123DEF45")).toBe("abc123DEF45");
    expect(youTubeId("https://youtu.be/abc123DEF45")).toBe("abc123DEF45");
    expect(youTubeId("https://www.youtube.com/embed/abc123DEF45")).toBe("abc123DEF45");
    expect(youTubeId("https://www.youtube.com/shorts/abc123DEF45")).toBe("abc123DEF45");
  });
  it("resolves to an embed url", () => {
    expect(isYouTube("https://youtu.be/xy")).toBe(true);
    const r = resolveYouTube("https://www.youtube.com/watch?v=abc123DEF45");
    expect(r.kind).toBe("youtube");
    expect(r.embedUrl).toBe("https://www.youtube.com/embed/abc123DEF45");
  });
});

describe("ytdlp pickStream", () => {
  it("prefers combined HLS by bitrate", () => {
    const info: YtInfo = {
      http_headers: { Referer: "https://example.com/", "User-Agent": "UA/1" },
      formats: [
        { url: "https://cdn.example/low.m3u8", protocol: "m3u8_native", vcodec: "h264", acodec: "aac", tbr: 500 },
        { url: "https://cdn.example/high.m3u8", protocol: "m3u8_native", vcodec: "h264", acodec: "aac", tbr: 3000 },
        { url: "https://cdn.example/video-only.mp4", protocol: "https", vcodec: "h264", acodec: "none", tbr: 6000 },
      ],
    };
    const p = pickStream(info)!;
    expect(p.url).toBe("https://cdn.example/high.m3u8");
    expect(p.isHls).toBe(true);
    expect(p.headers.Referer).toBe("https://example.com/");
  });
  it("falls back to combined progressive when no combined HLS", () => {
    const info: YtInfo = {
      formats: [
        { url: "https://cdn.example/prog.mp4", protocol: "https", vcodec: "h264", acodec: "aac", tbr: 1200 },
        { url: "https://cdn.example/v.m3u8", protocol: "m3u8_native", vcodec: "h264", acodec: "none", tbr: 9000 },
      ],
    };
    const p = pickStream(info)!;
    expect(p.url).toBe("https://cdn.example/prog.mp4");
    expect(p.isHls).toBe(false);
  });
  it("uses top-level url when no usable formats", () => {
    const p = pickStream({ url: "https://cdn.example/single.m3u8", protocol: "m3u8" })!;
    expect(p.url).toBe("https://cdn.example/single.m3u8");
    expect(p.isHls).toBe(true);
  });
  it("returns null when nothing playable", () => {
    expect(pickStream({ formats: [] })).toBeNull();
  });
});

describe("resolveYtdlp", () => {
  const okSpawn = (json: object): SpawnFn => async () => ({ code: 0, stdout: JSON.stringify(json), stderr: "" });

  it("resolves a combined HLS to hls+proxy with referer", async () => {
    const r = await resolveYtdlp(
      "https://example.com/page",
      okSpawn({
        title: "Sample",
        http_headers: { Referer: "https://example.com/" },
        formats: [{ url: "https://cdn.example/v.m3u8", protocol: "m3u8_native", vcodec: "h264", acodec: "aac", tbr: 1000 }],
      }),
    );
    expect(r.kind).toBe("hls");
    expect(r.needsProxy).toBe(true);
    expect(r.referer).toBe("https://example.com/");
    expect(r.title).toBe("Sample");
  });
  it("surfaces yt-dlp non-zero exit as unsupported (R9)", async () => {
    const r = await resolveYtdlp("https://example.com/page", async () => ({ code: 1, stdout: "", stderr: "ERROR: unsupported URL" }));
    expect(r.kind).toBe("unsupported");
    expect(r.reason).toContain("unsupported URL");
  });
  it("surfaces bad JSON as unsupported", async () => {
    const r = await resolveYtdlp("https://example.com/page", async () => ({ code: 0, stdout: "not json", stderr: "" }));
    expect(r.kind).toBe("unsupported");
  });
});

describe("resolveUrl dispatch (single-pass)", () => {
  const noSpawn: SpawnFn = async () => {
    throw new Error("spawn unavailable");
  };
  const okSpawn = (json: object): SpawnFn => async () => ({ code: 0, stdout: JSON.stringify(json), stderr: "" });

  it("routes local/direct without spawning yt-dlp", async () => {
    expect((await resolveUrl("/a/b.mp4", noSpawn)).kind).toBe("file");
    expect((await resolveUrl("https://example.com/x.mp4", noSpawn)).kind).toBe("direct");
  });
  it("routes youtube through yt-dlp → real video (no iframe special-case)", async () => {
    const r = await resolveUrl(
      "https://youtu.be/abc123DEF45",
      okSpawn({
        title: "yt",
        formats: [{ url: "https://r.example/prog.mp4", protocol: "https", vcodec: "h264", acodec: "aac", tbr: 1000 }],
      }),
    );
    expect(r.source).toBe("youtube");
    expect(r.kind).toBe("direct");
    expect(r.mediaUrl).toBe("https://r.example/prog.mp4");
  });
  it("youtube falls back to iframe only when yt-dlp fails", async () => {
    const r = await resolveUrl("https://youtu.be/abc123DEF45", noSpawn);
    expect(r.kind).toBe("youtube");
    expect(r.embedUrl).toBe("https://www.youtube.com/embed/abc123DEF45");
  });
  it("routes arbitrary pages to yt-dlp", async () => {
    const r = await resolveUrl("https://example.com/some/page", okSpawn({ url: "https://cdn.example/v.m3u8", protocol: "m3u8" }));
    expect(r.source).toBe("ytdlp");
    expect(r.kind).toBe("hls");
  });
  it("rejects empty / unknown input", async () => {
    expect((await resolveUrl("   ", noSpawn)).kind).toBe("unsupported");
    expect((await resolveUrl("ftp://x/y", noSpawn)).kind).toBe("unsupported");
  });
});
