// Playbox 도메인 타입. 사이트 지식 0(R2/R11) — 소스별 분기는 yt-dlp(코드 밖)에 위임.

export type SourceKind = "file" | "direct" | "hls" | "youtube" | "unsupported";

// 입력 URL 1회 해석 결과(단일패스, R10). play 경로가 이걸로 재생 방식을 정한다.
export interface Resolved {
  kind: SourceKind;
  source: string; // "local" | "direct" | "youtube" | "ytdlp" | "none"
  title?: string;
  // file
  filePath?: string;
  // direct | hls
  mediaUrl?: string;
  needsProxy?: boolean; // 코어 미디어 프록시 경유 여부(Referer/CORS 보호 미디어)
  referer?: string;
  userAgent?: string;
  // youtube
  embedUrl?: string;
  // unsupported
  reason?: string;
}

export type ItemKind = "favorite" | "clip";
export type DownloadStatus = "none" | "downloading" | "done" | "error";

// 라이브러리 단일 행타입 — 즐겨찾기 + 클립을 한 필터 목록으로(요구사항). 다운로드물은 filePath 채워짐.
export interface LibraryItem {
  id: string;
  kind: ItemKind;
  title: string;
  inputUrl: string;
  source: string;
  parentId?: string; // clip: 부모 즐겨찾기 id(있으면)
  startSec?: number; // clip
  endSec?: number; // clip
  filePath?: string; // 다운로드물(전체/클립)의 로컬 경로
  status?: DownloadStatus;
  favorite: number; // 1
  createdAt: number;
}

// 입력URL↔해석URL 매핑 캐시(단일패스 메모이즈).
export interface ResolvedCache {
  id: string;
  inputUrl: string;
  kind: SourceKind;
  source: string;
  mediaUrl?: string;
  embedUrl?: string;
  filePath?: string;
  needsProxy?: boolean;
  referer?: string;
  userAgent?: string;
  createdAt: number;
}
