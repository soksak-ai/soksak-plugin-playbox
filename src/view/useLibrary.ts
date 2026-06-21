// 라이브러리 반응형 읽기 — app.data 를 직접 구독한다(미러 없음). 마운트 시 1회 로드 + data.watch(scope)
// 변경마다 재로드. 로컬 SQLite 라 재쿼리가 ms 라 낙관적 미러 불필요. 변이는 뷰가 data.ts 로 직접 쓴다.
import { useEffect, useState } from "react";
import type { LibraryItem } from "@/types";
import { COLL, type DataApi, disposeOf, ensureDefined, loadLibrary } from "@/data";

export function useLibrary(data: DataApi | undefined, scope: string): LibraryItem[] {
  const [items, setItems] = useState<LibraryItem[]>([]);
  useEffect(() => {
    if (!data) return;
    let alive = true;
    const reload = () => {
      void loadLibrary(data, scope).then((rows) => {
        if (alive) setItems(rows);
      });
    };
    void ensureDefined(data).then(reload, reload);
    const un = data.watch(COLL, { scope }, reload);
    return () => {
      alive = false;
      disposeOf(un);
    };
  }, [data, scope]);
  return items;
}
