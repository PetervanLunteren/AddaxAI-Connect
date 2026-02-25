/**
 * System health monitoring page
 *
 * Displays status of all system services for server admins
 */
import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Activity, RefreshCw, CheckCircle2, XCircle, Loader2, BookOpen } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { ServerPageLayout } from '../../components/layout/ServerPageLayout';
import { getServicesHealth, type ServiceStatus } from '../../api/health';
import { statisticsApi } from '../../api/statistics';

/**
 * Map service names to display names with proper capitalization
 */
const SERVICE_DISPLAY_NAMES: Record<string, string> = {
  postgres: 'PostgreSQL',
  redis: 'Redis',
  minio: 'MinIO',
  prometheus: 'Prometheus',
  loki: 'Loki',
  api: 'API',
  frontend: 'Frontend',
  ingestion: 'Ingestion worker',
  detection: 'Detection worker',
  classification: 'Classification worker',
  notifications: 'Notifications worker',
  'notifications-telegram': 'Telegram notifications worker',
  'processing-pipeline': 'Processing Pipeline',
};

const ServiceStatusBadge: React.FC<{ status: ServiceStatus }> = ({ status }) => {
  const isHealthy = status.status === 'healthy';

  return (
    <div
      className={`flex items-start gap-3 p-4 rounded-lg border ${
        isHealthy ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'
      }`}
    >
      {isHealthy ? (
        <CheckCircle2 className="h-5 w-5 text-green-600 flex-shrink-0 mt-0.5" />
      ) : (
        <XCircle className="h-5 w-5 text-red-600 flex-shrink-0 mt-0.5" />
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm">
            {SERVICE_DISPLAY_NAMES[status.name] || status.name}
          </span>
          <span
            className={`text-xs px-2 py-0.5 rounded-full font-medium ${
              isHealthy
                ? 'bg-green-100 text-green-700'
                : 'bg-red-100 text-red-700'
            }`}
          >
            {isHealthy ? 'Healthy' : 'Unhealthy'}
          </span>
        </div>
        <p className="text-sm text-muted-foreground mt-1 break-words">
          {status.message}
        </p>
      </div>
    </div>
  );
};

export const HealthPage: React.FC = () => {
  // Fetch services health
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['services-health'],
    queryFn: getServicesHealth,
    refetchOnWindowFocus: false,
    retry: false,
  });

  // Fetch pipeline status
  const { data: pipelineData, refetch: refetchPipeline } = useQuery({
    queryKey: ['statistics', 'pipeline-status'],
    queryFn: () => statisticsApi.getPipelineStatus(),
  });

  const handleRefresh = () => {
    refetch();
    refetchPipeline();
  };

  // Build pipeline status as a service
  const pipelineService: ServiceStatus | null = pipelineData ? {
    name: 'processing-pipeline',
    status: pipelineData.pending === 0 ? 'healthy' : 'unhealthy',
    message: pipelineData.pending === 0
      ? 'No images pending classification'
      : `${pipelineData.pending.toLocaleString()} image${pipelineData.pending === 1 ? '' : 's'} pending classification`,
  } : null;

  // Combine services with pipeline status
  const allServices = data?.services
    ? [...data.services, ...(pipelineService ? [pipelineService] : [])]
    : [];

  const healthyCount = allServices.filter((s) => s.status === 'healthy').length;
  const totalCount = allServices.length;
  const allHealthy = healthyCount === totalCount && totalCount > 0;

  return (
    <ServerPageLayout
      title="System health"
      description="Monitor the status of all system services"
    >
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Activity className="h-5 w-5 text-muted-foreground" />
                <CardTitle>System services</CardTitle>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={handleRefresh}
                disabled={isLoading}
              >
                <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
                Refresh
              </Button>
            </div>
            {data && (
              <CardDescription>
                {allHealthy ? (
                  <span className="text-green-600 font-medium">
                    All services are healthy ({healthyCount}/{totalCount})
                  </span>
                ) : (
                  <span className="text-red-600 font-medium">
                    {healthyCount} of {totalCount} services are healthy
                  </span>
                )}
              </CardDescription>
            )}
          </CardHeader>
          <CardContent>
            {/* Loading State */}
            {isLoading && (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                <span className="ml-3 text-muted-foreground">Checking service health...</span>
              </div>
            )}

            {/* Error State */}
            {error && (
              <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
                <div className="flex items-center gap-2 mb-2">
                  <XCircle className="h-5 w-5 text-red-600" />
                  <span className="font-medium text-red-900">Failed to check service health</span>
                </div>
                <p className="text-sm text-red-700">
                  {error instanceof Error ? error.message : 'Unknown error occurred'}
                </p>
              </div>
            )}

            {/* Services List */}
            {allServices.length > 0 && (
              <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                {allServices.map((service) => (
                  <ServiceStatusBadge key={service.name} status={service} />
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Update guide */}
        <Card>
          <CardHeader>
            <div className="flex items-center space-x-2">
              <BookOpen className="h-5 w-5 text-muted-foreground" />
              <CardTitle>Update guide</CardTitle>
            </div>
            <CardDescription>
              How to safely update a production server to the latest version.
              Always test on a cloned test server first. Never update production directly.
              These instructions are written for DigitalOcean droplets. The general
              approach applies to other cloud providers too, but the snapshot steps
              will differ.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-6">

              {/* Step 1: Back up production */}
              <div>
                <h3 className="text-sm font-semibold mb-2">1. Back up production</h3>
                <div className="bg-muted border border-border p-4 rounded-md">
                  <ol className="text-sm text-muted-foreground list-decimal list-inside space-y-3">
                    <li>
                      <strong>Create a database dump.</strong>{' '}
                      <span className="text-xs italic">(on the production server)</span>{' '}
                      This is your most important backup. It's portable
                      and fast to restore if anything goes wrong with the schema migration.
                      <code className="block mt-1 px-2 py-1 bg-background rounded text-xs">
                        cd /opt/addaxai-connect && docker compose exec postgres pg_dump -U addaxai addaxai_connect {'>'} backup.sql
                      </code>
                    </li>
                    <li>
                      <strong>Power off the droplet.</strong>{' '}
                      <span className="text-xs italic">(on the production server)</span>{' '}
                      DigitalOcean recommends powering off before taking a snapshot to ensure full disk consistency.
                      This stops all services and the OS itself. You will lose your SSH session.
                      When prompted for a password, enter
                      the <code className="px-1 py-0.5 bg-background rounded text-xs">app_user_password</code> from{' '}
                      <code className="px-1 py-0.5 bg-background rounded text-xs">ansible/group_vars/dev.yml</code>.
                      <code className="block mt-1 px-2 py-1 bg-background rounded text-xs">
                        cd /opt/addaxai-connect && docker compose down && sudo shutdown -h now
                      </code>
                    </li>
                    <li>
                      <strong>Take a DigitalOcean snapshot.</strong>{' '}
                      <span className="text-xs italic">(in the DigitalOcean dashboard)</span>{' '}
                      Go to your droplet, click <em>Snapshots</em>, and create one. Wait for it to complete.
                      This captures the full disk (database, MinIO files, uploads, configs) so you can restore
                      the entire server if needed.
                    </li>
                    <li>
                      <strong>Power on the droplet.</strong>{' '}
                      <span className="text-xs italic">(in the DigitalOcean dashboard)</span>{' '}
                      Go back to your droplet and click the power on button. Wait until the status shows
                      it's running again before continuing.
                    </li>
                    <li>
                      <strong>Restart services.</strong>{' '}
                      <span className="text-xs italic">(on the production server)</span>{' '}
                      SSH back in and start the services. Production is back online while you test the
                      update separately.
                      <code className="block mt-1 px-2 py-1 bg-background rounded text-xs">
                        cd /opt/addaxai-connect && docker compose up -d
                      </code>
                    </li>
                  </ol>
                </div>
              </div>

              {/* Step 2: Test on a test server */}
              <div>
                <h3 className="text-sm font-semibold mb-2">2. Test on a test server</h3>
                <div className="bg-muted border border-border p-4 rounded-md">
                  <ol className="text-sm text-muted-foreground list-decimal list-inside space-y-3">
                    <li>
                      <strong>Create a new droplet from the snapshot.</strong>{' '}
                      <span className="text-xs italic">(in the DigitalOcean dashboard)</span>{' '}
                      Go to <em>Images {'>'} Snapshots</em>, click <em>More</em> on the snapshot you
                      just took, then click <em>Create Droplet</em>. Review the settings and
                      click <em>Create</em>. This gives you an exact clone of production with real data.
                    </li>
                    <li>
                      <strong>Create a DNS record for the test server.</strong>{' '}
                      <span className="text-xs italic">(at your DNS provider)</span>{' '}
                      Add an A record pointing to the new droplet's IP address (e.g., test.addaxai.com).
                      Then SSH into the test server and update the DOMAIN_NAME in the .env file so
                      the app uses the correct domain for cookies and redirects.
                      <code className="block mt-1 px-2 py-1 bg-background rounded text-xs whitespace-pre-wrap">
{`cd /opt/addaxai-connect && sed -i 's/^DOMAIN_NAME=.*/DOMAIN_NAME=test.addaxai.com/' .env`}
                      </code>
                    </li>
                    <li>
                      <strong>Disable email notifications.</strong>{' '}
                      <span className="text-xs italic">(on the test server)</span>{' '}
                      The notification workers run scheduled jobs (daily, weekly, and monthly
                      reports) that will send real emails to your users if the test server is running during
                      those windows. Replace the mail settings with dummy values before starting services.
                      <code className="block mt-1 px-2 py-1 bg-background rounded text-xs whitespace-pre-wrap">
{`cd /opt/addaxai-connect && sed -i \\
  -e 's/^MAIL_SERVER=.*/MAIL_SERVER=disabled/' \\
  -e 's/^MAIL_USERNAME=.*/MAIL_USERNAME=disabled/' \\
  -e 's/^MAIL_PASSWORD=.*/MAIL_PASSWORD=disabled/' \\
  -e 's/^MAIL_FROM=.*/MAIL_FROM=disabled@localhost/' .env`}
                      </code>
                    </li>
                    <li>
                      <strong>Pull the latest code.</strong>{' '}
                      <span className="text-xs italic">(on the test server)</span>
                      <code className="block mt-1 px-2 py-1 bg-background rounded text-xs">
                        cd /opt/addaxai-connect && git pull origin main
                      </code>
                    </li>
                    <li>
                      <strong>Rebuild and start containers.</strong>{' '}
                      <span className="text-xs italic">(on the test server)</span>{' '}
                      This rebuilds all service images with the new code.
                      <code className="block mt-1 px-2 py-1 bg-background rounded text-xs">
                        cd /opt/addaxai-connect && docker compose up -d --build --force-recreate
                      </code>
                    </li>
                    <li>
                      <strong>Run database migrations.</strong>{' '}
                      <span className="text-xs italic">(on the test server)</span>{' '}
                      This applies any new Alembic migrations to the cloned database.
                      Watch the output carefully for errors. This is where most update issues surface.
                      <code className="block mt-1 px-2 py-1 bg-background rounded text-xs">
                        cd /opt/addaxai-connect && bash scripts/update-database.sh
                      </code>
                    </li>
                    <li>
                      <strong>Verify everything works.</strong>{' '}
                      <span className="text-xs italic">(on the test server)</span>{' '}
                      Check that:
                      Your browser will show an SSL warning because the test server
                      has a different IP than the original domain. This is expected.
                      Click through it to continue. Check that:
                      <ul className="mt-1 ml-5 list-disc space-y-1">
                        <li>The frontend loads and you can log in</li>
                        <li>Existing images display correctly with detections</li>
                        <li>Camera list and health data are intact</li>
                        <li>All services show as healthy on the /server/health page</li>
                      </ul>
                    </li>
                    <li>
                      <strong>Destroy the test droplet</strong>{' '}
                      <span className="text-xs italic">(in the DigitalOcean dashboard)</span>{' '}
                      once you've confirmed the update works.
                    </li>
                  </ol>
                </div>
              </div>

              {/* Step 3: Update production */}
              <div>
                <h3 className="text-sm font-semibold mb-2">3. Update production</h3>
                <div className="bg-muted border border-border p-4 rounded-md">
                  <ol className="text-sm text-muted-foreground list-decimal list-inside space-y-3">
                    <li>
                      <strong>Take a fresh database dump.</strong>{' '}
                      <span className="text-xs italic">(on the production server)</span>{' '}
                      The earlier backup may be hours old by now, and new data may have come in. This overwrites the previous backup.
                      <code className="block mt-1 px-2 py-1 bg-background rounded text-xs">
                        cd /opt/addaxai-connect && docker compose exec postgres pg_dump -U addaxai addaxai_connect {'>'} backup.sql
                      </code>
                    </li>
                    <li>
                      <strong>Power off the droplet.</strong>{' '}
                      <span className="text-xs italic">(on the production server)</span>{' '}
                      Power off before taking a snapshot to ensure full disk consistency.
                      When prompted for a password, enter
                      the <code className="px-1 py-0.5 bg-background rounded text-xs">app_user_password</code> from{' '}
                      <code className="px-1 py-0.5 bg-background rounded text-xs">ansible/group_vars/dev.yml</code>.
                      <code className="block mt-1 px-2 py-1 bg-background rounded text-xs">
                        cd /opt/addaxai-connect && docker compose down && sudo shutdown -h now
                      </code>
                    </li>
                    <li>
                      <strong>Take a fresh DigitalOcean snapshot.</strong>{' '}
                      <span className="text-xs italic">(in the DigitalOcean dashboard)</span>{' '}
                      This is your rollback point if the update fails on production.
                    </li>
                    <li>
                      <strong>Power on the droplet.</strong>{' '}
                      <span className="text-xs italic">(in the DigitalOcean dashboard)</span>{' '}
                      Wait until the status shows it's running again before continuing.
                    </li>
                    <li>
                      <strong>Pull the latest code.</strong>{' '}
                      <span className="text-xs italic">(on the production server)</span>{' '}
                      SSH back in and pull the new version.
                      <code className="block mt-1 px-2 py-1 bg-background rounded text-xs">
                        cd /opt/addaxai-connect && git pull origin main
                      </code>
                    </li>
                    <li>
                      <strong>Re-run the Ansible playbook.</strong>{' '}
                      <span className="text-xs italic">(on your local machine)</span>{' '}
                      This handles everything: rebuilding containers, restarting services, running migrations, and updating configs.
                      <code className="block mt-1 px-2 py-1 bg-background rounded text-xs">
                        cd ansible && ansible-playbook -i inventory.yml playbook.yml
                      </code>
                    </li>
                    <li>
                      <strong>Verify on production.</strong>{' '}
                      <span className="text-xs italic">(on the production server)</span>{' '}
                      Same checks as the test server: frontend loads, data is
                      intact, services are healthy. Monitor the logs for a few minutes to catch any runtime errors.
                      <code className="block mt-1 px-2 py-1 bg-background rounded text-xs">
                        cd /opt/addaxai-connect && docker compose logs -f --tail 50
                      </code>
                    </li>
                  </ol>
                </div>
              </div>

              {/* Rollback note */}
              <div className="bg-muted border border-border p-4 rounded-md">
                <p className="text-sm text-muted-foreground">
                  <strong>If something goes wrong:</strong> restore the database from
                  your SQL dump and redeploy the previous version{' '}
                  <span className="text-xs italic">(on the production server)</span>.
                  For a full server rollback, create a new droplet from the snapshot you took in step 1{' '}
                  <span className="text-xs italic">(in the DigitalOcean dashboard)</span>.
                </p>
                <code className="block mt-2 px-2 py-1 bg-background rounded text-xs text-muted-foreground">
                  cd /opt/addaxai-connect && docker compose down && cat backup.sql | docker compose exec -T postgres psql -U addaxai addaxai_connect && docker compose up -d
                </code>
              </div>

            </div>
          </CardContent>
        </Card>
      </div>
    </ServerPageLayout>
  );
};
