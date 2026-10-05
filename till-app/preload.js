const { contextBridge, ipcRenderer, webFrame } = require("electron");

// The cashier picks the screen size in ДОП. ФУНКЦИИ; it is kept per computer and applied on every start.
const ZOOM_KEY = "korgen-ui-zoom";
try {
  const saved = Number(localStorage.getItem(ZOOM_KEY));
  if (saved >= 0.5 && saved <= 1.5) webFrame.setZoomFactor(saved);
} catch { /* default size */ }

/** What the till screen may ask of the program around it (the web page has no other access to the computer). */
contextBridge.exposeInMainWorld("korgenShell", {
  minimize: () => ipcRenderer.send("shell:minimize"),
  quit: () => ipcRenderer.send("shell:quit"),
  onCloseRequested: (handler) => {
    const listener = () => handler();
    ipcRenderer.on("shell:close-requested", listener);
    ipcRenderer.send("shell:close-handler", true); // the till screen answers close requests (cart check)
    return () => {
      ipcRenderer.removeListener("shell:close-requested", listener);
      ipcRenderer.send("shell:close-handler", false);
    };
  },
  deferClose: () => ipcRenderer.send("shell:defer-close"),
  cancelClose: () => ipcRenderer.send("shell:cancel-close"),
  confirmClose: () => ipcRenderer.send("shell:confirm-close"),
  info: () => ipcRenderer.invoke("shell:info"),
  printerStatus: () => ipcRenderer.invoke("print:status"),
  printReceipt: (html) => ipcRenderer.invoke("print:receipt", html),
  printLabel: (html, opts) => ipcRenderer.invoke("print:label", html, opts),
  labelPrinter: () => ipcRenderer.invoke("print:label-printer"),
  checkForUpdate: () => ipcRenderer.invoke("update:check"),
  updateStatus: () => ipcRenderer.invoke("update:status"),
  installUpdate: () => ipcRenderer.send("update:install"),
  getZoom: () => Math.round(webFrame.getZoomFactor() * 100),
  setZoom: (percent) => {
    const f = Math.min(1.5, Math.max(0.5, Number(percent) / 100));
    webFrame.setZoomFactor(f);
    try { localStorage.setItem(ZOOM_KEY, String(f)); } catch { /* best effort */ }
    return Math.round(f * 100);
  },
});
