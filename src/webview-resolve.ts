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
