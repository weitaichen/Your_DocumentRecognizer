// Messages API 模式的花費估算。
// 註：Messages API 不會直接回傳金額，需用 token 用量 × 單價自行計算。
// 下方單價為「每百萬 token 美元」，屬預設估算值，若官方調價請自行修改。
// （Agent SDK 模式不使用這張表——它的 result 直接回傳 total_cost_usd。）
const MODEL_PRICING = {
  // model 前綴比對：input / output（每 1M tokens 的美元）
  "claude-opus-4": { input: 15, output: 75 },
  "claude-fable-5": { input: 15, output: 75 },
  "claude-sonnet-5": { input: 3, output: 15 },
  "claude-sonnet-4": { input: 3, output: 15 },
  "claude-haiku-4": { input: 1, output: 5 },
  "claude-3-5-haiku": { input: 0.8, output: 4 },
};

const FALLBACK = { input: 15, output: 75 };

function priceFor(model) {
  const name = String(model || "");
  for (const prefix of Object.keys(MODEL_PRICING)) {
    if (name.startsWith(prefix)) return MODEL_PRICING[prefix];
  }
  return FALLBACK;
}

// usage: Anthropic Messages API 回傳的 usage 物件
export function estimateCostUsd(model, usage) {
  if (!usage) return 0;
  const p = priceFor(model);
  const inTok = Number(usage.input_tokens || 0);
  const outTok = Number(usage.output_tokens || 0);
  // 快取 token 也一併粗估（讀取視為 input 單價的一小部分，這裡保守以 input 單價計）
  const cacheCreate = Number(usage.cache_creation_input_tokens || 0);
  const cacheRead = Number(usage.cache_read_input_tokens || 0);
  const inputCost = ((inTok + cacheCreate + cacheRead) / 1e6) * p.input;
  const outputCost = (outTok / 1e6) * p.output;
  return inputCost + outputCost;
}
