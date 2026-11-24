/**
 * The words and the link of every To do line. The server says what and how
 * many (services/api/utils/todo.py); this is the only place that knows how a
 * line reads and where it goes. Each link opens the page with the filter that
 * shows exactly the counted rows.
 *
 * To add a nudge: count it in utils/todo.py, then give its kind a line here.
 */
import type { TodoItem } from '../api/todo';

export type TodoGroup = 'you' | 'project' | 'server';

export interface TodoLine {
  group: TodoGroup;
  text: string;
  to: string;
  overdue?: number;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

const INTEGRATION_NAMES: Record<string, string> = {
  earthranger: 'EarthRanger',
  sensingclues: 'Sensing Clues',
};

/** The line of one item, or null for a kind this browser does not know yet
 *  (a newer server): better silent than a line without words. */
export function todoLine(item: TodoItem, projectId: number | null, userId: number): TodoLine | null {
  const p = `/projects/${projectId}`;
  const n = item.count;
  switch (item.kind) {
    case 'my_tasks':
      return { group: 'you', text: `${plural(n, 'service task', 'service tasks')} for you`,
               to: `${p}/service?person=${userId}`, overdue: item.overdue ?? 0 };
    case 'overdue_tasks':
      return { group: 'project', text: plural(n, 'overdue service task', 'overdue service tasks'), to: `${p}/service?due=overdue` };
    case 'suspicious_moves':
      return { group: 'project', text: plural(n, 'suspicious move', 'suspicious moves'), to: `${p}/moves?status=suspicious` };
    case 'unplaced_photos':
      return { group: 'project', text: `${plural(n, 'camera', 'cameras')} with photos without a site`, to: `${p}/cameras?unplaced=yes` };
    case 'rejecting':
      return { group: 'project', text: `${plural(n, 'camera', 'cameras')} rejecting files`, to: `${p}/cameras?rejected=rejecting` };
    case 'sim_expiring':
      return { group: 'project', text: `${plural(n, 'SIM card', 'SIM cards')} expiring`, to: `${p}/cameras?sim=expiring` };
    case 'integration_error': {
      const target = item.target ?? '';
      return { group: 'project', text: `${INTEGRATION_NAMES[target] ?? 'An integration'} is failing`, to: `${p}/integrations/${target}` };
    }
    case 'choose_species':
      return { group: 'project', text: 'Choose the species for this project', to: `${p}/settings` };
    case 'inactive':
      return { group: 'project', text: plural(n, 'inactive camera', 'inactive cameras'), to: `${p}/cameras?status=inactive` };
    case 'low_battery':
      return { group: 'project', text: `${plural(n, 'camera', 'cameras')} low on battery`, to: `${p}/cameras?battery=low` };
    case 'sd_nearly_full':
      return { group: 'project', text: `${plural(n, 'SD card', 'SD cards')} nearly full`, to: `${p}/cameras?sd_usage=high` };
    case 'services_down':
      return { group: 'server', text: `${plural(n, 'service', 'services')} not running`, to: '/server/health' };
    case 'unknown_camera_files':
      return { group: 'server', text: `${plural(n, 'file', 'files')} from unknown cameras this week`, to: '/server/file-management' };
    case 'telegram_not_set_up':
      return { group: 'server', text: 'Telegram is not set up', to: '/server/settings' };
    default:
      return null;
  }
}
