// Shows the requests from appDialog.ts (#732) as a native modal <dialog>: the browser gives the inert page, focus
// containment, Esc and focus return. One host is mounted in App; each request gets a fresh element (key = id).
import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { currentDialog, settleDialog, subscribeDialogs, type OpenDialog } from './appDialog';
import { Button } from './components/ui/button';
import { Input } from './components/ui/input';
import './app-dialog.css';

export function AppDialogHost() {
  const open = useSyncExternalStore(subscribeDialogs, currentDialog, currentDialog);
  return open ? <AppDialog key={open.id} open={open} /> : null;
}

function AppDialog({ open: { id, request: r } }: { open: OpenDialog }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const bodyId = useId();
  const fieldId = useId();
  const errorId = useId();
  const [value, setValue] = useState(r.kind === 'text' ? (r.initial ?? '') : '');
  const [error, setError] = useState<string | null>(null);
  const valueRef = useRef(value);
  valueRef.current = value;

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);

  // Esc, the back gesture and the cancel/ok buttons all end here; returnValue says which (''/cancel = dismissed).
  const onClose = () => {
    const d = ref.current;
    const chosen = d?.returnValue === 'ok';
    if (d) d.returnValue = '';
    settleDialog(id, r.kind === 'text' ? (chosen ? valueRef.current : null) : chosen);
  };

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    if (r.kind !== 'text') return; // method="dialog" closes with the submit button's value ("ok")
    e.preventDefault();
    const message = r.validate?.(value) ?? null;
    if (message) return setError(message);
    ref.current?.close('ok');
  };

  const describedBy = r.body ? bodyId : undefined;
  return (
    <dialog
      ref={ref}
      data-app-dialog=""
      aria-labelledby={titleId}
      aria-describedby={describedBy}
      onClose={onClose}
      className="app-dialog m-auto w-[min(26rem,calc(100vw-2rem))] max-w-none rounded-lg border bg-background p-0 text-foreground shadow-md"
    >
      <form method="dialog" onSubmit={onSubmit}>
        <div className="overlay-head flex flex-col gap-1.5">
          <h2 id={titleId} className="text-sm font-semibold">
            {r.title}
          </h2>
          {r.body && (
            <p id={bodyId} className="text-sm text-muted-foreground">
              {r.body}
            </p>
          )}
        </div>
        {r.kind === 'text' && (
          <div className="flex flex-col gap-1.5 px-(--overlay-x) pb-2">
            <label htmlFor={fieldId} className="sr-only">
              {r.label ?? r.title}
            </label>
            <Input
              id={fieldId}
              autoFocus
              value={value}
              placeholder={r.placeholder}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? errorId : undefined}
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => (setValue(e.target.value), setError(null))}
              onFocus={(e) => e.currentTarget.select()}
            />
            <p id={errorId} role="alert" className="min-h-4 text-xs text-destructive">
              {error ?? ''}
            </p>
          </div>
        )}
        <div className="overlay-foot flex items-center justify-end gap-2">
          {r.kind !== 'notice' && (
            <Button variant="outline" size="sm" onClick={() => ref.current?.close('cancel')} autoFocus={r.kind === 'confirm' && r.danger}>
              {r.cancel ?? '취소'}
            </Button>
          )}
          <Button
            type="submit"
            size="sm"
            value="ok"
            variant={r.kind === 'confirm' && r.danger ? 'destructive' : 'default'}
            autoFocus={r.kind === 'notice' || (r.kind === 'confirm' && !r.danger)}
          >
            {r.ok ?? '확인'}
          </Button>
        </div>
      </form>
    </dialog>
  );
}
