import { useState } from "react";
import { CheckCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { api, useApp } from "@/store";

/**
 * One click to drop finished sessions (done or error) from the list. Their transcripts go with
 * them; branches stay, and a worktree goes only when nothing uncommitted is left in it.
 */
export function ClearDoneButton() {
  const done = useApp(s => s.sessions.filter(x => x.status === "done" || x.status === "error").length);
  const [busy, setBusy] = useState(false);
  if (!done) return null;
  const clear = async () => {
    setBusy(true);
    try {
      const r = await api<{ removed: number }>("POST", "/api/sessions/clear-done");
      toast.success(`끝난 세션 ${r.removed}개를 정리했어요`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Button
      variant="outline" size="sm" onClick={clear} disabled={busy} className="gap-1.5"
      title="끝난 세션을 목록에서 지워요. 대화 기록도 지워지고, 브랜치는 남아요."
    >
      <CheckCheck />
      <span className="max-sm:hidden">끝난 세션 정리</span>
      <span className="num text-xs text-muted-foreground">{done}</span>
    </Button>
  );
}
