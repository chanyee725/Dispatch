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
const LOOKUP_TIMEOUT_MS = 1_500;
const PROBE_TIMEOUT_MS = 800;
const MAX_RESPONSE_BYTES = 64 * 1024;
const BATCH_SIZE = 8;
let activeLookup;

async function registeredPort(dir, signal) {
  let file;
  try {
    signal.throwIfAborted();
    if (!(await lstat(dir)).isDirectory()) return null;
    signal.throwIfAborted();
    file = await open(join(dir, 'server.port'), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    signal.throwIfAborted();
    if (!(await file.stat()).isFile()) return null;
    signal.throwIfAborted();
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

async function readService(port, lookupSignal) {
  let reader;
  try {
    // The peers' existing endpoint returns project metadata only. Never follow a redirect.
    const signal = AbortSignal.any([lookupSignal, AbortSignal.timeout(PROBE_TIMEOUT_MS)]);
    const res = await fetch(`http://127.0.0.1:${port}/api/projects`, {
      redirect: 'error',
      signal,
    });
    reader = res.body?.getReader();
    if (!res.ok || !reader) return null;

    const chunks = [];
    let size = 0;
    while (true) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      signal.throwIfAborted();
      if (done) return JSON.parse(new TextDecoder().decode(Buffer.concat(chunks, size)));
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) return null;
      chunks.push(value);
    }
  } catch {
    return null;
  } finally {
    if (reader) {
      void reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }
}

async function scanServices(root, port, candidates, peers, signal) {
  const roots = new Set();
  for (const raw of candidates) {
    if (signal.aborted) return;
    const abs = expandHome(raw);
    if (!isAbsolute(abs)) continue;
    const path = resolve(abs);
    const dir = STATE_DIRS.includes(basename(path)) ? dirname(path) : path;
    if (relative(expandHome('~'), dir).split(sep).some((part) => INTERNAL_DIRS.has(part))) continue;
    const canonical = await realpath(dir).catch(() => null);
    if (canonical && canonical !== root && canonical === dir) roots.add(canonical);
  }

  const probes = new Map();
  // Probe only recorded ports, in batches so a long workspace list cannot open unbounded sockets.
  const dirs = [...roots];
  for (let i = 0; i < dirs.length && !signal.aborted; i += BATCH_SIZE) {
    await Promise.all(dirs.slice(i, i + BATCH_SIZE).map(async (dir, offset) => {
      const name = basename(dir);
      for (const stateDir of STATE_DIRS) {
        const peerPort = await registeredPort(join(dir, stateDir), signal);
        if (signal.aborted) return;
        if (!peerPort || peerPort === port) continue;
        if (!probes.has(peerPort)) probes.set(peerPort, readService(peerPort, signal));
        const state = await probes.get(peerPort);
        if (signal.aborted) return;
        if (Array.isArray(state?.projects) && state.projects.some((p) =>
          p?.current === true && p.port === peerPort && p.name === name && expandHome(p.path) === dir,
        )) {
          peers[i + offset] = { name, port: peerPort, current: false };
          return;
        }
      }
    }));
  }
}

/**
 * The current server and registered peers whose loopback response identifies the same project root.
 * `workspaces` may be a loader; its wait counts toward the same deadline as the scan.
 */
export async function listServiceProjects({ root, port, workspaces, deployments = DEPLOYMENTS }) {
  const current = { name: basename(root), port, current: true };
  const controller = new AbortController();
  let timer;
  const deadline = new Promise((resolve) => {
    timer = setTimeout(() => {
      controller.abort(new DOMException('Service lookup timed out', 'TimeoutError'));
      resolve();
    }, LOOKUP_TIMEOUT_MS);
  });

  let entries;
  try {
    const load = Promise.resolve().then(() => (typeof workspaces === 'function' ? workspaces() : workspaces));
    entries = await Promise.race([load, deadline]);
  } catch {
    // Unreadable settings still leave the registered deployments to check.
    entries = [];
  }
  // A slow settings read must not start a scan after the deadline.
  if (controller.signal.aborted) return [current];

  const candidates = [...deployments, ...(entries ?? []).map((entry) => entry.path)];
  const key = JSON.stringify([root, port, candidates]);
  if (activeLookup) {
    clearTimeout(timer);
    // Share matching lookups without handing peers from one workspace list to another.
    return activeLookup.key === key ? activeLookup.result : [current];
  }

  const peers = [];
  const scan = scanServices(root, port, candidates, peers, controller.signal).finally(() => {
    clearTimeout(timer);
    // Hold the slot until pending filesystem operations have finished unwinding.
    activeLookup = undefined;
  });
  const result = Promise.race([scan, deadline])
    .then(() => [current, ...peers.filter(Boolean)].sort((a, b) => a.port - b.port));
  activeLookup = { key, result };
  return result;
}
