const radios = [...document.querySelectorAll('input[name="mode"]')];
const apiKeyBlock = document.getElementById("apiKeyBlock");
const apiKeyInput = document.getElementById("apiKeyInput");
const keyHint = document.getElementById("keyHint");
const saveBtn = document.getElementById("saveBtn");
const statusEl = document.getElementById("settingsStatus");

let hasStoredKey = false;

function selectedMode() {
  const r = radios.find((x) => x.checked);
  return r ? r.value : "agent-sdk";
}

function syncApiKeyVisibility() {
  apiKeyBlock.hidden = selectedMode() !== "api";
}

radios.forEach((r) => r.addEventListener("change", syncApiKeyVisibility));

// 載入目前設定
async function load() {
  try {
    const s = await (await fetch("/api/settings")).json();
    const target = radios.find((r) => r.value === s.mode) || radios[0];
    target.checked = true;
    hasStoredKey = s.hasApiKey;
    if (s.hasApiKey) {
      keyHint.textContent = `已儲存金鑰：${s.apiKeyMasked}（留空即沿用；要更換請輸入新的）`;
      apiKeyInput.placeholder = "留空 = 沿用已儲存的金鑰";
    } else {
      keyHint.textContent = "尚未儲存金鑰";
    }
    syncApiKeyVisibility();
  } catch (e) {
    setStatus("載入設定失敗：" + e.message, "error");
  }
}

saveBtn.addEventListener("click", async () => {
  const mode = selectedMode();
  const apiKey = apiKeyInput.value.trim();

  if (mode === "api" && !apiKey && !hasStoredKey) {
    setStatus("選擇 Claude API 時必須輸入 API Key", "error");
    return;
  }

  saveBtn.disabled = true;
  setStatus("儲存中…", "loading");
  try {
    const resp = await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode, apiKey: apiKey || undefined }),
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || `伺服器錯誤 (${resp.status})`);

    hasStoredKey = data.hasApiKey;
    apiKeyInput.value = "";
    if (data.hasApiKey) {
      keyHint.textContent = `已儲存金鑰：${data.apiKeyMasked}（留空即沿用；要更換請輸入新的）`;
    }
    setStatus(
      `已儲存，目前模式：${data.mode === "api" ? "Claude API" : "Claude Agent SDK（訂閱）"}`,
      ""
    );
  } catch (e) {
    setStatus("儲存失敗：" + e.message, "error");
  } finally {
    saveBtn.disabled = false;
  }
});

function setStatus(text, kind) {
  statusEl.textContent = text;
  statusEl.className = "status" + (kind ? " " + kind : "");
}

load();
