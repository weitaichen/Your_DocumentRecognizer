// Electron 外殼：先啟動內建的 Express 伺服器，再用桌面視窗載入它。
import { app, BrowserWindow, shell, dialog } from "electron";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startServer, PORT } from "./server.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
function logErr(where, err) {
  const line = `[${where}] ${err?.stack || err}\n`;
  try {
    fs.appendFileSync(path.join(__dirname, "electron-error.log"), line);
  } catch {}
}
process.on("uncaughtException", (e) => logErr("uncaughtException", e));
process.on("unhandledRejection", (e) => logErr("unhandledRejection", e));

let mainWindow = null;

function createWindow(url) {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 820,
    title: "文件辨識器 · Your DocumentRecognizer",
    backgroundColor: "#f4f5f7",
    webPreferences: {
      // 前端只是靜態頁 + fetch 呼叫本機 API，不需要 node 整合
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadURL(url);

  // 外部連結用系統瀏覽器開，不在 app 內導覽
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

// 檢查某埠上跑的是不是「本 app」（避免誤把別的程式當成自己）
async function isOurApp(port) {
  try {
    const r = await fetch(`http://localhost:${port}/api/settings`, {
      signal: AbortSignal.timeout(1500),
    });
    if (!r.ok) return false;
    const j = await r.json();
    return typeof j?.mode === "string";
  } catch {
    return false;
  }
}

// 決定要載入的網址：優先在 PORT 啟動；被占用時，若已是本 app 就重用，否則換空閒埠
async function resolveUrl() {
  try {
    const { port } = await startServer(PORT);
    return `http://localhost:${port}`;
  } catch (err) {
    if (err?.code !== "EADDRINUSE") throw err;
    if (await isOurApp(PORT)) {
      console.log(`埠 ${PORT} 已有本 app 在跑，直接重用。`);
      return `http://localhost:${PORT}`;
    }
    console.log(`埠 ${PORT} 被其他程式占用，改用系統指派的空閒埠。`);
    const { port } = await startServer(0);
    return `http://localhost:${port}`;
  }
}

app.whenReady().then(async () => {
  try {
    const url = await resolveUrl(); // 先確定有可用的伺服器，再開視窗
    createWindow(url);
  } catch (err) {
    logErr("startup", err);
    dialog.showErrorBox("啟動失敗", String(err?.stack || err));
    app.quit();
    return;
  }

  // macOS：點 dock 圖示且無視窗時重新開一個
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// 關閉所有視窗即結束（macOS 慣例除外）
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
