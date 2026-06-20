import type { Resolved } from "@/types";

// 로컬 파일 — file:// 또는 절대 경로(POSIX / 또는 Windows 드라이브). 네트워크/yt-dlp 불필요.
export function isLocal(input: string): boolean {
  return (
    input.startsWith("file://") ||
    input.startsWith("/") ||
    /^[a-zA-Z]:[\\/]/.test(input)
  );
}

export function resolveLocal(input: string): Resolved {
  let filePath = input;
  if (input.startsWith("file://")) {
    try {
      filePath = decodeURIComponent(new URL(input).pathname);
    } catch {
      filePath = input.slice("file://".length);
    }
  }
  const title = filePath.split(/[\\/]/).pop() || filePath;
  return { kind: "file", filePath, title, source: "local" };
}
