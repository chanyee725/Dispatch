// Right panel origin (#942): the working track's tone per activity, the panel path, and the return-to-card helpers.
import test from 'node:test';
import assert from 'node:assert/strict';
import { trackProps, trackTone } from '../../web/src/home/trackTone.ts';
import { AGENT_STATUS } from '../../shared/dispatch/agent-status.ts';
import { TRAIL, offscreen, originOf, teamTrail } from '../../web/src/live/origin.ts';

test('trackTone: one tone per activity, from both label sources', () => {
  const kind = (label: string | undefined, state: 'working' | 'waiting' | null = 'working') => trackTone(label, state)?.kind ?? null;
  assert.equal(kind(AGENT_STATUS.thinkDiagram), 'think');
  assert.equal(kind(undefined), 'think', 'no tool label while working: the model is thinking');
  for (const l of [AGENT_STATUS.writeDoc, AGENT_STATUS.writeTable, AGENT_STATUS.writeDiagram]) assert.equal(kind(l), 'write');
  assert.equal(kind(AGENT_STATUS.writeCode), 'code');
  assert.equal(kind('파일 수정'), 'code');
  assert.equal(kind(AGENT_STATUS.readCode), 'read');
  assert.equal(kind('코드 읽기'), 'read');
  assert.equal(kind(AGENT_STATUS.working), 'work');
  assert.equal(kind('단위 테스트'), 'work', 'unknown labels are plain work');
  assert.equal(kind(AGENT_STATUS.waiting), 'wait');
  assert.equal(kind(AGENT_STATUS.writeCode, 'waiting'), 'wait', 'waiting for a person wins over the last label');
  assert.equal(kind(AGENT_STATUS.writeCode, null), null, 'idle: no tone');
});

test('trackTone: colours and speeds per the issue table', () => {
  const t = (l: string | undefined) => trackTone(l, 'working')!;
  assert.deepEqual([t(undefined).color, t(undefined).speed], ['var(--role-lead)', '3.2s']);
  assert.deepEqual([t(AGENT_STATUS.writeDoc).color, t(AGENT_STATUS.writeDoc).speed], ['var(--role-impl)', '2.4s']);
  assert.deepEqual([t(AGENT_STATUS.writeCode).color, t(AGENT_STATUS.writeCode).speed], ['var(--ok)', '1.6s']);
  assert.deepEqual([t(AGENT_STATUS.readCode).color, t(AGENT_STATUS.readCode).speed], ['var(--role-merge)', '2.8s']);
  assert.match(t('x').color, /var\(--foreground\) 60%/);
  assert.ok(t(AGENT_STATUS.writeCode).width < t(AGENT_STATUS.writeDoc).width, 'code: a narrower sliver');
  assert.ok(t(undefined).width > t(AGENT_STATUS.writeDoc).width && t(undefined).opacity < 1, 'thinking: wide and faint');
  const w = trackTone(null, 'waiting')!;
  assert.deepEqual([w.color, w.motion], ['var(--warn)', 'blink']);
});

test('trackProps: classes and css vars; the sweep ends past the right edge', () => {
  assert.deepEqual(trackProps(null), { className: 'session-track' });
  const p = trackProps(trackTone(AGENT_STATUS.writeCode, 'working'));
  assert.equal(p.className, 'session-track is-on');
  assert.equal(p['data-track'], 'code');
  const v = p.style as Record<string, string | number>;
  assert.equal(v['--track-color'], 'var(--ok)');
  assert.equal(v['--track-width'], '18%');
  assert.ok(parseFloat(v['--track-end'] as string) * 18 >= 10000);
  assert.equal(trackProps(trackTone(null, 'waiting')).className, 'session-track is-wait');
});

test('origin helpers: the marked card around a trigger, and when it needs a scroll', () => {
  const card = { closest: () => null } as unknown as HTMLElement;
  const inner = { closest: (sel: string) => (sel === '[data-origin]' ? card : null) } as unknown as HTMLElement;
  assert.equal(originOf(inner), card);
  assert.equal(originOf(card), card, 'no marked ancestor: the trigger itself');
  assert.equal(offscreen({ top: 10, bottom: 90 }, 800), false);
  assert.equal(offscreen({ top: -5, bottom: 90 }, 800), true);
  assert.equal(offscreen({ top: 700, bottom: 820 }, 800), true);
});
