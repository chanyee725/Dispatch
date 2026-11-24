// The agent's cursor tag and role badge (#592): each name is drawn as the same pointer + colour tag the session shows on
// the canvas and in the document, so the session cards, the document rows and the live cursor read as one person.
import type { CSSProperties } from 'react';
import { cn } from '../lib/utils';
import { roleBadge, safeColor, type AgentPresence, type RoleTone } from './agents';

const FALLBACK = '#475569';

/** The cursor tag in small: pointer and name on the session's colour. Decorative copies pass `hidden`. */
export function AgentTag({ agent, size = 'md', className }: { agent: Pick<AgentPresence, 'name' | 'color' | 'sid'>; size?: 'sm' | 'md'; className?: string }) {
  const color = safeColor(agent.color) ?? FALLBACK;
  return (
    <span data-agent-tag={agent.sid} className={cn('inline-flex min-w-0 shrink items-start', className)} style={{ '--agent': color } as CSSProperties}>
      <svg aria-hidden width={size === 'sm' ? 8 : 10} height={size === 'sm' ? 9 : 11} viewBox="0 0 16 18" className="mt-px shrink-0 fill-[var(--agent)]">
        <path d="M1 1 L1 15 L5 11.5 L8 17 L10.5 15.8 L7.6 10.4 L13 10 Z" />
      </svg>
      <span
        className={cn(
          'truncate rounded-[5px] bg-[var(--agent)] font-medium text-white',
          size === 'sm' ? 'mt-[5px] -ml-px px-1.5 text-2xs leading-4' : 'mt-[7px] -ml-0.5 px-[7px] text-xs leading-5',
        )}
      >
        {agent.name}
      </span>
    </span>
  );
}

const ROLE_COLOR: Record<RoleTone, string> = {
  lead: 'var(--role-lead)',
  merge: 'var(--role-merge)',
  impl: 'var(--role-impl)',
  review: 'var(--role-review)',
  test: 'var(--role-test)',
  design: 'var(--role-design)',
  docs: 'var(--role-docs)',
  other: 'var(--muted-foreground)',
};

/** The session's role as a small tinted badge: the role colour plus its name, so colour is never the only cue. */
export function RoleBadge({ agent, className }: { agent: Pick<AgentPresence, 'role' | 'roleName' | 'outside'>; className?: string }) {
  const { tone, label } = roleBadge(agent);
  return (
    <span
      data-role-tone={tone}
      style={{ '--role': ROLE_COLOR[tone] } as CSSProperties}
      className={cn(
        'inline-flex h-[18px] max-w-full min-w-0 items-center rounded-[5px] bg-[color-mix(in_oklch,var(--role)_13%,transparent)] px-1.5 text-2xs leading-none font-medium text-[color-mix(in_oklch,var(--role)_60%,var(--foreground))] [transform:translateZ(0)]',
        className,
      )}
    >
      <span className="truncate">{label}</span>
    </span>
  );
}
