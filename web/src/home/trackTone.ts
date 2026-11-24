// The working track's tone (#942): one mapping from what a session does now (its status label) to the colour and
// motion of the `.session-track` sweep. Used by every working track (dashboard and 세션 보드 cards, team panel rows,
// the live panel head), so no other file maps labels to colours. Labels come from two places: the cursor module's
// AGENT_STATUS (dashboard presence) and the hub's activityOf() (세션 보드 sessions). Colour is never the only cue:
// every track sits next to its state word.
import type { CSSProperties } from 'react';
import { AGENT_STATUS } from '../../../shared/dispatch/agent-status.ts';

export type TrackKind = 'think' | 'write' | 'code' | 'read' | 'work' | 'wait';

export interface TrackTone {
  kind: TrackKind;
  /** A CSS colour (a token). */
  color: string;
  /** One sweep, e.g. '2.4s'; for `wait` one blink. */
  speed: string;
  /** Sliver width as a percent of the track. */
  width: number;
  /** Sliver opacity. */
  opacity: number;
  /** `flow`: the sliver sweeps right; `blink`: the whole track fades in and out in place. */
  motion: 'flow' | 'blink';
}

const TONES: Record<TrackKind, TrackTone> = {
  think: { kind: 'think', color: 'var(--role-lead)', speed: '3.2s', width: 45, opacity: 0.6, motion: 'flow' },
  write: { kind: 'write', color: 'var(--role-impl)', speed: '2.4s', width: 28, opacity: 1, motion: 'flow' },
  code: { kind: 'code', color: 'var(--ok)', speed: '1.6s', width: 18, opacity: 1, motion: 'flow' },
  read: { kind: 'read', color: 'var(--role-merge)', speed: '2.8s', width: 28, opacity: 0.7, motion: 'flow' },
  work: { kind: 'work', color: 'color-mix(in oklch, var(--foreground) 60%, transparent)', speed: '2.4s', width: 28, opacity: 1, motion: 'flow' },
  wait: { kind: 'wait', color: 'var(--warn)', speed: '1.6s', width: 100, opacity: 1, motion: 'blink' },
};

const KIND: Record<string, TrackKind> = {
  [AGENT_STATUS.thinkDiagram]: 'think',
  [AGENT_STATUS.writeDiagram]: 'write',
  [AGENT_STATUS.writeDoc]: 'write',
  [AGENT_STATUS.writeTable]: 'write',
  [AGENT_STATUS.writeCode]: 'code',
  [AGENT_STATUS.readCode]: 'read',
  [AGENT_STATUS.working]: 'work',
  [AGENT_STATUS.waiting]: 'wait',
  // The hub's activity labels (server/dispatch/hub.js activityOf).
  '파일 수정': 'code',
  '코드 읽기': 'read',
  '변경 확인': 'read',
  '기다리는 중': 'wait',
};

/**
 * The track tone for a session: `state` says whether it works now ('working'), waits for a person ('waiting'), or
 * neither (null → no tone, a quiet empty track). While working, the label picks the tone; no label means the model is
 * thinking between tools; an unknown label is plain work (ink).
 */
export function trackTone(statusLabel: string | null | undefined, state: 'working' | 'waiting' | null): TrackTone | null {
  if (state === 'waiting') return TONES.wait;
  if (state !== 'working') return null;
  if (!statusLabel) return TONES.think;
  return TONES[KIND[statusLabel] ?? 'work'];
}

/** The class and style of a `.session-track` span for a tone (null → the idle track). */
export function trackProps(tone: TrackTone | null): { className: string; style?: CSSProperties; 'data-track'?: TrackKind } {
  if (!tone) return { className: 'session-track' };
  const style = {
    '--track-color': tone.color,
    '--track-speed': tone.speed,
    '--track-width': `${tone.width}%`,
    // The sweep ends when the sliver's left edge reaches the track's right edge (translate is in sliver widths).
    '--track-end': `${Math.ceil(10000 / tone.width)}%`,
    '--track-opacity': tone.opacity,
  } as CSSProperties;
  return { className: tone.motion === 'blink' ? 'session-track is-wait' : 'session-track is-on', style, 'data-track': tone.kind };
}
