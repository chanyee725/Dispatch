#!/usr/bin/env node
// PostToolUse hook (#766): syntax/type check the file an agent just edited.
// Exit 2 feeds the error back to the agent so it fixes it; exit 0 lets it carry on.
// .js/.mjs/.cjs → node --check; .ts/.tsx under shared/ or web/ → tsc -p <dir>; .json → JSON.parse.
import { spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

let input = {};
try { input = JSON.parse(readFileSync(0, "utf8") || "{}"); } catch { process.exit(0); }
const root = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
const file = input.tool_input?.file_path || input.tool_input?.notebook_path;
if (!file || !existsSync(file)) process.exit(0);
const rel = path.relative(root, path.resolve(root, file));
if (rel.startsWith("..") || rel.split(path.sep).includes("node_modules")) process.exit(0);

const run = (cmd, args) => spawnSync(cmd, args, { cwd: root, encoding: "utf8", timeout: 120_000 });
const fail = text => {
  const lines = String(text).trim().split("\n");
  process.stderr.write(`${rel}: check failed\n${lines.slice(0, 40).join("\n")}${lines.length > 40 ? `\n… ${lines.length - 40} more lines` : ""}\n`);
  process.exit(2);
};

const ext = path.extname(rel);
if ([".js", ".mjs", ".cjs"].includes(ext)) {
  const r = run(process.execPath, ["--check", file]);
  if (r.status) fail(r.stderr || r.stdout);
} else if (ext === ".ts" || ext === ".tsx") {
  const project = ["shared", "web"].find(d => rel.startsWith(d + path.sep));
  const tsc = path.join(root, "node_modules", ".bin", "tsc");
  if (project && existsSync(tsc)) {
    const r = run(tsc, ["-p", project, "--noEmit", "--pretty", "false"]);
    if (r.status) fail(r.stdout || r.stderr);
  }
} else if (ext === ".json" && !path.basename(rel).startsWith("tsconfig")) { // tsconfig allows comments
  try { JSON.parse(readFileSync(file, "utf8")); } catch (e) { fail(e.message); }
}
process.exit(0);
