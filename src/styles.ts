// 전역 CSS(Shadow DOM 주입) — soksak 테마 변수 추종. 호스트 chrome 셀렉터 오염 0(Shadow 격리).
export const GLOBAL_CSS = `
:host { all: initial; }
* { box-sizing: border-box; }
.pb-root {
  position: absolute; inset: 0;
  display: flex; flex-direction: column; overflow: hidden;
  color: var(--fg, #ddd); background: var(--bg, #1a1a1a);
  font-family: system-ui, -apple-system, sans-serif; font-size: 13px;
}
.pb-header {
  display: flex; align-items: center; gap: 8px;
  /* 툴바 행 계약(코어 PLUGIN-CONTRACT §Toolbar row) — 치수는 테마 토큰 소유. */
  height: var(--toolbar-h, 28px);
  padding: 0 var(--toolbar-pad-x, 8px); border-bottom: 1px solid var(--bd, #333); font-weight: 600;
  flex: 0 0 auto;
}
.pb-header .pb-icon { opacity: 0.8; }
.pb-header .pb-spacer { flex: 1; }
.pb-body { flex: 1; overflow: auto; }

/* 플레이어 빈 상태 — URL 입력 + 드롭 + 파일 열기 */
.pb-empty {
  display: flex; flex-direction: column; align-items: stretch; justify-content: center;
  gap: 14px; padding: 24px; max-width: 560px; margin: 0 auto; width: 100%;
}
.pb-url-row { display: flex; gap: 8px; }
.pb-input {
  flex: 1; min-width: 0; padding: 9px 11px;
  background: var(--inset, #111); color: var(--fg, #eee);
  border: 1px solid var(--bd, #3a3a3a); border-radius: 7px; font-size: 13px; outline: none;
}
.pb-input:focus { border-color: var(--acc, #4a9eff); }
.pb-btn {
  padding: 9px 14px; border-radius: 7px; border: 1px solid transparent;
  background: var(--acc, #3a6ea5); color: #fff; cursor: pointer; font-size: 13px; white-space: nowrap;
}
.pb-btn:hover { filter: brightness(1.1); }
.pb-btn:disabled { opacity: 0.5; cursor: default; }
.pb-btn-ghost { background: transparent; color: var(--fg2, #aaa); border-color: var(--bd, #3a3a3a); }
.pb-drop {
  display: flex; flex-direction: column; align-items: center; gap: 8px;
  border: 1.5px dashed var(--bd, #444); border-radius: 10px; padding: 28px 16px;
  color: var(--fg3, #888); text-align: center; transition: border-color .15s, background .15s;
}
.pb-dragover .pb-drop { border-color: var(--acc, #4a9eff); background: rgba(74,158,255,0.08); }
.pb-drop-title { font-size: 13px; color: var(--fg2, #bbb); }
.pb-drop-sub { font-size: 11px; opacity: 0.6; }
.pb-error { color: #f88; font-size: 12px; padding: 4px 2px; word-break: break-word; }
.pb-flash { flex: 0 0 auto; padding: 5px 10px; background: var(--acc, #3a6ea5); color: #fff; font-size: 12px; }
.pb-hint { color: var(--fg3, #888); font-size: 12px; padding: 12px 14px; }

/* 미디어 재생 영역 */
.pb-media { position: relative; flex: 1; background: #000; min-height: 0; }
.pb-video, .pb-frame { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; background: #000; }

/* 라이브러리 */
.pb-list { display: flex; flex-direction: column; }
.pb-row {
  display: flex; align-items: center; gap: 8px; padding: 8px 10px;
  border-bottom: 1px solid var(--bd, #2a2a2a); cursor: pointer;
}
.pb-row:hover { background: var(--inset, rgba(255,255,255,0.04)); }
.pb-row-title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pb-row-kind { font-size: 10px; color: var(--fg3, #888); padding: 1px 5px; border: 1px solid var(--bd,#3a3a3a); border-radius: 4px; }
`;
