// Shared dashboard primitives for the home dashboard (#685) and the project dashboard (#686).
// Quiet panels on the app's own tokens (#889 refresh): card surface with the ink ring, 10px corners, a header that
// runs straight into its first row (rows carry their own top rule), inner tiles one paper step down on --background.
// API is additive-only: other screens import these, so props are never renamed or removed.
import { useId, type ReactNode } from 'react';
import { cn } from '../../lib/utils';

/**
 * Two halves side by side (5:5 by default) that stack below 880px of *container* width, so the split
 * follows the main pane, not the window (the sidebar takes part of the window).
 * It grows to the bottom of its flex parent (#699); a long one scrolls with the page as before. Cards stay as tall as
 * their content (#715): growing the last card only left an empty band inside it.
 */
export function DashGrid({ children, className, ratio = '1fr 1fr', fill }: { children: ReactNode; className?: string; ratio?: string; fill?: boolean }) {
  // fill (#819): side by side, the grid is exactly as tall as its pane (a flex parent of fixed height, e.g. <main>) and
  // the cards share it (<Card fill>); stacked, it keeps the page's own scroll.
  return (
    <div className={cn('@container flex grow flex-col', fill && 'min-h-0')}>
      <div
        className={cn(
          'dash-grid flex grow flex-col gap-4 px-5 pt-1 pb-5 *:last:grow @min-[880px]:grid @min-[880px]:[grid-template-columns:var(--dash-cols)]',
          fill && '@min-[880px]:min-h-0 @min-[880px]:grid-rows-[minmax(0,1fr)]',
          className,
        )}
        style={{ '--dash-cols': ratio } as React.CSSProperties}
      >
        {children}
      </div>
    </div>
  );
}

/** A column of cards inside one half. */
export function DashColumn({ children, className, label, fill }: { children: ReactNode; className?: string; label?: string; fill?: boolean }) {
  return (
    // Filled (#819), the cards' own <Card fill> shares set the split; otherwise each card is as tall as its content (#715).
    <div className={cn('flex min-w-0 flex-col gap-4', fill && '@min-[880px]:min-h-0', className)} role={label ? 'region' : undefined} aria-label={label}>
      {children}
    </div>
  );
}

type CardProps = {
  /** Heading text; also names the region for screen readers. */
  title: ReactNode;
  /** Small number after the title (e.g. how many rows). */
  count?: number;
  /** Right side of the header: buttons or links. */
  actions?: ReactNode;
  /** One line under the title in muted text. */
  hint?: ReactNode;
  children?: ReactNode;
  className?: string;
  /** Body without padding, for row lists that run edge to edge. */
  flush?: boolean;
  /** data-card attribute, for tests and screenshots. */
  id?: string;
  /**
   * Share of a <DashColumn>'s height (flex-grow from a zero basis), e.g. 5, 3 and 2 for a 5:3:2 split (#720).
   * The card never gets shorter than its content, so a full card pushes the split instead of clipping rows.
   */
  grow?: number;
  /** The body scrolls inside the card instead of growing it (#793): the card keeps its share of the column. */
  scroll?: boolean;
  /**
   * Share of a filled column (#819, <DashGrid fill>), side by side only: the card takes `fill` parts of the column's
   * height and its body (a flex column) scrolls inside. Stacked, the card is as tall as its content.
   */
  fill?: number;
  /** Header content before the actions, e.g. a tab list (#819); the title then stays as a hidden heading. */
  lead?: ReactNode;
};

/** A titled panel. The header is part of the card; rows inside use <CardRow>. */
export function Card({ title, count, actions, hint, children, className, flush, id, grow, scroll, fill, lead }: CardProps) {
  const headId = useId();
  const share = grow === undefined ? (fill === undefined ? undefined : ({ '--card-fill': fill } as React.CSSProperties)) : { flex: `${grow} 1 0%`, minBlockSize: scroll ? '7.5rem' : 'fit-content' };
  return (
    <section
      aria-labelledby={headId}
      data-card={id}
      style={share}
      className={cn(
        'card-surface min-w-0 overflow-hidden',
        scroll && 'flex flex-col',
        fill !== undefined && '@min-[880px]:flex @min-[880px]:min-h-30 @min-[880px]:flex-col @min-[880px]:[flex:var(--card-fill)_1_0%]',
        className,
      )}
    >
      <CardHeader id={headId} title={title} count={count} actions={actions} hint={hint} lead={lead} />
      <div
        className={cn(
          !flush && 'px-4 py-3',
          scroll && 'min-h-0 flex-1 overflow-y-auto overscroll-contain',
          fill !== undefined && '@min-[880px]:flex @min-[880px]:min-h-0 @min-[880px]:flex-1 @min-[880px]:flex-col @min-[880px]:overflow-y-auto @min-[880px]:overscroll-contain',
        )}
      >
        {children}
      </div>
    </section>
  );
}

export function CardHeader({ id, title, count, actions, hint, lead }: { id?: string; title: ReactNode; count?: number; actions?: ReactNode; hint?: ReactNode; lead?: ReactNode }) {
  return (
    <header className="flex min-h-[44px] items-center gap-2 px-4 pt-2.5 pb-1.5">
      <div className={cn('min-w-0', lead && 'sr-only')}>
        <h2 id={id} className="m-0 flex items-baseline gap-2 text-xs font-semibold">
          <span className="truncate">{title}</span>
          {count !== undefined && <span className="font-normal text-muted-foreground tabular-nums">{count}</span>}
        </h2>
        {hint && <p className="m-0 truncate text-xs text-muted-foreground">{hint}</p>}
      </div>
      {lead && <div className="flex min-w-0 items-center">{lead}</div>}
      {actions && <div className="ml-auto flex shrink-0 items-center gap-1">{actions}</div>}
    </header>
  );
}

/** A list of rows in a flush card. */
export function CardList({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <ul aria-label={label} className="m-0 list-none p-0 *:border-t">
      {children}
    </ul>
  );
}

/**
 * Items as a grid of n rows × 3 columns in a flush card (#720). The columns follow the card's own width (a container
 * query), not the window: 3 from 26rem, 2 from 18rem, 1 below that (a phone-width card).
 */
export function CardGrid({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <div className="@container">
      <ul aria-label={label} className="m-0 grid list-none grid-cols-1 gap-2 p-2 @min-[18rem]:grid-cols-2 @min-[26rem]:grid-cols-3">
        {children}
      </ul>
    </div>
  );
}

/**
 * One row: leading icon, a main line and a muted second line, trailing meta. Pass `onClick` (a button) or `href`
 * (a link) to make the whole row the target.
 */
export function CardRow({ icon, title, sub, meta, onClick, href, className, data }: { icon?: ReactNode; title: ReactNode; sub?: ReactNode; meta?: ReactNode; onClick?: () => void; href?: string; className?: string; data?: string }) {
  const body = (
    <>
      {icon && <span aria-hidden className="grid size-5 shrink-0 place-items-center text-muted-foreground [&_svg]:size-4">{icon}</span>}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm">{title}</span>
        {sub && <span className="block truncate text-xs text-muted-foreground">{sub}</span>}
      </span>
      {meta && <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground tabular-nums">{meta}</span>}
    </>
  );
  const cls = 'flex w-full min-w-0 items-center gap-3 px-4 py-2 text-left';
  const hit = 'hover:bg-accent/60 focus-visible:bg-accent focus-visible:outline-none';
  return (
    <li data-row={data} className={className}>
      {href ? (
        <a href={href} target="_blank" rel="noreferrer" className={cn(cls, hit, 'text-inherit no-underline')}>{body}</a>
      ) : onClick ? (
        <button type="button" onClick={onClick} className={cn(cls, hit)}>{body}</button>
      ) : (
        <div className={cls}>{body}</div>
      )}
    </li>
  );
}

/** A number with a label under it; `tone` colours a dot before the number. */
export function Stat({ value, label, tone }: { value: ReactNode; label: ReactNode; tone?: keyof typeof TONE }) {
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1.5 text-xl leading-7 font-semibold tracking-title tabular-nums">
        {tone && <span aria-hidden className={cn('size-1.5 rounded-full', TONE[tone])} />}
        {value}
      </div>
      <div className="truncate text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

export const TONE = { ok: 'bg-ok', warn: 'bg-warn', bad: 'bg-bad', idle: 'bg-idle', merged: 'bg-merged', impl: 'bg-[var(--role-impl)]', review: 'bg-[var(--role-review)]' } as const;

/** Small coloured status dot with text; the text is what screen readers get. */
export function StatusDot({ tone, children, pulse }: { tone: keyof typeof TONE; children?: ReactNode; pulse?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span aria-hidden className={cn('size-1.5 shrink-0 rounded-full', TONE[tone], pulse && 'motion-safe:animate-pulse')} />
      {children}
    </span>
  );
}

/** What a card shows when it has nothing: one plain sentence and, optionally, the action that fills it. */
export function EmptyState({ children, action, className }: { children: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col items-start gap-2 px-4 py-5 text-sm text-muted-foreground', className)}>
      <p className="m-0">{children}</p>
      {action}
    </div>
  );
}
