// shadcn/ui (MIT) Kbd, adapted: relative imports.
import * as React from 'react';
import { cn } from '../../lib/utils';

function Kbd({ className, ...props }: React.ComponentProps<'kbd'>) {
  return (
    <kbd
      data-slot="kbd"
      className={cn('pointer-events-none inline-flex h-5 min-w-5 items-center justify-center gap-1 rounded-sm border bg-muted px-1 font-sans text-2xs font-medium text-muted-foreground select-none', className)}
      {...props}
    />
  );
}

export { Kbd };
