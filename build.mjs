// soksak-playbox 번들 빌드 — esbuild 단일 ESM main.js(loader 가 blob-URL 로 import).
// react/react-dom/hls.js 전부 인라인(런타임 import 0 — 스펙 §0). 전역 CSS 는 소스 문자열 상수
// (src/styles.ts)로 들고 plugin-entry 가 Shadow DOM <style> 로 주입한다. 단일 Stage.
import { build, context } from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(root, "src");

const opts = {
  entryPoints: ["src/plugin-entry.tsx"],
  bundle: true,
  format: "esm", // 로더가 dynamic import() 하는 ESM
  platform: "browser",
  target: "es2022",
  jsx: "automatic", // React 19 automatic runtime
  alias: { "@": SRC },
  define: {
    "process.env.NODE_ENV": '"production"',
    "import.meta.env.DEV": "false",
  },
  outfile: "main.js",
  minify: false, // 가독(검토). 발행 시 minify 전환.
  legalComments: "none",
  logLevel: "info",
};

if (process.argv.includes("--watch")) {
  const ctx = await context(opts);
  await ctx.watch();
  console.log("[media-player] watching src → main.js …");
} else {
  await build(opts);
  console.log("[media-player] built main.js");
}
