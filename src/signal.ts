// 뷰↔뷰 시그널 채널(projectId 당 1개) — 재생/제어 인텐트 + 플레이어 라이브 상태. 데이터 아님.
// 데이터 단일 진실은 app.data(=data.ts). 미러 없음 — 뷰는 useLibrary 로 app.data 를 직접 구독한다.
import { genId } from "@/data";

export interface PlayIntent {
  inputUrl: string;
  title?: string;
  // 클립이면 구간 — 플레이어가 startSec 로 seek 하고 [startSec, endSec] 를 반복 재생한다.
  startSec?: number;
  endSec?: number;
}
// 플레이어 라이브 상태 — 뷰가 publish, player.state 커맨드가 read(CLI/MCP 가 재생상태 조회).
export interface PlayerState {
  inputUrl: string | null;
  currentTime: number;
  duration: number;
  paused: boolean;
  clip: { start: number; end: number } | null;
  loop: boolean;
}
// 플레이어 제어 인텐트 — player.control 커맨드가 set, 뷰가 consume(CLI/MCP 가 재생 조작).
export interface ControlIntent {
  action: "play" | "pause" | "seek" | "toggleLoop";
  seconds?: number;
}

export interface PlayerSignal {
  scope(): string;
  id(): string;
  subscribe(cb: () => void): () => void;
  requestPlay(p: PlayIntent): void;
  consumePlay(): PlayIntent | null;
  setPlayerState(s: PlayerState | null): void;
  getPlayerState(): PlayerState | null;
  requestControl(c: ControlIntent): void;
  consumeControl(): ControlIntent | null;
}

export function createSignal(scope: string): PlayerSignal {
  // 인스턴스 식별(진단) — debug 노드가 같은 projectId 의 뷰들이 같은 채널인지 비교.
  const instanceId = genId().slice(0, 6);
  let pendingPlay: PlayIntent | null = null;
  let pendingControl: ControlIntent | null = null;
  let playerState: PlayerState | null = null;
  const subs = new Set<() => void>();
  const notify = () => {
    for (const cb of subs) cb();
  };
  return {
    scope: () => scope,
    id: () => instanceId,
    subscribe(cb) {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    requestPlay(p) {
      pendingPlay = p;
      notify();
    },
    consumePlay() {
      const p = pendingPlay;
      pendingPlay = null;
      return p;
    },
    // read 전용 — notify 안 함(렌더 루프 방지). player.state 커맨드가 read.
    setPlayerState(s) {
      playerState = s;
    },
    getPlayerState: () => playerState,
    requestControl(c) {
      pendingControl = c;
      notify();
    },
    consumeControl() {
      const c = pendingControl;
      pendingControl = null;
      return c;
    },
  };
}
