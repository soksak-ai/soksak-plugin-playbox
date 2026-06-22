import type { PlayerSignal } from "@/signal";
import PlayerView from "./PlayerView";
import LibrarySidebar from "./LibrarySidebar";

// 뷰 라우팅 — player(content 배치)는 플레이어, library(sidebar)는 사이드바. 둘 다 같은 app + scope + 시그널 공유.
// 닫기 가드(close guard)는 콘텐츠 배치인 player 뷰만 유효 — 재생 중 닫기 경고는 PlayerView 가 보고한다.
// (download 는 library=sidebar 작업이라 setStatus 무효 자리이고, 닫기 가드의 대상도 아니다.)
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
  if (viewId === "player")
    return (
      <PlayerView app={app} scope={scope} signal={signal} setStatus={setStatus} />
    );
  return <LibrarySidebar app={app} scope={scope} signal={signal} />;
}
