# Cold-storage tier for MinIO — end-to-end plan

## Context

The production server (DigitalOcean, 160 GB NVMe SSD) is approaching its disk limit. Raw camera-trap images dominate usage at ~4 MB each — tens of GB per month per active project. Postgres, thumbnails, crops, project documents, and ML models are collectively small by comparison.

The goal: introduce a **cold-storage tier** so most `raw-images` live on an EU-hosted S3-compatible bucket, while recent images stay local for fast reads. Thumbnails (hit by every grid view and every export), crops, project-images, project-documents, and models stay on the hot server.

Original idea: a MinIO data directory on a TransIP Big Storage 2 TB HDD, keeping the latest 20 GB of thumbnails and 50 GB of images on a fast tier, daily eviction, fall back to cold when a hot-cache miss occurs.

## Research summary

### Current state of object storage in this codebase

- Single MinIO instance bind-mounted at `./data/minio`, six buckets: `raw-images`, `crops`, `thumbnails`, `models`, `project-images`, `project-documents` (`shared/shared/storage.py:123-129`, `docker-compose.yml:39-82`).
- Image reads go through authenticated API endpoints. Every read uses `storage_client.download_fileobj(bucket, key)` (`services/api/routers/images.py:1190-1306`, `export.py:503-712`, `project_documents.py:126-164`).
- `Image` model stores only `storage_path` and `thumbnail_path`; no bucket field, no tier column (`shared/shared/models.py:16-56`).
- HTTP caching on image responses: 1 h for thumbnails, 24 h for originals (`services/api/routers/images.py:1242, 1301`).
- Frontend: unbounded in-memory blob cache in `ImageCacheContext.tsx`, 50 ms staggered prefetch.
- No TTL, no retention, no background cleanup today. Only explicit deletes are admin-triggered (`services/api/routers/image_admin.py:406-495`) and the Telegram post-send cleanup of the annotated image in `thumbnails` (`services/notifications-telegram/worker.py:140-157`).
- Export streams all thumbnails for a project in one request.
- Email notifications are link-only. Telegram notifications embed annotated-image bytes then delete the source object from `thumbnails`.
- No per-bucket utilisation metrics exist.

### TransIP Big Storage verdict (with sources)

- HDD, RAID-Z ZFS, ~€10/month for 2 TB ([transip.eu/vps/big-storage](https://www.transip.eu/vps/big-storage/)).
- Attaches as a raw block device **only to a TransIP VPS in the same availability zone** (AMS0 or RTM0) ([kb/304](https://www.transip.eu/knowledgebase/304-what-is-big-storage)).
- No iSCSI. Cross-host sharing via NFS, SMB, or SSHFS over public internet.
- REST API v6 exists for provisioning and attach/detach.
- Backups: 4-hourly, only 9 retained (36 h window) — thin for archival.
- No published latency / IOPS benchmarks.

**Verdict:** the production server is at DigitalOcean, so TransIP Big Storage cannot direct-attach. Using it would require mounting over the public internet (NFS/SSHFS from a TransIP proxy VPS) — slow, brittle, adds infrastructure to maintain. Ruled out.

### EU/NL-hosted S3-compatible alternatives

| Provider                              | Location        | 2 TB/month   | Egress model                             | Fit                                                           |
|---------------------------------------|-----------------|--------------|------------------------------------------|---------------------------------------------------------------|
| **Wasabi Amsterdam**                  | NL (Amsterdam)  | ~€13         | Free up to 1:1 ratio of stored           | **Primary pick.** NL, S3, immediate access, 90-day min.       |
| Scaleway Object Storage Amsterdam     | NL (Amsterdam)  | ~€12 IA tier | Per-GB egress (small)                    | Solid runner-up. Avoid Scaleway Glacier — 6-12 h restore breaks latency target. |
| Backblaze B2 EU Central               | DE (Frankfurt)  | ~€11         | Free via Cloudflare/Fastly, else $0.01/GB| Strong technically; Germany not NL.                          |
| Hetzner Storage Box                   | DE/FI           | €10.90 (5 TB)| Unlimited, but no S3 API                 | Cheap but does not plug into MinIO ILM.                       |
| AWS S3 Glacier Deep Archive           | EU regions      | ~€2          | $0.09/GB egress                          | Breaks <10 s latency target. Skip.                            |

## Clarifying questions and user answers

### Q1 — Server host
Where is production hosted?
- TransIP VPS in AMS/RTM — would make Big Storage viable.
- ✅ **DigitalOcean (Ubuntu droplet)** *(user answer)* — rules TransIP out.
- Hetzner or other non-TransIP — same constraint.
- Not sure.

### Q2 — Built-in vs custom
- ✅ **Use MinIO's built-in ILM/tiering** *(user answer, my recommendation)* — transparent remote-tier transitions, no application code changes, matches CONVENTIONS.md #12.
- Custom cache-and-evict — more code to own.
- Block-level cache (bcache) — heavy server-admin overhead.

### Q3 — Provider openness
- User answer: **"storage providers that work with our setup and plan, NL preferred, EU acceptable if NL unavailable."** → Wasabi Amsterdam primary; Scaleway Amsterdam fallback; Backblaze B2 Frankfurt only if NL flex.

### Q4 — Latency target
- ✅ **Under 3 s thumbnails, under 10 s originals** *(user answer, my recommendation)* — rules out Glacier-class.

### Q5 — Tier scope
- ✅ **`raw-images` only** *(user answer, my recommendation)*. Thumbnails / crops / project files / models stay hot.

### Q6 — Tier rule
- User raised the project-variance problem (5-camera vs 200-camera). Asked about size-based ILM.
- **Fact:** MinIO ILM is S3-Lifecycle-shaped (Days / Date / NoncurrentVersion / ObjectLocked). No "bucket size" primitive.
- Resolved in Q7.

### Q7 — Variance fix
- ✅ **Age-based default + size-safety-valve script** *(user answer, my recommendation)*. 60-day MinIO ILM rule as primary; backstop cron that force-transitions oldest when local `raw-images` exceeds a budget.
- Per-prefix age rules — more flexible, more moving parts.
- Pure custom size script — contradicts the built-in choice.
- Pure age-based, no backstop — worst case eats hot capacity on big projects.

### Q8 — Default age threshold
- ✅ **60 days** *(user answer, my recommendation)*.

### Q9 — Sizing verification
- ✅ **User will SSH and run `du -sh` first** *(user answer, my recommendation)*. Actual numbers drive the safety-valve budget.

### Q10 — DB tier column
- ✅ **No column, rely on MinIO transparent tiering** *(user answer, my recommendation)*.

### Q11 — Cold-tier durability/backup
- ✅ **Rely on provider's built-in durability** *(user answer, my recommendation)*. Wasabi advertises 11 nines. Postgres backups stay a separate concern.

### Q12 — UI on cold reads
- ✅ **Same existing spinner, no special treatment** *(user answer, my recommendation)*. Revisit if measurements show pain.

## Key decisions (final)

1. **Provider:** Wasabi Amsterdam (`s3.eu-central-1.wasabisys.com`, region `eu-central-1`). Fallback: Scaleway Amsterdam One Zone-IA if Wasabi has a blocker. Avoid Scaleway Glacier, avoid AWS Glacier Deep Archive.
2. **Mechanism:** MinIO built-in ILM with a remote-tier transition.
3. **Scope:** only `raw-images` is tiered.
4. **Policy:** age rule at 60 days + daily size-safety-valve script.
5. **No DB column.**
6. **No UI changes in v1.**
7. **No dual-provider replication** in v1.
8. **Size budget** set after user-measured `du -sh` on prod.

## Architecture

### Object lifecycle

```
Ingestion writes to raw-images       (local MinIO, default behaviour)
            │
            ▼
  ILM rule  (age >= 60 days)         transitions object body to remote tier
            │                         (local keeps only metadata + tier pointer)
            ▼
  Safety-valve cron  (daily)         force-transitions additional oldest objects
                                      when local raw-images exceeds hot_budget_gb
            │
            ▼
  API / export / worker reads        download_fileobj(raw-images, key)
                                      MinIO transparently pulls from remote tier
                                      on cold access. HTTP cache absorbs repeat reads.
```

No changes in API routes, workers, or frontend.

### Critical gotcha: local metadata holds the tier pointers

When MinIO transitions an object, the **body** moves to the remote bucket. The **metadata plus the remote-key pointer** stays in `data/minio` locally. The remote object is stored under a MinIO-managed opaque name; without the local metadata you cannot find it by the original `storage_path`.

Implication: **`data/minio` must be part of a backup strategy** once tiering is enabled. Today it's bind-mounted and gitignored, treated as recoverable via a DigitalOcean snapshot. We need to reaffirm that policy explicitly in `docs/cold-storage.md` (the snapshot-based DR story already covers it; nothing new to build) and also add a nightly `mc mirror` of the MinIO metadata subdirectory to a second Wasabi path as belt-and-suspenders. Tracked as a later hardening item, not a v1 blocker.

### Configuration surface

Added environment variables (`.env` / `ansible/group_vars/dev.yml`):

| Var                         | Example / Default                              | Notes                                                                 |
|-----------------------------|-----------------------------------------------|-----------------------------------------------------------------------|
| `COLD_TIER_ENABLED`         | `false` (default) / `true`                    | Master switch. When false, no tier registration, no watchdog.         |
| `COLD_TIER_PROVIDER`        | `wasabi`                                      | Free text, used only in logs.                                         |
| `COLD_TIER_ENDPOINT`        | `https://s3.eu-central-1.wasabisys.com`       | Remote S3 endpoint.                                                   |
| `COLD_TIER_REGION`          | `eu-central-1`                                |                                                                       |
| `COLD_TIER_BUCKET`          | `addaxai-connect-cold-storage`                | One bucket can be shared across servers; per-server isolation is by `COLD_TIER_PREFIX`. |
| `COLD_TIER_PREFIX`          | `pwn.addaxai.com` (domain_name)               | Per-server folder inside the shared bucket. MinIO refuses two registrations on the same (bucket, prefix). |
| `COLD_TIER_ACCESS_KEY`      | (vault-encrypted)                             | One key for the shared bucket; can be scoped per-prefix in IAM if needed. |
| `COLD_TIER_SECRET_KEY`      | (vault-encrypted)                             |                                                                       |
| `COLD_TIER_NAME`            | `WASABI_COLD`                                 | Internal MinIO tier alias. Referenced by ILM rule.                    |
| `COLD_TIER_AGE_DAYS`        | `60`                                          | ILM transition threshold.                                             |
| `COLD_TIER_HOT_BUDGET_GB`   | `50` (provisional, set after prod sizing)     | Watchdog threshold. If local raw-images exceeds, oldest are evicted.  |
| `COLD_TIER_WATCHDOG_HOUR`   | `4`                                           | UTC hour of daily run.                                                |

`COLD_TIER_ENABLED=false` keeps every new piece of infrastructure dormant. Gates the `minio-tier-init` and `minio-tier-watchdog` services via a new docker-compose profile suffix, or via their own `deploy: replicas: 0` when disabled. Preferred: gate with an entrypoint check inside the container. Keeps the compose file simple.

## Rollout plan (phased)

### Phase 0 — Pre-flight (user-driven, no code yet)

1. **Sizing measurement.** User SSHes to prod and runs:
   ```bash
   cd /opt/addaxai-connect
   du -sh data/postgres data/minio data/minio/* models/ 2>/dev/null
   df -h /
   docker compose exec -T postgres psql -U addaxai -d addaxai_connect -c \
     "SELECT COUNT(*), MIN(captured_at), MAX(captured_at) FROM images;"
   ```
   Paste output. We use it to:
   - Fix `COLD_TIER_HOT_BUDGET_GB` (target: keep `data/minio/raw-images` under ~50 GB on a 160 GB disk, leaving generous room for postgres / models / logs / growth).
   - Estimate how much data the first transition will move (= everything older than 60 days). That sizes the Wasabi monthly cost.
   - Sanity-check Wasabi's 90-day minimum retention: 90 d × ~€0.007/GB/month is fine for long-lived data; partial rollback would still bill through the 90-day floor.
2. **Wasabi account + bucket.**
   - Sign up at [wasabi.com](https://wasabi.com), pick the Amsterdam region (`eu-central-1`).
   - Create one shared bucket, e.g. `addaxai-connect-cold-storage`. All servers (dev, pwn, future production droplets) tier into this one bucket. Each server's transitioned objects land under its own `COLD_TIER_PREFIX/` (the server's `domain_name`), so the slices never collide. MinIO's "tier already in use" rejection is keyed on (bucket, prefix), so unique prefixes are what makes sharing safe.
   - Create an IAM policy on this bucket with permissions: `s3:GetObject`, `s3:PutObject`, `s3:DeleteObject`, `s3:ListBucket`, `s3:GetBucketLocation`. Do **not** grant bucket-create, tag, or policy permissions. If you want least-privilege per server, scope each server's IAM key to its own `arn:aws:s3:::bucket/<domain_name>/*` resource; the credential can otherwise be shared.
   - Generate access keys (one per server, or one shared) and store the pair in 1Password (or equivalent). Never commit.
3. **Ansible vault setup.**
   - `ansible-vault encrypt_string <secret> --name 'cold_tier_access_key'` and `cold_tier_secret_key`.
   - Add the encrypted strings to `group_vars/dev.yml` (and eventually `group_vars/prod.yml` if/when a separate prod inventory exists).
   - Commit the encrypted vars. Keep the vault password in the ops password manager.
4. **Decision sign-off.** Confirm the hot-budget number and the age threshold with the user before code changes start.

### Phase 1 — Local development & CI (no touching any server)

Work on a branch `feature/cold-tier`. Nothing in prod is affected.

1. **Add the new env vars** with sane defaults in `.env.example` and `ansible/group_vars/dev.yml.example`. Default `COLD_TIER_ENABLED=false` so existing dev servers keep running unchanged.
2. **Add `docker-compose.override.cold-tier.yml`** introducing:
   - `minio-tier-init`: one-shot, depends on `minio`, runs entrypoint `services/minio-tier-init/entrypoint.sh`. Exits fast if `COLD_TIER_ENABLED!=true`.
   - `minio-tier-watchdog`: long-running, runs a sleep loop with a daily invocation of `services/minio-tier-watchdog/watchdog.py`. Same disable switch.
   - Both gated behind all existing profiles (`deepfaune`, `speciesnet`, `demo`).
3. **Write `services/minio-tier-init/entrypoint.sh`** — idempotent script:
   - `mc alias set local http://minio:9000 $MINIO_ROOT_USER $MINIO_ROOT_PASSWORD`
   - `mc admin tier add s3 local $COLD_TIER_NAME --endpoint=... --access-key=... --secret-key=... --region=... --bucket=...` — ignore "already exists".
   - `mc ilm rule add --transition-days=$COLD_TIER_AGE_DAYS --transition-tier=$COLD_TIER_NAME local/raw-images` — also idempotent via check-then-add.
   - Log a summary of tier config for audit.
4. **Write `services/minio-tier-watchdog/watchdog.py`** — small (<80 lines):
   - Read `COLD_TIER_HOT_BUDGET_GB` from env.
   - Run `mc du --json local/raw-images` to sum current hot-bucket size.
   - If size > budget: list objects sorted by captured-date ASC (from metadata or object key convention `camera_id/YYYY/MM/...`), force-transition the oldest until size is back under budget. Use `mc ilm restore --no-op` or direct `mc cp --attr` / `mc admin tier` calls.
   - Use `shared.logger.get_logger("cold-tier-watchdog")` for structured JSON output. Include counts and byte totals.
   - On any exception: log with `exc_info=True`, exit non-zero so Docker restarts the container.
   - Sleep-until-next-run loop written as simple `time.sleep(seconds_until_hour_utc(watchdog_hour))`.
5. **Add `services/minio-tier-watchdog/Dockerfile`** — thin `minio/mc` base plus `python:3.12-slim` multi-stage, installs `mc` binary, copies script, runs as non-root.
6. **Unit tests.** `tests/tier/test_watchdog.py`:
   - Mock `subprocess.run` calls to `mc`.
   - Cases: under budget → no-op; over budget → transitions until under; mc failure → raises; structured log emitted with expected keys.
   - Runs under the existing `pytest -m "not ml"` flow.
7. **Integration test.** `tests/integration/test_tiering.py` (new, opt-in, marker `tier`):
   - Fixture boots two MinIO containers via testcontainers-python: one as "local", one as "mock cold".
   - Fixture runs the init script against them.
   - Test: upload a file, run `mc ilm restore` to force transition with `--transition-days 0`, assert `mc stat` shows the object on the remote tier, GET the object back, assert byte-identical.
   - Skipped in CI unless `-m tier` is passed; runs locally via `docker compose --profile test-tier`.
8. **Dry-run locally.** `docker compose --profile deepfaune up -d` with `COLD_TIER_ENABLED=true` and two local MinIOs on different ports. Force short age + small budget. Exercise full loop.

### Phase 2 — Dev server smoke test

Runs against the existing `dev.addaxai.com` droplet.

1. **Push the branch**, deploy via the existing ansible command against inventory `dev`:
   ```bash
   ansible-playbook -i ansible/inventory.yml ansible/playbook.yml --tags app-deploy
   ```
2. **Verify the config landed.**
   ```bash
   ssh dev
   cd /opt/addaxai-connect
   grep '^COLD_TIER_' .env
   docker compose ps | grep tier
   docker compose logs minio-tier-init --tail 50
   ```
   Expect: tier added, ILM rule present, no errors.
3. **Probe with a synthetic object.**
   ```bash
   docker compose exec minio-tier-init mc admin tier ls local
   docker compose exec minio-tier-init mc ilm rule ls local/raw-images
   docker compose exec minio-tier-init bash -c "echo hi | mc pipe local/raw-images/test/probe.txt"
   docker compose exec minio-tier-init mc ilm restore local/raw-images/test/probe.txt --days 0
   # Force immediate transition via a temporary prefix rule:
   docker compose exec minio-tier-init mc ilm rule add --transition-days 0 --transition-tier WASABI_COLD \
     --prefix test/ local/raw-images
   ```
4. **Wait for transition.** MinIO's ILM runner evaluates rules on a schedule (default hourly). Force a scan with `mc ilm rule ls --expiry local/raw-images` and look for the "pending transitions" count.
5. **Read-back latency check.** `curl -H "Authorization: Bearer $TOKEN" -o /dev/null -w "%{time_total}\n" https://dev.addaxai.com/api/images/.../full` — must be under 10 s.
6. **Watchdog dry run.**
   ```bash
   docker compose exec minio-tier-watchdog python /app/watchdog.py --once --dry-run
   ```
   Confirms the size-measurement logic before any eviction fires.
7. **Multi-day soak.** Leave it running 72 h. Check daily:
   - Watchdog runs without exception (grep logs for `ERROR`).
   - Dev bucket on Wasabi console shows the expected object count growth.
   - Hot bucket stays at or below budget.
8. **Rollback test.** Set `COLD_TIER_ENABLED=false`, re-run ansible app-deploy, confirm services stop without touching data.

### Phase 3 — Production rollout

Only after Phase 2 passes.

1. **Take a full DigitalOcean snapshot** of the prod droplet. Recovery anchor.
2. **Pre-flight backup.**
   ```bash
   ssh prod
   cd /opt/addaxai-connect
   docker compose exec postgres pg_dump -U addaxai addaxai_connect > backup-pre-cold-tier.sql
   ```
3. **Deploy with the flag off.** Set `COLD_TIER_ENABLED=false` in prod's `group_vars` first. Deploy ansible, confirm nothing changes.
4. **Flip the flag to true, age rule off.** Set `COLD_TIER_ENABLED=true` but initial ILM rule is on a non-matching prefix (e.g., `--prefix __never__/`) so no data moves yet. Deploy. Watch logs. Verify Wasabi credentials work, tier registers.
5. **Canary: transition a handful of test objects.** Pick 5–10 objects older than 60 days from a low-risk project. Force-transition them. Read them back through the API. Verify latency and correctness.
6. **Enable the real ILM rule.** Remove the `__never__/` prefix, apply the full rule. MinIO will start migrating all existing 60-day-plus objects in the background.
7. **Pace the initial drain.** MinIO's default ILM scan rate is reasonable but an initial bulk transition of potentially 50+ GB will saturate upload bandwidth. Watch `docker compose stats` and `iftop` on the droplet. If the DO droplet has a monthly bandwidth cap (tiered plans), this counts against it. Mitigation options, pick one:
   - Do nothing: accept the multi-hour slow drain.
   - Temporarily lower `COLD_TIER_AGE_DAYS` in stages (e.g., start at 180 d, step down to 120 d, then 60 d over several days).
   - Use MinIO's `mc admin replicate throttle` equivalent for ILM if available; otherwise the watchdog can serve as a rate-limit by only force-transitioning N objects per run.
8. **Enable the watchdog.** After the initial drain settles, flip the watchdog to active mode.
9. **Smoke tests.**
   - Admin-triggered image-delete on a tiered image → object gone from both local metadata and Wasabi (`mc stat local/raw-images/...` → not found, `mc ls wasabi/...` → not listed).
   - CamTrap DP export for a project with tiered images → zip builds without error; thumbnails are still hot so speed is unaffected.
   - Random image read from the UI on a tiered object → latency acceptable, image displays.
10. **Update the runbooks.** Merge `docs/cold-storage.md`, `docs/operations.md` pointer, `docs/architecture.md` update.

### Phase 4 — Post-rollout monitoring

- Weekly for the first month, then monthly:
  - `du -sh data/minio/raw-images` — confirm it stays under budget.
  - Wasabi console → bucket size and request counts — confirm no unexpected billing.
  - `mc admin tier info local $COLD_TIER_NAME` — confirm tier health.
  - Tail `docker compose logs minio-tier-watchdog | grep ERROR` for the prior week.
- **Alert rule** (simple): if the watchdog has not logged a successful run in 36 h, the ops inbox gets an email. Implement via a tiny check in the existing notifications worker that reads the latest watchdog log line; defer if too much for v1.

## File changes

### New files

- `services/minio-tier-init/entrypoint.sh` — idempotent tier + ILM registration.
- `services/minio-tier-init/Dockerfile` (FROM `minio/mc:latest`, copies the entrypoint).
- `services/minio-tier-watchdog/watchdog.py` — daily eviction script (<80 lines).
- `services/minio-tier-watchdog/Dockerfile` — thin image.
- `services/minio-tier-watchdog/requirements.txt` — pinned deps.
- `docker-compose.override.cold-tier.yml` — optional override loaded when `COLD_TIER_ENABLED=true`. Keeps the main compose file untouched.
- `tests/tier/__init__.py`
- `tests/tier/test_watchdog.py` — unit tests for the eviction logic.
- `tests/integration/test_tiering.py` — testcontainers-based two-MinIO round trip, marker `tier`.
- `scripts/smoke_test_cold_tier.sh` — one-shot script: probe object, force transition, read back, report pass/fail with timings.
- `docs/cold-storage.md` — concrete runbook. Sections: Wasabi signup, bucket + IAM key creation, credential flow, Ansible-vault usage, dev vs prod bucket separation, tier registration commands, transition verification, force-restore, pause/disable procedure, rollback, credential rotation, cost-tracking one-liners, dry-run watchdog command, and the "what happens if `data/minio` is lost" DR note. Written with real commands and gotchas per the ops-docs-style preference.

### Modified files

- `docker-compose.yml` — no change in v1; new services come in via the override file to keep gating clean.
- `ansible/roles/app-deploy/tasks/main.yml` — add:
  1. A `template` task to render `docker-compose.override.cold-tier.yml` next to `docker-compose.yml` (skipped when `cold_tier_enabled` is false).
  2. A `lineinfile` / `template` update to `.env.j2` with the `COLD_TIER_*` vars.
  3. A conditional `docker compose --profile ... up -d` that includes the override.
- `ansible/roles/app-deploy/templates/.env.j2` — add `COLD_TIER_*` var block.
- `ansible/group_vars/dev.yml.example` — document the cold-tier variables (`cold_tier_enabled: false` by default, placeholders for endpoint/bucket, and a pointer to the ansible-vault section for credentials).
- `.env.example` — mirror.
- `docs/deployment.md` — add a short "Optional: cold storage" subsection pointing at `docs/cold-storage.md`.
- `docs/operations.md` — add the monitoring and "pause tiering" one-liners.
- `docs/architecture.md` — one-paragraph note that `raw-images` is tierable to a remote S3 bucket via MinIO ILM.
- `TODO.md` — add two follow-ups: (a) monitor tier latency for a week after enabling, (b) decide on metadata-backup hardening once we have real numbers.

### Files to leave untouched (verify in review)

- `shared/shared/storage.py` — no API change.
- `shared/shared/models.py` — no new column.
- `services/api/routers/{images,export,image_admin,project_documents}.py` — reads and deletes unchanged; MinIO handles tiering invisibly.
- `services/notifications-telegram/worker.py` — `thumbnails` stays hot.
- `services/frontend/**` — no UI change in v1.
- `scripts/update-database.sh` — no Alembic migration needed.

### Reused existing code (no re-invention)

- `services/api/routers/images.py:1190-1306` — `get_image_thumbnail` / `get_image_full` stream via `download_fileobj`; unchanged.
- `services/ingestion/storage_operations.py:39, 111` — writes unchanged.
- `services/api/routers/image_admin.py:468-472` — `delete_object` handles tiered objects.
- `docker-compose.yml` `minio-init` service — shape cloned for `minio-tier-init`.
- `shared/shared/logger.py:get_logger` — watchdog logs via the same structured-JSON logger used everywhere else.
- `ansible/roles/app-deploy/tasks/main.yml` pattern of templating `.env.j2` plus conditional tasks — mirrored for cold-tier.

## Testing strategy

### Unit tests (fast, always run)

- `tests/tier/test_watchdog.py` — pure-Python, mocks subprocess calls to `mc`. Covers:
  - Under-budget: no eviction, log a heartbeat.
  - Over-budget: evicts oldest first, stops as soon as under budget.
  - `mc` command failure: script raises, Docker restarts container.
  - Malformed `mc du --json` output: fails loudly (CONVENTIONS.md #1).
  - Age / captured-at parsing from the object-key pattern `camera_id/YYYY/MM/UUID_filename`.

### Integration tests (opt-in, local / CI)

- `tests/integration/test_tiering.py` (marker `tier`):
  - Fixture spins up two MinIO instances via testcontainers-python (≈10 s).
  - Runs `services/minio-tier-init/entrypoint.sh` against them.
  - Uploads a sample object, force-transitions via a 0-day rule, asserts local `mc stat` shows the remote tier, fetches the object back, byte-compares.
  - Tears down cleanly.
- Added to CI as a separate job gated on `pytest -m tier`, so the normal CI run stays fast.

### End-to-end smoke (dev server)

- `scripts/smoke_test_cold_tier.sh`:
  1. Enumerate tier config.
  2. Upload a probe object under a `smoke-test/` prefix.
  3. Force-transition.
  4. Read via the authenticated API and time it.
  5. Clean up the probe object.
  6. Prints a pass/fail with timings.
- Run manually after each ansible deploy to dev. Later wired to a post-deploy ansible task.

### Production smoke (runbook)

- Steps listed in `docs/cold-storage.md`. Key checks from Phase 3.9.

### Regression coverage

- `pytest tests/ -m "not ml"` must still pass at every step. No existing tests should break because the application code does not change.
- If we ever add the DB tier column later, add a migration test under `tests/api/`.

## Credential & secret management

- One Wasabi bucket can serve all servers. Per-server isolation is by `cold_tier_prefix` (defaults to `domain_name` in the env template), which becomes the folder name inside the shared bucket. MinIO refuses two registrations against the same (bucket, prefix), so each server's prefix must be unique.
- IAM policy is bucket-scoped, least-privilege (`s3:GetObject`, `s3:PutObject`, `s3:DeleteObject`, `s3:ListBucket`, `s3:GetBucketLocation`). For tighter scoping you can issue per-server keys whose `Resource` is `arn:aws:s3:::bucket/<domain_name>/*`; not required for correctness.
- Ansible-vault is the single source of truth for keys. Example snippet (actual values encrypted):
  ```yaml
  cold_tier_enabled: true
  cold_tier_endpoint: "https://s3.eu-central-1.wasabisys.com"
  cold_tier_region: "eu-central-1"
  cold_tier_bucket: "addaxai-connect-cold-storage"
  cold_tier_access_key: !vault |
    $ANSIBLE_VAULT;1.1;AES256
    3862...
  cold_tier_secret_key: !vault |
    $ANSIBLE_VAULT;1.1;AES256
    1c4a...
  ```
  The .env template adds `COLD_TIER_PREFIX={{ domain_name }}` automatically; no extra ansible variable is needed.
- **Rotation.** Documented in `docs/cold-storage.md`: create a new IAM key, deploy new vars via ansible, confirm tier still works, revoke the old key in Wasabi. Target: quarterly.
- **Revocation.** If a key is suspected leaked: revoke in Wasabi console immediately, then rotate. The local MinIO will start failing transitions; the watchdog log will show errors. App reads of tiered objects will also fail until the new key is deployed — this is a minor outage window for historical images only; recent images stay available.

## Monitoring & observability

- `mc admin tier info local $COLD_TIER_NAME` — tier health (online, errors).
- `mc du local/raw-images` and `mc du wasabi/<bucket>` — size per tier.
- Watchdog emits structured JSON; searchable via `docker compose logs minio-tier-watchdog | jq 'select(.level=="error")'`.
- Wasabi console metrics: API call counts, bucket size, egress volume — watched monthly.
- Optional v2: a `/api/server/cold-tier-status` endpoint (server-admin only) that surfaces tier health, hot-bucket size, last watchdog timestamp, count of transitioned objects in the last 24 h. Defer unless needed.

## Rollback & decommissioning

- **Pause tiering (reversible, seconds).** `mc ilm rule remove <id> local/raw-images` — new objects are no longer tiered. Existing tiered objects stay where they are and remain readable.
- **Temporary disable (ansible).** Set `cold_tier_enabled: false`, re-run app-deploy. The init and watchdog containers stop. Tier config survives on local MinIO; reads of tiered objects still work as long as the MinIO daemon still has the tier registered.
- **Full rollback.** Restore all tiered objects to local with `mc ilm restore local/raw-images --recursive --days=999999`. This pulls every object body back from Wasabi and writes it into `data/minio`. Risky if local disk cannot hold the total. Only feasible when the original disk-space problem has been solved by other means.
- **Wasabi cost during rollback.** The 90-day minimum retention is per-object: once an object has been on Wasabi for >=90 days, removing it costs nothing extra. Objects that were moved within the last 90 days when you decide to roll back still bill through their 90-day floor. For a one-way-only deployment this isn't a concern; for experimentation it argues for using the dev bucket liberally and keeping the prod bucket stable.
- **Decommissioning.** To remove the feature entirely: set the flag off, remove `COLD_TIER_*` vars, delete the override file and new services. The docker-compose profiles, MinIO, and application are untouched.

## Disaster recovery

### Scenario 1: Wasabi credentials are leaked / account compromised
- Revoke the key in Wasabi immediately.
- Rotate: create a new IAM key, deploy via ansible, confirm tier health returns.
- Audit `mc admin trace` output for anomalies over the relevant period.
- No data-integrity impact; reads of historical objects fail briefly until new creds land.

### Scenario 2: Hot `data/minio` volume corrupted on DO droplet
- Restore from the DigitalOcean snapshot taken before rollout (Phase 3.1).
- Any ILM-transitioned objects whose metadata is in that snapshot remain resolvable via the tier pointer.
- Any objects transitioned **after** the snapshot lose their pointers. The bodies remain in Wasabi under opaque keys. Recovery requires cross-referencing: `mc ls --recursive wasabi/...` vs. Postgres `images.storage_path`. Feasible but slow and manual. Mitigation: after enabling tiering, add a nightly backup of `data/minio/.minio.sys/` metadata to a second location. Tracked as Phase-4 hardening.

### Scenario 3: Watchdog script bug deletes / force-transitions wrong objects
- The watchdog only **transitions** objects, it does not delete them. Transitions are reversible (`mc ilm restore`). So the blast radius of a bug is at worst: objects move to cold earlier than intended and are slower to read back. No data loss.
- Unit tests cover the "oldest-first" selection logic. Integration tests exercise the full round trip.
- In prod, first enable in `--dry-run` mode (logs what it would do without doing it). Remove the dry-run flag only after a week of clean logs.

### Scenario 4: MinIO ILM bug or upstream regression
- Pin MinIO to a known-good tag in `docker-compose.yml` (currently `minio:latest` — change to a specific tag as part of this work; semver-pin is hygiene regardless).
- Rollback-by-tag is fast; `data/minio` is stable across minor versions per MinIO's compat promise.

### Scenario 5: Wasabi is down for hours
- Reads on tiered objects return 5xx until Wasabi recovers.
- Writes keep landing on local (ingestion is unaffected).
- Users browsing recent images are unaffected (those are hot).
- Accept the exposure; document in the runbook.

## Cost tracking

- Wasabi pricing model: flat ~$6.99/TB/month in Amsterdam, free egress within 1:1 ratio of stored volume, 90-day minimum retention per object.
- Expected cost once steady state: ~€13/month at 2 TB, flat.
- Monthly operational check: Wasabi console → billing page, screenshot to the ops notes.
- Cost-per-image math for sanity: 4 MB × 1,000,000 images = ~4 TB ≈ €25/month. Gives headroom for years of growth.

## Open items (resolve before implementation starts)

1. **Sizing measurement output** (user runs the commands above, pastes output). Required for `COLD_TIER_HOT_BUDGET_GB`.
2. **Wasabi account + two buckets + two IAM keys** (user provisions, stores credentials in 1Password, hands encrypted strings to ansible-vault).
3. **Confirm the watchdog-as-docker-service vs systemd-timer choice.** Recommend the docker-compose service for parity; confirm before I implement.
4. **Confirm the dev server is safe to experiment on right now** (no live demo traffic / live users we'd disturb) — or pick a maintenance window.
5. **Confirm the branch name and PR scope.** Recommend one PR for docs + infra + init + watchdog, reviewed as a single unit. Implementation itself is maybe 150 lines of code across the two scripts plus the compose override.
