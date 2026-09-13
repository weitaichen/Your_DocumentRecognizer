import express from "express";
import multer from "multer";
import { query } from "@anthropic-ai/claude-agent-sdk";
import Anthropic from "@anthropic-ai/sdk";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadConfig, saveConfig, getCosts, addCost } from "./store.js";
import { estimateCostUsd } from "./pricing.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const MODEL = process.env.RECOGNIZER_MODEL || "claude-opus-4-8";

// 上傳暫存資料夾
const UPLOAD_DIR = path.join(__dirname, "uploads");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// multer：只收圖片，上限 15MB
const upload = multer({
  dest: UPLOAD_DIR,
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith("image/")) cb(null, true);
    else cb(new Error("只接受圖片檔案 (image/*)"));
  },
});

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// 給前端的共用辨識提示詞
const PROMPT =
  `請辨識這張文件圖片（例如收貨單、工單、發票等）中的所有欄位。` +
  `請把圖片上出現的每一個「欄位名稱 : 對應數值」都抽取出來。` +
  `只輸出 JSON，不要任何說明文字、不要 markdown 圍欄，格式為：` +
  `{"fields":[{"category":"欄位名稱","value":"對應數值"}]}。` +
  `類別(category)請用繁體中文；找不到或無法確定的欄位不要捏造。`;

/**
 * 從模型回傳文字中萃取 JSON。
 * 容錯：去除 ```json ... ``` 圍欄，並擷取第一個 { ... } 區塊。
 */
function extractFields(rawText) {
  let text = (rawText || "").trim();

  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch) text = fenceMatch[1].trim();

  if (!text.startsWith("{")) {
    const first = text.indexOf("{");
    const last = text.lastIndexOf("}");
    if (first !== -1 && last !== -1 && last > first) {
      text = text.slice(first, last + 1);
    }
  }

  const parsed = JSON.parse(text);
  const fields = Array.isArray(parsed.fields) ? parsed.fields : [];
  return fields
    .filter((f) => f && (f.category != null || f.value != null))
    .map((f) => ({
      category: String(f.category ?? "").trim(),
      value: String(f.value ?? "").trim(),
    }));
}

// ---- 用 Claude Agent SDK 辨識（走訂閱） ----
async function recognizeWithAgentSdk(b64, mediaType) {
  async function* buildInput() {
    yield {
      type: "user",
      message: {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType, data: b64 } },
          { type: "text", text: PROMPT },
        ],
      },
    };
  }

  // 關鍵：把 ANTHROPIC_API_KEY 從傳給 Claude Code 的環境變數中移除，
  // 保證即使先前用過 API 模式、或機器上有殘留的 key，Agent SDK 仍走訂閱憑證。
  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY;

  let finalText = "";
  let costUsd = 0;
  let apiKeySource = "unknown";
  for await (const msg of query({
    prompt: buildInput(),
    options: { model: MODEL, permissionMode: "bypassPermissions", cwd: __dirname, env },
  })) {
    if (msg.type === "system" && msg.subtype === "init") {
      apiKeySource = msg.apiKeySource;
    }
    if (msg.type === "result" && msg.subtype === "success") {
      finalText = msg.result;
      costUsd = Number(msg.total_cost_usd || 0);
    }
  }
  console.log(`[recognize] Agent SDK 完成 apiKeySource=${apiKeySource} cost=$${costUsd}`);
  return { finalText, costUsd };
}

// ---- 用 Claude Messages API 辨識（走 API key） ----
async function recognizeWithApi(b64, mediaType, apiKey) {
  const client = new Anthropic({ apiKey }); // key 只在此處使用，絕不寫入 process.env
  const resp = await client.messages.create({
    model: MODEL,
    max_tokens: 2048,
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType, data: b64 } },
          { type: "text", text: PROMPT },
        ],
      },
    ],
  });
  const finalText = resp.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n");
  const costUsd = estimateCostUsd(MODEL, resp.usage);
  console.log(`[recognize] API 完成 usage=${JSON.stringify(resp.usage)} 估算=$${costUsd}`);
  return { finalText, costUsd };
}

// ---- 設定 API ----
app.get("/api/settings", (_req, res) => {
  const c = loadConfig();
  res.json({
    mode: c.mode,
    hasApiKey: Boolean(c.apiKey),
    apiKeyMasked: c.apiKey ? maskKey(c.apiKey) : "",
  });
});

app.post("/api/settings", (req, res) => {
  const { mode, apiKey } = req.body || {};
  if (mode !== "agent-sdk" && mode !== "api") {
    return res.status(400).json({ error: "mode 只能是 agent-sdk 或 api" });
  }
  const cur = loadConfig();
  const willHaveKey = (apiKey && apiKey.trim()) || cur.apiKey;
  if (mode === "api" && !willHaveKey) {
    return res.status(400).json({ error: "選擇 Claude API 時必須提供 API Key" });
  }
  const saved = saveConfig({ mode, apiKey });
  res.json({
    mode: saved.mode,
    hasApiKey: Boolean(saved.apiKey),
    apiKeyMasked: saved.apiKey ? maskKey(saved.apiKey) : "",
  });
});

function maskKey(k) {
  if (k.length <= 12) return "****";
  return `${k.slice(0, 7)}…${k.slice(-4)}`;
}

// ---- 花費 API ----
app.get("/api/costs", (_req, res) => {
  res.json(getCosts());
});

// ---- 辨識 API ----
app.post("/api/recognize", (req, res) => {
  upload.single("image")(req, res, async (uploadErr) => {
    if (uploadErr) return res.status(400).json({ error: uploadErr.message });
    if (!req.file) return res.status(400).json({ error: "沒有收到圖片檔案" });

    const absPath = path.resolve(req.file.path);
    const mediaType = req.file.mimetype || "image/png";
    const config = loadConfig(); // 每次都重新讀，切換模式立即生效

    let finalText = "";
    try {
      const b64 = await fs.promises.readFile(absPath, { encoding: "base64" });

      let result;
      if (config.mode === "api") {
        if (!config.apiKey) {
          return res.status(400).json({ error: "尚未設定 API Key，請到設定頁輸入" });
        }
        result = await recognizeWithApi(b64, mediaType, config.apiKey);
      } else {
        result = await recognizeWithAgentSdk(b64, mediaType);
      }

      finalText = result.finalText;
      console.log("[recognize] 原始輸出:\n", finalText);

      const fields = extractFields(finalText);
      // 只有 API 模式（用自己的 API Key、按 token 計費）才累計花費；
      // Agent SDK 走訂閱、不按次扣費，故不計入，畫面維持 $0。
      const costs = config.mode === "api" ? addCost(result.costUsd) : getCosts();
      return res.json({ fields, mode: config.mode, costs });
    } catch (err) {
      console.error("[recognize] 辨識失敗:", err);
      return res.status(500).json({
        error: "辨識失敗：" + (err?.message || String(err)),
        raw: finalText || undefined,
      });
    } finally {
      fs.promises.unlink(absPath).catch(() => {});
    }
  });
});

// 啟動伺服器；listening 後 resolve({ server, port })，埠被占用等錯誤則 reject（供 Electron 判斷）。
// port 傳 0 代表由系統指派空閒埠。
export function startServer(port = PORT) {
  return new Promise((resolve, reject) => {
    const server = app.listen(port, () => {
      const addr = server.address();
      const actualPort = addr && typeof addr === "object" ? addr.port : port;
      const c = loadConfig();
      console.log(`文件辨識器已啟動： http://localhost:${actualPort}`);
      console.log(`使用模型：${MODEL}`);
      console.log(
        `目前辨識模式：${c.mode === "api" ? "Claude API (API key)" : "Claude Agent SDK (訂閱)"}`
      );
      resolve({ server, port: actualPort });
    });
    server.on("error", reject);
  });
}

// 直接以 node 執行（npm start）時才自動啟動；被 import（Electron）時不自動啟動
const isDirectRun =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  startServer().catch((err) => {
    if (err?.code === "EADDRINUSE") {
      console.error(`埠 ${PORT} 已被占用，請關掉占用的程式或用 PORT=其他埠 npm start`);
    } else {
      console.error("伺服器啟動失敗：", err);
    }
    process.exit(1);
  });
}

export { app, PORT };
