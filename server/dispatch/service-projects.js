import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { pidAlive } from '../lock.js';
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

async function readMetadata(path, limit, signal) {
  let file;
  try {
    signal.throwIfAborted();
    file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    signal.throwIfAborted();
    if (!(await file.stat()).isFile()) return null;
    signal.throwIfAborted();
    const buf = Buffer.alloc(limit);
    const { bytesRead } = await file.read(buf);
    return bytesRead < limit ? buf.subarray(0, bytesRead).toString('utf8').trim() : null;
  } catch {
    return null;
  } finally {
    await file?.close().catch(() => {});
  }
}

async function registeredService(dir, signal) {
  try {
    signal.throwIfAborted();
    if (!(await lstat(dir)).isDirectory()) return null;
    const portText = await readMetadata(join(dir, 'server.port'), 32, signal);
    const port = Number(portText);
    if (!/^\d+$/.test(portText ?? '') || port < 1 || port > 65535) return null;

    const pidText = await readMetadata(join(dir, 'server.pid'), 32, signal);
    const pid = Number(pidText);
    if (!/^\d+$/.test(pidText ?? '') || pid > 0x7fffffff || !pidAlive(pid)) return null;

    const locks = join(dir, '.drawing');
    if (!(await lstat(locks)).isDirectory()) return null;
    const lockText = await readMetadata(join(locks, 'server.lock'), 128, signal);
    if (!lockText) return null;
    const lock = JSON.parse(lockText);
    return lock?.pid === pid && lock.port === port ? { pid, port } : null;
  } catch {
    return null;
  }
}

async function currentProject(root, port, signal) {
  for (const stateDir of STATE_DIRS) {
    const service = await registeredService(join(root, stateDir), signal);
    if (service?.pid === process.pid && service.port === port) {
      return { name: basename(root), port, current: true };
    }
  }
  return null;
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
        const service = await registeredService(join(dir, stateDir), signal);
        if (signal.aborted) return;
        if (!service || service.port === port) continue;
        const peerPort = service.port;
        if (!probes.has(peerPort)) probes.set(peerPort, readService(peerPort, signal));
        const state = await probes.get(peerPort);
        if (signal.aborted) return;
        const reported = Array.isArray(state?.projects) ? state.projects.filter((p) => p?.current === true) : [];
        const [project] = reported;
        if (reported.length === 1 && project.port === peerPort && project.name === name &&
            expandHome(project.path) === dir && pidAlive(service.pid)) {
          peers[i + offset] = { name: project.name, port: peerPort, current: false };
          return;
        }
      }
    }));
  }
}

/**
 * Only skill-registered servers, with peer identities confirmed against their project roots.
 * `workspaces` may be a loader; its wait counts toward the same deadline as the scan.
 */
export async function listServiceProjects({ root, port, workspaces, deployments = DEPLOYMENTS }) {
  const controller = new AbortController();
  let timer;
  const deadline = new Promise((resolve) => {
    timer = setTimeout(() => {
      controller.abort(new DOMException('Service lookup timed out', 'TimeoutError'));
      resolve();
    }, LOOKUP_TIMEOUT_MS);
  });

  // The current server is already answering this request. Its registration must still match
  // this process. Unreadable settings leave the known deployment roots available.
  const load = Promise.resolve()
    .then(() => (typeof workspaces === 'function' ? workspaces() : workspaces))
    .catch(() => []);
  const current = await Promise.race([currentProject(root, port, controller.signal), deadline]);
  const local = current ? [current] : [];
  const entries = await Promise.race([load, deadline]);
  // A slow settings read must not start a scan after the deadline.
  if (controller.signal.aborted) return local;

  const candidates = [...deployments, ...(entries ?? []).map((entry) => entry.path)];
  const key = JSON.stringify([root, port, candidates]);
  const projectList = (peers) => [...local, ...peers].sort((a, b) => a.name.localeCompare(b.name));
  if (activeLookup) {
    // Share matching lookups without handing peers from one workspace list to another.
    try {
      if (activeLookup.key !== key) return local;
      return projectList(await Promise.race([activeLookup.result, deadline.then(() => [])]));
    } finally {
      clearTimeout(timer);
    }
  }

  const peers = [];
  const scan = scanServices(root, port, candidates, peers, controller.signal).finally(() => {
    clearTimeout(timer);
    // Hold the slot until pending filesystem operations have finished unwinding.
    activeLookup = undefined;
  });
  const result = Promise.race([scan, deadline]).then(() => peers.filter(Boolean));
  activeLookup = { key, result };
  return projectList(await result);
}
