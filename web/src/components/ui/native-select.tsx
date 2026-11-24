// A dense native <select> in the shadcn/ui (MIT) Select look: the browser's own control (keyboard, mobile pickers,
// form semantics) with the app's border, height and chevron. Used where tests and a11y rely on a real <select>.
import * as React from 'react';
import { ChevronDownIcon } from 'lucide-react';
import { cn } from '../../lib/utils';

/** `start`: a decorative mark drawn inside the control before the value (e.g. the chosen model's provider icon). */
function NativeSelect({ className, children, start, ...props }: React.ComponentProps<'select'> & { start?: React.ReactNode }) {
  return (
    <span data-slot="native-select" className="relative inline-flex">
      {start && (
        <span aria-hidden data-slot="native-select-start" className="pointer-events-none absolute top-1/2 left-2 inline-flex -translate-y-1/2 text-foreground">
          {start}
        </span>
      )}
      <select
        className={cn(
          start && 'pl-7',
          'h-7 appearance-none rounded-md border border-input bg-transparent py-0 pr-6 text-xs text-foreground transition-[color,border-color,box-shadow] outline-none hover:bg-accent focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50',
          !start && 'pl-2',
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDownIcon aria-hidden className="pointer-events-none absolute top-1/2 right-1.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
    </span>
  );
}

export { NativeSelect };
