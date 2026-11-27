// Sidebar header (#778): the name of the one project this server belongs to (the folder `start.sh <project>` was
// given). Dispatch opens inside a project, so there is no folder switch or project list here.

import dispatchLogo from '../brand/favicon-64.png?no-inline';

type Props = {
  /** The project folder's name; null while it loads. */
  name: string | null;
};

export function ProjectName({ name }: Props) {
  const shown = name ?? 'Dispatch';
  return (
    <div className="flex h-[35px] min-w-0 flex-1 items-center gap-2 px-2" title={name ?? undefined} data-project-name>
      <img src={dispatchLogo} width={22} height={22} alt="" className="shrink-0" />
      <span className="truncate text-sm font-semibold">
        <span className="sr-only">프로젝트 </span>
        {shown}
      </span>
    </div>
  );
}
