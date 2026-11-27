import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const SRC = path.join(ROOT, "src");
const DIST = path.join(ROOT, "dist");

fs.mkdirSync(DIST, { recursive: true });

// 1. Bundle self-contained MCP server -> dist/server.mjs (zero runtime node_modules required)
await esbuild.build({
  entryPoints: [path.join(SRC, "server.ts")],
  outfile: path.join(DIST, "server.mjs"),
  bundle: true,
  minify: true,
  platform: "node",
  format: "esm",
  target: "node20",
  banner: {
    js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);',
  },
  sourcemap: false,
});

// 2. Bundle self-contained Action Launchpad UI -> dist/actions.html
const sharedCss = fs.readFileSync(path.join(SRC, "ui", "shared.css"), "utf8");

const res = await esbuild.build({
  entryPoints: [path.join(SRC, "ui", "actions.ts")],
  bundle: true,
  write: false,
  platform: "browser",
  format: "esm",
  target: "es2022",
  minify: true,
});
const jsCode = res.outputFiles[0].text.replace(/<\/script>/gi, "<\\/script>");
const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="color-scheme" content="light dark" />
  <title>Action Launchpad — Antigravity</title>
  <style>${sharedCss}</style>
</head>
<body>
  <div id="root"></div>
  <script type="module">${jsCode}</script>
</body>
</html>
`;

const outPath = path.join(DIST, "actions.html");
fs.writeFileSync(outPath, html, "utf8");
console.log(`Built actions.html (${(Buffer.byteLength(html) / 1024).toFixed(1)} KB)`);
console.log("Built dist/server.mjs and dist/actions.html.");
