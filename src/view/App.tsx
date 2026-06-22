import { useEffect } from "react";
import type { PlayerSignal } from "@/signal";
import PlayerView from "./PlayerView";
import LibrarySidebar from "./LibrarySidebar";
import { useLibrary } from "./useLibrary";

// 뷰 라우팅 — player 는 플레이어, library 는 사이드바. 둘 다 같은 app + scope + 시그널 채널 공유(뷰 간
// 재생/제어 인텐트). 데이터는 각 뷰가 app.data 를 useLibrary 로 직접 구독(미러 없음).
export default function App({
  viewId,
  app,
  scope,
  signal,
  setStatus,
}: {
  viewId: string;
  app: any;
  scope: string;
  signal: PlayerSignal | null;
  setStatus?: (s: { code: string; message?: string } | null) => void;
}) {
  // 다운로드 진행 보고(R1) — 라이브러리에 downloading 항목이 있으면 그 뷰를 닫기 전에
  // 코어가 경고(close guard). 끝나면 자동 해제(null). download 가 어디서 돌든 상태는 여기로 모인다.
  const items = useLibrary(app?.data, scope);
  const dl = items.filter((i) => i.status === "downloading").length;
  useEffect(() => {
    setStatus?.(dl > 0 ? { code: "busy", message: `다운로드 ${dl}건 진행 중` } : null);
  }, [dl, setStatus]);

  if (viewId === "player") return <PlayerView app={app} scope={scope} signal={signal} />;
  return <LibrarySidebar app={app} scope={scope} signal={signal} />;
}
