// The one <Toaster /> (Sonner, #899), restyled with our tokens: the popover surface, its border and pop shadow, our
// radius and type. Quiet on purpose — no rich colors; only the icon carries the tone (ok / destructive).
// Mounted once at the app root; toasts come from activity/actionToast.ts.
import type { CSSProperties } from 'react';
import { CircleAlert, CircleCheck, Info, LoaderCircle } from 'lucide-react';
import { Toaster as Sonner } from 'sonner';

// Inline custom properties beat Sonner's [data-sonner-theme] selectors, so these follow light, dark and monitor.
const tokens = {
  '--normal-bg': 'var(--popover)',
  '--normal-text': 'var(--popover-foreground)',
  '--normal-border': 'var(--border)',
  '--normal-bg-hover': 'var(--accent)',
  '--normal-border-hover': 'var(--border)',
  '--border-radius': 'var(--radius-card)',
  '--gray11': 'var(--muted-foreground)',
  fontFamily: 'var(--font-sans)',
} as CSSProperties;

export function Toaster({ dark }: { dark: boolean }) {
  return (
    <Sonner
      theme={dark ? 'dark' : 'light'}
      position="bottom-right"
      containerAriaLabel="알림"
      gap={8}
      style={tokens}
      icons={{
        success: <CircleCheck className="size-4 text-ok" />,
        error: <CircleAlert className="size-4 text-destructive" />,
        info: <Info className="size-4 text-muted-foreground" />,
        loading: <LoaderCircle className="size-4 animate-spin text-muted-foreground motion-reduce:animate-none" />,
      }}
      toastOptions={{
        closeButtonAriaLabel: '닫기',
        classNames: {
          toast: '!shadow-pop !border-0 !px-3.5 !py-3 !text-sm',
          title: '!font-normal',
          description: '!text-muted-foreground',
        },
      }}
    />
  );
}
