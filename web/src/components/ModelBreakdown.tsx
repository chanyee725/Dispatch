import { ModelTag } from "@/components/bits";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { fmtK, fmtUsd, totalTok } from "@/lib/format";
import type { Session } from "@/types";

type Row = { key: string; provider: string; label: string; sessions: number; cost: number | null; input: number; output: number; total: number };

/** Cost and tokens of the listed sessions, grouped by model (biggest first). */
export function ModelBreakdown({ sessions, open, onOpenChange }: { sessions: Session[]; open: boolean; onOpenChange: (o: boolean) => void }) {
  const rows = new Map<string, Row>();
  for (const s of sessions) {
    const r = rows.get(s.model) ?? { key: s.model, provider: s.provider, label: s.modelLabel, sessions: 0, cost: null, input: 0, output: 0, total: 0 };
    r.sessions += 1;
    if (s.cost != null) r.cost = (r.cost ?? 0) + s.cost;
    r.input += s.usage.input + s.usage.cacheRead + s.usage.cacheWrite;
    r.output += s.usage.output;
    r.total += totalTok(s.usage);
    rows.set(s.model, r);
  }
  const list = [...rows.values()].sort((a, b) => (b.cost ?? 0) - (a.cost ?? 0) || b.total - a.total);
  const sum = list.reduce((a, r) => ({ cost: a.cost + (r.cost ?? 0), total: a.total + r.total }), { cost: 0, total: 0 });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>모델별 사용</DialogTitle>
          <DialogDescription>지금 목록에 있는 세션 {sessions.length}개 기준이에요. 비용은 API 환산이라 구독 청구액과 달라요.</DialogDescription>
        </DialogHeader>
        {list.length ? (
          <table className="w-full table-fixed text-sm">
            <thead className="text-xs text-muted-foreground">
              <tr className="border-b">
                <th className="w-[42%] pb-2 text-left font-normal">모델</th>
                <th className="pb-2 text-right font-normal">세션</th>
                <th className="pb-2 text-right font-normal">입력</th>
                <th className="pb-2 text-right font-normal">출력</th>
                <th className="pb-2 text-right font-normal">비용</th>
              </tr>
            </thead>
            <tbody className="num">
              {list.map(r => (
                <tr key={r.key} className="border-b last:border-0">
                  <td className="py-2.5 pr-2"><ModelTag provider={r.provider} label={r.label} /></td>
                  <td className="py-2.5 text-right">{r.sessions}</td>
                  <td className="py-2.5 text-right">{fmtK(r.input)}</td>
                  <td className="py-2.5 text-right">{fmtK(r.output)}</td>
                  <td className="py-2.5 text-right">{r.cost == null ? "—" : fmtUsd(r.cost)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="num text-sm font-semibold">
              <tr>
                <td className="pt-2.5">합계</td>
                <td className="pt-2.5 text-right">{sessions.length}</td>
                <td className="pt-2.5 text-right" colSpan={2}>{fmtK(sum.total)} 토큰</td>
                <td className="pt-2.5 text-right">{fmtUsd(sum.cost)}</td>
              </tr>
            </tfoot>
          </table>
        ) : (
          <p className="py-6 text-center text-sm text-muted-foreground">세션이 없어요</p>
        )}
      </DialogContent>
    </Dialog>
  );
}
