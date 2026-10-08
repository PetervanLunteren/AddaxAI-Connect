# Service

Cameras in the field need work: new batteries, a fresh SD card, a cleaned lens, cut vegetation, a corrected angle. The Service page keeps track of it. It holds two lists.

- **Open tasks** is the work still to do. Plan it before a field trip, so nothing gets forgotten.
- **Visits** is the work already done. This is the service history of every camera.

Open the Service page from the menu, right under Cameras.

## Tasks and visits

A task is a planned visit. It names a camera, what needs doing, and optionally a due date, a person and a note.

When the work is done, click **Mark done** on the task. You confirm what was actually done and on which day, and the task becomes a visit. It leaves the open tasks and shows up in the visits. So there is one history, and a finished task is never stored twice.

If a task is no longer needed, click **Cancel task**. It is removed and nothing is logged, because the work did not happen.

You can also log a visit directly with **Log visit**, without planning it first. Use that for work you did on the spot.

A task has no "in progress" state. Work on a camera trap is usually one visit, so a task is either open or done. A task is **overdue** when its due date has passed and it is still open.

## Planning service for many cameras

**Plan service** makes one task for every camera you pick. Pick cameras from the list, where each one shows its site name first, or use the map button to select them on a map. Each task is marked done on its own, because each camera gets its own visit.

**Log visit** works the same way. One field trip that serviced a whole line of cameras is one dialog.

## Sites, not device ids

Tasks and visits belong to a camera, but the page shows the site first, with the camera id small below it. People know "Big Oak North", not a device id.

- An open task shows the site where the camera is now.
- A visit shows the site where the camera stood on the day of the visit. When a camera moved on the same day, the visit counts for the new site.
- A visit from before the camera sent its first photo has no site yet. It shows as "No site".

Because a task follows its camera, a task cannot be planned for a site that has no camera at the moment. When a camera moves to another site before the work is done, its open task moves with it.

## Assigning work and the email

A task can be assigned to a project member. The list can be filtered by person, so everyone can find their own work.

When you assign a task to someone else, you can tick **Send email to assignee**. It is off by default. One email lists all the cameras you planned in one go, so planning a task on twenty cameras sends one email, not twenty. You never get an email for a task you assign to yourself.

## Who can do what

- Project admins plan, edit, complete and cancel tasks, and log and delete visits. Any admin can change any task.
- Viewers see the open tasks and the visits, but cannot change them. A viewer who is limited to some sites only sees the tasks and visits at those sites. That includes the notes, and the email address of the person who was assigned or did the work.

## Elsewhere in the app

- The dashboard shows how many tasks are overdue, with a link to them.
- The menu shows the number of open tasks next to Service, for admins.
- The camera and site panels show the last service date, the open tasks and a link to the service history of that camera or site.
- The Cameras table has an optional "Last service" column.
- The Exports page has a "Service visits" export with every visit.
