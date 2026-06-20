import { describe, it, expect } from "vitest";
import { buildFfmpegArgs, runDownload } from "./download";
import type { SpawnFn, SpawnResult } from "./resolve";

// ── buildFfmpegArgs: 순수(전체/구간/무효구간) ────────────────────────────────
describe("buildFfmpegArgs", () => {
  it("전체 → -i + -c copy (시킹 없음)", () => {
    expect(buildFfmpegArgs("SRC", "/o.mp4")).toEqual(["-y", "-i", "SRC", "-c", "copy", "/o.mp4"]);
  });
  it("구간 → -ss(입력측) + -t(길이) + -c copy", () => {
    expect(buildFfmpegArgs("SRC", "/o.mp4", 10, 18)).toEqual([
      "-y", "-ss", "10", "-i", "SRC", "-t", "8", "-c", "copy", "/o.mp4",
    ]);
  });
  it("무효 구간(end<=start) → 전체로 폴백", () => {
    expect(buildFfmpegArgs("SRC", "/o.mp4", 18, 10)).toEqual(["-y", "-i", "SRC", "-c", "copy", "/o.mp4"]);
  });
});

// ── runDownload: 오케스트레이션(네트워크 없이 fake spawn/app) ──────────────────
const okFfmpeg: SpawnFn = (cmd: string): Promise<SpawnResult> =>
  Promise.resolve({ code: cmd === "ffmpeg" ? 0 : 1, stdout: "", stderr: "" });

// media.proxy.info 를 주는 fake app(프록시 base 고정).
const fakeApp = {
  commands: { execute: (m: string) => (m === "media.proxy.info" ? Promise.resolve({ base: "http://127.0.0.1:9/tok" }) : Promise.resolve({})) },
};

describe("runDownload", () => {
  it("inputUrl 없음 → INVALID_PARAMS", async () => {
    const r = await runDownload(fakeApp, okFfmpeg, { inputUrl: "", outPath: "/o.mp4" });
    expect(r.ok).toBe(false);
    expect(r.code).toBe("INVALID_PARAMS");
  });
  it("outPath 없음 → INVALID_PARAMS", async () => {
    const r = await runDownload(fakeApp, okFfmpeg, { inputUrl: "https://x/a.mp4", outPath: "" });
    expect(r.ok).toBe(false);
    expect(r.code).toBe("INVALID_PARAMS");
  });
  it("직접 mp4 → ffmpeg 원본 URL 직접(-i), 성공", async () => {
    const calls: Array<{ cmd: string; args: string[] }> = [];
    const spy: SpawnFn = (cmd, args) => {
      calls.push({ cmd, args });
      return Promise.resolve({ code: 0, stdout: "", stderr: "" });
    };
    const r = await runDownload(fakeApp, spy, { inputUrl: "https://cdn.example/v/clip.mp4", outPath: "/out.mp4" });
    expect(r.ok).toBe(true);
    expect(r.path).toBe("/out.mp4");
    const ff = calls.find((c) => c.cmd === "ffmpeg");
    expect(ff).toBeTruthy();
    expect(ff!.args).toContain("https://cdn.example/v/clip.mp4"); // 비프록시 = 원본 직접
    expect(ff!.args.slice(-3)).toEqual(["-c", "copy", "/out.mp4"]);
  });
  it("HLS(m3u8) → 코어 프록시 URL 로 -i", async () => {
    const calls: Array<{ cmd: string; args: string[] }> = [];
    const spy: SpawnFn = (cmd, args) => {
      calls.push({ cmd, args });
      return Promise.resolve({ code: 0, stdout: "", stderr: "" });
    };
    const r = await runDownload(fakeApp, spy, { inputUrl: "https://cdn.example/v/play.m3u8", outPath: "/out.mp4" });
    expect(r.ok).toBe(true);
    const ff = calls.find((c) => c.cmd === "ffmpeg");
    const srcIdx = ff!.args.indexOf("-i") + 1;
    expect(ff!.args[srcIdx]).toContain("http://127.0.0.1:9/tok/m3u8?url="); // 프록시 경유
  });
  it("구간 다운로드 → -ss/-t 포함", async () => {
    const calls: Array<{ cmd: string; args: string[] }> = [];
    const spy: SpawnFn = (cmd, args) => {
      calls.push({ cmd, args });
      return Promise.resolve({ code: 0, stdout: "", stderr: "" });
    };
    await runDownload(fakeApp, spy, { inputUrl: "https://cdn.example/v/clip.mp4", outPath: "/out.mp4", startSec: 5, endSec: 12 });
    const ff = calls.find((c) => c.cmd === "ffmpeg")!;
    expect(ff.args).toContain("-ss");
    expect(ff.args).toContain("-t");
  });
  it("YouTube(yt-dlp 실패→iframe) → NO_STREAM(iframe 다운로드 불가)", async () => {
    // yt-dlp 실패 시뮬레이트(code 1) → resolveUrl 이 youtube(iframe) 로 폴백.
    const failYtdlp: SpawnFn = () => Promise.resolve({ code: 1, stdout: "", stderr: "no" });
    const r = await runDownload(fakeApp, failYtdlp, { inputUrl: "https://www.youtube.com/watch?v=abc123DEF45", outPath: "/o.mp4" });
    expect(r.ok).toBe(false);
    expect(r.code).toBe("NO_STREAM");
  });
  it("ffmpeg 실패(code≠0) → FFMPEG_FAILED", async () => {
    const failFf: SpawnFn = () => Promise.resolve({ code: 1, stdout: "", stderr: "boom" });
    const r = await runDownload(fakeApp, failFf, { inputUrl: "https://cdn.example/v/clip.mp4", outPath: "/o.mp4" });
    expect(r.ok).toBe(false);
    expect(r.code).toBe("FFMPEG_FAILED");
  });
});
