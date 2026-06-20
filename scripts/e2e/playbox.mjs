// soksak-playbox 라이브 E2E — SOKSAK_SOCKET JSON-RPC 로 명령 표면(R1) 검증.
// 실행: dev 앱 구동 후 `SOKSAK_SOCKET=$HOME/.soksak/com.soksak.dev.sock node scripts/e2e/playbox.mjs`.
//        (dev.load·enable 은 스크립트가 시도. 준비는 고정 sleep 이 아니라 ping-poll 로 기다린다.)
// 프로토콜: 줄 단위 JSON {id,method,params} → {id,ok,...payload}. 응답은 result 래퍼 없이 payload 머지.
// 비파괴: 기존 라이브러리는 건드리지 않는다 — 고정 MARKER 항목만 add/remove. 멱등: 잔재 선청소 + 종료 선청소.
import net from "node:net";
import os from "node:os";
import path from "node:path";

const PLUGIN_DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..");
const PLUGIN_ID = "soksak-playbox";
const P = `plugin.${PLUGIN_ID}.`;
const SOCKET = process.env.SOKSAK_SOCKET || path.join(os.homedir(), ".soksak", "com.soksak.dev.sock");
const MARKER = "soksak-e2e-playbox"; // 고정 — 크래시 잔재도 탐지·청소 가능(랜덤 금지).

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
function rpc(method, params = {}, timeoutMs = 30000) {
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
    sock.write(JSON.stringify({ id, method, params }) + "\n");
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
