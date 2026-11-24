/**
 * The words, icon and link of every To do line. The server says what and how
 * many (services/api/utils/todo.py); this is the only place that knows how a
 * line reads and where it goes. Each link opens the page with the filter that
 * shows exactly the counted rows, and the icon is that page's icon in the
 * navigation, so a line shows at a glance what it belongs to.
 *
 * To add a nudge: count it in utils/todo.py, then give its kind a line here.
 */
import type { LucideIcon } from 'lucide-react';
import { Activity, ArrowLeftRight, Camera, Footprints, Radio, Settings, Upload, Wrench } from 'lucide-react';
import type { TodoItem } from '../api/todo';

export type TodoGroup = 'you' | 'project' | 'server';

export interface TodoLine {
  kind: string;
  projectId: number | null; // null for a server line
  target: string | null; // integration_error: which integration
  quiet: boolean; // dismissed by me, nothing new since
  fresh: number; // loud again after a dismissal: how many are new, else 0
  keys: string[]; // what it counts, sent back by Dismiss
  group: TodoGroup;
  icon: LucideIcon;
  text: string;
  to: string;
  overdue?: number;
  // Something is broken rather than due: listed first in its group.
  broken?: boolean;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

const INTEGRATIONS: Record<string, { name: string; icon: LucideIcon }> = {
  earthranger: { name: 'EarthRanger', icon: Radio },
  sensingclues: { name: 'Sensing Clues', icon: Footprints },
};

/** The line of one item, or null for a kind this browser does not know yet
 *  (a newer server): better silent than a line without words. */
export function todoLine(item: TodoItem, projectId: number | null, userId: number): TodoLine | null {
  const p = `/projects/${projectId}`;
  const n = item.count;
  const line = (group: TodoGroup, icon: LucideIcon, text: string, to: string, extra: Partial<TodoLine> = {}): TodoLine =>
    ({ kind: item.kind, projectId, target: item.target ?? null, quiet: item.quiet, fresh: item.new ?? 0,
       keys: item.keys, group, icon, text, to, ...extra });
  switch (item.kind) {
    case 'my_tasks':
      return line('you', Wrench, `${plural(n, 'service task', 'service tasks')} for you`,
        `${p}/service?person=${userId}`, { overdue: item.overdue ?? 0 });
    case 'overdue_tasks':
      return line('project', Wrench, plural(n, 'overdue service task', 'overdue service tasks'), `${p}/service?due=overdue`);
    case 'suspicious_moves':
      return line('project', ArrowLeftRight, plural(n, 'suspicious move', 'suspicious moves'), `${p}/moves?status=suspicious`);
    case 'unplaced_photos':
      return line('project', Camera, `${plural(n, 'camera', 'cameras')} with photos without a site`, `${p}/cameras?unplaced=yes`);
    case 'rejecting':
      return line('project', Camera, `${plural(n, 'camera', 'cameras')} rejecting files`, `${p}/cameras?rejected=rejecting`, { broken: true });
    case 'sim_expiring':
      return line('project', Camera, `${plural(n, 'SIM card', 'SIM cards')} expiring`, `${p}/cameras?sim=expiring`);
    case 'integration_error': {
      const integration = INTEGRATIONS[item.target ?? ''];
      return line('project', integration?.icon ?? Radio, `${integration?.name ?? 'An integration'} is failing`,
        `${p}/integrations/${item.target}`, { broken: true });
    }
    case 'choose_species':
      return line('project', Settings, 'Choose the species for this project', `${p}/settings`);
    case 'inactive':
      return line('project', Camera, plural(n, 'inactive camera', 'inactive cameras'), `${p}/cameras?status=inactive`, { broken: true });
    case 'low_battery':
      return line('project', Camera, `${plural(n, 'camera', 'cameras')} low on battery`, `${p}/cameras?battery=low`);
    case 'sd_nearly_full':
      return line('project', Camera, `${plural(n, 'SD card', 'SD cards')} nearly full`, `${p}/cameras?sd_usage=high`);
    case 'services_down':
      return line('server', Activity, `${plural(n, 'service', 'services')} not running`, '/server/health', { broken: true });
    case 'unknown_camera_files':
      return line('server', Upload, `${plural(n, 'file', 'files')} from unknown cameras this week`, '/server/file-management');
    case 'telegram_not_set_up':
      return line('server', Settings, 'Telegram is not set up', '/server/settings');
    default:
      return null;
  }
}

/** New before quiet, and within each broken first, else the server's order. */
export const inOrder = (lines: TodoLine[]): TodoLine[] => {
  const rank = (l: TodoLine) => (l.quiet ? 2 : 0) + (l.broken ? 0 : 1);
  return [...lines].sort((a, b) => rank(a) - rank(b));
};
