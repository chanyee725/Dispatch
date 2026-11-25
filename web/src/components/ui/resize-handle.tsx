import { useRef, useState, type PointerEvent } from 'react';
import { cn } from '../../lib/utils';

type ResizeHandleProps = {
  orientation: 'horizontal' | 'vertical';
  label: string;
  controls?: string;
  title: string;
  slot: string;
  className?: string;
  min: number;
  max: number;
  value: number;
  onPreview: (size: number) => void;
  onCommit: (size: number) => void;
  onCancel?: () => void;
  sizeForKey: (key: string, shift: boolean) => number | null;
  reset?: number;
};

/** A focusable separator. Its orientation describes the divider, perpendicular to the drag axis. */
export function ResizeHandle({
  orientation, label, controls, title, slot, className, min, max, value, onPreview, onCommit, onCancel, sizeForKey, reset,
}: ResizeHandleProps) {
  const horizontal = orientation === 'horizontal';
  const drag = useRef<{ pointer: number; origin: number; initial: number; next: number | null } | null>(null);
  const [dragging, setDragging] = useState(false);
  const position = (e: PointerEvent<HTMLDivElement>) => horizontal ? e.clientY : e.clientX;
  const end = (e: PointerEvent<HTMLDivElement>, canceled = false) => {
    const current = drag.current;
    if (!current || current.pointer !== e.pointerId) return;
    drag.current = null;
    setDragging(false);
    if (canceled && onCancel) onCancel();
    else if (current.next !== null) onCommit(Math.min(max, Math.max(min, current.next)));
  };

  return (
    <div
      role="separator"
      aria-orientation={orientation}
      aria-label={label}
      aria-controls={controls}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-valuetext={`${value}px`}
      aria-disabled={max === min || undefined}
      tabIndex={max === min ? -1 : 0}
      title={title}
      data-slot={slot}
      data-dragging={dragging ? '' : undefined}
      className={cn(
        'group/resize select-none outline-none',
        horizontal ? 'relative cursor-row-resize touch-pan-x' : 'cursor-col-resize touch-pan-y',
        className,
      )}
      onPointerDown={(e) => {
        if (max === min || e.button !== 0 || drag.current) return;
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { pointer: e.pointerId, origin: position(e), initial: value, next: null };
        setDragging(true);
      }}
      onPointerMove={(e) => {
        const current = drag.current;
        if (!current || current.pointer !== e.pointerId) return;
        current.next = Math.min(max, Math.max(min, current.initial + position(e) - current.origin));
        onPreview(current.next);
      }}
      onPointerUp={(e) => end(e)}
      onPointerCancel={(e) => end(e, true)}
      onLostPointerCapture={(e) => end(e, true)}
      onDoubleClick={reset === undefined ? undefined : () => onCommit(reset)}
      onKeyDown={(e) => {
        const next = sizeForKey(e.key, e.shiftKey);
        if (max === min || next === null) return;
        e.preventDefault();
        onCommit(next);
      }}
    >
      <span
        aria-hidden
        className={cn(
          'pointer-events-none absolute bg-transparent transition-colors duration-150 group-hover/resize:bg-foreground/20 group-focus-visible/resize:bg-ring group-data-dragging/resize:bg-ring motion-reduce:transition-none forced-colors:group-focus-visible/resize:bg-[Highlight]',
          horizontal
            ? 'inset-x-0 top-1/2 h-px -translate-y-1/2 bg-border group-focus-visible/resize:h-0.5'
            : 'inset-y-0 left-1/2 w-px -translate-x-1/2 group-focus-visible/resize:w-0.5',
        )}
      />
    </div>
  );
}
