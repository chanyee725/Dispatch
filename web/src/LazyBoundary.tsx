import { Component, type ReactNode } from 'react';
import { noticeFor } from './chunkError';
import { Button } from './components/ui/button';

type Props = {
  /** Called when a child fails (and again before reloading): save the open file here. Resolve false when edits are still unsaved. */
  onFail?: () => Promise<boolean | void> | boolean | void;
  children: ReactNode;
};
type State = { error: unknown; failed: boolean };

/** Catches a failed lazy chunk (or a render crash) so the rest of the app stays up; offers a reload. */
export class LazyBoundary extends Component<Props, State> {
  state: State = { error: null, failed: false };

  static getDerivedStateFromError(error: unknown): State {
    return { error, failed: true };
  }

  componentDidCatch() {
    void Promise.resolve(this.props.onFail?.()).catch(() => {});
  }

  private reload = async () => {
    let saved: boolean | void = true;
    try {
      saved = await this.props.onFail?.();
    } catch {
      saved = false;
    }
    // Reloading with unsaved edits (failed PUT, conflict) would lose them.
    if (saved === false) return;
    window.location.reload();
  };

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div role="alert" className="flex flex-wrap items-center gap-2 p-6 text-sm text-muted-foreground">
        <span>{noticeFor(this.state.error)}</span>
        <Button size="sm" onClick={() => void this.reload()}>
          새로고침
        </Button>
      </div>
    );
  }
}
