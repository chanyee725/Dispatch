#!/usr/bin/env node
// Entry point for the Claude Code plugin installed from the repository root (.claude-plugin/plugin.json): its
// hooks.json (plugin/hooks/hooks.json) runs ${CLAUDE_PLUGIN_ROOT}/hooks/main-delegates.mjs, which is this file there and
// the real hook when plugin/ itself is the plugin root (release bundle, Codex). The hook runs on import: it
// starts when process.argv[1] ends with "main-delegates.mjs".
import "../plugin/hooks/main-delegates.mjs";
