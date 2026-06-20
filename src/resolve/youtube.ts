import type { Resolved } from "@/types";

// YouTube 는 iframe 임베드(표준·합법 재생 경로). URL 패턴 인식뿐이며 스크래핑/난독화 지식 아님(R2 예외).
const YT_HOST = /(^|\.)(youtube\.com|youtu\.be|youtube-nocookie\.com)$/i;

export function isYouTube(input: string): boolean {
  try {
    return YT_HOST.test(new URL(input).hostname);
  } catch {
    return false;
  }
}

export function youTubeId(input: string): string | null {
  try {
    const u = new URL(input);
    if (/(^|\.)youtu\.be$/i.test(u.hostname)) {
      return u.pathname.slice(1).split("/")[0] || null;
    }
    if (u.pathname === "/watch" || u.pathname.startsWith("/watch")) {
      return u.searchParams.get("v");
    }
    const m = u.pathname.match(/\/(embed|shorts|v|live)\/([^/?#]+)/);
    return m ? m[2] : null;
  } catch {
    return null;
  }
}

export function resolveYouTube(input: string): Resolved {
  const id = youTubeId(input);
  if (!id) {
    return { kind: "unsupported", reason: "YouTube 영상 ID 추출 실패", source: "youtube" };
  }
  return {
    kind: "youtube",
    embedUrl: `https://www.youtube.com/embed/${id}`,
    title: `YouTube ${id}`,
    source: "youtube",
  };
}
