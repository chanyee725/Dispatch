// Project mode (E13): which git project the workspace belongs to, and whether this server may run
// Dispatch for it. Dispatch is off when the workspace is not inside a git work tree, or when another
// server (a standalone Dispatch, or another Drawing server) already uses the project's state folder
// (`.atelier/`, or a not-yet-moved `.dispatch/`, paths.js).
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { claimLock, LockBreakTimeoutError, LockPathError, pidAlive, probe } from '../lock.js';
import { stateLayout } from './paths.js';

/** Korean UI copy for each reason Dispatch is off. */
export const OFF_MESSAGES = {
  'no-workspace': '작업 공간이 없어서 실행 기능은 꺼져 있어요.',
  'not-git': '작업 공간이 git 저장소 밖이라 실행 기능은 꺼져 있어요. 그림 도구는 그대로 써요.',
  standalone: '이 프로젝트에서 다른 Dispatch 서버가 돌고 있어서 실행 기능을 껐어요. 그 서버를 멈추고 다시 시작해 주세요.',
  unsafe: '프로젝트의 .atelier 폴더가 심볼릭 링크라서 실행 기능을 껐어요.',
  'lock-busy': '프로젝트 잠금을 정리하지 못해서 실행 기능을 껐어요. 잠시 뒤에 서버를 다시 시작해 주세요.',
  'other-drawing': '이 프로젝트를 다른 Drawing 서버가 쓰고 있어서 실행 기능을 껐어요. 그 서버를 멈추고 다시 시작해 주세요.',
};

const home = (p) => (process.env.HOME && typeof p === 'string' ? p.replace(/^~(?=$|\/)/, process.env.HOME.replace(/\/+$/, '')) : p);

/**
 * { root } when workspaceDir sits inside (or is) a git work tree's top level, else { reason }.
 * `gitTop(dir)` answers the top level or null; the result must contain the workspace, so a stray
 * GIT_DIR / GIT_WORK_TREE pointing somewhere else does not count.
 */
export async function findProject(workspaceDir, { gitTop }) {
  if (!workspaceDir) return { reason: 'no-workspace' };
  let ws;
  try {
    ws = await realpath(workspaceDir);
  } catch {
    return { reason: 'no-workspace' };
  }
  const top = await gitTop(ws);
  if (!top) return { reason: 'not-git' };
  let root;
  try {
    root = await realpath(top);
  } catch {
    return { reason: 'not-git' };
  }
  if (ws !== root && !ws.startsWith(root + path.sep)) return { reason: 'not-git' };
  return { root };
}

/** True when a server on `port` answers /api/state as Dispatch for `root` (standalone or Drawing). */
async function servesProject(port, root) {
  const state = await probe(port, '/api/state');
  return !!state && home(state.project?.path) === root;
}

/**
 * Takes `<root>/.atelier/drawing.lock` (or the `layout` given, paths.js) for this server, after
 * checking that no other server (its port is in the folder's `server.port`) serves the project.
 * Writes nothing but the lock (and its folder) when it refuses.
 * Returns { ok: true, lock } or { ok: false, reason: 'standalone' | 'other-drawing' | 'unsafe' | 'lock-busy', port }.
 */
export async function claimProject(root, layout = stateLayout(root)) {
  const standalonePort = Number.parseInt(await readFile(layout.portFile, 'utf8').catch(() => ''), 10);
  if (await servesProject(standalonePort, root)) return { ok: false, reason: 'standalone', port: standalonePort };
  let res;
  try {
    res = await claimLock(layout.lockFile, {
      root,
      isLive: async ({ pid, port }) => pidAlive(pid) && (port == null || (await servesProject(port, root))),
    });
  } catch (err) {
    if (err instanceof LockPathError) return { ok: false, reason: 'unsafe', port: null };
    if (err instanceof LockBreakTimeoutError) return { ok: false, reason: 'lock-busy', port: null };
    throw err;
  }
  if (res.ok) return res;
  return { ok: false, reason: 'other-drawing', port: res.holder?.port ?? null };
}
