// 設定與花費的本機持久化：存在 data/ 資料夾（已被 .gitignore 排除，內含 API key）
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "data");
const CONFIG_FILE = path.join(DATA_DIR, "config.json");
const COSTS_FILE = path.join(DATA_DIR, "costs.json");

fs.mkdirSync(DATA_DIR, { recursive: true });

const DEFAULT_CONFIG = { mode: "agent-sdk", apiKey: "" };
const DEFAULT_COSTS = { byDate: {}, total: 0 };

function readJson(file, fallback) {
  try {
    return { ...fallback, ...JSON.parse(fs.readFileSync(file, "utf8")) };
  } catch {
    return { ...fallback };
  }
}

function writeJson(file, obj) {
  fs.writeFileSync(file, JSON.stringify(obj, null, 2), "utf8");
}

// ---- 設定 ----
export function loadConfig() {
  const c = readJson(CONFIG_FILE, DEFAULT_CONFIG);
  // 僅接受合法 mode
  if (c.mode !== "agent-sdk" && c.mode !== "api") c.mode = "agent-sdk";
  if (typeof c.apiKey !== "string") c.apiKey = "";
  return c;
}

export function saveConfig(next) {
  const cur = loadConfig();
  const merged = {
    mode: next.mode === "api" ? "api" : "agent-sdk",
    // 沒帶新 key 時保留原本的
    apiKey:
      typeof next.apiKey === "string" && next.apiKey.trim() !== ""
        ? next.apiKey.trim()
        : cur.apiKey,
  };
  writeJson(CONFIG_FILE, merged);
  return merged;
}

// ---- 花費 ----
function todayStr() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function getCosts() {
  const c = readJson(COSTS_FILE, DEFAULT_COSTS);
  const date = todayStr();
  return {
    date,
    today: Number(c.byDate?.[date] || 0),
    total: Number(c.total || 0),
  };
}

export function addCost(usd) {
  const amount = Number(usd);
  if (!Number.isFinite(amount) || amount <= 0) return getCosts();
  const c = readJson(COSTS_FILE, DEFAULT_COSTS);
  const date = todayStr();
  if (!c.byDate) c.byDate = {};
  c.byDate[date] = Number(c.byDate[date] || 0) + amount;
  c.total = Number(c.total || 0) + amount;
  writeJson(COSTS_FILE, c);
  return { date, today: c.byDate[date], total: c.total };
}
