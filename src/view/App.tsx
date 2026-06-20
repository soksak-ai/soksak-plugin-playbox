import type { LibraryStore } from "@/store";
import PlayerView from "./PlayerView";
import LibrarySidebar from "./LibrarySidebar";

// 뷰 라우팅 — player 는 플레이어, library 는 사이드바. 둘 다 같은 app + store 를 공유(뷰 간 재생 인텐트).
export default function App({
  viewId,
  app,
  store,
}: {
  viewId: string;
  app: any;
  store: LibraryStore | null;
}) {
  if (viewId === "player") return <PlayerView app={app} store={store} />;
  return <LibrarySidebar app={app} store={store} />;
}
