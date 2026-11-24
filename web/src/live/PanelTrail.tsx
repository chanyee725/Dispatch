// The path line in a right panel's head (#942): where the panel was opened from, e.g. 대시보드 › 실행 중인 세션 › Bea.
// Earlier steps are buttons that go back there; the last one is the item the panel shows.
import { FOCUS_RING } from '../lib/focus';

export function PanelTrail({ steps, current, onBack }: { steps: readonly string[]; current: string; onBack: (i: number) => void }) {
  return (
    <nav aria-label="경로" className="agent-live-trail" data-panel-trail>
      <ol>
        {steps.map((label, i) => (
          <li key={`${i}:${label}`} className="shrink-0">
            <button type="button" onClick={() => onBack(i)} className={FOCUS_RING}>{label}</button>
          </li>
        ))}
        <li className="min-w-0">
          <span aria-current="page" title={current}>{current}</span>
        </li>
      </ol>
    </nav>
  );
}
