import { useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { ResizeHandle } from '../components/ui/resize-handle';
import { useResizeSize } from '../lib/resizeSize';
import { DEFAULT_HEIGHT, HANDLE_HEIGHT, SESSIONS_MIN, STORAGE_KEY, TIMELINE_MIN, heightForKey, maxSessionHeight, preferredHeight } from './lib/sessionTimelineSize';

export function SessionTimelineSplit({ sessions, timeline }: { sessions: ReactNode; timeline: ReactNode }) {
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);
  const { size, preview, commit, cancel } = useResizeSize(STORAGE_KEY, DEFAULT_HEIGHT, preferredHeight);
  const [maxHeight, setMaxHeight] = useState(SESSIONS_MIN);
  const height = Math.min(size, maxHeight);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => setMaxHeight(maxSessionHeight(element.clientHeight));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className="group/board-split grid h-[65dvh] min-h-[var(--split-min)] min-w-0 grid-rows-[var(--sessions-height)_var(--handle-height)_minmax(0,1fr)] has-[[data-folded]]:h-auto has-[[data-folded]]:min-h-0 has-[[data-folded]]:grid-rows-[minmax(0,1fr)_auto] has-[[data-folded]]:gap-4 @min-[880px]:h-auto @min-[880px]:flex-1"
      style={{
        '--split-min': `${SESSIONS_MIN + HANDLE_HEIGHT + TIMELINE_MIN}px`,
        '--sessions-height': `${height}px`,
        '--handle-height': `${HANDLE_HEIGHT}px`,
      } as CSSProperties}
    >
      <div id={id} className="min-w-0">{sessions}</div>
      <ResizeHandle
        orientation="horizontal"
        label="세션 높이"
        controls={id}
        title="드래그하거나 ↑/↓로 높이를 바꿔요."
        slot="board-resize"
        className="group-has-[[data-folded]]/board-split:hidden"
        value={height}
        min={SESSIONS_MIN}
        max={maxHeight}
        onPreview={preview}
        onCommit={commit}
        onCancel={cancel}
        sizeForKey={(key, shift) => heightForKey(height, maxHeight, key, shift)}
      />
      <div data-timeline-pane className="min-w-0 overflow-y-auto">{timeline}</div>
    </div>
  );
}
