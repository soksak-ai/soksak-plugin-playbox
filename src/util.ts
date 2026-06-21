import { isLocal } from "@/resolve/local";
import { isDirectMedia } from "@/resolve/direct";
import { isYouTube, youTubeId } from "@/resolve/youtube";

// spawn 없이 입력을 빠르게 분류(즐겨찾기 추가 시 source/title 라벨용). 실제 해석은 재생 시 resolveUrl.
export function classify(input: string): { source: string; title: string } {
  const s = input.trim();
  if (isLocal(s)) return { source: "local", title: s.split(/[\\/]/).pop() || s };
  if (isDirectMedia(s)) return { source: "direct", title: s.split(/[?#]/)[0].split("/").pop() || s };
  if (isYouTube(s)) return { source: "youtube", title: "YouTube " + (youTubeId(s) ?? "") };
  if (/^https?:\/\//i.test(s)) {
    try {
      return { source: "page", title: new URL(s).hostname };
    } catch {
      return { source: "page", title: s };
    }
  }
  return { source: "none", title: s };
}

// 설정 map 값({key,value} 쌍 배열)을 {from,to} 로 정규화. 빈 행 무시.
export function parseDomainMap(entries: unknown): Array<{ from: string; to: string }> {
  const out: Array<{ from: string; to: string }> = [];
  if (!Array.isArray(entries)) return out;
  for (const e of entries) {
    if (!e || typeof e !== "object") continue;
    const from = String((e as { key?: unknown }).key ?? "").trim();
    const to = String((e as { value?: unknown }).value ?? "").trim();
    if (from && to) out.push({ from, to });
  }
  return out;
}

// URL 의 호스트를 매핑으로 치환(첫 일치, exact 또는 서브도메인). http(s) 아니면 그대로.
// 매핑은 전부 사용자 입력(소스에 사이트명 0) — 접속 차단 호스트를 접속 가능한 미러로.
export function applyDomainMap(url: string, pairs: Array<{ from: string; to: string }>): string {
  try {
    const u = new URL(url);
    for (const { from, to } of pairs) {
      if (!from || !to) continue;
      if (u.hostname === from || u.hostname.endsWith("." + from)) {
        u.hostname = u.hostname.slice(0, u.hostname.length - from.length) + to;
        return u.toString();
      }
    }
  } catch {
    /* 비 URL → 그대로 */
  }
  return url;
}

// 초 → m:ss / h:mm:ss. cs=true 면 .00(센티초)까지 — 클립 구간은 초 미만 정밀도로 표시/편집한다.
export function fmtTime(sec: number, cs = false): string {
  const v = Number.isFinite(sec) && sec > 0 ? sec : 0;
  const s = Math.floor(v % 60);
  const m = Math.floor((v / 60) % 60);
  const h = Math.floor(v / 3600);
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  const base = h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
  if (!cs) return base;
  const c = Math.round((v - Math.floor(v)) * 100);
  return `${base}.${String(c).padStart(2, "0")}`;
}

// fmtTime 역포맷 — "h:mm:ss.cs" / "m:ss.cs" / "ss.cs" → 초(소수 .00 포함). 잘못된 입력은 null.
export function parseTime(str: string): number | null {
  const s = String(str ?? "").trim();
  if (!s) return null;
  const parts = s.split(":");
  if (parts.length > 3) return null;
  let sec = 0;
  for (const p of parts) {
    if (p === "" || !Number.isFinite(Number(p))) return null;
    sec = sec * 60 + Number(p);
  }
  return Number.isFinite(sec) && sec >= 0 ? sec : null;
}

// 다운로드 폴더 — 설정값이 있으면 그것, 없으면 기본 {프로젝트 루트}/playbox/clip. 루트 없으면 상대.
export function downloadDir(app: { settings?: { get?: (k: string) => unknown }; project?: { current?: () => { root: string | null } | null } }): string {
  const set = String(app?.settings?.get?.("downloadDir") ?? "").trim();
  if (set) return set.replace(/\/+$/, "");
  const root = app?.project?.current?.()?.root;
  const base = typeof root === "string" && root ? root.replace(/\/+$/, "") : ".";
  return `${base}/playbox/clip`;
}
