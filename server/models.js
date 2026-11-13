import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

const CLAUDE_EFFORTS = ["low", "medium", "high", "xhigh", "max"];

const GEMINI_EFFORTS = ["low", "medium", "high", "xhigh", "max"];
const GEMINI_MODELS = [
  { id: "gemini-3.8-flash-high", label: "Gemini 3.8 Flash (High)" },
  { id: "gemini-3.8-flash-medium", label: "Gemini 3.8 Flash (Medium)" },
  { id: "gemini-3.8-flash-low", label: "Gemini 3.8 Flash (Low)" },
].map(m => ({ ...m, provider: "gemini", efforts: GEMINI_EFFORTS, defaultEffort: "high", contextWindow: 1000000 }));

const CLAUDE_MODELS = [
  { id: "claude-opus-5-5", label: "Opus 5.5" },
  { id: "claude-sonnet-5-5", label: "Sonnet 5.5" },
  { id: "claude-haiku-5-5", label: "Haiku 5.5" },
  { id: "claude-fable-5-1", label: "Fable 5.1" },
  { id: "claude-fable-5-2", label: "Fable 5.2" },
].map(m => ({ ...m, provider: "claude", efforts: CLAUDE_EFFORTS, defaultEffort: null, contextWindow: 200000 }));

// Codex publishes its catalog through `codex debug models`; only "list" models are user-selectable.
async function codexModels() {
  try {
    const { stdout } = await run("codex", ["debug", "models"], { maxBuffer: 64 << 20, timeout: 20000 });
    const data = JSON.parse(stdout);
    const list = Array.isArray(data) ? data : data.models || [];
    return list
      .filter(m => m.visibility === "list")
      .sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0))
      .map(m => ({
        id: m.slug,
        label: m.display_name || m.slug,
        provider: "openai",
        efforts: (m.supported_reasoning_levels || []).map(l => l.effort),
        defaultEffort: m.default_reasoning_level || null,
        contextWindow: m.context_window || 272000,
      }));
  } catch {
    return [];
  }
}

export async function loadModels() {
  return [...GEMINI_MODELS, ...CLAUDE_MODELS, ...(await codexModels())];
}
