// atelier-team script tests (team.test.js, relay.test.js): a stub Atelier server and a temp plugin tree holding the
// real team.sh, relay.sh and rules.md. No real server or agent CLI runs.
import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SRC = new URL('../../plugin/', import.meta.url).pathname;

// A stub Atelier: GET /api/state and /api/tasks answer from `sessions` and `tasks`; POST /api/sessions records the
// body and adds the made sessions (idle, the lead able to spawn), so a second run sees the first run's team. Like the
// hub, it refuses children past the default maxChildren (MAX_CHILDREN) of one parent.
export const MAX_CHILDREN = 8;
// `settings` goes into the state answer; `failTeam` makes every child POST answer that error (a refused team).
export async function stubServer({ sessions = [], tasks = [], settings, failTeam } = {}) {
  const posts = [];
  let n = 0;
  const server = http.createServer((req, res) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      if (req.method === 'GET' && req.url === '/api/state') return res.end(JSON.stringify({ providers: { claude: { connected: true } }, sessions, ...(settings && { settings }) }));
      if (req.method === 'GET' && req.url === '/api/tasks') return res.end(JSON.stringify({ tasks }));
      if (req.method === 'POST' && req.url === '/api/sessions') {
        const body = JSON.parse(b);
        posts.push(body);
        const total = body.items.reduce((a, i) => a + (i.n || 1), 0);
        const active = body.parent ? sessions.filter((s) => s.parent === body.parent && !['done', 'error'].includes(s.status)).length : 0;
        if (body.parent && failTeam) return res.end(JSON.stringify({ error: failTeam }));
        const max = settings?.team?.maxChildren ?? MAX_CHILDREN;
        if (body.parent && active + total > max) return res.end(JSON.stringify({ error: `max ${MAX_CHILDREN} children` }));
        const made = body.items.flatMap((i) => Array.from({ length: i.n || 1 }, () => i)).map((i) => ({ name: `S${++n}`, model: i.model ?? `default-${i.role}`, branch: `dispatch/${i.role}-${n}`, id: `id-${n}`,
          role: i.role, canSpawn: i.role === 'lead', status: 'idle', issue: i.issue ?? null, parent: body.parent ?? null }));
        sessions.push(...made);
        return res.end(JSON.stringify({ sessions: made }));
      }
      const m = req.method === 'POST' && req.url.match(/^\/api\/sessions\/([^/]+)\/remove$/);
      if (m) {
        const i = sessions.findIndex((s) => s.id === m[1]);
        if (i >= 0) sessions.splice(i, 1);
        return res.end('{"ok":true}');
      }
      res.statusCode = 404;
      res.end('{}');
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { port: server.address().port, posts, sessions, close: () => server.close() };
}

// A temp plugin tree with the real team.sh, relay.sh and rules.md and a start.sh that does nothing.
export function pluginTree() {
  const dir = mkdtempSync(join(tmpdir(), 'atelier-team-'));
  const skill = join(dir, 'plugin/skills/atelier-team');
  mkdirSync(join(skill, 'scripts'), { recursive: true });
  mkdirSync(join(skill, 'reference'));
  mkdirSync(join(dir, 'plugin/scripts'));
  for (const f of ['scripts/team.sh', 'scripts/relay.sh', 'reference/rules.md']) copyFileSync(join(SRC, 'skills/atelier-team', f), join(skill, f));
  writeFileSync(join(dir, 'plugin/scripts/start.sh'), '#!/bin/sh\nexit 0\n');
  chmodSync(join(dir, 'plugin/scripts/start.sh'), 0o755);
  return { dir, scripts: join(skill, 'scripts'), cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

export function runScript(file, args, env) {
  return new Promise((resolve) => {
    const c = spawn('bash', [file, ...args], { env: { ...process.env, DISPATCH_TEAM_MODEL: '', DISPATCH_TEAM_MODE: '', DISPATCH_TEAM_ISSUE: '', DISPATCH_TEAM_IGNORE_LEAD: '', DISPATCH_TEAM_SH: '', ...env } });
    let stdout = '';
    let stderr = '';
    c.stdout.on('data', (d) => (stdout += d));
    c.stderr.on('data', (d) => (stderr += d));
    c.on('close', (status) => resolve({ status, stdout, stderr }));
  });
}

