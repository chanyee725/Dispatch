import { useState } from "react";
import { BrushCleaning } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api, useApp } from "@/store";

/** Stops and removes every session of this project (this server only), after a confirmation. */
export function ClearAllButton() {
  const sessions = useApp(s => s.sessions);
  const project = useApp(s => s.project);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const running = sessions.filter(s => s.status === "running" || s.status === "starting" || s.status === "waiting").length;
  const clear = async () => {
    setBusy(true);
    try {
      const r = await api<{ removed: number }>("POST", "/api/sessions/clear");
      toast.success(`세션 ${r.removed}개를 정리했어요`);
      setOpen(false);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)} disabled={!sessions.length} aria-label="정리하기" title="이 프로젝트의 세션 모두 정리">
        <BrushCleaning />
        <span className="max-sm:hidden">정리하기</span>
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>세션을 모두 정리할까요?</DialogTitle>
            <DialogDescription>
              {project.name}의 세션 {sessions.length}개를 종료하고 목록에서 지워요.
              {running > 0 && <> 지금 일하는 세션 <b className="text-foreground">{running}개</b>도 멈춰요.</>} 브랜치와 작업 폴더는 그대로 남아요. 다른 프로젝트는 건드리지 않아요.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild><Button variant="outline">취소</Button></DialogClose>
            <Button variant="destructive" onClick={clear} disabled={busy}>{busy ? "정리하는 중…" : "모두 정리"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
