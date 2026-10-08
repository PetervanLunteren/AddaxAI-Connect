# Service

Cameras in the field need work: new batteries, a fresh SD card, a cleaned lens, cut vegetation, a corrected angle. The Service page keeps track of it. Open it from the menu, right under Cameras. It has two tabs.

- **Open** is the work still to do. Plan it before a field trip, so nothing gets forgotten.
- **Done** is the work already done. This is the service history of every camera.

The tables, filters and selection work the same as on the Cameras and Sites pages.

## Tasks and visits

A task is a planned visit. It names a camera, what needs doing, and optionally a due date, a person and a note. Click a task to change it.

When the work is done, tick the task and click **Mark done** in the bar above the table. You confirm on which day it was done and by whom, and the task moves to Done. So there is one history, and a finished task is never stored twice.

- Mark one task done and the dialog also shows what was planned, so you can correct what was actually done.
- Mark several done at once, for example after a field day, and they share the date and the person. Each task keeps its own planned actions and note.

If tasks are no longer needed, tick them and click **Cancel tasks**. They are removed and nothing is logged, because the work did not happen.

You can also log work directly with **Log visit**, without planning it first. Use that for work you did on the spot. A visit logged by mistake is deleted the same way: tick it on the Done tab and click **Delete**.

A task has no "in progress" state. Work on a camera trap is usually one visit, so a task is either open or done. A task is **overdue** when its due date has passed and it is still open.

## Planning service for many cameras

**Plan service** makes one task for every camera you pick. Pick cameras from the list, where each one shows its site name first, or use the map button to select them on a map. Each task is marked done on its own, because each camera gets its own visit.

**Log visit** works the same way. One field trip that serviced a whole line of cameras is one dialog.

## Sites, not device ids

Tasks and visits belong to a camera, but the tables show the site first, with the camera id in its own column next to it, the same as on the Cameras page. People know "Big Oak North", not a device id.

- An open task shows the site where the camera is now.
- A visit shows the site where the camera stood on the day of the visit. When a camera moved on the same day, the visit counts for the new site.
- A visit from before the camera sent its first photo has no site yet. It shows as "No site".

Because a task follows its camera, a task cannot be planned for a site that has no camera at the moment. When a camera moves to another site before the work is done, its open task moves with it.

## Assigning work and the email

A task can be assigned to a project member, when you plan it, by clicking it, or for several at once with **Assign** in the bar. The list can be filtered by person, so everyone can find their own work.

When you assign tasks to someone else, you can tick **Send email to assignee**. It is off by default. One email lists all the tasks of that one action, so assigning twenty tasks sends one email, not twenty. You never get an email for a task you assign to yourself.

## Who can do what

- Project admins plan, edit, complete and cancel tasks, and log and delete visits. Any admin can change any task.
- Viewers see the open tasks and the visits, but cannot change them. A viewer who is limited to some sites only sees the tasks and visits at those sites. That includes the notes, and the email address of the person who was assigned or did the work.

## Elsewhere in the app

- The dashboard shows how many tasks are overdue, with a link to them.
- The menu shows the number of open tasks next to Service, for admins.
- The camera and site panels show the last service date and the open tasks, with links to both tabs filtered to that camera or site.
- The Cameras table has an optional "Last service" column.
- The Exports page has a "Service visits" export with every visit.
