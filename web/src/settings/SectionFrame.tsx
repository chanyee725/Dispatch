// One section of the 설정 modal (#624): a heading the section is named by, an optional hint, then the body.
import { useId, type ReactNode } from 'react';
import { cn } from '../lib/utils';

export function SectionFrame({ title, hint, children, className, testId }: { title: string; hint?: string; children: ReactNode; className?: string; testId?: string }) {
  const id = useId();
  return (
    <section aria-labelledby={id} data-testid={testId} className={cn('flex min-w-0 flex-col gap-4', className)}>
      <header className="flex flex-col gap-1 pr-10 max-md:pr-0">
        <h3 id={id} className="text-lg leading-7 font-semibold tracking-title">
          {title}
        </h3>
        {hint && <p className="max-w-[65ch] text-sm text-muted-foreground">{hint}</p>}
      </header>
      {children}
    </section>
  );
}

