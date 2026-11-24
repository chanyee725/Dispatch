// shadcn/ui (MIT) new-york Dialog, adapted: relative imports, no built-in close icon (callers keep their own
// "닫기" button), a ring shadow and 12px panel corners (#889); it grows from the centre.
import * as React from 'react';
import { Dialog as DialogPrimitive } from 'radix-ui';
import { cn } from '../../lib/utils';

function Dialog(props: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />;
}

function DialogPortal(props: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />;
}

function DialogOverlay({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn('fixed inset-0 z-50 bg-black/40 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0', className)}
      {...props}
    />
  );
}

// An in-app confirm/prompt (#732, AppDialogHost) opened from inside this dialog is a separate native modal: its
// clicks, focus and Esc must not close the Radix dialog underneath.
const inAppDialog = (e: Event) => e.target instanceof Element && !!e.target.closest('dialog[data-app-dialog]');
const appDialogOpen = () => !!document.querySelector('dialog[data-app-dialog][open]');

function DialogContent({ className, overlayClassName, children, onInteractOutside, onEscapeKeyDown, ...props }: React.ComponentProps<typeof DialogPrimitive.Content> & { overlayClassName?: string }) {
  return (
    <DialogPortal>
      <DialogOverlay className={overlayClassName} />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        className={cn(
          'fixed top-1/2 left-1/2 z-50 flex -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-panel bg-background text-foreground shadow-(--shadow-pop) outline-none duration-200 ease-(--ease-out)',
          'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-[0.98] data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-[0.98]',
          className,
        )}
        onInteractOutside={(e) => {
          if (inAppDialog(e) || appDialogOpen()) e.preventDefault();
          else onInteractOutside?.(e);
        }}
        onEscapeKeyDown={(e) => {
          // Esc belongs to the app dialog on top: keep this one open and close that one (as 취소).
          const top = document.querySelector<HTMLDialogElement>('dialog[data-app-dialog][open]');
          if (top) (e.preventDefault(), top.close());
          else onEscapeKeyDown?.(e);
        }}
        {...props}
      >
        {children}
      </DialogPrimitive.Content>
    </DialogPortal>
  );
}

function DialogHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="dialog-header" className={cn('overlay-head flex items-center gap-2 border-b', className)} {...props} />;
}

function DialogFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="dialog-footer" className={cn('overlay-foot flex items-center justify-end gap-2 border-t', className)} {...props} />;
}

function DialogTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return <DialogPrimitive.Title data-slot="dialog-title" className={cn('text-sm leading-none font-semibold', className)} {...props} />;
}

function DialogDescription({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return <DialogPrimitive.Description data-slot="dialog-description" className={cn('text-xs text-muted-foreground', className)} {...props} />;
}

const DialogClose = DialogPrimitive.Close;

export { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogOverlay, DialogPortal, DialogTitle };
