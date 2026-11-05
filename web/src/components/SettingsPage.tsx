import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { roleColor } from "@/lib/format";
import { api, useApp } from "@/store";
import type { Settings, TeamSettings } from "@/types";

const save = (body: Partial<{ team: Partial<TeamSettings>; guard: Partial<Settings["guard"]> }>) =>
  api("POST", "/api/settings", body).then(() => toast.success("설정을 저장했어요"), (e: Error) => toast.error(e.message));

function Section({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col rounded-xl border bg-card">
      <header className="border-b px-5 py-3.5">
        <h2 className="text-[15px] font-semibold">{title}</h2>
        {note && <p className="mt-0.5 text-[13px] text-muted-foreground">{note}</p>}
      </header>
      <div className="flex flex-col divide-y">{children}</div>
    </section>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-6 px-5 py-3.5 max-sm:flex-col max-sm:items-start max-sm:gap-2">
      <div className="min-w-0">
        <div className="text-sm font-medium">{label}</div>
        {hint && <p className="mt-0.5 text-[13px] text-muted-foreground">{hint}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-2">{children}</div>
    </div>
  );
}

/** A number field that saves on blur or Enter, and snaps back when the server refuses the value. */
function NumberField({ value, min, max, unit, label, onSave }: {
  value: number; min: number; max: number; unit: string; label: string; onSave: (n: number) => Promise<unknown>;
}) {
  const [v, setV] = useState(String(value));
  useEffect(() => setV(String(value)), [value]);
  const commit = () => {
    const n = Number(v);
    if (v === String(value)) return;
    if (!Number.isInteger(n) || n < min || n > max) { toast.error(`${min}~${max} 사이 숫자를 넣어 주세요`); setV(String(value)); return; }
    onSave(n);
  };
  return (
    <>
      <Input
        type="number" inputMode="numeric" min={min} max={max} value={v} aria-label={label}
        className="num h-8 w-20 text-right" onChange={e => setV(e.target.value)} onBlur={commit}
        onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
      />
      <span className="w-8 text-sm text-muted-foreground">{unit}</span>
    </>
  );
}

function Toggle({ checked, label, onChange }: { checked: boolean; label: string; onChange: (v: boolean) => void }) {
  return <Checkbox checked={checked} aria-label={label} onCheckedChange={v => onChange(v === true)} className="size-5" />;
}

export function SettingsPage() {
  const settings = useApp(s => s.settings);
  const roles = useApp(s => s.roles);
  const models = useApp(s => s.models);
  const providers = useApp(s => s.providers);
  const team = settings.team;
  const g = settings.guard;
  const groups = [...new Set(models.map(m => m.provider))];

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5 p-6 max-md:p-4">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">설정</h1>
        <p className="mt-1 text-sm text-muted-foreground">이 프로젝트의 팀이 일하는 방식을 정해요. 바꾸면 바로 저장되고, 다음 세션·다음 턴부터 적용돼요.</p>
      </header>

      <Section title="관리자와 팀" note="관리자가 대화를 이어 가는 주기와 팀 크기예요.">
        <Row label="관리자 대화 새로 시작" hint="이 턴 수마다 대화를 요약해 새 세션으로 이어 가요. 짧을수록 토큰이 적게 들고, 0이면 이어 가지 않아요.">
          <NumberField value={team.rotateLead} min={0} max={100} unit="턴" label="관리자 대화 새로 시작 턴 수" onSave={n => save({ team: { rotateLead: n } })} />
        </Row>
        <Row label="다른 역할 대화 새로 시작" hint="구현자·리뷰어·테스터 등에 같은 규칙을 써요.">
          <NumberField value={team.rotateOthers} min={0} max={100} unit="턴" label="다른 역할 대화 새로 시작 턴 수" onSave={n => save({ team: { rotateOthers: n } })} />
        </Row>
        <Row label="관리자 한 명이 둘 수 있는 팀원" hint="동시에 열려 있는 팀원 수의 상한이에요.">
          <NumberField value={team.maxChildren} min={1} max={16} unit="명" label="관리자당 최대 팀원 수" onSave={n => save({ team: { maxChildren: n } })} />
        </Row>
      </Section>

      <Section title="역할별 기본 모델" note="새 세션을 만들 때와 관리자가 팀원을 만들 때 쓰는 기본값이에요.">
        {roles.map(r => (
          <Row key={r.id} label={r.name}>
            <span className="size-2 rounded-full" style={{ background: roleColor(r.id) }} aria-hidden />
            <Select
              value={team.roleModels[r.id] ?? r.model}
              onValueChange={v => save({ team: { roleModels: { [r.id]: v } } })}
            >
              <SelectTrigger className="h-8 w-56 bg-background" aria-label={`${r.name} 기본 모델`}><SelectValue /></SelectTrigger>
              <SelectContent>
                {groups.map(p => (
                  <SelectGroup key={p}>
                    <SelectLabel>{providers[p]?.name ?? p}{providers[p]?.connected ? "" : " · 연결 필요"}</SelectLabel>
                    {models.filter(m => m.provider === p).map(m => <SelectItem key={m.id} value={m.id}>{m.label}</SelectItem>)}
                  </SelectGroup>
                ))}
              </SelectContent>
            </Select>
          </Row>
        ))}
      </Section>

      <Section title="작업 폴더">
        <Row label="새 작업 폴더에 node_modules 넣기" hint="프로젝트의 node_modules를 하드링크로 넣어요. 디스크를 더 쓰지 않고, 세션이 설치를 기다리지 않아요.">
          <Toggle checked={team.shareDeps} label="새 작업 폴더에 node_modules 넣기" onChange={v => save({ team: { shareDeps: v } })} />
        </Row>
        <Row label="세션을 지우면 작업 폴더도 지우기" hint="커밋 안 한 변경이 없을 때만 지워요. 브랜치는 남아요.">
          <Toggle checked={team.dropWorktrees} label="세션을 지우면 작업 폴더도 지우기" onChange={v => save({ team: { dropWorktrees: v } })} />
        </Row>
      </Section>

      <Section title="답변">
        <Row label="답변 스타일 지침 넣기" hint="모든 세션의 지시에 읽기 쉬운 답변 규칙을 붙여요.">
          <Toggle checked={team.replyStyle} label="답변 스타일 지침 넣기" onChange={v => save({ team: { replyStyle: v } })} />
        </Row>
      </Section>

      <Section title="사용 한도" note="Claude 사용량이 기준에 닿으면 새 Claude 세션을 막아요. Codex·Gemini는 막지 않아요.">
        <Row label="한도 가까우면 새 세션 막기">
          <Toggle checked={g.enabled} label="한도 가까우면 새 세션 막기" onChange={v => save({ guard: { enabled: v } })} />
        </Row>
        <Row label="5시간 한도 기준">
          <NumberField value={Math.round(g.five * 100)} min={1} max={100} unit="%" label="5시간 한도 기준" onSave={n => save({ guard: { five: n / 100 } })} />
        </Row>
        <Row label="주간 한도 기준">
          <NumberField value={Math.round(g.seven * 100)} min={1} max={100} unit="%" label="주간 한도 기준" onSave={n => save({ guard: { seven: n / 100 } })} />
        </Row>
      </Section>
    </div>
  );
}
