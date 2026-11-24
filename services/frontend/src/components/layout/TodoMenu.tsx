/**
 * "To do" in the top bar: what needs somebody now, next to the account menu.
 *
 * The one nudge of the app. Pages show state and filters; they do not keep
 * badges or warning bars of their own. A line is the current state, not a
 * message: there is nothing to mark as read or dismiss, and it leaves when
 * the problem is fixed. The server decides the lines
 * (services/api/utils/todo.py), lib/todo-lines.ts gives them words and links.
 *
 * Inside a project it shows that project only: For you, then the project's
 * lines without a heading, since they are always this project's.
 * Outside a project (Projects, Account, server pages) it shows every project
 * that has something, one block each, and for a server admin the Server
 * lines: server work is not about the project you are in. The project comes
 * from the address, not from the selected project, which stays set outside
 * projects too.
 *
 * The number on the icon is the number of lines in view, not the sum of the
 * counts: twenty cameras low on battery are one thing to do.
 *
 * Each line carries the icon of the page it opens. Broken things come first.
 * A line that is a choice, not a fault, has "Not needed" for whoever could
 * fix it: hidden for everyone, undone from the note on its page
 * (NotNeededNote). Nothing here is hidden for one person only.
 */
import React, { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ClipboardList } from 'lucide-react';
import { todoApi, todoKeys, type TodoItem } from '../../api/todo';
import { brokenFirst, todoLine, type TodoLine } from '../../lib/todo-lines';
import { useAuth } from '../../hooks/useAuth';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/Popover';
import { StatusPill } from '../ui/StatusPill';
import { cn } from '../../lib/utils';

interface Section {
  key: string;
  title: string | null; // null: no heading (the project you are in)
  lines: TodoLine[];
}

export const TodoMenu: React.FC = () => {
  const { user } = useAuth();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const { data } = useQuery({
    queryKey: todoKeys.all,
    queryFn: todoApi.get,
    enabled: !!user,
    refetchInterval: 5 * 60 * 1000,
  });
  const notNeeded = useMutation({
    mutationFn: (line: TodoLine) => todoApi.markNotNeeded(line.kind, line.projectId),
  });
  if (!user) return null;

  const match = pathname.match(/^\/projects\/(\d+)/);
  const projectId = match ? Number(match[1]) : null;
  const linesOf = (items: TodoItem[], pid: number | null) =>
    brokenFirst(items.map((item) => todoLine(item, pid, user.id)).filter((l): l is TodoLine => l !== null));

  const sections: Section[] = [];
  if (projectId !== null) {
    const here = linesOf(data?.projects.find((p) => p.project_id === projectId)?.items ?? [], projectId);
    sections.push({ key: 'you', title: 'For you', lines: here.filter((l) => l.group === 'you') });
    sections.push({ key: 'project', title: null, lines: here.filter((l) => l.group === 'project') });
  } else {
    for (const project of data?.projects ?? []) {
      sections.push({ key: String(project.project_id), title: project.project_name, lines: linesOf(project.items, project.project_id) });
    }
    sections.push({ key: 'server', title: 'Server', lines: linesOf(data?.server ?? [], null) });
  }
  const shown = sections.filter((s) => s.lines.length > 0);
  const count = shown.reduce((n, s) => n + s.lines.length, 0);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            'relative flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition-colors',
            'hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            open && 'bg-accent text-foreground',
          )}
          aria-label={count > 0 ? `To do, ${count}` : 'To do'}
          title="To do"
        >
          <ClipboardList className="h-5 w-5" />
          {count > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold leading-none text-primary-foreground">
              {count}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(22rem,calc(100vw-2rem))] p-0">
        <p className="border-b border-border px-4 py-3 text-sm font-semibold">To do</p>
        {shown.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">Nothing to do</p>
        ) : (
          <div className="max-h-[70vh] overflow-y-auto py-1">
            {shown.map((section, i) => (
              <div key={section.key} className={cn('py-1', !section.title && i > 0 && 'mt-1 border-t border-border')}>
                {section.title && (
                  <p className="truncate px-4 pb-1 pt-2 text-xs font-medium text-muted-foreground">{section.title}</p>
                )}
                {section.lines.map((line) => (
                  // One line per row, cut with "..." and the full text on
                  // hover. "Not needed" shows over the end of the row on
                  // hover, as Gmail's row actions do; on a touch screen,
                  // which has no hover, it stays in view.
                  <div key={line.to} className="group relative flex items-center gap-2 pr-2 hover:bg-accent">
                    <Link
                      to={line.to}
                      onClick={() => setOpen(false)}
                      title={line.text}
                      className={cn(
                        'flex min-w-0 flex-1 items-center gap-3 py-2 pl-4 text-sm',
                        line.canBeNotNeeded && '[@media(hover:none)]:pr-24',
                      )}
                    >
                      <line.icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 truncate">{line.text}</span>
                    </Link>
                    {!!line.overdue && (
                      <StatusPill tone="error" className="shrink-0 px-2 py-0.5">{line.overdue} overdue</StatusPill>
                    )}
                    {line.canBeNotNeeded && (
                      <button
                        type="button"
                        onClick={() => notNeeded.mutate(line)}
                        disabled={notNeeded.isPending}
                        title="Hide this line for everyone. Undo on its page."
                        className={cn(
                          'absolute right-2 top-1/2 -translate-y-1/2 rounded border border-border bg-card px-2 py-1 text-xs text-muted-foreground hover:text-foreground',
                          '[@media(hover:hover)]:opacity-0 group-hover:opacity-100 focus-visible:opacity-100',
                        )}
                      >
                        Not needed
                      </button>
                    )}
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
};
