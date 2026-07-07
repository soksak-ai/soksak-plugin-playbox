// soksak-playbox 라이브 E2E — SOKSAK_SOCKET JSON-RPC 로 명령 표면(R1) 검증.
// 실행: dev 앱 구동 후 `SOKSAK_SOCKET=$HOME/.soksak/com.soksak.dev.sock node scripts/e2e/playbox.mjs`.
//        (dev.load·enable 은 스크립트가 시도. 준비는 고정 sleep 이 아니라 ping-poll 로 기다린다.)
// 프로토콜: 줄 단위 JSON {id,method,params} → {id,ok,...payload}. 응답은 result 래퍼 없이 payload 머지.
// 비파괴: 기존 라이브러리는 건드리지 않는다 — 고정 MARKER 항목만 add/remove. 멱등: 잔재 선청소 + 종료 선청소.
import net from "node:net";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { execFileSync } from "node:child_process";

const PLUGIN_DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..");
const PLUGIN_ID = "soksak-plugin-playbox";
const P = `plugin.${PLUGIN_ID}.`;
const SOCKET = process.env.SOKSAK_SOCKET || path.join(os.homedir(), ".soksak", "com.soksak.dev.sock");
const MARKER = "soksak-e2e-media-player"; // 고정 — 크래시 잔재도 탐지·청소 가능(랜덤 금지).

let sock;
let rbuf = "";
let nextId = 1;
const pending = new Map();

function connect() {
  return new Promise((resolve, reject) => {
    sock = net.connect(SOCKET);
    sock.setEncoding("utf8");
    sock.on("connect", resolve);
    sock.on("error", reject);
    sock.on("data", (chunk) => {
      rbuf += chunk;
      let nl;
      while ((nl = rbuf.indexOf("\n")) >= 0) {
        const line = rbuf.slice(0, nl);
        rbuf = rbuf.slice(nl + 1);
        if (!line.trim()) continue;
        let msg;
        try {
          msg = JSON.parse(line);
        } catch {
          continue;
        }
        const p = pending.get(msg.id);
        if (p) {
          pending.delete(msg.id);
          p(msg);
        }
      }
    });
  });
}

// dev 프론트엔드의 소켓 포워딩 latency 는 부하 시 수 초~10초+로 가변(debug 빌드 + vite dev).
// 타임아웃은 측정 worst-case 위로 넉넉히 — assertion 은 그대로(약화 아님, 인프라 관용).
function rpc(method, params = {}, timeoutMs = 30000, window = undefined) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error("timeout: " + method));
    }, timeoutMs);
    pending.set(id, (msg) => {
      clearTimeout(timer);
      resolve(msg);
    });
    // 봉투 timeoutMs 도 전달 — 서버 rx.recv_timeout 가 이 값을 쓴다(긴 작업=download 가 10s 기본에 안 잘리게).
    // window: 특정 창 label 로 라우팅(멀티윈도우 검증). 생략 시 활성 창(ipc.rs window: Option).
    const env = { id, method, params, timeoutMs: Math.max(5000, timeoutMs - 2000) };
    if (window) env.window = window;
    sock.write(JSON.stringify(env) + "\n");
  });
}

// 응답은 result 래퍼 없이 envelope({id,ok}) + payload 머지 — 그대로 payload 로 본다.
const val = (m) => (m && m.result !== undefined ? m.result : m);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0;
let fail = 0;
function ok(cond, msg, detail) {
  if (cond) {
    pass++;
    console.log("  ✓ " + msg);
  } else {
    fail++;
    console.log("  ✗ " + msg, detail !== undefined ? JSON.stringify(detail) : "");
  }
}

// 마커가 박힌 항목만 제거(기존 사용자 데이터 불가침). 제거 개수 반환.
async function cleanMarker() {
  const list = val(await rpc(P + "library.list"));
  const mine = (list.items || []).filter((i) => String(i.inputUrl).includes(MARKER));
  for (const it of mine) await rpc(P + "favorite.remove", { id: it.id });
  return mine.length;
}

async function main() {
  console.log("socket:", SOCKET);
  await connect();

  // dev 적재 + 활성(이미 되어 있으면 무해). 준비는 warmup 으로 — 서버가 프론트 미응답 시 {code:TIMEOUT}
  // 을 빠르게 돌려주므로(부하·reload 직후 UI thrashing), 연속 2회 genuine ok 가 될 때까지 깨어날 시간을 준다.
  await rpc("plugin.dev.load", { path: PLUGIN_DIR }).catch(() => {});
  await rpc("plugin.enable", { id: PLUGIN_ID }).catch(() => {});
  let streak = 0;
  for (let i = 0; i < 40 && streak < 2; i++) {
    const p = await rpc(P + "ping").then(val).catch(() => null);
    if (p && p.ok === true) streak++;
    else {
      streak = 0;
      await sleep(1000);
    }
  }
  ok(streak >= 2, "플러그인 준비(ping 연속 2회)");

  // ── A. ping ────────────────────────────────────────────────────────────────
  const ping = val(await rpc(P + "ping"));
  ok(ping.ok === true && ping.plugin === PLUGIN_ID && ping.version === "0.1.0", "ping 적재·버전", ping);

  // ── B. resolve (사이트지식 0, 네트워크 불요 — 결정적 경로) ────────────────────
  const hls = val(await rpc(P + "resolve", { inputUrl: "https://example.com/v/play.m3u8" }));
  ok(hls.kind === "hls" && hls.needsProxy === true && hls.source === "direct", "resolve m3u8 → hls+proxy", hls);

  const mp4 = val(await rpc(P + "resolve", { inputUrl: "https://example.com/v/clip.mp4" }));
  ok(mp4.kind === "direct" && mp4.needsProxy === false && mp4.source === "direct", "resolve mp4 → direct", mp4);

  const file = val(await rpc(P + "resolve", { inputUrl: "file:///Users/x/My%20Clip.mp4" }));
  ok(file.kind === "file" && file.filePath === "/Users/x/My Clip.mp4" && file.source === "local", "resolve file:// → local path", file);

  const empty = val(await rpc(P + "resolve", { inputUrl: "" }));
  ok(empty.ok === false && empty.code === "INVALID_PARAMS", "resolve 빈 입력 → INVALID_PARAMS", empty);

  const unsup = val(await rpc(P + "resolve", { inputUrl: "ftp://host/a.mp4" }));
  ok(unsup.kind === "unsupported" && unsup.source === "none", "resolve ftp → unsupported", unsup);

  // ── C. doctor (환경 독립 — 형태만 단언) ─────────────────────────────────────
  const doc = val(await rpc(P + "doctor"));
  ok(
    doc.ytdlp && typeof doc.ytdlp.found === "boolean" && doc.ffmpeg && typeof doc.ffmpeg.found === "boolean" && doc.ready === doc.ytdlp.found,
    "doctor 의존성 보고(ready=ytdlp.found)",
    doc,
  );

  // ── D. 라이브러리 수명주기 (비파괴·자기청소·멱등) ────────────────────────────
  const pre = await cleanMarker();
  if (pre > 0) console.log(`  · 잔재 ${pre}건 선청소`);
  const baseline = val(await rpc(P + "library.list")).count;

  const favR = val(await rpc(P + "favorite.add", { inputUrl: `https://example.com/${MARKER}/clip-a.mp4`, title: `${MARKER} 즐겨찾기 한글` }));
  const favId = favR.item && favR.item.id;
  ok(favId && favR.item.kind === "favorite" && String(favR.item.inputUrl).includes(MARKER), "favorite.add", favR.item);

  const afterFav = val(await rpc(P + "library.list"));
  ok(afterFav.count === baseline + 1, "library.list +1", { baseline, now: afterFav.count });
  const favOnly = val(await rpc(P + "library.list", { kind: "favorite" }));
  ok(favOnly.items.some((i) => i.id === favId), "library.list kind=favorite 에 새 즐겨찾기", favOnly.count);

  const clipR = val(await rpc(P + "clip.add", { inputUrl: `https://example.com/${MARKER}/clip-b.m3u8`, startSec: 5, endSec: 12, title: `${MARKER} 클립` }));
  const clipId = clipR.item && clipR.item.id;
  ok(clipId && clipR.item.kind === "clip" && clipR.item.startSec === 5 && clipR.item.endSec === 12, "clip.add 시간구간", clipR.item);

  const badClip = val(await rpc(P + "clip.add", { inputUrl: `https://example.com/${MARKER}/x.mp4`, startSec: 12, endSec: 5 }));
  ok(badClip.ok === false && badClip.code === "INVALID_PARAMS", "clip.add endSec<=startSec → INVALID_PARAMS", badClip);

  const clips = val(await rpc(P + "clip.list"));
  ok(clips.items.some((i) => i.id === clipId) && clips.items.every((i) => i.kind === "clip"), "clip.list 클립만", clips.count);

  const afterClip = val(await rpc(P + "library.list"));
  ok(afterClip.count === baseline + 2, "library.list +2", { baseline, now: afterClip.count });

  const byMarker = val(await rpc(P + "library.filter", { text: MARKER }));
  ok(
    byMarker.count >= 2 && byMarker.items.some((i) => i.id === favId) && byMarker.items.some((i) => i.id === clipId),
    "library.filter 마커 → 두 항목",
    byMarker.count,
  );
  const byCjk = val(await rpc(P + "library.filter", { text: "한글" }));
  ok(byCjk.items.some((i) => i.id === favId), "library.filter CJK(한글) → 즐겨찾기", byCjk.count);

  // ── E. play (inject — 라이브러리 비기록, 인텐트+해석만) ──────────────────────
  const played = val(await rpc(P + "play", { inputUrl: `https://example.com/${MARKER}/c.mp4` }));
  ok(played.requested === true && played.resolved && played.resolved.kind === "direct", "play 인텐트+해석", played);

  // ── F. download (프록시+ffmpeg, 라이브 — 중립 공개 HLS, 사이트명 0) ───────────
  // resolve → 코어 프록시 → ffmpeg 로 실제 mp4 저장(구간 6초). yt-dlp 비개입. 파일 + ffprobe 로 증명.
  const dlOut = path.join(os.tmpdir(), "pb-e2e-download.mp4");
  try { fs.unlinkSync(dlOut); } catch {}
  const APPLE = "https://devstreaming-cdn.apple.com/videos/streaming/examples/img_bipbop_adv_example_fmp4/master.m3u8";
  const dl = val(await rpc(P + "download", { inputUrl: APPLE, outPath: dlOut, startSec: 0, endSec: 6 }, 90000));
  ok(dl.ok === true && dl.path === dlOut, "download 구간 저장 성공", dl);
  let dlBytes = 0;
  let dlDur = 0;
  try {
    dlBytes = fs.statSync(dlOut).size;
    const probe = execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", dlOut], { encoding: "utf8" });
    dlDur = parseFloat(probe.trim());
  } catch (e) {
    console.log("  · ffprobe/stat 실패:", e.message);
  }
  ok(dlBytes > 10000, "download 파일 바이트>10KB(실재 비디오)", dlBytes);
  ok(dlDur > 3 && dlDur < 9, "download 재생시간 ~6초", dlDur);
  // iframe(YouTube 해석 실패 가정)·미지원 입력은 저장 거부.
  const dlBad = val(await rpc(P + "download", { inputUrl: "ftp://host/a.mp4", outPath: dlOut }, 20000));
  ok(dlBad.ok === false && dlBad.code === "NO_STREAM", "download 미지원 입력 → NO_STREAM", dlBad);
  try { fs.unlinkSync(dlOut); } catch {}

  // ── G. 프로젝트별 scope 격리 (결정론적, debug 커맨드 + projectId) ──────────────
  // 같은 프로젝트의 뷰·커맨드는 한 store, 다른 프로젝트는 격리. 활성 프로젝트와 무관하게 projectId 로
  // 결정(이벤트 플립·"활성 프로젝트 가변" 아님). 멀티윈도우 같은 프로젝트는 app.data.watch 가 동기
  // (각 창의 그 프로젝트 store 가 같은 scope 를 watch — 본 격리가 그 전제). 별도 프로젝트는 app.data scope
  // 파티션이라 실존 프로젝트가 없어도 격리만 결정론적으로 검증된다.
  const PROJ_B = "e2e-scope-b"; // 고정(멱등). 실존 프로젝트 불요 — scope 파티션 격리 확인용.
  // 잔재 선청소(크래시 대비).
  for (const it of (val(await rpc(P + "clip.list", { projectId: PROJ_B })).items || []).filter((i) => String(i.inputUrl).includes(MARKER))) {
    await rpc(P + "favorite.remove", { id: it.id, projectId: PROJ_B });
  }
  const dbgA0 = val(await rpc(P + "debug"));
  const dbgB0 = val(await rpc(P + "debug", { projectId: PROJ_B }));
  ok(dbgB0.scope === PROJ_B && dbgA0.scope !== PROJ_B, "debug: 프로젝트별 scope 분리", { a: dbgA0.scope, b: dbgB0.scope });
  ok(dbgA0.instanceId !== dbgB0.instanceId, "프로젝트별 store 인스턴스 분리", { a: dbgA0.instanceId, b: dbgB0.instanceId });
  const aCount0 = dbgA0.count;
  const bCount0 = dbgB0.count;
  const addB = val(await rpc(P + "clip.add", { projectId: PROJ_B, inputUrl: `https://example.com/${MARKER}/scope.m3u8`, startSec: 1, endSec: 4, title: `${MARKER} scope` }));
  ok(addB.item && addB.item.kind === "clip", "다른 프로젝트(B)에 clip.add", addB.item);
  ok(val(await rpc(P + "debug", { projectId: PROJ_B })).count === bCount0 + 1, "B count +1", { before: bCount0 });
  ok(val(await rpc(P + "debug")).count === aCount0, "A count 불변(격리)", { before: aCount0 });
  ok(val(await rpc(P + "clip.list", { projectId: PROJ_B })).items.some((i) => i.id === addB.item.id), "clip.list(B) 에 B 클립", null);
  ok(!val(await rpc(P + "clip.list")).items.some((i) => i.id === addB.item.id), "clip.list(A) 에 B 클립 없음(격리)", null);
  // clip.update — 구간을 초.00 정밀로 수정(CLI/MCP 경로).
  const upd = val(await rpc(P + "clip.update", { projectId: PROJ_B, id: addB.item.id, startSec: 2.25, endSec: 3.5 }));
  ok(upd.ok === true && Math.abs(upd.item.startSec - 2.25) < 0.01 && Math.abs(upd.item.endSec - 3.5) < 0.01, "clip.update — 구간 .00 수정", upd.item ? { s: upd.item.startSec, e: upd.item.endSec } : upd);
  ok(val(await rpc(P + "favorite.remove", { id: addB.item.id, projectId: PROJ_B })).removed === true, "B 클립 제거", null);
  ok(val(await rpc(P + "debug", { projectId: PROJ_B })).count === bCount0, "B count 원복(멱등)", { baseline: bCount0 });

  // ── 멀티윈도우 같은 프로젝트 동기 (라이브 검증됨 — 자동단언 제외) ──────────────
  // 같은 프로젝트를 두 창에 펼치면 한 창의 변경이 app.data.watch 로 다른 창 store 에 동기된다. 각 창은 그
  // 프로젝트의 별도 store 인스턴스지만 같은 scope 를 watch(위 G 의 scope 격리가 그 전제). rpc 4번째 인자로
  // window 타깃 가능(ipc.rs window: Option). 자동 E2E 에선 (1) 백그라운드 새 창이 occlusion 으로 JS
  // throttle 돼 watch 콜백이 불가측 지연, (2) window.open/focus 가 다른 섹션 라우팅을 교란해 불안정 →
  // 하드 단언 제외. 라이브 재현(검증 완료):
  //   sok window.open                                  # 같은 활성 프로젝트로 새 창
  //   SOKSAK_WINDOW=<win> sok plugin.<id>.view.open '{"view":"<id>.library"}'
  //   sok window.focus  (또는 새 창 보이게)            # occlusion throttle 해제
  //   sok plugin.<id>.clip.add '{...}'                 # 한 창에서
  //   SOKSAK_WINDOW=<win> sok ui.tree                  # 다른 창 library debug 노드 count +1 (watch 동기)

  // ── I. 실제 재생 검증 (DOM playstate 노드 + 재생 중 클립, 가짜 URL 아님) ────────
  // 실 HLS 스트림을 열어 플레이어 playstate 노드(currentTime)가 진행하는지 폴링해 "진짜 재생 중"을 단언.
  // 이어서 재생 중 clip-start/clip-end 를 ui.input.click 으로 눌러 실재생 시점으로 클립이 저장(end>start>=0)
  // 되는지 — 재생→클립→라이브러리 전 경로를 실영상으로 검증(인텐트/가짜URL 아님).
  await rpc("window.focus").catch(() => {}); // occlusion 해제(단일 창) — 비디오 throttle 방지
  await sleep(500);
  await rpc("plugin.view.open", { view: `${PLUGIN_ID}.player`, placement: "content" }).catch(() => {});
  await rpc("plugin.view.open", { view: `${PLUGIN_ID}.library` }).catch(() => {});
  await sleep(800);
  const REALHLS = "https://devstreaming-cdn.apple.com/videos/streaming/examples/img_bipbop_adv_example_fmp4/master.m3u8";
  await rpc(P + "play", { inputUrl: REALHLS, title: "E2E 실재생" });
  const treeStr = async () => JSON.stringify(await rpc("ui.tree"));
  const findNode = async (suffix) => {
    const m = (await treeStr()).match(new RegExp(`win[^"]*${PLUGIN_ID}\\.player\\/node\\/${suffix}`));
    return m ? m[0] : null;
  };
  const playT = async () => {
    const m = (await treeStr()).match(/node\/playstate\/(\d+)\/(\d)\/(\d)/);
    return m ? { cs: parseInt(m[1], 10), paused: m[2] === "1", ready: parseInt(m[3], 10) } : null;
  };
  let pt = null;
  for (let i = 0; i < 25 && !(pt && pt.cs > 50 && !pt.paused); i++) {
    await sleep(800);
    pt = await playT();
  }
  ok(pt != null, "playstate 노드 존재(플레이어 열림)", pt);
  ok(pt != null && pt.cs > 50 && !pt.paused, "실 스트림 재생 중 — currentTime 진행(>0.5s, 비일시정지)", pt);
  const startAddr = await findNode("clip-start");
  ok(startAddr != null, "clip-start 노드(재생 컨트롤) 발견", startAddr);
  if (startAddr && pt && pt.cs > 50) {
    const before = val(await rpc(P + "clip.list")).count;
    await rpc("ui.input.click", { address: startAddr }); // 재생 중 시작 마킹(실 currentTime)
    await sleep(1500); // 구간 생기게 진행
    const endAddr = await findNode("clip-end");
    if (endAddr) await rpc("ui.input.click", { address: endAddr }); // 끝 마킹 → 저장
    await sleep(800);
    const after = val(await rpc(P + "clip.list"));
    ok(after.count === before + 1, "재생 중 [ ] 클립 → 라이브러리 +1", { before, after: after.count });
    const nc = after.items[0]; // 최신
    ok(nc && nc.kind === "clip" && nc.endSec > nc.startSec && nc.startSec >= 0, "클립 구간이 실재생 시점(end>start>=0)", nc ? { s: nc.startSec, e: nc.endSec, url: nc.inputUrl } : null);

    // ── 저장한 클립을 라이브러리에서 클릭 → 구간 seek + 반복(되감김) + 반복 아이콘 검증 ──
    if (nc && after.count === before + 1) {
      const clipState = async () => {
        const m = (await treeStr()).match(/node\/clipstate\/(-?\d+)\/(-?\d+)\/(\d)/);
        return m ? { start: parseInt(m[1], 10) / 100, end: parseInt(m[2], 10) / 100, loop: parseInt(m[3], 10) } : null;
      };
      const findItem = async (id) => {
        const m = (await treeStr()).match(new RegExp(`win[^"]*${PLUGIN_ID}\\.library\\/node\\/item\\/${id}`));
        return m ? m[0] : null;
      };
      const addr = await findItem(nc.id);
      ok(addr != null, "라이브러리에 클립 항목 노드(item/<id>)", addr);
      if (addr) {
        await rpc("ui.input.click", { address: addr }); // 클립 클릭 → 구간 재생 인텐트
        let cs = null;
        for (let i = 0; i < 15 && !(cs && cs.loop === 1 && cs.end > cs.start); i++) {
          await sleep(700);
          cs = await clipState();
        }
        ok(cs != null && Math.abs(cs.start - nc.startSec) < 0.6 && Math.abs(cs.end - nc.endSec) < 0.6 && cs.loop === 1, "클립 클릭 → 구간 로드 + 반복 ON", cs);
        ok((await findNode("loop")) != null, "반복 토글 아이콘 제공", null);
        // 구간 반복: 폴링하며 currentTime 이 구간 내 + 되감김(end→start) 감지 → 진짜 루프.
        let prev = -1;
        let wrapped = false;
        let inRange = false;
        for (let i = 0; i < 14; i++) {
          await sleep(600);
          const p = await playT();
          if (!p) continue;
          const t = p.cs / 100;
          if (cs && t >= cs.start - 0.4 && t <= cs.end + 0.7) inRange = true;
          if (prev >= 0 && t < prev - 0.3) wrapped = true;
          prev = t;
        }
        ok(inRange, "재생 위치가 클립 구간 내(처음부터가 아니라 seek 됨)", { end: cs && cs.end, prev });
        ok(wrapped, "구간 반복 — currentTime 되감김 감지(루프 동작)", { end: cs && cs.end });

        // player.state / player.control — CLI/MCP 가 재생 상태 read + 제어(원칙: 모든 것 command).
        const pst = val(await rpc(P + "player.state"));
        ok(pst && pst.open === true && pst.clip, "player.state — 재생 상태 read(open/clip)", pst ? { open: pst.open, loop: pst.loop, t: pst.currentTime } : pst);
        await rpc(P + "player.control", { action: "pause" });
        await sleep(900);
        const pPause = await playT();
        ok(pPause != null && pPause.paused, "player.control pause → 일시정지", pPause);
        await rpc(P + "player.control", { action: "play" });
        await sleep(900);
        const pPlay = await playT();
        ok(pPlay != null && !pPlay.paused, "player.control play → 재개", pPlay);
        const lBefore = (await clipState())?.loop;
        await rpc(P + "player.control", { action: "toggleLoop" });
        await sleep(700);
        const lAfter = (await clipState())?.loop;
        ok(lBefore != null && lAfter != null && lBefore !== lAfter, "player.control toggleLoop → 반복 토글", { before: lBefore, after: lAfter });
        await rpc(P + "player.control", { action: "toggleLoop" }); // 원복
      }
      await rpc(P + "favorite.remove", { id: nc.id }); // 정리
    }
  }
  const closeAddr = await findNode("close");
  if (closeAddr) await rpc("ui.input.click", { address: closeAddr }).catch(() => {}); // 미디어 닫기(잔재 0)

  // ── J. 다운로드 버튼(UI) — runDownload 직접(커맨드 우회). "알 수 없는 명령" 회귀 방지 + 기본 폴더. ──
  // 자기완결: 실 클립 추가 → 라이브러리 다운로드 버튼 클릭 → dlstate ok + 기본 폴더({프로젝트}/playbox/clip)
  // 에 파일 생성 확인 → 파일·클립 정리. 짧은 구간(1–3s)이라 ffmpeg 빠름.
  {
    const dlDir = String(val(await rpc(P + "debug")).downloadDir || "");
    const dlClip = val(await rpc(P + "clip.add", { inputUrl: REALHLS, startSec: 1, endSec: 3, title: `${MARKER} dl` }));
    await rpc("plugin.view.open", { view: `${PLUGIN_ID}.library` }).catch(() => {});
    await rpc("window.focus").catch(() => {}); // 노드 찾기 ui.tree 안정화(occlusion 해제)
    await sleep(900);
    const before = (() => {
      try {
        return fs.readdirSync(dlDir);
      } catch {
        return [];
      }
    })();
    const dlMatch = (await treeStr()).match(new RegExp(`win[^"]*${PLUGIN_ID}\\.library\\/node\\/download\\/${dlClip.item.id}`));
    ok(dlMatch != null, "라이브러리 클립 다운로드 버튼 노드", dlMatch ? dlMatch[0] : null);
    if (dlMatch) {
      await rpc("ui.input.click", { address: dlMatch[0] });
      // 실제 산출물(파일)을 fs 로 폴링 — 로컬이라 webview occlusion throttle 무관. dlstate 노드는 DOM
      // 표면(인터랙티브용)이지만 ffmpeg 중 ui.tree 폴링은 불안정하므로 E2E 는 파일 생성을 본다.
      const freshNow = () => {
        try {
          return fs.readdirSync(dlDir).filter((f) => !before.includes(f));
        } catch {
          return [];
        }
      };
      let fresh = [];
      for (let i = 0; i < 30 && fresh.length === 0; i++) {
        await sleep(1000);
        fresh = freshNow();
      }
      ok(fresh.length >= 1, "다운로드 버튼 → 기본 폴더 {프로젝트}/playbox/clip 에 파일 생성(runDownload 직접, '알 수 없는 명령' 아님)", { dir: dlDir, fresh });
      for (const f of fresh) {
        try {
          fs.unlinkSync(path.join(dlDir, f));
        } catch {
          /* best-effort */
        }
      }
    }
    await rpc(P + "favorite.remove", { id: dlClip.item.id }); // 클립 정리
  }

  // ── 청소 + 멱등 검증 ────────────────────────────────────────────────────────
  const rmFav = val(await rpc(P + "favorite.remove", { id: favId }));
  ok(rmFav.removed === true, "favorite.remove 즐겨찾기", rmFav);
  const rmClip = val(await rpc(P + "favorite.remove", { id: clipId }));
  ok(rmClip.removed === true, "favorite.remove 클립", rmClip);

  const restored = val(await rpc(P + "library.list"));
  ok(restored.count === baseline, "library.list baseline 복원", { baseline, now: restored.count });
  ok(!restored.items.some((i) => String(i.inputUrl).includes(MARKER)), "마커 잔재 0(멱등)", restored.count);

  console.log(`\n${pass} passed, ${fail} failed`);
  sock.end();
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error("E2E 오류:", e.message);
  process.exit(1);
});
