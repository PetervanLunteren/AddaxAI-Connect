/**
 * Notifications page for project-level alerts and notifications
 */
import React from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../components/ui/Card';
import { Bell } from 'lucide-react';

export const NotificationsPage: React.FC = () => {
  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Notifications</h1>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Bell className="h-5 w-5" />
            <CardTitle>Project Notifications</CardTitle>
          </div>
          <CardDescription>
            Configure alerts and notifications for this project
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Notification settings coming soon...
          </p>
        </CardContent>
      </Card>
    </div>
  );
};
