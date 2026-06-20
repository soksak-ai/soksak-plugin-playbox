import { resolveUrl, type SpawnFn } from "@/resolve";
import { applyDomainMap, parseDomainMap } from "@/util";
import { resolveViaWebview, resolveViaWebviewHidden, resolveViaIframe } from "@/webview-resolve";
import type { Resolved } from "@/types";

// 전체 해석(R10 2경로) — 재생·다운로드 공통 단일진실(inline 중복 금지). (1) 도메인매핑(설정·사이트지식 0,
// R13) → (2) yt-dlp/직접/youtube/로컬, 실패 시 (3) http(s) 페이지는 WebKit webview 로드 + 코어 미디어
// 스니프(yt-dlp 가 못 뚫는 Cloudflare anti-bot·SNI 차단을 실 브라우저가 통과). extractMode 설정:
// hidden=오프스크린(기본·깔끔), tab=보이는 탭(페이지가 재생 클릭을 요구할 때 사용자 개입).
export async function resolveFull(
  app: any,
  raw: string,
  spawn: SpawnFn,
): Promise<{ resolved: Resolved; input: string }> {
  const input = applyDomainMap(raw, parseDomainMap(app?.settings?.get?.("domainMap")));
  let resolved = await resolveUrl(input, spawn);
  if (resolved.kind === "unsupported" && /^https?:\/\//i.test(input)) {
    const tmo = Number(app?.settings?.get?.("sniffTimeoutMs") ?? 15000);
    const mode = String(app?.settings?.get?.("extractMode") ?? "hidden");
    resolved =
      mode === "tab"
        ? await resolveViaWebview(app, input, tmo)
        : await resolveViaWebviewHidden(app, input, tmo);
    // sniff 도 실패하면(미디어가 중첩 iframe 안) iframe src 에서 미디어 URL 추출.
    if (resolved.kind === "unsupported") {
      resolved = await resolveViaIframe(app, input, tmo);
    }
  }
  return { resolved, input };
}
