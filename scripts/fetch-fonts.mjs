// One-off: download the Latin subsets of the app's Google Fonts so the iOS app works offline.
import { writeFileSync } from "node:fs";
const URL_CSS = "https://fonts.googleapis.com/css2?family=Chivo+Mono:wght@500;700&family=Bricolage+Grotesque:opsz,wght@12..96,400;12..96,600;12..96,800&display=swap";
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1";
const css = await (await fetch(URL_CSS, { headers: { "User-Agent": UA } })).text();
const blocks = css.split(/(?=\/\* )/).filter(b => b.startsWith("/* latin */"));
let out = "", n = 0;
for (const b of blocks) {
  const url = b.match(/url\((https:[^)]+)\)/)[1];
  const fam = b.match(/font-family: '([^']+)'/)[1].replace(/\s+/g, "");
  const w = b.match(/font-weight: ([\d ]+);/)[1].trim().replace(/\s+/g, "-");
  const file = `${fam}-${w}.woff2`;
  writeFileSync(`assets/fonts/${file}`, Buffer.from(await (await fetch(url)).arrayBuffer()));
  out += b.replace(url, `fonts/${file}`).replace("/* latin */", "").trim() + "\n";
  n++;
}
writeFileSync("assets/fonts/fonts.css", out);
console.log(`saved ${n} font files`);
