// Build both targets from one source:
//   dist/game-clock.html  single self-contained page (the shareable web version)
//   www/                  web assets for the iOS/iPadOS app (Capacitor webDir), fonts bundled for offline use
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, readdirSync, rmSync } from "node:fs";
import { build } from "esbuild";

execSync("npx tsc -p tsconfig.json", { stdio: "inherit" });
const js = readFileSync("build/clock.js", "utf8");
const page = readFileSync("src/index.html", "utf8");

// --- web: one file ---
mkdirSync("dist", { recursive: true });
writeFileSync("dist/game-clock.html", page.replace("/*__SCRIPT__*/", () => js));

// --- iOS/iPadOS app ---
rmSync("www", { recursive: true, force: true });
mkdirSync("www/fonts", { recursive: true });
for (const f of readdirSync("assets/fonts")) copyFileSync(`assets/fonts/${f}`, `www/fonts/${f}`);
copyFileSync("assets/icon-180.png", "www/icon-180.png");
copyFileSync("assets/icon-1024.png", "www/icon-1024.png");

await build({
  entryPoints: ["src/native-entry.ts"],
  bundle: true,
  format: "iife",
  target: "safari16",
  minify: true,
  outfile: "www/native.js",
});

const body = page
  .replace(/<title>.*?<\/title>\n/, "")
  .replace(/<meta name="claude:[^>]*>\n/, "")
  .replace(/<link rel="preconnect"[^>]*>\n/, "")
  .replace(/<link rel="stylesheet" href="https:\/\/fonts\.googleapis\.com[^>]*>\n/, '<link rel="stylesheet" href="fonts/fonts.css">\n')
  .replace("<script>\n/*__SCRIPT__*/", () => `<script src="native.js"></script>\n<script>\n${js}`);

writeFileSync("www/index.html", `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=no">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="Taikyoku">
<meta name="format-detection" content="telephone=no">
<link rel="apple-touch-icon" href="icon-180.png">
<link rel="manifest" href="manifest.webmanifest">
<title>Taikyoku Clock</title>
<script>
  // Startup safety net: if anything fails while the app loads, show it on screen instead of a blank view.
  (function () {
    function show(msg) {
      var d = document.getElementById("bootError") || document.createElement("pre");
      d.id = "bootError";
      d.style.cssText = "position:fixed;inset:auto 0 0 0;z-index:99;margin:0;padding:16px;max-height:50%;overflow:auto;background:#300;color:#fdd;font:12px/1.4 ui-monospace,monospace;white-space:pre-wrap";
      d.textContent += msg + "\\n";
      (document.body || document.documentElement).appendChild(d);
    }
    window.addEventListener("error", function (e) { show("Error: " + e.message + " (" + (e.filename || "").split("/").pop() + ":" + e.lineno + ")"); });
    window.addEventListener("unhandledrejection", function (e) { show("Unhandled: " + (e.reason && e.reason.message || e.reason)); });
  })();
</script>
${body}
</html>
`);

writeFileSync("www/manifest.webmanifest", JSON.stringify({
  name: "Taikyoku Clock",
  short_name: "Taikyoku",
  display: "fullscreen",
  orientation: "any",
  background_color: "#e7d8bb",
  theme_color: "#2b231b",
  icons: [{ src: "icon-180.png", sizes: "180x180", type: "image/png" }, { src: "icon-1024.png", sizes: "1024x1024", type: "image/png" }],
}, null, 2));

console.log("built dist/game-clock.html and www/");
