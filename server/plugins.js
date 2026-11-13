import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

// Claude Code plugins installed on this machine, read from ~/.claude/plugins/installed_plugins.json
// (CLAUDE_CONFIG_DIR overrides ~/.claude). Only install paths are read; nothing is stored.

export function claudeHome() {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");
}

// Install path of the first plugin whose key starts with `<name>@`, or null when it is not installed.
export function pluginDir(name, home = claudeHome()) {
  try {
    const installed = JSON.parse(readFileSync(path.join(home, "plugins", "installed_plugins.json"), "utf8"));
    const entries = Object.entries(installed.plugins ?? installed).find(([k]) => k.startsWith(`${name}@`))?.[1];
    return (Array.isArray(entries) ? entries : [entries]).map(e => e?.installPath).find(Boolean) ?? null;
  } catch {
    return null;
  }
}
