// The user's defaults in one human-editable file, ~/.atelier/drawing.json (E555, issue #724).
// Schema and fallback order: docs/design/user-defaults.md.
//
// Metadata only: theme, default models per role, harness profiles per mode, guard thresholds, team settings, default workspace
// folder and port, the PR tracking default, the registered workspace folders and the user's account labels per
// provider connection (#747; a label like `Claude · Max`, checked to never be an email or account id). Never
// tokens, keys, emails or names. Written with a stable key order and 2-space indent; keys this version does not
// know are kept. A broken file never crashes the server: it reads as "no defaults" with an error the
// 설정 UI shows, and writes refuse until the user fixes it (we never overwrite their file).
//
// DRAWING_USER_DEFAULTS=off (test/test-env) keeps the file out entirely: nothing is read or written.
import { lstat, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { ACCOUNT_KEYS, checkAccountLabel, cleanAccountLabels } from '../shared/dispatch/accounts.ts';
import { userDir } from './dispatch/paths.js';
import { isObj } from '../shared/is-obj.ts';

export const SCHEMA_VERSION = 1;
export const THEMES = ['system', 'light', 'dark'];

/** Known top-level keys in the order they are written. Unknown keys follow in the order the file had them. */
export const KEY_ORDER = ['version', 'theme', 'workspace', 'port', 'prStatus', 'team', 'guard', 'modeProfiles', 'accountLabels', 'workspaces', 'lastWorkspace'];

const TEAM_INT = ['rotateLead', 'rotateOthers', 'maxChildren', 'autoRemoveGraceSec', 'ctxHandoff', 'handoffMTokens', 'stuckFails', 'stuckSilentMinutes', 'stuckMismatchMinutes'];
const TEAM_NUM = ['stuckEtaRatio'];
const TEAM_BOOL = ['replyStyle', 'shareDeps', 'dropWorktrees', 'autoRemoveDone', 'autoRotateLong'];
const GUARD_NUM = ['five', 'seven', 'fable'];

export const BROKEN_MESSAGE = '~/.atelier/drawing.json 파일을 읽지 못했어요. 파일을 고치거나 지우면 다시 저장할 수 있어요. 지금은 기본값을 써요.';

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/** ~/.atelier/drawing.json for this HOME, or null when DRAWING_USER_DEFAULTS=off. */
export function defaultsFile(env = process.env) {
  if (env.DRAWING_USER_DEFAULTS === 'off') return null;
  return path.join(userDir(env), 'drawing.json');
}

/** `~/x` and `~` resolve against HOME; anything else is returned as it is. */
export function expandHome(p, env = process.env) {
  if (typeof p !== 'string') return p;
  const home = env.HOME || os.homedir();
  if (p === '~') return home;
  return p.startsWith('~/') ? path.join(home, p.slice(2)) : p;
}

const pick = (src, ok) => Object.fromEntries(Object.entries(src).filter(([k, v]) => ok(k, v)));

/**
 * The typed values a raw (parsed) file holds. A key with the wrong type counts as missing and is named
 * in `problems`, so one bad value does not throw away the rest.
 */
export function readValues(raw) {
  const v = {};
  const problems = [];
  const bad = (k) => problems.push(k);
  if ('theme' in raw) THEMES.includes(raw.theme) ? (v.theme = raw.theme) : bad('theme');
  if ('workspace' in raw) typeof raw.workspace === 'string' && raw.workspace ? (v.workspace = raw.workspace) : raw.workspace !== null && bad('workspace');
  if ('port' in raw) Number.isInteger(raw.port) && raw.port > 0 && raw.port < 65536 ? (v.port = raw.port) : raw.port !== null && bad('port');
  if ('prStatus' in raw) typeof raw.prStatus === 'boolean' ? (v.prStatus = raw.prStatus) : bad('prStatus');
  if ('team' in raw) {
    if (!isObj(raw.team)) bad('team');
    else {
      const t = pick(raw.team, (k, x) => (TEAM_INT.includes(k) && Number.isInteger(x)) || (TEAM_NUM.includes(k) && isNum(x)) || (TEAM_BOOL.includes(k) && typeof x === 'boolean'));
      if (isObj(raw.team.roleModels)) t.roleModels = pick(raw.team.roleModels, (_k, x) => typeof x === 'string' && x !== '');
      v.team = t;
    }
  }
  if ('guard' in raw) {
    if (!isObj(raw.guard)) bad('guard');
    else {
      const g = pick(raw.guard, (k, x) => GUARD_NUM.includes(k) && isNum(x) && x > 0 && x <= 1);
      if (isObj(raw.guard.openai)) g.openai = pick(raw.guard.openai, (k, x) => ['five', 'seven'].includes(k) && isNum(x) && x > 0 && x <= 1);
      v.guard = g;
    }
  }
  if ('workspaces' in raw) {
    if (!Array.isArray(raw.workspaces)) bad('workspaces');
    else v.workspaces = raw.workspaces.filter((w) => isObj(w) && typeof w.path === 'string' && w.path).map((w) => ({ path: w.path, name: typeof w.name === 'string' ? w.name : path.basename(w.path) }));
  }
  if ('lastWorkspace' in raw) typeof raw.lastWorkspace === 'string' && raw.lastWorkspace ? (v.lastWorkspace = raw.lastWorkspace) : raw.lastWorkspace !== null && bad('lastWorkspace');
  if ('accountLabels' in raw) isObj(raw.accountLabels) ? (v.accountLabels = cleanAccountLabels(raw.accountLabels)) : bad('accountLabels');
  // Harness profiles per mode (#748): kept as an object here; server/dispatch/mode-profiles.js checks the cells.
  if ('modeProfiles' in raw) isObj(raw.modeProfiles) ? (v.modeProfiles = raw.modeProfiles) : raw.modeProfiles !== null && bad('modeProfiles');
  return { values: v, problems };
}

/** The file text for `obj`: known keys in KEY_ORDER, then unknown keys in their own order, 2-space indent. */
export function serialize(obj) {
  const out = {};
  for (const k of KEY_ORDER) if (k in obj && obj[k] !== undefined) out[k] = obj[k];
  for (const k of Object.keys(obj)) if (!(k in out) && obj[k] !== undefined) out[k] = obj[k];
  return JSON.stringify(out, null, 2) + '\n';
}

/** Parses file text: { raw } or { error } for bad JSON or a non-object. */
function parse(text) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    return { error: 'not valid JSON' };
  }
  return isObj(raw) ? { raw } : { error: 'not a JSON object' };
}

/**
 * Reads the file synchronously (for `npm start` before the server exists). Missing file or
 * DRAWING_USER_DEFAULTS=off: empty values. Never throws.
 */
export function readDefaultsSync(env = process.env) {
  const file = defaultsFile(env);
  if (!file) return { values: {}, problems: [], error: null };
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch (err) {
    return { values: {}, problems: [], error: err.code === 'ENOENT' ? null : err.code ?? err.name };
  }
  const p = parse(text);
  return p.error ? { values: {}, problems: [], error: p.error } : { ...readValues(p.raw), error: null };
}

/** mtime, ctime, size and inode of `file` as one string ("none" when missing), to tell when it changed. */
async function signature(file) {
  try {
    const s = await stat(file, { bigint: true });
    return `${s.mtimeNs}:${s.ctimeNs}:${s.size}:${s.ino}`;
  } catch (err) {
    return err.code === 'ENOENT' ? 'none' : `error:${err.code ?? err.name}`;
  }
}

export class UserDefaults {
  /** @param {string|null} file  null = memory only (nothing read or written). */
  constructor(file = defaultsFile()) {
    this.file = file;
    this.raw = {};
    this.values = {};
    this.problems = [];
    /** null, or why the file could not be read (then values are empty and writes refuse). */
    this.error = null;
    /** What the file looked like at the last read (see signature()); null before the first read. */
    this.sig = null;
    this.writing = Promise.resolve();
  }

  /** Re-reads the file. Never throws: an unreadable file sets `error` and empty values. */
  async load() {
    // Built off to the side and swapped in at once, so a reader never sees half-cleared values.
    const next = { raw: {}, values: {}, problems: [], error: null, sig: null };
    if (this.file) {
      // Stat before reading: an edit that lands after the stat changes the signature, so current() reloads.
      next.sig = await signature(this.file);
      let text = null;
      try {
        text = await readFile(this.file, 'utf8');
      } catch (err) {
        if (err.code !== 'ENOENT') next.error = err.code ?? err.name;
      }
      if (text !== null) {
        const p = parse(text);
        if (p.error) next.error = p.error;
        else {
          next.raw = p.raw;
          ({ values: next.values, problems: next.problems } = readValues(p.raw));
        }
      }
    }
    Object.assign(this, next);
    return this;
  }

  /**
   * The values as the file holds them now: reloads when the file changed since the last read (a hand edit
   * while the server runs), else answers from memory. Every reader goes through this, not `values`.
   */
  async current() {
    if (this.file && (await signature(this.file)) !== this.sig) await this.load();
    return this.values;
  }

  /** What GET /api/user-defaults answers: the file's place (HOME as ~), its values and any error. */
  status() {
    return {
      file: this.file ? '~/.atelier/drawing.json' : null,
      values: this.values,
      error: this.error ? BROKEN_MESSAGE : null,
      problems: this.problems,
    };
  }

  /**
   * Applies `patch` (top-level keys; undefined leaves a key, null removes it) to what is on disk now,
   * keeping hand edits and unknown keys. Refuses (code EDEFAULTS) when the file is broken.
   * Writes one at a time, atomically (temp file + rename). Returns the new values.
   */
  update(patch) {
    const run = this.writing.catch(() => {}).then(async () => {
      await this.load();
      if (this.error) throw Object.assign(new Error(BROKEN_MESSAGE), { code: 'EDEFAULTS', status: 409 });
      const next = { ...this.raw };
      if (!('version' in next)) next.version = SCHEMA_VERSION;
      for (const [k, v] of Object.entries(patch)) {
        if (v === undefined) continue;
        if (v === null) delete next[k];
        else next[k] = v;
      }
      if (!this.file) {
        this.raw = next;
        ({ values: this.values, problems: this.problems } = readValues(next));
        return this.values;
      }
      const dir = path.dirname(this.file);
      await mkdir(dir, { recursive: true, mode: 0o700 });
      try {
        if (!(await lstat(this.file)).isFile()) throw Object.assign(new Error('drawing.json is not a regular file'), { code: 'EDEFAULTS', status: 409 });
      } catch (err) {
        if (err.code !== 'ENOENT') throw err;
      }
      const tmp = `${this.file}.${randomUUID()}.tmp`;
      try {
        await writeFile(tmp, serialize(next), { flag: 'wx', mode: 0o600 });
        await rename(tmp, this.file);
      } catch (err) {
        await rm(tmp, { force: true });
        throw err;
      }
      this.sig = await signature(this.file);
      this.raw = next;
      ({ values: this.values, problems: this.problems } = readValues(next));
      return this.values;
    });
    this.writing = run;
    return run;
  }
}

/**
 * Where `npm start` runs when the command line names no folder, and on which port.
 * Workspace: the file's `workspace`, else `lastWorkspace`. Port: DRAW_PORT, else the file's `port`, else fallback.
 */
export function startDefaults(values, env = process.env, fallbackPort = 4330) {
  const ws = values.workspace ?? values.lastWorkspace ?? null;
  return {
    workspaceDir: ws ? expandHome(ws, env) : null,
    port: Number(env.DRAW_PORT) || values.port || fallbackPort,
  };
}

const PATCHABLE = new Set(['theme', 'workspace', 'port', 'prStatus', 'accountLabels']);

/**
 * Validates `accountLabels` from a patch: `{ <provider>: string | null }` (null or '' clears one label). Unknown
 * providers are refused. Returns the per-provider changes (null = clear). Throws status 400.
 */
export function checkAccountLabels(v) {
  const no = (msg) => {
    throw Object.assign(new Error(msg), { status: 400 });
  };
  if (!isObj(v)) no('accountLabels는 { claude, openai, gemini } 모양이에요');
  const out = {};
  for (const [k, x] of Object.entries(v)) {
    if (!ACCOUNT_KEYS.includes(k)) no(`알 수 없는 연결이에요: ${k.slice(0, 20)}`);
    const r = checkAccountLabel(x);
    if (!r.ok) no(r.error);
    out[k] = r.value;
  }
  return out;
}

/** Applies per-provider label changes (null clears) to the current labels; null when none is left. */
export function mergeAccountLabels(cur, changes) {
  const next = { ...(cur || {}) };
  for (const [k, x] of Object.entries(changes)) {
    if (x === null) delete next[k];
    else next[k] = x;
  }
  return Object.keys(next).length ? next : null;
}

/** Validates a patch from the 설정 UI (theme, workspace, port, prStatus, accountLabels; null clears). Throws status 400. */
export function checkPatch(body) {
  const out = {};
  const no = (msg) => {
    throw Object.assign(new Error(msg), { status: 400 });
  };
  for (const [k, v] of Object.entries(isObj(body) ? body : {})) {
    if (!PATCHABLE.has(k)) continue;
    if (k === 'accountLabels') {
      out[k] = v === null ? null : checkAccountLabels(v);
      continue;
    }
    if (v === null) {
      out[k] = null;
      continue;
    }
    if (k === 'theme' && !THEMES.includes(v)) no('테마는 system, light, dark 중 하나예요');
    if (k === 'workspace' && (typeof v !== 'string' || !v.trim() || !(path.isAbsolute(v.trim()) || v.trim().startsWith('~')))) no('워크스페이스는 절대 경로나 ~/로 시작하는 경로로 넣어 주세요');
    if (k === 'port' && !(Number.isInteger(v) && v >= 1024 && v < 65536)) no('포트는 1024~65535 사이 숫자를 넣어 주세요');
    if (k === 'prStatus' && typeof v !== 'boolean') no('prStatus는 true나 false예요');
    out[k] = typeof v === 'string' ? v.trim() : v;
  }
  return out;
}

/** Atelier module entry (server/modules.js): GET/POST /api/user-defaults. Other modules use `defaults`. */
export async function setup(ctx, { file } = {}) {
  const defaults = new UserDefaults(file === undefined ? defaultsFile() : file);
  await defaults.load();
  if (defaults.error) console.error(`User defaults: ~/.atelier/drawing.json unreadable (${defaults.error}); using built-in defaults.`);
  const send = (res, status, body) => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify(body));
  };
  const readBody = async (req) => {
    let s = '';
    for await (const c of req) {
      s += c;
      if (s.length > 64 * 1024) throw Object.assign(new Error('too large'), { status: 413 });
    }
    try {
      return s ? JSON.parse(s) : {};
    } catch {
      throw Object.assign(new Error('invalid JSON'), { status: 400 });
    }
  };
  return {
    defaults,
    routes: [
      {
        method: 'GET',
        path: '/api/user-defaults',
        handler: async (_req, res) => {
          await defaults.load();
          send(res, 200, defaults.status());
        },
      },
      {
        method: 'POST',
        path: '/api/user-defaults',
        handler: async (req, res) => {
          try {
            const patch = checkPatch(await readBody(req));
            if (patch.accountLabels) patch.accountLabels = mergeAccountLabels((await defaults.current()).accountLabels, patch.accountLabels);
            await defaults.update(patch);
            if ('theme' in patch || 'accountLabels' in patch) ctx.hub.broadcast('user-defaults', defaults.status());
            send(res, 200, defaults.status());
          } catch (err) {
            send(res, err.status ?? 500, { error: err.status ? err.message : '저장하지 못했어요.' });
          }
        },
      },
    ],
  };
}
