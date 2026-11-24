// The /atelier-agents mod (#755; Claude Code ships /agents itself, so that name is refused): a pane beside the chat that follows Atelier's agent teams, and a one-line status.
// Every few seconds it reads GET http://127.0.0.1:<port>/api/agents/summary (the port from the project's
// .atelier/server.port, as main-delegates.mjs and scripts/server-check.sh find it). Read only, loopback only,
// metadata only: the summary carries names, roles, models, states, stages, times and issue/PR numbers.
// When the server does not answer the pane says offline. Formatting lives in agents-format.mjs (tested by node).
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { AgentsView } from '../types'
import { asSummary, githubRepo, paneModel, parsePort, statusLine } from './agents-format.mjs'

const PANE = 'atelier-agents'
const TITLE = 'Atelier 에이전트'
const POLL_MS = 4000
const FETCH_MS = 2500
const MAX_UP = 12

// Change the shape tag when AgentsView changes: a value an earlier version stored outlives a reload.
const view = atom({ plugin: 'atelier', key: 'agentsView' } as const, { kind: 'none' } as AgentsView, { shape: 'agents-view-1' })
const repo = atom({ plugin: 'atelier', key: 'agentsRepo' } as const, null as string | null, { shape: 'agents-repo-1' })

let timer: { cancel: () => void } | null = null
let busy = false

// The git top-level of the session's folder (nearest ancestor holding .git), or null.
async function projectRoot($: EngineInterface): Promise<string | null> {
  let dir = await $.session.cwd()
  for (let i = 0; i < MAX_UP && dir; i++) {
    if (await $.fs.exists(`${dir}/.git`).catch(() => false)) return dir
    const up = dir.replace(/\/[^/]*$/, '')
    if (up === dir) break
    dir = up || '/'
  }
  return null
}

async function readPort($: EngineInterface, root: string): Promise<number | null> {
  for (const dir of ['.atelier', '.dispatch']) {
    const raw = await $.fs.read(`${root}/${dir}/server.port`).catch(() => null)
    if (typeof raw === 'string') return parsePort(raw)
  }
  return null
}

async function poll($: EngineInterface): Promise<void> {
  if (busy) return
  busy = true
  try {
    const before = await read($, view)
    const root = await projectRoot($)
    const port = root ? await readPort($, root) : null
    let next: AgentsView
    if (!root || port === null) next = { kind: 'none' }
    else {
      const res = await Promise.race([
        $.http.fetch(`http://127.0.0.1:${port}/api/agents/summary`).catch(() => null),
        $.clock.sleep(FETCH_MS).then(() => null),
      ])
      let summary = null
      if (res?.ok) try { summary = asSummary(JSON.parse(res.text)) } catch { summary = null }
      const lastAt = before.kind === 'online' ? before.at : before.kind === 'offline' ? before.lastAt : null
      next = summary ? { kind: 'online', port, at: await $.clock.now(), summary } : { kind: 'offline', port, lastAt }
      if (summary && (await read($, repo)) === null) {
        const cfg = await $.fs.read(`${root}/.git/config`).catch(() => null)
        await update($, repo, () => githubRepo(cfg))
      }
    }
    await update($, view, () => next)
    $.ui.status(statusLine(next))
  } finally {
    busy = false
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'atelier-agents', description: 'Atelier 에이전트 팀 진행 상황을 옆 창에 보여줘요' })
    timer?.cancel()
    timer = $.clock.every(POLL_MS, () => void poll($).catch(() => undefined))
    void poll($).catch(() => undefined)
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    timer?.cancel()
    timer = null
    return next(e)
  })

  on('command.run', { command: 'atelier-agents' }, async $ => {
    await $.ui.open({ id: PANE, title: TITLE })
    void poll($).catch(() => undefined)
    return { text: 'Atelier 에이전트 창을 열었어요.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Link } = $.ui.resolve(e)
    const m = paneModel(await read($, view), await read($, repo), await $.clock.now())
    if (m.kind !== 'online') {
      return (
        <Box flexDirection="column">
          <Text dimColor={m.kind === 'none'} color={m.kind === 'offline' ? 'yellow' : undefined}>{m.text}</Text>
        </Box>
      )
    }
    return (
      <Box flexDirection="column">
        <Text bold>{m.title}</Text>
        {m.usage.map(u => <Text dimColor>{u}</Text>)}
        {m.leads.length === 0 && <Text dimColor>돌고 있는 관리자가 없어요.</Text>}
        {m.leads.map(l => (
          <Box flexDirection="column" marginTop={1}>
            <Text bold color={l.stuck ? 'yellow' : undefined}>{l.head}</Text>
            {l.tasks.map(t => (
              <Box flexDirection="column" paddingLeft={2}>
                <Text color={t.stuck || t.late ? 'yellow' : undefined}>{t.text}</Text>
                {t.stuck && <Text color="yellow">{t.stuck}</Text>}
              </Box>
            ))}
            {l.team.map(t => (
              <Box paddingLeft={2}>
                <Text dimColor={!t.stuck && t.status !== 'running'} color={t.stuck ? 'yellow' : undefined}>{t.text}</Text>
              </Box>
            ))}
            {l.issues.map(i => (
              <Box paddingLeft={2} flexDirection="row" gap={1}>
                <Text dimColor>{i.text}</Text>
                {i.prs.length === 0 && <Text dimColor>PR 없음</Text>}
                {i.prs.map(p => (p.href ? <Link href={p.href} label={p.label} /> : <Text dimColor>{p.label}</Text>))}
              </Box>
            ))}
          </Box>
        ))}
      </Box>
    )
  })
}
