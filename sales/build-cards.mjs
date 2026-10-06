// Builds business cards (90 x 50 mm) as print sheets: one PDF per person, A4, 10 cards a page.
//   page 1 = fronts, page 2 = backs (columns mirrored so a sheet printed double-sided, flipped on the long edge, lines up)
//   node sales/build-cards.mjs      (people and site come from sales/contacts.json)
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(root, "package.json"));
const QRCode = require("qrcode");
const { chromium } = require("playwright");
const contacts = JSON.parse(readFileSync(path.join(root, "sales", "contacts.json"), "utf8"));
const logo = "data:image/png;base64," + readFileSync(path.join(root, "public", "korgen-kassa-logo.png")).toString("base64");
const url = contacts.site.startsWith("http") ? contacts.site : `https://${contacts.site}`;
const qr = await QRCode.toString(url, { type: "svg", margin: 0, color: { dark: "#0F3D2C", light: "#FFFFFF" } });
const TR = { а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "kh", ц: "ts", ч: "ch", ш: "sh", щ: "sch", ы: "y", э: "e", ю: "yu", я: "ya", ә: "a", ғ: "g", қ: "k", ң: "n", ө: "o", ұ: "u", ү: "u", һ: "h", і: "i" };
const slug = (name) => [...name.toLowerCase()].map((c) => TR[c] ?? c).join("").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");

const front = `<div class="card front"><img src="${logo}" alt=""><div class="txt">
<p class="ru">Касса и учёт, которые не останавливаются</p>
<p class="kz">Тоқтамайтын касса және есеп жүйесі</p>
<p class="site">${esc(contacts.site)}</p></div></div>`;
const back = (p) => `<div class="card back"><div class="info">
<p class="co">ТОО «Innova Corporation Company»<br><span>«Innova Corporation Company» ЖШС</span></p>
<p class="name">${esc(p.name)}</p>
<p class="phone">${esc(p.phone)}</p>
<p class="site2">${esc(contacts.site)}</p></div>
<div class="qr">${qr}</div></div>`;

const css = `
@page{size:A4;margin:0}
*{box-sizing:border-box}
html,body{margin:0;padding:0;font-family:'Manrope',Arial,sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.sheet{width:210mm;height:297mm;position:relative;page-break-after:always}
.sheet:last-child{page-break-after:auto}
.grid{position:absolute;left:15mm;top:23.5mm;width:180mm;display:grid;grid-template-columns:90mm 90mm;grid-auto-rows:50mm}
.card{width:90mm;height:50mm;position:relative;overflow:hidden;outline:.15mm solid #C9D3CD}
.front{background:#fff;display:flex;align-items:center;gap:2mm;padding:3mm 5mm 3mm 3mm}
.front img{width:34mm;height:34mm;object-fit:contain;flex:none}
.front .txt{flex:1}
.front p{margin:0}
.front .ru{font-size:3.7mm;font-weight:800;line-height:1.2;color:#0F3D2C}
.front .kz{font-size:3.1mm;font-weight:500;line-height:1.25;color:#4A5A52;margin-top:1.6mm}
.front .site{font-size:3.5mm;font-weight:800;color:#17803A;margin-top:3.2mm}
.back{background:#0F3D2C;color:#fff;display:flex;justify-content:space-between;align-items:stretch;padding:4.5mm 5mm}
.back .info{display:flex;flex-direction:column;min-width:0}
.back p{margin:0}
.back .co{font-size:2.7mm;font-weight:700;line-height:1.3;color:#CFE6D8}
.back .co span{font-weight:500;color:#9CC4AE}
.back .name{font-size:6mm;font-weight:800;margin-top:auto}
.back .phone{font-size:4.6mm;font-weight:700;margin-top:1mm}
.back .site2{font-size:3.4mm;font-weight:800;color:#22B24C;margin-top:1.4mm}
.back .qr{width:21mm;height:21mm;background:#fff;border-radius:1.6mm;padding:1.6mm;align-self:flex-end;flex:none}
.back .qr svg{width:100%;height:100%;display:block}`;

const sheet = (cards) => `<section class="sheet"><div class="grid">${cards.join("")}</div></section>`;
// the back sheet is printed on the other side of the paper: with the long edge flipped, left and right columns swap
const mirror = (arr) => arr.flatMap((_, i) => (i % 2 === 0 ? [arr[i + 1], arr[i]] : []));

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
for (const p of contacts.people.filter((x) => x.name && x.phone)) {
  const fronts = Array(10).fill(front);
  const backs = Array(10).fill(back(p));
  const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>Vizitka ${esc(p.name)}</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;700;800&display=swap"><style>${css}</style></head><body>${sheet(fronts)}${sheet(mirror(backs))}</body></html>`;
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  const file = path.join(root, "sales", `vizitka-${slug(p.name)}.pdf`);
  if (process.env.PREVIEW) for (const [i, el] of (await page.$$(".sheet")).entries()) await el.screenshot({ path: path.join(process.env.PREVIEW, `card-${slug(p.name)}-${i + 1}.png`) });
  await page.pdf({ path: file, format: "A4", printBackground: true, margin: { top: 0, right: 0, bottom: 0, left: 0 } });
  console.log("wrote", file);
  await page.close();
}
await browser.close();
