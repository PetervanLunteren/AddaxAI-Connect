# Ansible

How server configuration is stored, and how to run the playbook against one
server when you have several.

## What is in this repo and what is not

This repo ships the shape of a deployment, never anyone's actual servers. So
the `.example` files are committed and your filled-in copies are gitignored.

| Committed | Yours, gitignored |
|---|---|
| `playbook.yml`, `roles/` | |
| `inventory.yml.example` | `inventory.yml` |
| `group_vars/all/main.yml.example` | `group_vars/all/main.yml` |
| `host_vars/example.yml.example` | `host_vars/<host>.yml` |
| `scripts/import-host-vars.sh` | |

Your files hold real passwords in the clear. Keep a copy somewhere private, a
private git repo works well. You do not have to treat that copy as precious:
`scripts/import-host-vars.sh` rebuilds any `host_vars` file from the running
server, so as long as a server is alive its settings are recoverable.

## Getting started

```bash
cp ansible/inventory.yml.example              ansible/inventory.yml
cp ansible/group_vars/all/main.yml.example    ansible/group_vars/all/main.yml
cp ansible/host_vars/example.yml.example      ansible/host_vars/myserver.yml
```

Then edit all three. `myserver` must match the name you used in
`inventory.yml`.

## Where a setting goes

Three places, and the rule is short:

```
inventory.yml              which machines exist and how to reach them
group_vars/all/main.yml    settings every server agrees on
host_vars/<host>.yml       everything specific to one server, including passwords
```

Later wins. So put a value in `group_vars/all` and override it in `host_vars`
for the one server that differs.

Passwords always go in `host_vars`, never in `group_vars/all`. Two servers
sharing a database password is not a saving, it is one break-in instead of two.

## Running it

Always name a target. The playbook covers every server in your inventory, so
without `--limit` it would try to deploy all of them at once. A guard refuses
that rather than letting it happen quietly.

```bash
# one server, the normal case
ansible-playbook -i ansible/inventory.yml ansible/playbook.yml --limit myserver

# only refresh .env and cron, the usual step during an update
ansible-playbook -i ansible/inventory.yml ansible/playbook.yml --limit myserver --tags sync-config

# a whole group on purpose
ansible-playbook -i ansible/inventory.yml ansible/playbook.yml --limit prod -e confirm_multi=true
```

Check what a target resolves to before running anything:

```bash
ansible -i ansible/inventory.yml prod --list-hosts
ansible-inventory -i ansible/inventory.yml --host myserver
```

Neither command contacts a server.

## Adopting a server that already runs

If a server is already deployed, do not hand-write its `host_vars` file. Import
it:

```bash
bash ansible/scripts/import-host-vars.sh myserver
```

That reads `/opt/addaxai-connect/.env` over SSH and turns it back into ansible
variables. It is read-only on the server, one `cat` and nothing else.

The values come off the running machine rather than from a template, so
re-running the playbook afterwards writes back the `.env` the server already
has. That is what makes it safe to do this on a live server.

Two variables cannot be imported, because they are never written to `.env`:

| Variable | Sets |
|---|---|
| `app_user_password` | the app user's login password |
| `monitoring_password` | the nginx metrics htpasswd entry |

Both roles skip their task when the variable is undefined, so leaving them out
keeps whatever is on the server now. Setting one rotates it on the next run.

## Keeping .env.j2 and the importer in step

`roles/app-deploy/templates/.env.j2` turns ansible variables into `.env`.
`scripts/import-host-vars.sh` turns `.env` back into ansible variables. Add a
variable to one and it belongs in the other, or an imported server quietly
falls back to a role default instead of keeping its own value.

Values that `.env.j2` derives from another variable (`DATABASE_URL`,
`REDIS_URL`, `CORS_ORIGINS`, `MINIO_ENDPOINT`, `COLD_TIER_PREFIX`,
`BACKUP_HOST_PREFIX`, `COMPOSE_PROFILES`) are outputs, not inputs, and are
deliberately absent from the importer.
