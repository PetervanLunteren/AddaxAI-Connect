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
 * lines without a heading, since they are always this project's, with
 * Dismiss all at the bottom. Outside a project it is an accordion, so the
 * list stays short however many projects there are: Server first (the
 * most important, open), then one closed group per project, those with
 * something new first, each header with a "3 new" pill. An open group has
 * its own Dismiss all, so you never dismiss lines you did not see. The
 * project comes from the address, not from the selected project, which
 * stays set outside projects too.
 *
 * The number on the icon is the number of loud lines in view, not the sum
 * of the counts: twenty cameras low on battery are one thing to do.
 */
import React, { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Check, ChevronDown, ChevronRight, ClipboardList } from 'lucide-react';
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
  // Open groups outside a project; Server is open, the projects closed,
  // each time the panel opens.
  const [expanded, setExpanded] = useState<Set<string>>(new Set(['server']));
  const onOpenChange = (next: boolean) => {
    if (next) setExpanded(new Set(['server']));
    setOpen(next);
  };
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
    sections.push({ key: 'server', title: 'Server', lines: linesOf(data?.server ?? [], null) });
    const projects = (data?.projects ?? []).map((project) => ({
      key: String(project.project_id), title: project.project_name, lines: linesOf(project.items, project.project_id),
    }));
    // Projects with something new first, then the rest, each by name (the
    // server's order).
    const hasNew = (section: Section) => section.lines.some((l) => !l.quiet);
    sections.push(...projects.filter(hasNew), ...projects.filter((section) => !hasNew(section)));
  }
  const shown = sections.filter((s) => s.lines.length > 0);
  const loud = shown.flatMap((s) => s.lines).filter((l) => !l.quiet);
  const accordion = projectId === null;
  // Only one group: nothing to fold away.
  const isOpen = (key: string) => !accordion || shown.length === 1 || expanded.has(key);
  const toggle = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const row = (line: TodoLine) => (
    // One row per line, cut with "..." and the full text on hover; the
    // whole row is the link. A loud row has Dismiss over its end on hover,
    // as Gmail's row actions; on a touch screen, which has no hover, it
    // stays in view.
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
          accordion && 'pl-9',
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
  );

  const dismissAll = (lines: TodoLine[], label = 'Dismiss all') => (
    <Button variant="ghost" size="sm" onClick={() => dismiss.mutate(lines)} disabled={dismiss.isPending}>
      <Check className="mr-1.5 h-4 w-4" />
      {label}
    </Button>
  );

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
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
              {shown.map((section, i) => {
                const sectionLoud = section.lines.filter((l) => !l.quiet);
                const groupOpen = isOpen(section.key);
                return (
                  <div
                    key={section.key}
                    className={cn('py-1', (accordion ? i > 0 : !section.title && i > 0) && 'mt-1 border-t border-border')}
                  >
                    {accordion ? (
                      <div className="flex items-center gap-1 pr-2">
                        <button
                          type="button"
                          onClick={() => toggle(section.key)}
                          aria-expanded={groupOpen}
                          className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2 text-left text-sm font-medium hover:bg-accent"
                        >
                          {groupOpen ? (
                            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                          ) : (
                            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                          )}
                          <span className="min-w-0 flex-1 truncate">{section.title}</span>
                          {sectionLoud.length > 0 && (
                            <StatusPill tone="neutral" className="shrink-0 px-2 py-0.5">{sectionLoud.length} new</StatusPill>
                          )}
                        </button>
                        {/* Only what you see: never lines in a closed group. */}
                        {groupOpen && sectionLoud.length > 0 && dismissAll(sectionLoud)}
                      </div>
                    ) : (
                      section.title && (
                        <p className="truncate px-4 pb-1 pt-2 text-xs font-medium text-muted-foreground">{section.title}</p>
                      )
                    )}
                    {groupOpen && section.lines.map(row)}
                  </div>
                );
              })}
            </div>
            {!accordion && loud.length > 0 && (
              <div className="flex justify-end border-t border-border p-2">{dismissAll(loud)}</div>
            )}
          </>
        )}
      </PopoverContent>
    </Popover>
  );
};
