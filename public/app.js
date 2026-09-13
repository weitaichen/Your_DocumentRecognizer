const loadBtn = document.getElementById("loadBtn");
const fileInput = document.getElementById("fileInput");
const preview = document.getElementById("preview");
const previewWrap = document.getElementById("previewWrap");
const previewHint = document.getElementById("previewHint");
const recognizeBtn = document.getElementById("recognizeBtn");
const statusEl = document.getElementById("status");
const resultBody = document.getElementById("resultBody");
const costToday = document.getElementById("costToday");
const costTotal = document.getElementById("costTotal");
const modeLabel = document.getElementById("modeLabel");

let currentFile = null;

const fmt = (n) => "$" + Number(n || 0).toFixed(4);

async function refreshCosts() {
  try {
    const r = await fetch("/api/costs");
    const c = await r.json();
    costToday.textContent = fmt(c.today);
    costTotal.textContent = fmt(c.total);
  } catch {
    /* 忽略 */
  }
}

async function refreshMode() {
  try {
    const r = await fetch("/api/settings");
    const s = await r.json();
    modeLabel.textContent =
      s.mode === "api" ? "Claude API" : "Claude Agent SDK（訂閱）";
  } catch {
    /* 忽略 */
  }
}

// 進頁時載入花費與目前模式
refreshCosts();
refreshMode();

// 「載入圖檔」→ 觸發隱藏的 file input
loadBtn.addEventListener("click", () => fileInput.click());

fileInput.addEventListener("change", () => {
  const file = fileInput.files && fileInput.files[0];
  if (!file) return;

  currentFile = file;
  const url = URL.createObjectURL(file);
  preview.src = url;
  preview.hidden = false;
  previewHint.hidden = true;
  previewWrap.classList.remove("empty");

  recognizeBtn.disabled = false;
  setStatus("", "");
  resetTable("辨識結果會顯示在這裡");
});

recognizeBtn.addEventListener("click", async () => {
  if (!currentFile) return;

  recognizeBtn.disabled = true;
  loadBtn.disabled = true;
  setStatus("辨識中…（可能需要數秒）", "loading");
  resetTable("辨識中…");

  try {
    const form = new FormData();
    form.append("image", currentFile);

    const resp = await fetch("/api/recognize", { method: "POST", body: form });
    const data = await resp.json();

    if (!resp.ok) {
      throw new Error(data.error || `伺服器錯誤 (${resp.status})`);
    }

    renderTable(data.fields || []);
    setStatus(`完成，共辨識 ${data.fields ? data.fields.length : 0} 個欄位`, "");

    // 更新花費（後端已回傳最新值，直接套用；並再拉一次以防萬一）
    if (data.costs) {
      costToday.textContent = fmt(data.costs.today);
      costTotal.textContent = fmt(data.costs.total);
    } else {
      refreshCosts();
    }
  } catch (err) {
    setStatus("錯誤：" + err.message, "error");
    resetTable("辨識失敗");
  } finally {
    recognizeBtn.disabled = false;
    loadBtn.disabled = false;
  }
});

function setStatus(text, kind) {
  statusEl.textContent = text;
  statusEl.className = "status" + (kind ? " " + kind : "");
}

function resetTable(message) {
  resultBody.innerHTML = "";
  const tr = document.createElement("tr");
  tr.className = "placeholder";
  const td = document.createElement("td");
  td.colSpan = 2;
  td.textContent = message;
  tr.appendChild(td);
  resultBody.appendChild(tr);
}

function renderTable(fields) {
  resultBody.innerHTML = "";

  if (!fields.length) {
    const tr = document.createElement("tr");
    tr.className = "empty";
    const td = document.createElement("td");
    td.colSpan = 2;
    td.textContent = "未辨識到欄位";
    tr.appendChild(td);
    resultBody.appendChild(tr);
    return;
  }

  for (const f of fields) {
    const tr = document.createElement("tr");
    const cat = document.createElement("td");
    cat.textContent = f.category || "";
    const val = document.createElement("td");
    val.textContent = f.value || "";
    tr.appendChild(cat);
    tr.appendChild(val);
    resultBody.appendChild(tr);
  }
}
