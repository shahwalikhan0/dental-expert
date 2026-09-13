#!/bin/sh
# Back up a running DentalERP stack: the database, and the uploads volume.
#
#   ./scripts/backup.sh                 # into ./backups/<timestamp>/
#   ./scripts/backup.sh /mnt/backups    # somewhere else
#
# Run it from the directory holding docker-compose.yml and .env.
#
# A backup you have never restored is a hypothesis, not a backup. scripts/
# restore.sh is the other half, and SELF_HOSTING.md asks you to exercise it
# once on purpose before you need it in anger.

set -eu

PROJECT="dental-erp"
DEST_ROOT="${1:-./backups}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DEST="$DEST_ROOT/$STAMP"

if [ ! -f .env ]; then
  echo "No .env here. Run this from the directory holding docker-compose.yml." >&2
  exit 1
fi

# shellcheck disable=SC1091
set -a
. ./.env
set +a

: "${POSTGRES_PASSWORD:?POSTGRES_PASSWORD is not set in .env}"
POSTGRES_DB="${POSTGRES_DB:-dental_erp}"
POSTGRES_USER="${POSTGRES_USER:-dental}"

if ! docker compose ps --status running --services 2>/dev/null | grep -qx postgres; then
  echo "The postgres service is not running — start the stack first." >&2
  exit 1
fi

mkdir -p "$DEST"
echo "Backing up to $DEST"

# --- database -----------------------------------------------------------------
# pg_dump runs inside a repeatable-read transaction, so it is a consistent
# snapshot without locking anything and the clinic keeps working while it runs.
# PGPASSWORD rather than a password on the command line so the credential is
# not visible in `ps` on a shared host.
#
# --no-owner/--no-acl so the dump restores cleanly under whatever role the
# target cluster uses, rather than demanding the exact role names this one has.
echo "  database..."
docker compose exec -T -e PGPASSWORD="$POSTGRES_PASSWORD" postgres \
  pg_dump \
  --username="$POSTGRES_USER" \
  --format=plain \
  --no-owner \
  --no-acl \
  "$POSTGRES_DB" | gzip >"$DEST/database.sql.gz"

# gzip in a pipeline reports success even when pg_dump upstream of it failed,
# so check the dump actually contains a dump.
if ! gzip -dc "$DEST/database.sql.gz" | head -40 | grep -q "PostgreSQL database dump"; then
  echo "Database dump looks empty or truncated — refusing to call this a backup." >&2
  exit 1
fi

# --- uploads ------------------------------------------------------------------
if [ "${STORAGE_DRIVER:-local}" = "s3" ]; then
  echo "  uploads: skipped (STORAGE_DRIVER=s3 — your files are in the bucket,"
  echo "           and backing those up is your object store's job: enable"
  echo "           versioning or a lifecycle policy there)"
else
  echo "  uploads..."
  # Through a helper container, because the volume is not mounted on the host.
  # Mounted read-only, so a backup can never be the thing that damages the
  # originals.
  #
  # The archive is streamed to stdout and redirected here rather than written
  # to a bind-mounted directory. A bind mount would have to name a host path,
  # and host paths are the fragile part: they need translating on Docker
  # Desktop, they inherit SELinux labels on RHEL, and the container writes them
  # as root. A pipe has none of those problems.
  #
  # stderr is deliberately not suppressed. An earlier version of this script
  # sent it to /dev/null and printed "Done" regardless, so a failure here
  # produced a backup directory with no uploads in it and nothing to say so.
  docker run --rm -v "${PROJECT}_uploads:/src:ro" alpine:3 \
    tar czf - -C /src . >"$DEST/uploads.tar.gz"

  # Verify rather than trust the exit code: busybox tar reports some failures
  # on stderr and still exits 0, and a redirect creates the file either way.
  if [ ! -s "$DEST/uploads.tar.gz" ] || ! gzip -t "$DEST/uploads.tar.gz" 2>/dev/null; then
    echo "Uploads archive is missing or corrupt — refusing to call this a backup." >&2
    exit 1
  fi
fi

# --- manifest -----------------------------------------------------------------
{
  echo "created:        $STAMP"
  echo "version:        ${DENTAL_ERP_VERSION:-latest}"
  echo "database:       $POSTGRES_DB"
  echo "storage_driver: ${STORAGE_DRIVER:-local}"
} >"$DEST/manifest.txt"

# Checksums so a restore can tell a truncated copy from a good one before it
# starts overwriting anything.
(cd "$DEST" && find . -maxdepth 1 -type f ! -name checksums.txt -exec sha256sum {} + >checksums.txt)

echo ""
echo "Done:"
ls -lh "$DEST" | tail -n +2 | awk '{printf "  %-20s %s\n", $9, $5}'
echo ""
echo "This is on the same machine as the thing it protects. Copy it somewhere"
echo "else — that copy is the backup; this one is a convenience."
