import type { SpawnFn, SpawnResult } from "@/resolve";

// app.process.spawn 래퍼 — stdout/stderr 를 모아 종료코드와 함께 반환(SpawnFn). process 권한 필요.
// 미가용(권한 없음/코어)이면 reject → 리졸버가 unsupported 로 표면화(R9).
export function makeSpawn(app: any): SpawnFn {
  return (cmd, args) =>
    new Promise<SpawnResult>((resolve, reject) => {
      const proc = app?.process;
      if (!proc?.spawn) {
        reject(new Error("process capability 미가용(권한/코어)"));
        return;
      }
      const dec = new TextDecoder();
      let stdout = "";
      let stderr = "";
      proc
        .spawn(cmd, args)
        .then((handle: number) => {
          proc.onData?.(handle, (d: Uint8Array) => {
            stdout += dec.decode(d, { stream: true });
          });
          proc.onStderr?.(handle, (d: Uint8Array) => {
            stderr += dec.decode(d, { stream: true });
          });
          proc.onExit?.(handle, (code: number) => {
            resolve({ code: code ?? 0, stdout, stderr });
          });
        })
        .catch(reject);
    });
}
