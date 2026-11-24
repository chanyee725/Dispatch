// Short status of an agent session for its live cursor and the agent panel (E536, issue #653): a few words from the
// tool call it runs now and what it last edited, e.g. "다이어그램 작성 중…". Pure, so the server (server/cursor),
// the web app and tests share it. Memory only: the input is the hub's masked, clipped tool text, never stored.

/** What the session last edited in a `.dpx.json` file (from the cursor's diff); null when not known yet. */
export type AgentTarget = 'diagram' | 'doc' | 'table' | null;

export const AGENT_STATUS = {
  thinkDiagram: '다이어그램 생각 중…',
  writeDiagram: '다이어그램 작성 중…',
  writeDoc: '글 작성 중…',
  writeTable: '표 작성 중…',
  readCode: '코드 읽는 중…',
  writeCode: '코드 작성 중…',
  working: '작업 중…',
  waiting: '대기 중',
} as const;

export type AgentStatusLabel = (typeof AGENT_STATUS)[keyof typeof AGENT_STATUS];

export interface AgentStatusInput {
  /** Hub session status: running | starting | waiting (a permission request) | idle | error | ... */
  status?: string | null;
  /** The tool call running now ({ name, text }: hub tool entry, text = masked, clipped input); null between calls. */
  tool?: { name?: string; text?: string } | null;
  /** What the session last edited (see AgentTarget). */
  target?: AgentTarget;
}

const READ_TOOLS = /^(Read|Grep|Glob|LS|NotebookRead)$/;
const EDIT_TOOLS = /^(Edit|Write|MultiEdit|NotebookEdit|edit)$/;
const SHELL = /^(Bash|shell)$/i;
const WAIT_TOOLS = /^(Monitor|TaskOutput|TaskStop)$/;
const DPX = /\.dpx\.json/;
// Shell commands that only read: cat, grep, a curl without a write method or body, ...
const SHELL_READ = /^\W*"?(\{"command":"?)?\s*(cat|sed -n|grep|rg|ls|find|head|tail|wc|jq|git (diff|log|show|status))\b/;
const SHELL_WRITE = /\bcurl\b[^|;&]*(-X\s*(PUT|POST|PATCH|DELETE)|--request\s+(PUT|POST|PATCH|DELETE)|\s(-d|--data[\w-]*|--json|-T)\b)/;
const SHELL_WAIT = /^\W*"?(\{"command":"?)?\s*sleep\b/;
// What a write to a `.dpx.json` changes, from its body: a diagram block or canvas, a table, else the document text.
// (Not "blocks"/"canvas": a whole-file body always has those keys.)
const DIAGRAM_WORDS = /\\?"code\\?"\s*:|\b(flowchart|sequence-diagram|cloud-architecture|entity-relationship|erd|diagramType|mermaid)\b/;
const TABLE_WORDS = /\b(table|tableRow|tableCell|tableHeader)\b|\|\s*-{3,}/;

/** Which part of a `.dpx.json` an edit call writes, from its text; falls back to what it edited last. */
function writeTarget(text: string, last: AgentTarget): Exclude<AgentTarget, null> {
  if (TABLE_WORDS.test(text)) return 'table';
  if (DIAGRAM_WORDS.test(text)) return 'diagram';
  if (/\b(document|paragraph|heading|content)\b/.test(text)) return 'doc';
  return last ?? 'doc';
}

const WRITE: Record<Exclude<AgentTarget, null>, AgentStatusLabel> = {
  diagram: AGENT_STATUS.writeDiagram,
  doc: AGENT_STATUS.writeDoc,
  table: AGENT_STATUS.writeTable,
};

/** Between edits (thinking, reading the file): planning the diagram, or writing the text of the document. */
const between = (target: AgentTarget): AgentStatusLabel => (target === 'diagram' ? AGENT_STATUS.thinkDiagram : target === 'table' ? AGENT_STATUS.writeTable : AGENT_STATUS.writeDoc);

/**
 * The status label of a live session, or null when it is not working (idle, ended, unknown status).
 *   waiting (a permission request) or a wait tool -> "대기 중"
 *   an edit of a `.dpx.json` (Edit/Write, curl PUT/POST) -> "다이어그램 작성 중…" | "표 작성 중…" | "글 작성 중…"
 *   a read of a `.dpx.json`, or no tool (the model is thinking) -> "다이어그램 생각 중…" before a diagram edit,
 *     else "글 작성 중…" (the next text is being written)
 *   other reads -> "코드 읽는 중…"; other edits -> "코드 작성 중…"; any other tool -> "작업 중…"
 */
export function agentStatus({ status, tool, target = null }: AgentStatusInput): AgentStatusLabel | null {
  if (status === 'waiting') return AGENT_STATUS.waiting;
  if (status !== 'running' && status !== 'starting') return null;
  const name = typeof tool?.name === 'string' ? tool.name : '';
  const text = typeof tool?.text === 'string' ? tool.text : '';
  if (!tool || !name) return between(target);
  if (WAIT_TOOLS.test(name)) return AGENT_STATUS.waiting;
  const dpx = DPX.test(text);
  if (READ_TOOLS.test(name)) return dpx ? between(target) : AGENT_STATUS.readCode;
  if (EDIT_TOOLS.test(name)) return dpx ? WRITE[writeTarget(text, target)] : AGENT_STATUS.writeCode;
  if (SHELL.test(name)) {
    if (SHELL_WAIT.test(text)) return AGENT_STATUS.waiting;
    const write = SHELL_WRITE.test(text) && !SHELL_READ.test(text);
    if (dpx || /\/api\/file\b/.test(text)) return write ? WRITE[writeTarget(text, target)] : between(target);
    if (SHELL_READ.test(text)) return AGENT_STATUS.readCode;
    return AGENT_STATUS.working;
  }
  // MCP and other tools that name a document (a Drawing file tool): writing or reading it.
  if (dpx) return /write|put|update|save|edit|create/i.test(name) ? WRITE[writeTarget(text, target)] : between(target);
  return AGENT_STATUS.working;
}
