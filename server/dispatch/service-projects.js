import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { expandHome } from '../user-defaults.js';

// These deployments already register their assigned ports via start.sh.
const DEPLOYMENTS = [
  '~/ws/physical-ai/sim-client',
  '~/ws/physical-ai/sim-studio',
  '~/ws/physical-ai/keeper2-bridge',
  '~/personal/Dispatch',
];
const STATE_DIRS = ['.dispatch', '.atelier'];
const INTERNAL_DIRS = new Set([...STATE_DIRS, 'transcripts', 'wt', 'worktrees']);

async function registeredPort(dir) {
  let file;
  try {
    if (!(await lstat(dir)).isDirectory()) return null;
    file = await open(join(dir, 'server.port'), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    if (!(await file.stat()).isFile()) return null;
    const buf = Buffer.alloc(32);
    const { bytesRead } = await file.read(buf);
    if (bytesRead === buf.length) return null;
    const value = buf.subarray(0, bytesRead).toString('utf8').trim();
    const port = Number(value);
    return /^\d+$/.test(value) && port > 0 && port <= 65535 ? port : null;
  } catch {
    return null;
  } finally {
    await file?.close().catch(() => {});
  }
}

async function readService(port) {
  try {
    // The peers' existing endpoint returns project metadata only. Never follow a redirect.
    const res = await fetch(`http://127.0.0.1:${port}/api/projects`, {
      redirect: 'error',
      signal: AbortSignal.timeout(800),
    });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

/** The current server and registered peers whose loopback response identifies the same project root. */
export async function listServiceProjects({ root, port, workspaces, deployments = DEPLOYMENTS }) {
  const candidates = [...deployments, ...workspaces.map((entry) => entry.path)];
  const roots = new Set();
  for (const raw of candidates) {
    const abs = expandHome(raw);
    if (!isAbsolute(abs)) continue;
    const path = resolve(abs);
    const dir = STATE_DIRS.includes(basename(path)) ? dirname(path) : path;
    if (relative(expandHome('~'), dir).split(sep).some((part) => INTERNAL_DIRS.has(part))) continue;
    const canonical = await realpath(dir).catch(() => null);
    if (canonical && canonical !== root && canonical === dir) roots.add(canonical);
  }

  const current = { name: basename(root), port, current: true };
  const peers = [];
  const probes = new Map();
  // Probe only recorded ports, in batches so a long workspace list cannot open unbounded sockets.
  const dirs = [...roots];
  for (let i = 0; i < dirs.length; i += 8) {
    const batch = await Promise.all(dirs.slice(i, i + 8).map(async (dir) => {
      const name = basename(dir);
      for (const stateDir of STATE_DIRS) {
        const peerPort = await registeredPort(join(dir, stateDir));
        if (!peerPort || peerPort === port) continue;
        if (!probes.has(peerPort)) probes.set(peerPort, readService(peerPort));
        const state = await probes.get(peerPort);
        if (Array.isArray(state?.projects) && state.projects.some((p) =>
          p?.current === true && p.port === peerPort && p.name === name && expandHome(p.path) === dir,
        )) return { name, port: peerPort, current: false };
      }
      return null;
    }));
    peers.push(...batch.filter(Boolean));
  }
  return [current, ...peers].sort((a, b) => a.port - b.port);
}
