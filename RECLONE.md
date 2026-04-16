# Reclone runbook

How to recover a server whose local git history has diverged irreconcilably from `origin/main`. Typical cause: someone force-pushed `origin/main` (history rewrite) while the server had an old clone sitting on the now-orphaned commits, so `git pull` fails with `fatal: Need to specify how to reconcile divergent branches`. Running `git status -sb` in that state shows both `ahead` and `behind` counts in the hundreds or thousands.

This procedure wipes the server's `.git` directory and working tree (tracked files only), re-clones from origin, preserves runtime data and secrets, and redeploys.

## When to use it

- `git status` shows `main...origin/main [ahead N, behind M]` with both N and M large.
- Recent commits on the server don't show up on GitHub.
- Recent commits on GitHub don't land on the server after `git pull`.
- Confirmed with a colleague that `origin/main` was rewritten.

Do not use this when the server has unpushed local work you care about. Push those commits to a backup branch first.

## What survives, what doesn't

**Survives** (not touched by this procedure):

- `.env` (gitignored, stays in place).
- `uploads/` and `data/` (gitignored, bind-mounted into Docker containers).
- The Postgres data at `data/postgres/` (bind mount). The DB, users, images, detections, everything stays.
- The MinIO object store at `data/minio/`.
- `models/` (about 1.4 GB of cached ML weights; gitignored subdirs).
- `backup.sql` or any `*.sql` dumps sitting in the repo root.
- Running container images (they get rebuilt next step, but existing cached layers are reused).

**Replaced**:

- Every tracked file in the working tree, reset to origin's version.
- `.git/` directory, re-created from a fresh fetch.
- Orphan untracked files left over from the old branch (obsolete source files, renamed directories, etc.).

## Prerequisites

- SSH access to the server (alias `dev` here, adjust as needed).
- The repo lives at `/opt/addaxai-connect/` on the server.
- Docker and Docker Compose installed, working.
- Network reachability to `github.com` from the server.

## Procedure

### 1. Stop containers and tear down the diverged git state

```bash
ssh dev
cd /opt/addaxai-connect
docker compose down --remove-orphans
rm -rf .git
```

`docker compose down --remove-orphans` stops every running service and drops orphan containers (services that exist in the old compose file but not in origin's version, like the removed `classification-deepfaune` after a rename or `monitoring` stack). Containers writing to bind-mounted dirs need to be stopped before the git reset so no file in-flight gets replaced.

`rm -rf .git` removes only the git metadata. The working tree files stay (including secrets and data dirs), but git no longer tracks anything.

### 2. Re-initialize git, fetch origin, reset the tree

```bash
git init -b main
git remote add origin https://github.com/PetervanLunteren/AddaxAI-Connect.git
git fetch origin main
git reset --hard origin/main
git branch --set-upstream-to=origin/main main
```

`git reset --hard origin/main` overwrites tracked files to match origin exactly, but leaves untracked files alone. After this step `git status -sb` should read `## main...origin/main` with no divergence count.

### 3. Remove orphan untracked files, preserve data

After the reset, `git status` still shows untracked files from the old branch (obsolete service directories, renamed code files, old monitoring configs, etc.) sitting alongside the current tree. These have to go, but the data directories and backup files must not.

Dry-run first:

```bash
git clean -fd -e models -e backup.sql --dry-run
```

Review the output. If it lists any file you want to keep, add another `-e <name>` flag. When the list is safe, run for real:

```bash
git clean -fd -e models -e backup.sql
```

The `-e` flag excludes patterns from deletion. Anything gitignored (`.env`, `data/`, `uploads/`, `logs/`, `__pycache__/`, `node_modules/`) is already safe from `git clean -fd` without the `-x` flag. After this step `git status --porcelain | grep "^??"` should list only the intentional preservations (`models/`, `backup.sql`).

### 4. Rebuild all service images and start containers

Every service in the origin `docker-compose.yml` is gated behind a profile (`deepfaune`, `speciesnet`, or `demo` per DEVELOPERS.md). Without a profile flag, `docker compose up` exits immediately with "no service selected" and nothing happens. Pick the profile the server is supposed to run on (typically `deepfaune` for Willfine deployments in Europe):

```bash
docker compose --profile deepfaune up -d --build --remove-orphans
```

For `speciesnet` or `demo` deployments, substitute the profile name. ML-heavy services (detection, classification) take the longest, a few minutes each with cache. The `--remove-orphans` flag clears any leftover container name that isn't in the new compose file.

### 5. Run database migrations

The Postgres volume is unchanged. If origin ships migrations that haven't been applied to the existing DB, run them now:

```bash
bash scripts/update-database.sh
```

This runs `alembic upgrade head` inside the API container and then a deployment-period backfill script. Check the output for errors. If the DB schema was frozen on an older alembic revision, every pending migration from that revision through to the latest head runs in sequence.

### 6. Verify

```bash
docker compose ps
```

Every container should be `Up`. Healthchecks on postgres/redis/minio should read `(healthy)`. Tail a couple of logs to confirm no import or startup errors:

```bash
docker compose logs api --tail 30
docker compose logs ingestion --tail 20
```

Hit the API directly for a simple 200/401 check (401 is fine, means auth middleware is alive):

```bash
curl -s -o /dev/null -w "api: %{http_code}\n" http://localhost:8000/api/cameras
```

## Gotchas observed during this reclone

- Every service in the compose file is behind a profile. `docker compose up -d --build` on its own prints "no service selected" and does nothing. Always pass `--profile <name>` (typically `deepfaune`).
- `models/` surfaces as an untracked directory if origin doesn't track any file under it. The 1.4 GB of cached weights inside are gitignored individually (`models/*.pt`, etc.), but the parent dir is not. Must exclude explicitly with `-e models` in `git clean`, otherwise `git clean -fd` will wipe it and every ML container will re-download on next start.
- `backup.sql` is untracked and also not in `.gitignore` (no generic `*.sql` rule). Exclude explicitly with `-e backup.sql` if you want to keep it.
- Orphan service directories left over from renames (e.g. `services/classification/` after it was split into `services/classification-deepfaune/` and `services/classification-speciesnet/`) sit next to the current directories and do nothing, but they clutter IDE searches. `git clean -fd` removes them cleanly.
- After `docker compose down --remove-orphans`, the Docker network is removed too. The next `up -d` recreates it. No manual step needed.

## After recovery

- Push a single new commit (e.g. a doc update) to confirm the push path works: `git push origin main` should fast-forward without any divergence warning.
- If anyone else has a clone that was pointing at the old (pre-rewrite) history, they need to do the same reclone on their machine, or `git fetch && git reset --hard origin/main && git clean -fd` inside their existing clone.
