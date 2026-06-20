import type { Resolved } from "@/types";

// webview 경로 해석(R10 경로 2) — yt-dlp 가 못 뚫는 사이트(네트워크 SNI 차단·난독)를 WebKit 브라우저로
// 로드해, 페이지가 스스로 요청하는 m3u8 을 코어 미디어 스니프로 가로챈다. 사이트 지식·디코드 0(R2/R3):
// 코어 browser.media.sniff 는 패턴만 받고 어떤 사이트도 모른다. 추출은 가시 브라우저 탭에서 일어나
// 사용자가 필요 시 개입(재생 클릭·캡차)할 수 있다(R9 — 숨김 마법 아님).

interface SniffHit {
  url: string;
  via?: string;
  ref?: string;
}

// 코어 execute 결과는 {ok, result?} 또는 직접 객체일 수 있어 평탄화.
function unwrap(out: any): any {
  if (out && typeof out === "object" && "result" in out && out.result !== undefined) return out.result;
  return out;
}

// 여러 m3u8 중 변형(variant)보다 마스터 우선이 안전(hls.js 가 트랙 선택). 휴리스틱 — 가장 짧은 경로 깊이.
function pickBest(urls: SniffHit[]): SniffHit | null {
  const m3u8 = urls.filter((u) => /\.m3u8(\?|#|$)/i.test(u.url));
  const pool = m3u8.length ? m3u8 : urls;
  if (!pool.length) return null;
  return pool.slice().sort((a, b) => a.url.split("/").length - b.url.split("/").length)[0];
}

function originOf(url: string): string {
  try {
    return new URL(url).origin + "/";
  } catch {
    return "";
  }
}

// embed 플레이어 src 에서 미디어 URL 추출(사이트 무관, R2) — 임베드는 보통 iframe/source src 의 쿼리
// 파라미터(url=, file=, src= 등)에 실제 미디어 URL 을 담는다. 패턴은 "값이 미디어 URL 인가"만 본다.
const MEDIA_RE = /\.(m3u8|mp4|m4v|webm|ogg|ogv|mov|mkv|ts|mpd)(\?|#|$)/i;
export function mediaFromEmbedSrc(src: string): string | null {
  if (typeof src !== "string" || !src) return null;
  // 1) src 자체가 미디어 URL(경로가 미디어 확장자로 끝남 — 쿼리에 박힌 url= 는 #2 에서). 쿼리 제외 검사.
  if (/^https?:\/\//i.test(src) && MEDIA_RE.test(src.split(/[?#]/)[0])) return src;
  // 2) src 의 쿼리 파라미터 값이 미디어 URL(평문/한 번 더 인코딩 모두).
  try {
    const u = new URL(src);
    for (const [, v] of u.searchParams) {
      if (/^https?:\/\//i.test(v) && MEDIA_RE.test(v)) return v;
      try {
        const dv = decodeURIComponent(v);
        if (/^https?:\/\//i.test(dv) && MEDIA_RE.test(dv)) return dv;
      } catch {
        /* malformed % — 무시 */
      }
    }
  } catch {
    /* URL 파싱 불가 — 무시 */
  }
  return null;
}

// 수집된 src 목록에서 첫 미디어 URL.
export function pickEmbedMedia(srcs: unknown): string | null {
  if (!Array.isArray(srcs)) return null;
  for (const s of srcs) {
    const m = mediaFromEmbedSrc(String(s));
    if (m) return m;
  }
  return null;
}

// 숨김 추출 — 코어 오프스크린 추출 커맨드 1회 호출(보이는 탭 0). 사이트 무관(R3).
export async function resolveViaWebviewHidden(
  app: any,
  url: string,
  timeoutMs: number,
): Promise<Resolved> {
  try {
    const out = unwrap(await app.commands.execute("browser.media.extract", { url, timeoutMs }));
    const urls: SniffHit[] = Array.isArray(out?.urls) ? out.urls : [];
    const best = pickBest(urls);
    if (!best) {
      return {
        kind: "unsupported",
        reason: "스트림을 찾지 못했습니다(숨김 추출). 설정에서 추출 방식을 '탭'으로 바꾸면 페이지에서 직접 재생을 눌러볼 수 있습니다.",
        source: "webview",
      };
    }
    const isHls = /\.m3u8(\?|#|$)/i.test(best.url);
    return { kind: isHls ? "hls" : "direct", mediaUrl: best.url, needsProxy: true, referer: originOf(url), source: "webview" };
  } catch (e) {
    return { kind: "unsupported", reason: `숨김 추출 실패: ${e instanceof Error ? e.message : String(e)}`, source: "webview" };
  }
}

// 보이는 탭 추출 — 페이지가 재생 클릭을 요구하는 사이트용(사용자 개입 가능, R9).
export async function resolveViaWebview(
  app: any,
  url: string,
  timeoutMs: number,
): Promise<Resolved> {
  let viewId: string | null = null;
  try {
    const opened = unwrap(await app.commands.execute("browser.open", { url, where: "panel" }));
    viewId = opened?.viewId ?? opened?.view?.id ?? null;
    if (!viewId) {
      return { kind: "unsupported", reason: "브라우저 뷰를 열지 못함", source: "webview" };
    }
    const sniffed = unwrap(
      await app.commands.execute("browser.media.sniff", {
        view: viewId,
        pattern: "m3u8|mp4|mpd",
        timeoutMs,
        autoplay: true,
      }),
    );
    const urls: SniffHit[] = Array.isArray(sniffed?.urls) ? sniffed.urls : [];
    const best = pickBest(urls);
    if (!best) {
      // 탭은 열어둔 채로 — 사용자가 직접 재생을 눌러 스트림을 띄울 수 있음(R9).
      return {
        kind: "unsupported",
        reason: "스트림을 찾지 못했습니다. 열린 브라우저 탭에서 재생을 누른 뒤 다시 시도하세요.",
        source: "webview",
      };
    }
    const isHls = /\.m3u8(\?|#|$)/i.test(best.url);
    // 추출 성공 → 추출용 브라우저 탭은 닫는다(깔끔한 재생은 플레이어에서).
    if (viewId) await app.commands.execute("view.close", { view: viewId }).catch(() => {});
    return {
      kind: isHls ? "hls" : "direct",
      mediaUrl: best.url,
      needsProxy: true,
      referer: originOf(url),
      title: undefined,
      source: "webview",
    };
  } catch (e) {
    return {
      kind: "unsupported",
      reason: `webview 추출 실패: ${e instanceof Error ? e.message : String(e)}`,
      source: "webview",
    };
  }
}

// iframe 임베드 추출(R10 보조경로) — sniff 가 못 잡는 중첩 iframe 플레이어용. 미디어가 페이지가 아니라
// iframe 안(또는 iframe src 의 url= 파라미터)에 있어 sniff 훅이 못 본다. 페이지를 webview 로 로드해
// (Cloudflare/SNI 통과) iframe/video/source 의 src 를 읽어 미디어 URL 을 뽑는다. 재생은 안 하므로 짧게
// 폴링(iframe 은 HTML 에 즉시 존재). referer=페이지origin → 직접 미디어라도 프록시가 hotlink 헤더 주입.
export async function resolveViaIframe(app: any, url: string, timeoutMs: number): Promise<Resolved> {
  let viewId: string | null = null;
  try {
    const opened = unwrap(await app.commands.execute("browser.open", { url, where: "panel" }));
    viewId = opened?.viewId ?? opened?.view?.id ?? null;
    if (!viewId) return { kind: "unsupported", reason: "브라우저 뷰를 열지 못함", source: "webview" };
    const js =
      "var out=[];document.querySelectorAll('iframe').forEach(function(f){if(f.src)out.push(f.src)});" +
      "document.querySelectorAll('video,source').forEach(function(v){var s=v.currentSrc||v.src;if(s)out.push(s)});" +
      "return JSON.stringify(out)";
    const deadline = Date.now() + Math.max(3000, timeoutMs);
    let media: string | null = null;
    while (Date.now() < deadline) {
      const res = unwrap(await app.commands.execute("browser.eval", { view: viewId, js }).catch(() => null));
      let srcs: unknown = [];
      try {
        srcs = JSON.parse(typeof res === "string" ? res : (res && (res.result as string)) || "[]");
      } catch {
        srcs = [];
      }
      media = pickEmbedMedia(srcs);
      if (media) break;
      await new Promise((r) => setTimeout(r, 1500));
    }
    if (viewId) await app.commands.execute("view.close", { view: viewId }).catch(() => {});
    viewId = null;
    if (!media) {
      return { kind: "unsupported", reason: "iframe/임베드에서 미디어 URL 을 찾지 못함", source: "webview" };
    }
    const isHls = /\.m3u8(\?|#|$)/i.test(media);
    return { kind: isHls ? "hls" : "direct", mediaUrl: media, needsProxy: true, referer: originOf(url), source: "webview" };
  } catch (e) {
    if (viewId) await app.commands.execute("view.close", { view: viewId }).catch(() => {});
    return { kind: "unsupported", reason: `iframe 추출 실패: ${e instanceof Error ? e.message : String(e)}`, source: "webview" };
  }
}
