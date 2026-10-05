/**
 * Korgen Kassa till program (plan section 12, stage A4). A small window around the till screen:
 *  - the till screens (web/) live INSIDE the program, so it opens with no internet at all;
 *  - a tiny local web server on a fixed address serves them (a fixed address keeps the till's own saved data in one place);
 *  - everything the till needs from the server (/api, product images ...) is passed on to the market's server; when that
 *    cannot be reached the till gets a plain 503, which is exactly what its offline logic already treats as "no connection".
 */
const { app, BrowserWindow, Menu, ipcMain, shell, dialog } = require("electron");
const { autoUpdater } = require("electron-updater");
const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");

const PORT = 38471;
const WEB = path.join(__dirname, "web");
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".map": "application/json",
  ".webmanifest": "application/manifest+json",
};

/** The market server: KORGEN_SERVER_URL, else userData/config.json {"serverUrl": "..."}, else the live server. */
function serverUrl() {
  if (process.env.KORGEN_SERVER_URL) return process.env.KORGEN_SERVER_URL.replace(/\/+$/, "");
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(app.getPath("userData"), "config.json"), "utf8"));
    if (typeof cfg.serverUrl === "string" && cfg.serverUrl) return cfg.serverUrl.replace(/\/+$/, "");
  } catch {
    /* no config yet */
  }
  return "https://korgenkassa.kz";
}

function sendFile(res, file, immutable) {
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("Not found");
      return;
    }
    res.writeHead(200, {
      "content-type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream",
      "cache-control": immutable ? "public, max-age=31536000, immutable" : "no-cache",
    });
    res.end(data);
  });
}

/** A file under web/, or null if the path tries to leave it. */
function inside(rel) {
  const full = path.normalize(path.join(WEB, rel));
  return full.startsWith(WEB + path.sep) ? full : null;
}

// With a cable or Wi-Fi but no internet, every call used to wait for its timeout before the till fell back to its own
// data («Обработка», «Загрузка» hung). After a failure answer "offline" at once for a few seconds, and give up sooner.
let upstreamDownUntil = 0;

function proxy(req, res) {
  const target = new URL(serverUrl());
  const lib = target.protocol === "https:" ? https : http;
  const headers = { ...req.headers, host: target.host, origin: target.origin, "x-korgen-version": app.getVersion() };
  delete headers.referer;
  const api = req.url.startsWith("/api/");
  if (api && Date.now() < upstreamDownUntil) {
    res.writeHead(503, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "offline" }));
    req.resume();
    return;
  }
  const up = lib.request(
    { protocol: target.protocol, hostname: target.hostname, port: target.port || undefined, method: req.method, path: req.url, headers, timeout: api ? 8000 : 30000 },
    (r) => {
      if (api) upstreamDownUntil = 0;
      res.writeHead(r.statusCode || 502, r.headers);
      r.pipe(res);
    },
  );
  const offline = () => {
    if (api) upstreamDownUntil = Date.now() + 10000;
    if (res.headersSent) {
      res.destroy();
      return;
    }
    res.writeHead(503, { "content-type": api ? "application/json" : "text/plain" });
    res.end(api ? JSON.stringify({ error: "offline" }) : "offline");
  };
  up.on("timeout", () => up.destroy());
  up.on("error", offline);
  req.pipe(up);
}

function handle(req, res) {
  const url = new URL(req.url, "http://local");
  let p;
  try {
    p = decodeURIComponent(url.pathname);
  } catch {
    res.writeHead(400);
    res.end();
    return;
  }
  if (p === "/") {
    res.writeHead(302, { location: "/till" });
    res.end();
    return;
  }
  if (p === "/till" || p === "/till/") return sendFile(res, path.join(WEB, "till.html"), false);
  if (p.startsWith("/_next/static/")) {
    const f = inside(p);
    return f ? sendFile(res, f, true) : proxy(req, res);
  }
  const pub = inside(path.join("public", p));
  if (pub && fs.existsSync(pub) && fs.statSync(pub).isFile()) return sendFile(res, pub, false);
  return proxy(req, res);
}

/**
 * Automatic updates. The program looks for a newer version by itself when it starts and every few hours (only when the
 * market's server answers), downloads it quietly, and installs it the next time the program is closed — it never restarts
 * in the middle of a sale. "ПРОВЕРИТЬ ОБНОВЛЕНИЕ" in ДОП. ФУНКЦИИ can ask right now and offer to install at once.
 * The versions are files on the market's server (Korgen Kassa serves /till-updates/), see docs/till-updates.md.
 */
let update = { state: "idle", version: null, message: null };
function updateFeed() {
  return process.env.KORGEN_UPDATE_URL ? process.env.KORGEN_UPDATE_URL.replace(/\/+$/, "") : serverUrl() + "/till-updates";
}
function logUpdate(line) {
  try {
    fs.appendFileSync(path.join(app.getPath("userData"), "update.log"), new Date().toISOString() + " " + line + "\n");
  } catch {
    /* logging is best effort */
  }
}
async function checkForUpdate() {
  if (!app.isPackaged && !process.env.KORGEN_FORCE_UPDATES) return update;
  try {
    autoUpdater.setFeedURL({ provider: "generic", url: updateFeed() });
    await autoUpdater.checkForUpdates();
  } catch (e) {
    update = { state: "error", version: null, message: String((e && e.message) || e) };
    logUpdate("check failed: " + update.message);
  }
  return update;
}
function setupUpdates() {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowDowngrade = false;
  autoUpdater.logger = null;
  autoUpdater.on("update-available", (i) => {
    update = { state: "downloading", version: i.version, message: null };
    logUpdate("available " + i.version);
  });
  autoUpdater.on("update-not-available", () => {
    update = { state: "none", version: null, message: null };
    logUpdate("none");
  });
  autoUpdater.on("update-downloaded", (i) => {
    update = { state: "ready", version: i.version, message: null };
    logUpdate("downloaded " + i.version);
  });
  autoUpdater.on("error", (e) => {
    update = { state: "error", version: null, message: String((e && e.message) || e) };
    logUpdate("error " + update.message);
  });
  ipcMain.handle("update:check", () => checkForUpdate());
  ipcMain.handle("update:status", () => update);
  ipcMain.on("update:install", () => {
    if (update.state === "ready") autoUpdater.quitAndInstall(false, true);
  });
  setTimeout(() => void checkForUpdate(), 20_000);
  setInterval(() => void checkForUpdate(), 4 * 3600_000);
}

/**
 * Receipt printing. The cashier's screen hands over the finished receipt (HTML with its styles); the program prints it
 * silently — no dialog — on the receipt printer through its normal Windows driver, so Russian letters, ₸ and the paper
 * width are the driver's job. Which printer: {"printer": "XP-76"} in %APPDATA%\Korgen Kassa\config.json, else the first
 * installed printer that looks like a receipt printer (XP-..., POS-..., Xprinter, thermal, receipt), else the Windows default.
 */
const VIRTUAL_PRINTER = /onenote|pdf|xps|fax|anydesk|microsoft print|send to/i;
const RECEIPT_PRINTER = /(^|[^a-z])(xp|pos)[-\s]?\d|xprinter|thermal|receipt|чек/i;
function configuredPrinter() {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(app.getPath("userData"), "config.json"), "utf8"));
    return typeof cfg.printer === "string" && cfg.printer ? cfg.printer : null;
  } catch {
    return null;
  }
}
async function pickPrinter(webContents) {
  const printers = await webContents.getPrintersAsync();
  const want = configuredPrinter();
  if (want) {
    const hit = printers.find((p) => p.name === want);
    if (hit) return hit.name;
  }
  const real = printers.filter((p) => !VIRTUAL_PRINTER.test(p.name));
  const receipt = real.find((p) => RECEIPT_PRINTER.test(p.name));
  if (receipt) return receipt.name;
  const def = real.find((p) => p.isDefault) || real[0];
  return def ? def.name : null;
}
/**
 * The receipt is drawn in a hidden window at the printer's own resolution, turned into black/white dots, and sent to the
 * printer as raw ESC/POS raster data straight through the Windows spooler (RAW). No driver scaling: the Windows driver of
 * these roll printers reports an odd 160x72 dpi and resamples any picture (blurry, glued-together letters); raw dots are
 * printed 1:1 and stay sharp. The printable width of an 80 mm class printer is 576 dots (72 mm); a narrower one can be set
 * with {"printWidthDots": 384} in %APPDATA%\Korgen Kassa\config.json.
 */
const RAW_SEND_SCRIPT = "param([string]$Printer, [string]$File)\nAdd-Type -TypeDefinition @\"\nusing System;\nusing System.Runtime.InteropServices;\npublic class RawPrinter {\n  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]\n  public class DOCINFO { [MarshalAs(UnmanagedType.LPWStr)] public string pDocName; [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile; [MarshalAs(UnmanagedType.LPWStr)] public string pDataType; }\n  [DllImport(\"winspool.drv\", EntryPoint = \"OpenPrinterW\", SetLastError = true, CharSet = CharSet.Unicode)] public static extern bool OpenPrinter(string name, out IntPtr h, IntPtr pd);\n  [DllImport(\"winspool.drv\", SetLastError = true)] public static extern bool ClosePrinter(IntPtr h);\n  [DllImport(\"winspool.drv\", EntryPoint = \"StartDocPrinterW\", SetLastError = true, CharSet = CharSet.Unicode)] public static extern bool StartDocPrinter(IntPtr h, int level, [In] DOCINFO di);\n  [DllImport(\"winspool.drv\", SetLastError = true)] public static extern bool EndDocPrinter(IntPtr h);\n  [DllImport(\"winspool.drv\", SetLastError = true)] public static extern bool StartPagePrinter(IntPtr h);\n  [DllImport(\"winspool.drv\", SetLastError = true)] public static extern bool EndPagePrinter(IntPtr h);\n  [DllImport(\"winspool.drv\", SetLastError = true)] public static extern bool WritePrinter(IntPtr h, byte[] bytes, int count, out int written);\n  public static string Send(string printer, byte[] data) {\n    IntPtr h;\n    if (!OpenPrinter(printer, out h, IntPtr.Zero)) return \"OpenPrinter failed \" + Marshal.GetLastWin32Error();\n    var di = new DOCINFO { pDocName = \"Korgen Kassa receipt\", pDataType = \"RAW\" };\n    string err = null;\n    if (!StartDocPrinter(h, 1, di)) err = \"StartDoc failed \" + Marshal.GetLastWin32Error();\n    else {\n      StartPagePrinter(h);\n      int written;\n      if (!WritePrinter(h, data, data.Length, out written) || written != data.Length) err = \"WritePrinter failed \" + Marshal.GetLastWin32Error();\n      EndPagePrinter(h);\n      EndDocPrinter(h);\n    }\n    ClosePrinter(h);\n    return err;\n  }\n}\n\"@\n$bytes = [System.IO.File]::ReadAllBytes($File)\n$err = [RawPrinter]::Send($Printer, $bytes)\nif ($err) { Write-Error $err; exit 2 }\n";

function printWidthDots() {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(app.getPath("userData"), "config.json"), "utf8"));
    const n = Number(cfg.printWidthDots);
    if (Number.isFinite(n) && n >= 192 && n <= 832 && n % 8 === 0) return n;
  } catch {
    /* default */
  }
  return 576;
}

/** ESC/POS: initialise, the picture as raster bands (GS v 0), a little feed, partial cut. bgra = image pixels, 4 bytes each. */
function escPosRaster(bgra, width, height) {
  const bytesPerRow = width / 8;
  const rows = Buffer.alloc(bytesPerRow * height);
  for (let y = 0; y < height; y++) {
    for (let bx = 0; bx < bytesPerRow; bx++) {
      let b = 0;
      for (let i = 0; i < 8; i++) {
        const o = (y * width + bx * 8 + i) * 4;
        const lum = 0.114 * bgra[o] + 0.587 * bgra[o + 1] + 0.299 * bgra[o + 2];
        b = (b << 1) | (bgra[o + 3] > 40 && lum < 165 ? 1 : 0);
      }
      rows[y * bytesPerRow + bx] = b;
    }
  }
  const parts = [Buffer.from([0x1b, 0x40])];
  const BAND = 128;
  for (let y0 = 0; y0 < height; y0 += BAND) {
    const h = Math.min(BAND, height - y0);
    parts.push(Buffer.from([0x1d, 0x76, 0x30, 0x00, bytesPerRow & 255, bytesPerRow >> 8, h & 255, h >> 8]));
    parts.push(rows.subarray(y0 * bytesPerRow, (y0 + h) * bytesPerRow));
  }
  parts.push(Buffer.from([0x1b, 0x64, 0x03, 0x1d, 0x56, 0x42, 0x00])); // feed 3 lines, feed to cut position and cut
  return { data: Buffer.concat(parts), rows };
}

async function printReceiptHtml(html) {
  const dots = printWidthDots();
  const cssWidth = (dots / 203) * 96; // the printer's width in CSS pixels (203 dpi)
  const oversample = 2; // draw twice as large, shrink smoothly: sharper letters than drawing at 1:1
  const zoom = (dots * oversample) / cssWidth;
  const win = new BrowserWindow({
    show: false,
    width: dots * oversample,
    height: 400,
    useContentSize: true,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, zoomFactor: zoom },
  });
  const tmp = path.join(app.getPath("temp"), "korgen-receipt-" + Date.now());
  try {
    await win.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html));
    await win.webContents.insertCSS("html,body{overflow:hidden!important} ::-webkit-scrollbar{display:none!important}"); // no scrollbar strip in the picture
    const deviceName = await pickPrinter(win.webContents);
    if (!deviceName) return { ok: false, error: "Принтер не найден. Установите драйвер принтера." };
    const cssHeight = await win.webContents.executeJavaScript("Math.ceil(document.documentElement.scrollHeight)");
    const height = Math.max(60, Math.ceil(cssHeight * zoom));
    win.setContentSize(dots * oversample, height);
    await new Promise((r) => setTimeout(r, 400)); // let the layout settle at the new size
    const big = await win.webContents.capturePage({ x: 0, y: 0, width: dots * oversample, height });
    const small = big.resize({ width: dots, quality: "best" });
    const size = small.getSize();
    const bitmap = small.toBitmap();
    const { data, rows } = escPosRaster(bitmap, size.width, size.height);
    if (process.env.KORGEN_PRINT_DEBUG) {
      const mono = Buffer.alloc(size.width * size.height * 4, 255);
      for (let y = 0; y < size.height; y++) for (let x = 0; x < size.width; x++) {
        const bit = (rows[y * (size.width / 8) + (x >> 3)] >> (7 - (x & 7))) & 1;
        if (bit) { const o = (y * size.width + x) * 4; mono[o] = mono[o + 1] = mono[o + 2] = 0; }
      }
      fs.writeFileSync(path.join(app.getPath("userData"), "print-debug.png"), require("electron").nativeImage.createFromBitmap(mono, { width: size.width, height: size.height }).toPNG());
    }
    fs.writeFileSync(tmp + ".bin", data);
    fs.writeFileSync(tmp + ".ps1", "\ufeff" + RAW_SEND_SCRIPT);
    return await new Promise((resolve) => {
      require("child_process").execFile(
        "powershell.exe",
        ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", tmp + ".ps1", "-Printer", deviceName, "-File", tmp + ".bin"],
        { windowsHide: true, timeout: 60_000 },
        (err, _out, errOut) => resolve(err ? { ok: false, error: String(errOut || err.message).trim().slice(0, 300) } : { ok: true, printer: deviceName }),
      );
    });
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  } finally {
    setTimeout(() => {
      win.destroy();
      for (const ext of [".bin", ".ps1"]) fs.rm(tmp + ext, { force: true }, () => {});
    }, 3000);
  }
}

let server;
function startServer() {
  return new Promise((resolve, reject) => {
    server = http.createServer(handle);
    server.once("error", reject);
    server.listen(PORT, "127.0.0.1", () => resolve());
  });
}

let win;
let allowWindowClose = false;
let closeHandlerReady = false;
let closeRequestPending = false;
let closeFallbackTimer;
function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    backgroundColor: "#ffffff",
    autoHideMenuBar: true,
    title: "Korgen Kassa",
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  // Full screen, no title bar: the till fills the monitor like a real cash register. F11 switches it off and on.
  win.setFullScreen(true);
  win.webContents.on("before-input-event", (event, input) => {
    if (input.type === "keyDown" && input.key === "F11") {
      event.preventDefault();
      win.setFullScreen(!win.isFullScreen());
    }
  });
  // Keep an unfinished sale from disappearing when the cashier clicks the window's X / Alt+F4.
  win.on("close", (event) => {
    if (allowWindowClose) return;
    event.preventDefault();
    if (closeRequestPending) return;
    closeRequestPending = true;
    win.webContents.send("shell:close-requested");
    // No POS screen is mounted (e.g. PIN/activation page): don't trap the cashier in the app. When the till screen
    // does answer close requests, give a slow computer plenty of time (it answers at once, with a cart check).
    closeFallbackTimer = setTimeout(() => {
      allowWindowClose = true;
      if (win && !win.isDestroyed()) win.close();
    }, closeHandlerReady ? 5000 : 400);
    // A delayed answer from a slow renderer should still be able to recover on the next close attempt.
    setTimeout(() => { closeRequestPending = false; }, 5000);
  });
  win.once("ready-to-show", () => win.show());
  win.loadURL(`http://127.0.0.1:${PORT}/till`);
  // links to other sites open in the normal browser, never inside the till window
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url) && !url.startsWith(`http://127.0.0.1:${PORT}`)) void shell.openExternal(url);
    return { action: "deny" };
  });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
  Menu.setApplicationMenu(null);
  app.whenReady().then(async () => {
    try {
      await startServer();
    } catch (e) {
      dialog.showErrorBox("Korgen Kassa", `Не удалось запустить кассу: порт ${PORT} занят другой программой.\n${e.message}`);
      app.quit();
      return;
    }
    ipcMain.handle("print:receipt", (_e, html) => (typeof html === "string" && html.length < 3_000_000 ? printReceiptHtml(html) : { ok: false, error: "bad receipt" }));
    // «ПРИНТЕР» light on the till screen: is the receipt printer installed and ready (not switched off / unplugged / out of paper)?
    ipcMain.handle("print:status", async () => {
      try {
        const wc = win && !win.isDestroyed() ? win.webContents : null;
        if (!wc) return { found: false, ready: false, name: null, status: 0 };
        const name = await pickPrinter(wc);
        if (!name) return { found: false, ready: false, name: null, status: 0 };
        const info = (await wc.getPrintersAsync()).find((p) => p.name === name);
        const status = Number((info && info.status) || 0);
        // Windows PRINTER_STATUS_*: ERROR 0x2, PAPER_OUT 0x10, OFFLINE 0x80, NOT_AVAILABLE 0x1000, DOOR_OPEN 0x400000
        const bad = 0x2 | 0x10 | 0x80 | 0x1000 | 0x400000;
        return { found: true, ready: (status & bad) === 0, name, status };
      } catch {
        return { found: false, ready: false, name: null, status: 0 };
      }
    });
    ipcMain.on("shell:minimize", () => win && win.minimize());
    ipcMain.on("shell:quit", () => win && win.close());
    ipcMain.on("shell:close-handler", (_event, ready) => { closeHandlerReady = Boolean(ready); });
    ipcMain.on("shell:defer-close", () => clearTimeout(closeFallbackTimer));
    ipcMain.on("shell:cancel-close", () => {
      clearTimeout(closeFallbackTimer);
      closeRequestPending = false;
    });
    ipcMain.on("shell:confirm-close", () => {
      clearTimeout(closeFallbackTimer);
      allowWindowClose = true;
      closeRequestPending = false;
      if (win && !win.isDestroyed()) win.close();
    });
    ipcMain.handle("shell:info", () => ({ version: app.getVersion(), serverUrl: serverUrl() }));
    createWindow();
    setupUpdates();
  });
  app.on("window-all-closed", () => app.quit());
  app.on("before-quit", () => {
    clearTimeout(closeFallbackTimer);
    allowWindowClose = true;
    if (server) server.close();
  });
}
