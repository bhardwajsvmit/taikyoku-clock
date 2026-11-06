// Renders the app icon (1024px, no transparency as App Store requires) with the preinstalled Playwright.
const { chromium } = require("playwright");
const path = require("node:path");
const html = `<canvas id="c" width="1024" height="1024"></canvas><script>
const c = document.getElementById("c").getContext("2d"), S = 1024;
// two halves of the clock: lit (amber) on top, resting wood below, dark rail between
c.fillStyle = "#f1c26a"; c.fillRect(0, 0, S, S / 2);
c.fillStyle = "#e2d1af"; c.fillRect(0, S / 2, S, S / 2);
// faint board grid
c.strokeStyle = "rgba(60,40,15,.18)"; c.lineWidth = 8;
for (const x of [256, 512, 768]) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, S); c.stroke(); }
for (const y of [256, 768]) { c.beginPath(); c.moveTo(0, y); c.lineTo(S, y); c.stroke(); }
c.fillStyle = "#2b231b"; c.fillRect(0, S / 2 - 34, S, 68);
function stone(x, y, r, dark) {
  c.save(); c.shadowColor = "rgba(40,25,10,.35)"; c.shadowBlur = 30; c.shadowOffsetY = 14;
  const g = c.createRadialGradient(x - r * .35, y - r * .4, r * .1, x, y, r);
  if (dark) { g.addColorStop(0, "#5a5550"); g.addColorStop(1, "#141210"); }
  else { g.addColorStop(0, "#ffffff"); g.addColorStop(1, "#d9d3c7"); }
  c.fillStyle = g; c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill(); c.restore();
}
stone(512, 256, 170, true);
stone(512, 768, 170, false);
</script>`;
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1024, height: 1024 } });
  await p.setContent(`<style>body{margin:0}</style>${html}`);
  const el = await p.$("#c");
  await el.screenshot({ path: path.join(__dirname, "../assets/icon-1024.png") });
  await p.setViewportSize({ width: 180, height: 180 });
  await p.setContent(`<style>body{margin:0}img{width:180px;height:180px;display:block}</style><img src="data:image/png;base64,${require("fs").readFileSync(path.join(__dirname, "../assets/icon-1024.png")).toString("base64")}">`);
  await (await p.$("img")).screenshot({ path: path.join(__dirname, "../assets/icon-180.png") });
  await b.close();
  console.log("icons written");
})();
