import { MessageCircleQuestion } from "lucide-react";
import { Button } from "@/components/ui/button";
import { questionOf } from "@/lib/question";
import { awaitsAnswer } from "@/lib/turn";
import { useApp } from "@/store";
import type { Session } from "@/types";

/**
 * "답할 것": the question the session's last turn ended with, pinned at the top of the sheet.
 * Reads the question from the transcript already in the browser (or the session's last line); nothing is stored.
 * A choice fills the composer so the person can check it before sending.
 */
export function AnswerCard({ s, onPick }: { s: Session; onPick: (text: string) => void }) {
  const entries = useApp(st => st.transcripts[s.id]);
  if (!awaitsAnswer(s)) return null;
  let text: string | undefined;
  for (let i = (entries?.length ?? 0) - 1; i >= 0; i--) {
    const e = entries![i];
    if (e.kind === "user") break;
    if (e.kind === "assistant") { text = e.text; break; }
  }
  const q = questionOf(text ?? s.last);
  if (!q) return null;
  return (
    <section aria-label="답할 것" className="mx-6 mt-3 rounded-xl border border-warn/60 bg-warn/5 p-3">
      <div className="flex items-center gap-1.5 text-xs font-medium text-warn">
        <MessageCircleQuestion className="size-3.5" />
        답할 것
      </div>
      <p className="mt-1 line-clamp-3 text-sm leading-6" title={q.summary}>{q.summary}</p>
      {q.options.length > 0 && (
        <div className="mt-2.5 flex flex-wrap gap-2">
          {q.options.map(o => (
            <Button key={o} size="sm" variant="outline" className="h-auto max-w-full py-1.5 text-left whitespace-normal" onClick={() => onPick(o)}>
              {o}
            </Button>
          ))}
        </div>
      )}
      <p className="mt-2 text-xs text-muted-foreground">
        {q.options.length > 0 ? "고르면 입력창에 들어가요. 고쳐서 보내도 돼요." : "아래 입력창에 답을 적어 보내요."}
      </p>
    </section>
  );
}
