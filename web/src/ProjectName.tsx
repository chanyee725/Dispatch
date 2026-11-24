// Sidebar header (#778): the name of the one project this server belongs to (the folder `start.sh <project>` was
// given). Atelier opens inside a project, so there is no folder switch or project list here.

type Props = {
  /** The project folder's name; null while it loads. */
  name: string | null;
};

export function ProjectName({ name }: Props) {
  const shown = name ?? 'Atelier';
  return (
    <div className="flex h-[35px] min-w-0 flex-1 items-center gap-2 px-2" title={name ?? undefined} data-project-name>
      <span aria-hidden className="grid size-[22px] shrink-0 place-items-center rounded-sm bg-primary text-xs font-semibold text-primary-foreground">
        {[...shown][0]?.toUpperCase()}
      </span>
      <span className="truncate text-sm font-semibold">
        <span className="sr-only">프로젝트 </span>
        {shown}
      </span>
    </div>
  );
}
