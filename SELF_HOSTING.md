# Self-hosting Dental Expert

Running this system on your own server.

> **This fork builds from source.** The upstream `ghcr.io/abinauv/dental-erp`
> image ships the original MySQL schema and migration history and will not run
> against this Postgres stack, so the "fetch four files, pull an image" path
> below has been replaced by a checkout. See [CHANGES.md](CHANGES.md).

This is the operator's guide. If you want to _develop_ Dental Expert, read the
[README](README.md) instead — the development stack is a different file and a
different set of trade-offs.

---

## What you need

- A Linux host with Docker Engine 24+ and the Compose plugin. 2 GB RAM is
  workable for one clinic; 4 GB is comfortable (the image is built on the host,
  which wants headroom).
- A domain name pointing at that host, if you want HTTPS — and you do.
- 20 minutes.

You do **not** need Node.js on the host — the build happens inside Docker.

---

## 1. Get the files

The image is built from source, so clone the repository:

```bash
git clone <your-fork-url> /opt/dental-clinic && cd /opt/dental-clinic
cp .env.production.example .env
```

That also gets you the backup scripts — see
[Backups](#5-backups-do-this-before-you-need-it).

## 2. Fill in `.env`

```bash
chmod 600 .env
```

Every value marked REQUIRED has to be set; the stack refuses to start
otherwise, rather than falling back to something weak. Generate the secrets:

```bash
# Database passwords — base64url, so no characters that break a URL
node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"

# NEXTAUTH_SECRET
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"

# ENCRYPTION_KEY — exactly 64 hex characters
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# CRON_SECRET
node -e "console.log(require('crypto').randomBytes(16).toString('hex'))"
```

No Node.js on the host? `openssl rand -base64 24`, `openssl rand -base64 32`
and `openssl rand -hex 32` produce the same thing.

Two that are easy to get wrong:

- **`NEXTAUTH_URL` must be the public HTTPS URL**, exactly as a browser will
  see it. Wrong value means redirect loops and cookies set on the wrong host.
- **`ENCRYPTION_KEY` cannot be rotated casually.** It encrypts stored
  payment-gateway credentials; change it and they become undecryptable. Keep a
  copy somewhere other than this server.

Then tag the build, so you can tell which commit is running and roll back to a
previous image by tag:

```bash
DENTAL_EXPERT_VERSION="v1.0.0"
```

## 3. Start it

```bash
docker compose up -d
```

That builds the image, waits for PostgreSQL to be healthy, runs the database
migrations as a one-shot `migrate` container, and only then starts the app.

```bash
docker compose ps
```

`migrate` shows as `Exited (0)` — that is success, not a failure. `postgres`
and `app` show as healthy.

```bash
curl -fsS localhost:3000/api/health   # {"status":"ok",...}
curl -fsS localhost:3000/api/ready    # {"status":"ready",...}
```

The app is bound to `127.0.0.1` and is not reachable from outside the host yet.
That is deliberate — the next step puts TLS in front of it.

### Creating the first account

Open the app and use the sign-up flow to create the first clinic and its admin
user. There is no seeded account in a production deployment, on purpose: a
default login that ships with the software is a default login that ends up in
production.

## 4. HTTPS

Point your domain's A record (and AAAA, if you have IPv6) at the host **first**
— certificate issuance is an HTTP challenge on port 80 and cannot succeed
before DNS resolves. Then:

```bash
# in .env
DENTAL_EXPERT_DOMAIN="dental.example.com"
ACME_EMAIL="you@example.com"
```

```bash
docker compose -f docker-compose.yml -f docker-compose.caddy.yml up -d
```

Caddy obtains and renews a Let's Encrypt certificate by itself. There is no
certbot to install and no renewal cron entry to forget about.

Keep passing both `-f` flags on every subsequent command, or export
`COMPOSE_FILE=docker-compose.yml:docker-compose.caddy.yml` once in your shell
profile — otherwise the next `docker compose up -d` will quietly remove Caddy
as an orphan.

Already run nginx or Traefik? Skip this file and proxy to `127.0.0.1:3000`
yourself. Forward `X-Forwarded-Proto`, or the app will build `http://` URLs
behind your `https://` and the login flow will break.

## 5. Backups — do this before you need it

The scripts live in the repository:

They came with the checkout, in `scripts/`:

```bash
./scripts/backup.sh                 # -> ./backups/<timestamp>/
./scripts/backup.sh /mnt/backups    # or somewhere else
```

Each backup holds a `pg_dump` of the database, a tar of the uploads volume, a
manifest, and SHA-256 checksums. `pg_dump` takes its snapshot inside a
repeatable-read transaction, so the clinic keeps working while it runs.

Nightly, via cron:

```cron
15 2 * * * cd /opt/dental-clinic && ./scripts/backup.sh /mnt/backups >> /var/log/dental-backup.log 2>&1
```

**A backup on the same machine as the thing it protects is not a backup.** Copy
it off the host — object storage, another server, anywhere with a different
failure mode.

### Restoring

```bash
./scripts/restore.sh ./backups/20260803T101500Z          # says what it would do, changes nothing
./scripts/restore.sh ./backups/20260803T101500Z --yes    # actually restores
```

It verifies checksums before touching anything, stops the app, drops and
recreates the database, replaces the uploads volume, and starts the app again.

**Exercise this once, on purpose, now.** Take a backup, restore it, confirm the
app comes back. A restore path you have never run is a hypothesis. The safe way
to practise is on a second copy of the stack rather than the live one:

```bash
docker compose -p dental-erp-drill -f docker-compose.yml up -d
```

### Using S3 storage?

`backup.sh` skips the uploads tar and tells you so — the files are in your
bucket, and protecting them is the bucket's job. Turn on versioning or a
lifecycle policy there. The database backup still covers everything else.

## 6. Upgrading

```bash
./scripts/backup.sh                  # first, always
git pull
# edit .env: DENTAL_EXPERT_VERSION="v1.1.0"
docker compose build
docker compose up -d
```

The `migrate` container runs the new migrations before the app starts. Watch it
if you want to see them applied:

```bash
docker compose logs migrate
```

**Rolling back** means putting the old version back in `.env` and running
`docker compose up -d` again — but only if the release did not migrate the
database. A migration that dropped or rewrote a column cannot be undone by
running older code against it; that is what the backup you took first is for.
Release notes call out migrations that are not backward compatible.

---

## Sizing and scaling

**One instance** is the right shape for a single clinic, and it is what the
defaults assume. Local disk for uploads, no Redis, one app container.

**More than one app replica** needs two changes, and they are not optional:

1. **`STORAGE_DRIVER=s3`.** Two containers do not share a local disk, so a file
   uploaded through one is a 404 through the other. Copy your existing files
   across _before_ switching — see [docs/STORAGE.md](docs/STORAGE.md).
2. **Database connections.** Each replica opens its own pool. The arithmetic:

   ```
   replicas × DB_CONNECTION_LIMIT + headroom < POSTGRES_MAX_CONNECTIONS
   ```

   `DB_CONNECTION_LIMIT` defaults to 10 and `POSTGRES_MAX_CONNECTIONS` to 100,
   so four replicas is comfortable and eight is not. Leave a dozen spare for the
   migrate job and your own `psql` shell.

   Postgres allocates a backend process per connection, so a pooler (PgBouncer,
   or your provider's) is the answer past a handful of replicas rather than
   simply raising the ceiling.

   The default matters more than it looks: Prisma's own default is
   `num_cpus * 2 + 1`, and inside a container `num_cpus` is the **host's** core
   count, not the container's share of it. On a 16-core host that is 33
   connections per replica, and three replicas would exhaust a stock Postgres.
   Setting it explicitly is what stops that being discovered in production.

---

## Troubleshooting

**`migrate` exits non-zero and the app never starts.** That is the design — a
failed migration stops the deployment instead of leaving a half-migrated
database under running code. `docker compose logs migrate` has the reason.

**`/api/ready` returns 503 but `/api/health` returns 200.** The process is fine
and the database is not. Check `docker compose logs postgres`. Point liveness
probes at `/api/health` and readiness at `/api/ready` — pointing liveness at
`/api/ready` turns a brief database blip into a restart loop.

**Login redirects in a loop, or the session never sticks.** `NEXTAUTH_URL` does
not match the URL in the browser, or your proxy is not forwarding
`X-Forwarded-Proto`.

**`password authentication failed for user` after changing a database
password.** The Postgres volume keeps the role created on first start; changing
`POSTGRES_PASSWORD` in `.env` afterwards does not change it in the database.
Change it with `ALTER ROLE dental PASSWORD '...'`, or start from a fresh volume
and restore a backup.

**Uploaded files vanished after a redeploy.** The `uploads` volume was not
mounted. If the container still exists, rescue them before doing anything else:

```bash
docker cp <container>:/app/uploads ./uploads-backup
```

**The image will not pull on a Raspberry Pi or an ARM server.** It should —
releases publish `linux/amd64` and `linux/arm64`. Check what you actually asked
for: `docker buildx imagetools inspect ghcr.io/abinauv/dental-erp:<version>`.

---

## What this does not do yet

Stated plainly, because finding out later is worse:

- **No built-in log shipping or metrics.** Logs go to the container's stdout;
  collect them with whatever you already run.
- **No background job queue.** Scheduled work runs through authenticated HTTP
  endpoints driven by an external scheduler, and email and SMS are sent inline
  on the request. Phase 5 of the [infrastructure
  roadmap](docs/INFRASTRUCTURE.md) addresses this — it is not committed yet.
- **No SSO.** Credentials login only. Phase 6, also not committed.
- **No automated backup verification.** `backup.sh` checks that the dump is not
  truncated; it does not restore it somewhere to prove it works. That is the
  drill above, and it is on you to run it.
