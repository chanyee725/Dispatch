#!/usr/bin/env node
// Entry point: parse CLI args, start the server, print the URL.
import { resolve } from 'node:path';
import { statSync } from 'node:fs';
import { createApp } from './app.js';
import { parseArgs, USAGE } from './cli.js';
import { claimWorkspace } from './lock.js';
import { readDefaultsSync, startDefaults } from './user-defaults.js';
import { copyUserStateSync } from './dispatch/state-migrate.js';

const HOST = '127.0.0.1';
const DEFAULT_PORT = 4330;

// ~/.dispatch/drawing.json: the default workspace and port when the command line and DISPATCH_PORT (or DRAW_PORT) name none.
// The Atelier days' ~/.atelier files are copied to ~/.dispatch once (never over a file there), before anything reads them (#782).
if (copyUserStateSync() === 'copied') console.log('Copied ~/.atelier settings to ~/.dispatch');
const userDefaults = readDefaultsSync();
if (userDefaults.error) console.error(`~/.dispatch/drawing.json unreadable (${userDefaults.error}); using built-in defaults.`);
const start = startDefaults(userDefaults.values, process.env, DEFAULT_PORT);

let opts;
try {
  opts = parseArgs(process.argv.slice(2), process.env, start.workspaceDir);
} catch (err) {
  console.error(`${err.message}\n${USAGE}`);
  process.exit(1);
}
opts.workspaceDir = resolve(opts.workspaceDir);
try {
  if (!statSync(opts.workspaceDir).isDirectory()) throw new Error();
} catch {
  console.error(`Not a directory: ${opts.workspaceDir}`);
  process.exit(1);
}

// One server per workspace: a second one would race the first on every save.
let lock = null;
try {
  const claim = await claimWorkspace(opts.workspaceDir);
  if (!claim.ok) {
    const at = claim.holder?.port ? `: http://${HOST}:${claim.holder.port}/` : '';
    console.error(`Another Dispatch server is already running for this workspace${at}`);
    process.exit(1);
  }
  lock = claim.lock;
} catch (err) {
  // A read-only workspace can still be viewed; run without the lock rather than not at all.
  console.error(`Could not lock the workspace (${err.code ?? err.name}); not guarding against a second server.`);
}
let app = null;
// A folder switch (E554) replaces the workspace lock; app.ctx.lock is the one held now.
const releaseLocks = () => {
  (app ? app.ctx.lock : lock)?.releaseSync();
  app?.ctx.modules.dispatch?.releaseSync?.();
};
process.on('exit', releaseLocks);

const port = start.port;
app = await createApp({ ...opts, lock }, { claimWorkspace });
app.server.on('error', async (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${port} is already in use. Pick another one: DISPATCH_PORT=<port> npm start -- <workspace-dir>`);
  } else {
    console.error(`Server error: ${err.message}`);
  }
  await app.close().catch(() => {});
  process.exit(1);
});
app.server.listen(port, HOST, () => {
  app.ctx.lock?.setPort(port).catch((err) => console.error(`Could not update the workspace lock (${err.code ?? err.name})`));
  console.log(`Dispatch: http://${HOST}:${port}/  (workspace ${opts.workspaceDir}${opts.projectMode ? ', project mode' : ''})`);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, async () => {
    await app.close();
    process.exit(0);
  });
}
