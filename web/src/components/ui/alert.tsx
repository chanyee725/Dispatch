// shadcn/ui (MIT) new-york Alert, adapted: relative imports, a single-row layout with room for actions.
import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils';

const alertVariants = cva('relative flex w-full flex-wrap items-center gap-2 border-b px-4 py-2 text-sm', {
  variants: {
    variant: {
      default: 'bg-muted/60 text-foreground',
      destructive: 'bg-destructive/5 text-destructive',
    },
  },
  defaultVariants: { variant: 'default' },
});

function Alert({ className, variant, ...props }: React.ComponentProps<'div'> & VariantProps<typeof alertVariants>) {
  return <div data-slot="alert" role="alert" className={cn(alertVariants({ variant }), className)} {...props} />;
}

export { Alert };
