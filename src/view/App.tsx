import type { PlayerSignal } from "@/signal";
import PlayerView from "./PlayerView";
import LibrarySidebar from "./LibrarySidebar";

// 뷰 라우팅 — player 는 플레이어, library 는 사이드바. 둘 다 같은 app + scope + 시그널 채널 공유(뷰 간
// 재생/제어 인텐트). 데이터는 각 뷰가 app.data 를 useLibrary 로 직접 구독(미러 없음).
export default function App({
  viewId,
  app,
  scope,
  signal,
}: {
  viewId: string;
  app: any;
  scope: string;
  signal: PlayerSignal | null;
}) {
  if (viewId === "player") return <PlayerView app={app} scope={scope} signal={signal} />;
  return <LibrarySidebar app={app} scope={scope} signal={signal} />;
}
