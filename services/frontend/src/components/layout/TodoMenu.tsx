/**
 * "Needs attention" in the top bar: what needs somebody now, next to the
 * account menu. Internally called To do (TodoMenu, /api/todo).
 *
 * The one nudge of the app. Pages show state and filters; they do not keep
 * badges or warning bars of their own. A line is the current state: it
 * leaves when the problem is fixed. The server decides the lines
 * (services/api/utils/todo.py), lib/todo-lines.ts gives them words, icons
 * and links.
 *
 * New lines are loud: bold on a light teal background, and counted on the
 * icon. Dismiss makes a line quiet for you, never hides it: it stays as a
 * plain row you can still click, and turns loud again when something new
 * appears in it (another camera, or the same one failing again), with a
 * "1 new" pill to say what changed. Only for you. As Discourse and Gmail do
 * with read and unread.
 *
 * Inside a project it shows that project only: For you, then the project's
 * lines without a heading, since they are always this project's. Outside a
 * project it shows every project that has something, one block each, and
 * for a server admin the Server lines. The project comes from the address,
 * not from the selected project, which stays set outside projects too.
 *
 * The number on the icon is the number of loud lines in view, not the sum
 * of the counts: twenty cameras low on battery are one thing to do.
 */
import React, { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Check, ClipboardList } from 'lucide-react';
import { todoApi, todoKeys, type TodoItem } from '../../api/todo';
import { inOrder, todoLine, type TodoLine } from '../../lib/todo-lines';
import { useAuth } from '../../hooks/useAuth';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/Popover';
import { StatusPill } from '../ui/StatusPill';
import { Button } from '../ui/Button';
import { cn } from '../../lib/utils';

interface Section {
  key: string;
  title: string | null; // null: no heading (the project you are in)
  lines: TodoLine[];
}

// With the keys you were shown: a camera that arrived while the panel was
// open stays new.
const asDismissed = (lines: TodoLine[]) =>
  lines.map((l) => ({ kind: l.kind, project_id: l.projectId, target: l.target, keys: l.keys }));

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
  // Any successful change refreshes the list (lib/query-client.ts).
  const dismiss = useMutation({ mutationFn: (lines: TodoLine[]) => todoApi.dismiss(asDismissed(lines)) });
  if (!user) return null;

  const match = pathname.match(/^\/projects\/(\d+)/);
  const projectId = match ? Number(match[1]) : null;
  const linesOf = (items: TodoItem[], pid: number | null) =>
    inOrder(items.map((item) => todoLine(item, pid, user.id)).filter((l): l is TodoLine => l !== null));

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
  const loud = shown.flatMap((s) => s.lines).filter((l) => !l.quiet);

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
          aria-label={loud.length > 0 ? `Needs attention, ${loud.length} new` : 'Needs attention'}
          title="Needs attention"
        >
          <ClipboardList className="h-5 w-5" />
          {loud.length > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold leading-none text-primary-foreground">
              {loud.length}
            </span>
          )}
        </button>
      </PopoverTrigger>
      {/* No title: the icon that opened it says what it is; the project
          names and For you are the headings. */}
      <PopoverContent align="end" className="w-[min(22rem,calc(100vw-2rem))] p-0" aria-label="Needs attention">
        {shown.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">Nothing needs attention</p>
        ) : (
          <>
            <div className="max-h-[70vh] overflow-y-auto py-1">
              {shown.map((section, i) => (
                <div key={section.key} className={cn('py-1', !section.title && i > 0 && 'mt-1 border-t border-border')}>
                  {section.title && (
                    <p className="truncate px-4 pb-1 pt-2 text-xs font-medium text-muted-foreground">{section.title}</p>
                  )}
                  {section.lines.map((line) => (
                    // One row per line, cut with "..." and the full text on
                    // hover; the whole row is the link. A loud row has
                    // Dismiss over its end on hover, as Gmail's row actions;
                    // on a touch screen, which has no hover, it stays in view.
                    <div
                      key={`${line.kind}-${line.target ?? ''}-${line.projectId ?? 'server'}`}
                      className={cn('group relative', !line.quiet && 'bg-primary/5')}
                    >
                      <Link
                        to={line.to}
                        onClick={() => setOpen(false)}
                        title={line.text}
                        className={cn(
                          'flex items-center gap-3 px-4 py-2 text-sm hover:bg-accent',
                          !line.quiet && 'font-semibold [@media(hover:none)]:pr-20 group-hover:pr-20',
                        )}
                      >
                        <line.icon className={cn('h-4 w-4 shrink-0', line.quiet ? 'text-muted-foreground' : 'text-primary')} />
                        <span className="min-w-0 flex-1 truncate">{line.text}</span>
                        {/* Back after you dismissed it: what changed. */}
                        {line.fresh > 0 && (
                          <StatusPill tone="neutral" className="shrink-0 px-2 py-0.5 font-medium">{line.fresh} new</StatusPill>
                        )}
                        {!!line.overdue && (
                          <StatusPill tone="error" className="shrink-0 px-2 py-0.5 font-medium">{line.overdue} overdue</StatusPill>
                        )}
                      </Link>
                      {!line.quiet && (
                        <button
                          type="button"
                          onClick={() => dismiss.mutate([line])}
                          disabled={dismiss.isPending}
                          title="Quiet for you until something new appears"
                          className={cn(
                            'absolute right-2 top-1/2 -translate-y-1/2 rounded border border-border bg-card px-2 py-1 text-xs font-normal text-muted-foreground hover:text-foreground',
                            '[@media(hover:hover)]:opacity-0 group-hover:opacity-100 focus-visible:opacity-100',
                          )}
                        >
                          Dismiss
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              ))}
            </div>
            {loud.length > 0 && (
              <div className="flex justify-end border-t border-border p-2">
                <Button variant="ghost" size="sm" onClick={() => dismiss.mutate(loud)} disabled={dismiss.isPending}>
                  <Check className="mr-1.5 h-4 w-4" />
                  Dismiss all
                </Button>
              </div>
            )}
          </>
        )}
      </PopoverContent>
    </Popover>
  );
};
