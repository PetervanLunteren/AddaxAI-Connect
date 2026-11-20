/**
 * A link to the Deployments page with one camera or one site as filter. For
 * the camera and site panels, admins only (the page is).
 */
import { Link } from 'react-router-dom';
import { CalendarRange } from 'lucide-react';

export function DeploymentsPageLink({
  projectId,
  filter,
  id,
}: {
  projectId: number;
  filter: 'cameras' | 'sites';
  id: number;
}) {
  return (
    <Link
      to={`/projects/${projectId}/deployments?${filter}=${id}`}
      className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
    >
      <CalendarRange className="h-4 w-4" />
      See on the Deployments page
    </Link>
  );
}
