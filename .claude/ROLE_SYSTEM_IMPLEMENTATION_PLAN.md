# Role System Implementation Plan - Detailed Steps

**Status:** COMPLETE ✅
**Started:** 2025-01-14
**Completed:** 2025-01-14
**Goal:** Implement three-tier role system with project memberships

---

## System Design

### Three Roles
1. **project-viewer** (tied to specific project): Can view images, cameras, dashboard. Can set own notification settings.
2. **project-admin** (tied to specific project): Can manage cameras, species, users within their project(s)
3. **server-admin** (not tied to anything): Full access to everything, system administration

### Key Architecture Decisions
- Use `project_memberships` junction table for user-project-role mapping
- Users can have different roles in different projects
- `User.is_server_admin` boolean for server admins (renamed from `is_superuser`)
- Role names use hyphens: `project-viewer`, `project-admin`, `server-admin`
- Server admins added to allowlist with `is_server_admin=True`
- Regular users must have at least one project membership to register
- Project admins can invite users to their projects

---

## Phase 1: Database Schema ✅ COMPLETE

### 1.1 ✅ Create ProjectMembership model
**File:** `shared/shared/models.py`
- Table: `project_memberships`
- Columns: id, user_id, project_id, role, added_by_user_id, created_at
- Unique constraint: (user_id, project_id)
- Roles: 'project-admin' or 'project-viewer'

### 1.2 ✅ Update User model
**File:** `shared/shared/models.py`
- Rename `is_superuser` → `is_server_admin`
- Remove `role` column (now in project_memberships)
- Remove `project_id` column (now in project_memberships)

### 1.3 ✅ Update EmailAllowlist model
**File:** `shared/shared/models.py`
- Rename `is_superuser` → `is_server_admin`

### 1.4 ✅ Create Alembic migration
**File:** `services/api/alembic/versions/20250114_add_project_memberships_and_rename_superuser.py`
- Rename columns in users and email_allowlist tables
- Create project_memberships table with indexes
- Drop role and project_id from users table
- Include downgrade path

---

## Phase 2: Backend Authentication System ✅ COMPLETE

### 2.1 ✅ Create permissions.py module
**File:** `services/api/auth/permissions.py` ✅ CREATED
- Enum: `Role` (PROJECT_VIEWER, PROJECT_ADMIN, SERVER_ADMIN)
- Helper: `is_server_admin(user)` → bool
- Helper: `get_user_project_role(user, project_id, db)` → Optional[str]
- Helper: `get_user_projects_with_roles(user, db)` → list[dict]
- Helper: `can_access_project(user, project_id, db)` → bool
- Helper: `can_admin_project(user, project_id, db)` → bool
- Dependency: `require_server_admin(user)` → User (raises 403 if not admin)
- Dependency: `require_project_access(project_id, user, db)` → User (raises 403)
- Dependency: `require_project_admin_access(project_id, user, db)` → User (raises 403)

### 2.2 ✅ Update auth/users.py
**File:** `services/api/auth/users.py` ✅ UPDATED
- Keep `current_active_user`, `current_verified_user`
- Remove `current_superuser` (replaced by `require_server_admin`)
- Add comment explaining change

### 2.3 ✅ Update user_manager.py
**File:** `services/api/auth/user_manager.py` ✅ UPDATED
- Import `ProjectMembership` instead of `Project`
- Update `create()` method:
  - Use `allowlist_entry.is_server_admin` (renamed)
  - For non-admin users: validate project memberships exist
  - If no memberships: delete user and raise ValueError (crash early)
  - Log membership count and projects/roles

### 2.4 ✅ Update project_access.py
**File:** `services/api/auth/project_access.py` ✅ UPDATED
- Update `get_accessible_project_ids()`:
  - Server admins: return all project IDs
  - Regular users: query project_memberships table for user's projects
  - Return list of project IDs user can access

### 2.5 ✅ Update auth/schemas.py
**File:** `services/api/auth/schemas.py` ✅ UPDATED
- In `UserRead` class: rename `is_superuser` → `is_server_admin`
- Remove `role` and `project_id` fields (no longer in User model)

---

## Phase 3: Backend API Endpoints ✅ COMPLETE

### 3.1 Update admin.py router
**File:** `services/api/routers/admin.py`

**Replace all occurrences:**
- `current_superuser` → `require_server_admin` (10 endpoints)
- `is_superuser` → `is_server_admin` in models and responses

**Update existing endpoints:**
- `POST /api/admin/allowlist` - accept `is_server_admin` field
- `GET /api/admin/allowlist` - return `is_server_admin` in response
- Update `AllowlistResponse` schema: rename field
- `GET /api/admin/users` - update to return project memberships
- Update `UserResponse` schema:
  ```python
  class UserResponse(BaseModel):
      id: int
      email: str
      is_active: bool
      is_server_admin: bool  # renamed
      is_verified: bool
      project_memberships: list[dict]  # [{project_id, project_name, role}]
  ```

**New endpoints to add:**
```python
@router.get("/users/{user_id}/projects")
async def get_user_projects(...) -> list[ProjectMembershipResponse]:
    """Get all project memberships for a user (server admin only)"""

@router.post("/users/{user_id}/projects")
async def add_user_to_project(
    user_id: int,
    data: AddUserToProjectRequest,  # {project_id, role}
    ...
) -> ProjectMembershipResponse:
    """Add user to project with role (server admin only)"""
    # Create ProjectMembership entry

@router.patch("/users/{user_id}/projects/{project_id}")
async def update_user_project_role(
    user_id: int,
    project_id: int,
    data: UpdateRoleRequest,  # {role}
    ...
) -> ProjectMembershipResponse:
    """Change user's role in specific project (server admin only)"""
    # Update ProjectMembership.role

@router.delete("/users/{user_id}/projects/{project_id}")
async def remove_user_from_project(
    user_id: int,
    project_id: int,
    ...
):
    """Remove user from project (server admin only)"""
    # Delete ProjectMembership entry
    # If user has no other memberships and not server admin, delete allowlist entry
```

**Update allowlist creation:**
```python
class AllowlistCreateRequest(BaseModel):
    email: Optional[EmailStr] = None
    domain: Optional[str] = None
    is_server_admin: bool = False  # renamed
    project_memberships: list[dict] = []  # [{project_id, role}]

@router.post("/allowlist")
async def add_to_allowlist(...):
    """
    If is_server_admin=True: create allowlist entry only
    If is_server_admin=False: create allowlist + project_membership rows
    Validate: non-admins must have at least one project membership
    """
```

### 3.2 Update projects.py router
**File:** `services/api/routers/projects.py`

**Update existing endpoints:**
- `GET /api/projects` - keep as `current_active_user` (uses project filtering)
- `POST /api/projects` - change to `require_server_admin` (only server admin creates)
- `DELETE /api/projects/{id}` - change to `require_server_admin` (only server admin deletes)
- Remove `current_superuser` import, add `require_server_admin` import

**New endpoints for project admins:**
```python
@router.get("/projects/{project_id}/users")
async def get_project_users(
    project_id: int,
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(require_project_admin_access)
) -> list[ProjectUserResponse]:
    """Get all users in project with roles (project admin)"""
    # Query ProjectMembership where project_id = project_id
    # Join with User table to get emails
    # Return [{user_id, email, role, added_at}]

@router.post("/projects/{project_id}/users")
async def invite_user_to_project(
    project_id: int,
    data: InviteUserRequest,  # {email, role: 'project-admin'|'project-viewer'}
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(require_project_admin_access)
) -> ProjectUserResponse:
    """Invite user to THIS project (project admin)"""
    # Check if email in allowlist, if not create entry with is_server_admin=False
    # Create ProjectMembership for THIS project only
    # Return membership info

@router.patch("/projects/{project_id}/users/{user_id}")
async def update_project_user_role(
    project_id: int,
    user_id: int,
    data: UpdateRoleRequest,  # {role}
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(require_project_admin_access)
) -> ProjectUserResponse:
    """Change user's role in THIS project (project admin)"""
    # Update ProjectMembership.role where user_id and project_id match
    # Validate: user_id != current_user.id (can't change own role)

@router.delete("/projects/{project_id}/users/{user_id}")
async def remove_user_from_project(
    project_id: int,
    user_id: int,
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(require_project_admin_access)
):
    """Remove user from THIS project (project admin)"""
    # Delete ProjectMembership where user_id and project_id match
    # Validate: user_id != current_user.id (can't remove self)
    # If user has no other memberships and not server admin:
    #   - Delete allowlist entry (user loses all access)
```

### 3.3 Update cameras.py router
**File:** `services/api/routers/cameras.py`

**Update imports:**
- Remove: `from auth.users import current_superuser`
- Add: `from auth.permissions import require_project_admin_access, get_user_project_role, Role`

**Update endpoints:**
- `GET /api/cameras` - keep as `current_active_user` (already uses project filtering)
- `POST /api/cameras` - add role check:
  ```python
  @router.post("/cameras")
  async def create_camera(
      data: CreateCameraRequest,  # includes project_id
      db: AsyncSession = Depends(get_async_session),
      user: User = Depends(current_active_user)
  ):
      # Verify user is admin of target project
      role = await get_user_project_role(user, data.project_id, db)
      if role not in [Role.SERVER_ADMIN, Role.PROJECT_ADMIN]:
          raise HTTPException(403, "Project admin access required")
      # Create camera...
  ```
- `PUT /api/cameras/{id}` - add role check for camera's project
- `DELETE /api/cameras/{id}` - add role check for camera's project
- `POST /api/cameras/bulk-import` - add role check for target project

### 3.4 Update other routers
**Files:** `devtools.py`, `ingestion_monitoring.py`, `project_images.py`
- Replace `current_superuser` → `require_server_admin`
- Update imports

**Files:** `notifications.py`, `images.py`, `statistics.py`, `logs.py`
- Keep as-is (use project filtering via `get_accessible_project_ids`)

### 3.5 Create /users/me/projects endpoint
**File:** `services/api/main.py` or new `services/api/routers/users.py`

```python
@router.get("/users/me/projects")
async def get_my_projects(
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(current_active_user)
) -> list[ProjectWithRoleResponse]:
    """Get current user's projects with roles"""
    memberships = await get_user_projects_with_roles(user, db)
    # Join with Project table to get full project details
    # Return: [{id, name, description, role, image_url, ...}]
```

---

## Phase 4: Frontend Types and Utilities ✅ COMPLETE

### 4.1 Update types.ts
**File:** `services/frontend/src/api/types.ts`

```typescript
export interface User {
  id: number;
  email: string;
  is_active: boolean;
  is_server_admin: boolean;  // renamed from is_superuser
  is_verified: boolean;
}

export interface ProjectWithRole extends Project {
  role: 'project-admin' | 'project-viewer' | 'server-admin';
}

export interface ProjectMembership {
  user_id: number;
  user_email: string;
  project_id: number;
  role: 'project-admin' | 'project-viewer';
  added_at: string;
}

// Helper functions
export const isServerAdmin = (user: User | null): boolean => {
  return user?.is_server_admin === true;
};

export const canManageProject = (projectRole: string | undefined): boolean => {
  return projectRole === 'server-admin' || projectRole === 'project-admin';
};

export const canViewProject = (projectRole: string | undefined): boolean => {
  return projectRole !== undefined;
};
```

### 4.2 Update auth.ts
**File:** `services/frontend/src/api/auth.ts`
- Update response parsing to use `is_server_admin` field

### 4.3 Create memberships.ts API client
**File:** `services/frontend/src/api/memberships.ts` (NEW FILE)

```typescript
import { apiClient } from './client';

export const membershipsApi = {
  // Project admin: manage users in their project
  getProjectUsers: (projectId: number) =>
    apiClient.get(`/api/projects/${projectId}/users`),

  inviteUserToProject: (projectId: number, data: {email: string, role: string}) =>
    apiClient.post(`/api/projects/${projectId}/users`, data),

  updateProjectUserRole: (projectId: number, userId: number, role: string) =>
    apiClient.patch(`/api/projects/${projectId}/users/${userId}`, {role}),

  removeUserFromProject: (projectId: number, userId: number) =>
    apiClient.delete(`/api/projects/${projectId}/users/${userId}`),

  // Server admin: manage all users across all projects
  getUserProjects: (userId: number) =>
    apiClient.get(`/api/admin/users/${userId}/projects`),

  addUserToProject: (userId: number, data: {project_id: number, role: string}) =>
    apiClient.post(`/api/admin/users/${userId}/projects`, data),

  updateUserProjectRole: (userId: number, projectId: number, role: string) =>
    apiClient.patch(`/api/admin/users/${userId}/projects/${projectId}`, {role}),

  removeUserFromProjectAdmin: (userId: number, projectId: number) =>
    apiClient.delete(`/api/admin/users/${userId}/projects/${projectId}`),
};
```

---

## Phase 5: Frontend UI Updates ✅ COMPLETE

### 5.1 Update AuthContext.tsx
**File:** `services/frontend/src/contexts/AuthContext.tsx`
- Update user type to use `is_server_admin` instead of `is_superuser`

### 5.2 Update ProjectContext.tsx
**File:** `services/frontend/src/contexts/ProjectContext.tsx`

**Major changes:**
```typescript
// Fetch user's projects with roles from new endpoint
const { data: projectsWithRoles } = useQuery({
  queryKey: ['user-projects'],
  queryFn: () => apiClient.get('/api/users/me/projects'),
  enabled: isAuthenticated,
});

// visibleProjects now comes directly from API (includes role)
const visibleProjects = projectsWithRoles || [];

// Track current project's role
const currentProjectRole = selectedProject
  ? visibleProjects.find(p => p.id === selectedProject.id)?.role
  : undefined;

// Update canManageProjects logic
const canManageCurrentProject = canManageProject(currentProjectRole);
```

**Remove old filtering logic** (lines 58-74) - projects now come with roles from API

### 5.3 Update ProjectsPage.tsx
**File:** `services/frontend/src/pages/ProjectsPage.tsx`

**Changes:**
- Use `isServerAdmin(user)` instead of `user.is_superuser`
- Projects come from `/api/users/me/projects` with roles
- Show role badge on each card
- "Create project" button only for server admins
- "Manage users" button for project admins

```typescript
{visibleProjects.map((project) => (
  <ProjectCard
    key={project.id}
    project={project}
    role={project.role}
    canManage={canManageProject(project.role)}
  />
))}
```

### 5.4 Update ProjectCard.tsx
**File:** `services/frontend/src/components/projects/ProjectCard.tsx`

**Add role badge:**
```typescript
<div className="flex items-center justify-between">
  <h3>{project.name}</h3>
  <span className="badge">
    {role === 'server-admin' ? 'Server admin' :
     role === 'project-admin' ? 'Admin' : 'Viewer'}
  </span>
</div>

{canManage && (
  <Button onClick={() => navigate(`/projects/${project.id}/users`)}>
    Manage users
  </Button>
)}
```

### 5.5 Create ProjectUsersPage.tsx
**File:** `services/frontend/src/pages/project/ProjectUsersPage.tsx` (NEW FILE)

**Project admin interface for managing users in THEIR project:**
```typescript
export const ProjectUsersPage: React.FC = () => {
  const { projectId } = useParams();
  const { data: projectUsers } = useQuery({
    queryKey: ['project-users', projectId],
    queryFn: () => membershipsApi.getProjectUsers(projectId),
  });

  return (
    <div>
      <h1>Project users</h1>
      <Button onClick={() => setShowInviteModal(true)}>
        Invite user
      </Button>

      <Table>
        <thead>
          <tr>
            <th>Email</th>
            <th>Role</th>
            <th>Added</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {projectUsers?.map(membership => (
            <tr key={membership.user_id}>
              <td>{membership.user_email}</td>
              <td>
                <Select
                  value={membership.role}
                  onChange={(e) => updateRole(membership.user_id, e.target.value)}
                >
                  <option value="project-viewer">Viewer</option>
                  <option value="project-admin">Admin</option>
                </Select>
              </td>
              <td>{formatDate(membership.added_at)}</td>
              <td>
                <Button onClick={() => removeUser(membership.user_id)}>
                  Remove
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </Table>

      <InviteUserModal
        open={showInviteModal}
        projectId={projectId}
        onClose={() => setShowInviteModal(false)}
      />
    </div>
  );
};
```

**Also create:**
- `InviteUserModal.tsx` component for inviting users

### 5.6 Update UserAssignmentPage.tsx
**File:** `services/frontend/src/pages/server/UserAssignmentPage.tsx`

**Server admin interface - manage ALL users across ALL projects:**
```typescript
// Update table to show project memberships
<Table>
  <thead>
    <tr>
      <th>Email</th>
      <th>Server admin</th>
      <th>Projects</th>
      <th>Actions</th>
    </tr>
  </thead>
  <tbody>
    {users.map(user => (
      <tr key={user.id}>
        <td>{user.email}</td>
        <td>{user.is_server_admin ? 'Yes' : 'No'}</td>
        <td>
          {user.project_memberships.map(m => (
            <span key={m.project_id} className="badge">
              {m.project_name} ({m.role === 'project-admin' ? 'Admin' : 'Viewer'})
            </span>
          ))}
        </td>
        <td>
          <Button onClick={() => openManageProjects(user)}>
            Manage projects
          </Button>
        </td>
      </tr>
    ))}
  </tbody>
</Table>
```

**Create modal for managing user's project memberships**

### 5.7 Update Sidebar.tsx
**File:** `services/frontend/src/components/layout/Sidebar.tsx`

**Role-based menu visibility:**
```typescript
// Server admin menu
{isServerAdmin(user) && (
  <ServerAdminMenu />
)}

// Project admin menu (visible when viewing project they admin)
{canManageProject(currentProjectRole) && (
  <>
    <MenuItem to={`/projects/${projectId}/cameras/manage`}>
      Manage cameras
    </MenuItem>
    <MenuItem to={`/projects/${projectId}/species`}>
      Manage species
    </MenuItem>
    <MenuItem to={`/projects/${projectId}/users`}>
      Manage users
    </MenuItem>
  </>
)}

// All users menu
<MenuItem to="/dashboard">Dashboard</MenuItem>
<MenuItem to="/images">Images</MenuItem>
<MenuItem to="/cameras">Cameras</MenuItem>
<MenuItem to="/notifications">Notifications</MenuItem>
```

### 5.8 Update CamerasPage.tsx
**File:** `services/frontend/src/pages/CamerasPage.tsx`

Hide edit/delete buttons for project viewers:
```typescript
{canManageProject(currentProjectRole) && (
  <>
    <Button onClick={() => editCamera(camera)}>Edit</Button>
    <Button onClick={() => deleteCamera(camera)}>Delete</Button>
  </>
)}
```

---

## Phase 6: Documentation ✅ COMPLETE

### 6.1 Update DEVELOPERS.md
**File:** `DEVELOPERS.md`

Add section after line 30:
```markdown
## Role-based access control

Three-tier system:
- **server-admin** - Full access to all projects, can create projects, manage all users
- **project-admin** - Manages specific projects, can invite users to their projects
- **project-viewer** - Read-only access to specific projects

Users can have different roles in different projects (e.g., admin of Project A, viewer of Project B).

### Permission model
- `users.is_server_admin` boolean flag for server admins
- `project_memberships` table maps users to projects with roles
- No role = no access to that project

### Inviting users
**Server admin:** Can add users to any project with any role
**Project admin:** Can add users to their own projects only

User must have at least one project membership to register (enforced at registration).
```

### 6.2 Update README.md
**File:** `README.md`

Update section around line 116:
```markdown
6. **Configure email and superadmin**
   Still in `group_vars/dev.yml`.

   | Variable | Example | Description |
   |---------|---------|-------------|
   | `superadmin_email` | `"admin@example.com;admin2@example.com"` | Email address(es) for initial server admin account(s). Multiple emails can be separated by semicolons. These users will be automatically created with full system access. |
```

Add note about role system:
```markdown
## User roles

The system has three role levels:
- **Server admin** - Full access to all projects and system settings
- **Project admin** - Can manage specific projects (cameras, species, users)
- **Project viewer** - Read-only access to specific projects

Server admins are configured during deployment via `superadmin_email`.
Other users are invited by server admins or project admins through the web interface.
```

---

## Testing Checklist ⏳ PENDING

**Server admin:**
- [ ] Can create/delete projects
- [ ] Can view all projects
- [ ] Can manage users across all projects
- [ ] Can add users to any project with any role
- [ ] Can access server admin tools

**Project admin (for their assigned projects):**
- [ ] Can view project data (images, cameras, dashboard)
- [ ] Can create/edit/delete cameras
- [ ] Can manage species
- [ ] Can invite users to their project
- [ ] Can change roles (viewer ↔ admin) for users in their project
- [ ] Can remove users from their project
- [ ] Cannot access other projects
- [ ] Cannot create/delete projects
- [ ] Cannot access server admin tools

**Project viewer (for their assigned projects):**
- [ ] Can view project data (images, cameras, dashboard)
- [ ] Can configure own notifications
- [ ] Cannot create/edit/delete cameras
- [ ] Cannot manage species
- [ ] Cannot manage users
- [ ] Cannot access other projects

**Multi-project user:**
- [ ] User can be admin of Project A and viewer of Project B
- [ ] Project selector shows both projects
- [ ] Menu changes based on current project role
- [ ] Cannot edit cameras in projects where they are viewer

---

## Current Status

✅ **Phase 1 Complete:** Database schema with project_memberships table
✅ **Phase 2 Complete:** Authentication system with permissions
✅ **Phase 3 Complete:** Backend API routers updated
✅ **Phase 4 Complete:** Frontend types and API client
✅ **Phase 5 Complete:** All frontend UI components updated
✅ **Phase 6 Complete:** Documentation updated

**ALL PHASES COMPLETE - READY FOR TESTING**

---

## Files Modified

### Completed
- ✅ `shared/shared/models.py` - Added ProjectMembership, renamed is_superuser
- ✅ `services/api/alembic/versions/20250114_add_project_memberships_and_rename_superuser.py` - Migration
- ✅ `services/api/auth/permissions.py` - Created permission system
- ✅ `services/api/auth/users.py` - Removed current_superuser
- ✅ `services/api/auth/user_manager.py` - Updated create() for memberships

### Pending
- ⏳ `services/api/auth/project_access.py`
- ⏳ `services/api/auth/schemas.py`
- ⏳ `services/api/routers/admin.py`
- ⏳ `services/api/routers/projects.py`
- ⏳ `services/api/routers/cameras.py`
- ⏳ `services/api/routers/devtools.py`
- ⏳ `services/api/routers/ingestion_monitoring.py`
- ⏳ `services/api/routers/project_images.py`
- ⏳ `services/api/main.py` (or new users.py router)
- ⏳ `services/frontend/src/api/types.ts`
- ⏳ `services/frontend/src/api/auth.ts`
- ⏳ `services/frontend/src/api/memberships.ts` (new file)
- ⏳ `services/frontend/src/contexts/AuthContext.tsx`
- ⏳ `services/frontend/src/contexts/ProjectContext.tsx`
- ⏳ `services/frontend/src/pages/ProjectsPage.tsx`
- ⏳ `services/frontend/src/components/projects/ProjectCard.tsx`
- ⏳ `services/frontend/src/pages/project/ProjectUsersPage.tsx` (new file)
- ⏳ `services/frontend/src/pages/server/UserAssignmentPage.tsx`
- ⏳ `services/frontend/src/components/layout/Sidebar.tsx`
- ⏳ `services/frontend/src/pages/CamerasPage.tsx`
- ⏳ `DEVELOPERS.md`
- ⏳ `README.md`

---

## Estimated Time Remaining

- Phase 2: 30 minutes
- Phase 3: 6-8 hours
- Phase 4: 1 hour
- Phase 5: 6-8 hours
- Phase 6: 2 hours

**Total: ~16-20 hours remaining**
