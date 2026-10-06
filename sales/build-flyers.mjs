// Builds the printable A4 leaflets (Russian + Kazakh, front and back = 2 pages) into sales/*.pdf
//   node sales/build-flyers.mjs
// Contacts (company name, 2–3 names with phone numbers) come from sales/contacts.json; an empty number prints as a blank line.
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(root, "package.json"));
const QRCode = require("qrcode");
const { chromium } = require("playwright");
const contacts = JSON.parse(readFileSync(path.join(root, "sales", "contacts.json"), "utf8"));
// embedded: a page set with setContent() may not load file:// pictures, which left the logo out of the PDF
const logo = "data:image/png;base64," + readFileSync(path.join(root, "public", "korgen-kassa-logo.png")).toString("base64");
const qr = await QRCode.toString(contacts.site.startsWith("http") ? contacts.site : `https://${contacts.site}`, { type: "svg", margin: 0, color: { dark: "#0F3D2C", light: "#FFFFFF" } });

const T = {
  ru: {
    file: "listovka-ru", lang: "ru", font: "Manrope",
    eyebrow: "Для магазинов и супермаркетов",
    title: "Касса и учёт, которые не останавливаются",
    lead: "Продажи, склад, закупки и отчёты в одной системе. Касса работает даже без интернета.",
    badge: "Работает без интернета",
    badgeText: "Пропал интернет: продажи продолжаются, чеки печатаются. Связь вернулась: всё само уходит на сервер, без дублей.",
    cards: [
      ["Быстрая касса", "Сканер, быстрые товары, любая оплата: наличные, карта, в долг."],
      ["Склад под контролем", "Остатки, приёмка, инвентаризация камерой телефона."],
      ["Понятные деньги", "Смены, Z-отчёты, прибыль и расходы без калькулятора."],
      ["Контроль кассиров", "Права, PIN-коды, журнал всех действий."],
    ],
    backTitle: "Что внутри",
    features: [
      ["Касса", "Продажа по сканеру, весовые товары, скидки и акции, возвраты, отложенные чеки, оплата наличными, картой, в долг и смешанная."],
      ["Склад и закупки", "Приёмка от поставщика, списание, перемещение, инвентаризация, печать этикеток на этикеточном принтере."],
      ["Деньги и отчёты", "Смены с X- и Z-отчётами, счета, прибыль и убытки, ABC-анализ, выгрузка в Excel."],
      ["Контроль", "Права кассиров, вход по PIN-коду, запрет продажи алкоголя ночью и сверх остатка, журнал действий."],
      ["Несколько магазинов", "Любое число касс и магазинов, кабинет владельца с компьютера и телефона, поддержка в чате."],
    ],
    startTitle: "Как начать",
    steps: ["Перенесём ваши товары и остатки", "Установим программу на кассу", "Подключим сканер и принтеры", "Обучим кассиров"],
    contactTitle: "Свяжитесь с нами",
    company: "ТОО «Innova Corporation Company»",
    note: "Стоимость рассчитываем под размер магазина. Позвоните, и мы расскажем подробнее.",
    qrText: "Сайт",
  },
  kz: {
    file: "listovka-kz", lang: "kk", font: "Noto Sans",
    eyebrow: "Дүкендер мен супермаркеттерге арналған",
    title: "Тоқтамайтын касса және есеп жүйесі",
    lead: "Сатылым, қойма, сатып алу және есептер бір жүйеде. Касса интернетсіз де жұмыс істейді.",
    badge: "Интернетсіз жұмыс істейді",
    badgeText: "Интернет үзілді: сатылым жалғасады, чектер басылады. Байланыс қайта келді: бәрі серверге өздігінен кетеді, қайталанбай.",
    cards: [
      ["Жылдам касса", "Сканер, жылдам тауарлар, кез келген төлем: қолма-қол, карта, қарызға."],
      ["Қойма бақылауда", "Қалдықтар, қабылдау, телефон камерасымен түгендеу."],
      ["Түсінікті ақша", "Ауысымдар, Z-есептер, пайда мен шығыс калькуляторсыз."],
      ["Кассирлерге бақылау", "Құқықтар, PIN-кодтар, барлық әрекеттер журналы."],
    ],
    backTitle: "Ішінде не бар",
    features: [
      ["Касса", "Сканермен сату, салмақпен сатылатын тауарлар, жеңілдіктер мен акциялар, қайтарулар, кейінге қалдырылған чектер, қолма-қол, карта, қарызға және аралас төлем."],
      ["Қойма және сатып алу", "Жеткізушіден қабылдау, есептен шығару, жылжыту, түгендеу, этикетка принтерінде баға белгілерін басып шығару."],
      ["Ақша және есептер", "X- және Z-есептері бар ауысымдар, шоттар, пайда мен шығын, ABC-талдау, Excel-ге жүктеу."],
      ["Бақылау", "Кассирлердің құқықтары, PIN-код арқылы кіру, түнде алкоголь сатуға және қалдықтан артық сатуға тыйым, әрекеттер журналы."],
      ["Бірнеше дүкен", "Қалағанша касса мен дүкен, иесінің кабинеті компьютерден және телефоннан, чаттағы қолдау."],
    ],
    startTitle: "Қалай бастау керек",
    steps: ["Тауарлар мен қалдықтарыңызды көшіреміз", "Бағдарламаны кассаға орнатамыз", "Сканер мен принтерлерді қосамыз", "Кассирлерді оқытамыз"],
    contactTitle: "Бізбен байланысыңыз",
    company: "«Innova Corporation Company» ЖШС",
    note: "Құнын дүкеннің көлеміне қарай есептейміз. Қоңырау шалыңыз, толығырақ айтып береміз.",
    qrText: "Сайт",
  },
};

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
const phoneLine = (c) => `<div class="ph"><span class="nm">${c.name ? esc(c.name) : "&nbsp;"}</span><span class="num">${c.phone ? esc(c.phone) : "+7 (___) ___-__-__"}</span></div>`;

const html = (t) => `<!doctype html><html lang="${t.lang}"><head><meta charset="utf-8"><title>Korgen Kassa</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=${t.font.replace(/ /g, "+")}:wght@400;500;700;800&display=swap">
<style>
@page{size:A4;margin:0}
*{box-sizing:border-box}
html,body{margin:0;padding:0;font-family:'${t.font}',Arial,Helvetica,sans-serif;color:#17261F;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.page{width:210mm;height:297mm;position:relative;overflow:hidden;page-break-after:always;padding:14mm 15mm}
.back{padding:11mm 15mm}
.page:last-child{page-break-after:auto}
.front{background:#fff}
.logo{display:block;width:62mm;height:62mm;object-fit:contain;margin:0 auto -4mm}
.eyebrow{font-size:3.6mm;font-weight:700;letter-spacing:.7mm;text-transform:uppercase;color:#17803A;text-align:center;margin:0 0 4mm}
h1{font-size:11.5mm;line-height:1.08;font-weight:800;color:#0F3D2C;text-align:center;margin:0 0 5mm}
.lead{font-size:5mm;line-height:1.35;color:#4A5A52;text-align:center;margin:0 10mm 8mm}
.badge{background:#0F3D2C;color:#fff;border-radius:5mm;padding:7mm 8mm;margin-bottom:7mm}
.badge b{display:block;font-size:8mm;font-weight:800;color:#fff;margin-bottom:2.5mm}
.badge span{font-size:4.4mm;line-height:1.4;color:#CFE6D8}
.cards{display:grid;grid-template-columns:1fr 1fr;gap:4.5mm}
.card{background:#E3F3E8;border-radius:4mm;padding:5mm 5.5mm}
.card h3{margin:0 0 1.8mm;font-size:5mm;font-weight:800;color:#0F3D2C}
.card p{margin:0;font-size:3.9mm;line-height:1.35;color:#2F443A}
.foot{position:absolute;left:15mm;right:15mm;bottom:11mm;display:flex;justify-content:space-between;font-size:3.6mm;color:#4A5A52;border-top:.4mm solid #DDE5DF;padding-top:3mm}
.back{background:#F6F8F5}
h2{font-size:7mm;font-weight:800;color:#0F3D2C;margin:0 0 3.5mm}
.feat{display:flex;flex-direction:column;gap:2.6mm;margin-bottom:5.5mm}
.feat div{background:#fff;border:.3mm solid #DDE5DF;border-radius:3.5mm;padding:2.8mm 4.5mm}
.feat b{display:block;font-size:4.3mm;font-weight:800;color:#0F3D2C;margin-bottom:.6mm}
.feat span{font-size:3.5mm;line-height:1.3;color:#4A5A52}
.steps{display:grid;grid-template-columns:repeat(4,1fr);gap:3mm;margin-bottom:5.5mm}
.step{background:#15503A;border-radius:3.5mm;padding:3mm 3.5mm;color:#fff}
.step i{display:block;font-style:normal;font-size:7.5mm;font-weight:800;color:#22B24C;line-height:1;margin-bottom:1.5mm}
.step span{font-size:3.7mm;line-height:1.3;font-weight:700}
.contact{background:#0F3D2C;border-radius:5mm;padding:5mm 7mm;color:#fff;display:grid;grid-template-columns:1fr 30mm;gap:6mm;align-items:center}
.contact h2{color:#fff;font-size:6mm;margin:0 0 2mm}
.co{font-size:4.4mm;font-weight:800;margin-bottom:2mm}
.ph{display:flex;justify-content:space-between;gap:4mm;font-size:4.4mm;border-bottom:.3mm solid #4C7A66;padding:1.3mm 0}
.ph .nm{color:#CFE6D8}.ph .num{font-weight:700}
.site{margin-top:2.5mm;font-size:4.8mm;font-weight:800;color:#22B24C}
.qr{background:#fff;border-radius:3mm;padding:3mm;text-align:center}
.qr svg{width:100%;height:auto;display:block}
.qr span{display:block;margin-top:1.5mm;font-size:3.2mm;color:#0F3D2C;font-weight:700}
.note{margin:3.5mm 2mm 0;font-size:3.6mm;color:#4A5A52;text-align:center}
</style></head><body>
<section class="page front">
<img class="logo" src="${logo}" alt="Korgen Kassa">
<p class="eyebrow">${esc(t.eyebrow)}</p>
<h1>${esc(t.title)}</h1>
<p class="lead">${esc(t.lead)}</p>
<div class="badge"><b>${esc(t.badge)}</b><span>${esc(t.badgeText)}</span></div>
<div class="cards">${t.cards.map(([h, p]) => `<div class="card"><h3>${esc(h)}</h3><p>${esc(p)}</p></div>`).join("")}</div>
<div class="foot"><span>${esc(t.company)}</span><span>${esc(contacts.site)}</span></div>
</section>
<section class="page back">
<h2>${esc(t.backTitle)}</h2>
<div class="feat">${t.features.map(([h, p]) => `<div><b>${esc(h)}</b><span>${esc(p)}</span></div>`).join("")}</div>
<h2>${esc(t.startTitle)}</h2>
<div class="steps">${t.steps.map((s, i) => `<div class="step"><i>${i + 1}</i><span>${esc(s)}</span></div>`).join("")}</div>
<div class="contact">
<div><h2>${esc(t.contactTitle)}</h2><div class="co">${esc(t.company)}</div>${contacts.people.map(phoneLine).join("")}<div class="site">${esc(contacts.site)}</div></div>
<div class="qr">${qr}<span>${esc(t.qrText)}</span></div>
</div>
<p class="note">${esc(t.note)}</p>
</section></body></html>`;

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
for (const t of Object.values(T)) {
  const page = await browser.newPage();
  await page.setContent(html(t), { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  const out = path.join(root, "sales", `${t.file}.pdf`);
  await page.pdf({ path: out, format: "A4", printBackground: true, margin: { top: 0, right: 0, bottom: 0, left: 0 } });
  writeFileSync(path.join(root, "sales", `${t.file}.html`), html(t));
  console.log("wrote", out);
  await page.close();
}
await browser.close();
