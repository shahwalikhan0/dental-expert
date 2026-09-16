-- Appointments become instants.
--
-- `scheduledDate` was `date` and `scheduledTime` was free text, so an
-- appointment was not a point in time until something reassembled the two
-- against the clinic's timezone. Nothing did: the reminder job read
-- `scheduledDate - 1 hour`, an hour before *midnight*, and its
-- `scheduledDate >= now()` filter skipped every appointment later today
-- because today's date is midnight and midnight has passed.
--
-- The pair is replaced by one `timestamptz`. The clinic still books a wall
-- clock time; the conversion now happens once, on the way in, instead of
-- being re-derived (or not) at every read.

ALTER TABLE "Appointment" ADD COLUMN "startsAt" TIMESTAMPTZ(3);

-- Backfill against each clinic's own timezone. `scheduledTime` has no database
-- constraint, so a row whose time is not HH:MM would make the cast throw and
-- take the migration down with it; those fall back to midnight, which is what
-- the application was already effectively using for them.
UPDATE "Appointment" a
SET "startsAt" = (
      (
        to_char(a."scheduledDate", 'YYYY-MM-DD')
        || ' '
        || CASE
             WHEN a."scheduledTime" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]' THEN substring(a."scheduledTime" from 1 for 5)
             ELSE '00:00'
           END
      )::timestamp AT TIME ZONE COALESCE(NULLIF(h."timezone", ''), 'Asia/Karachi')
    )
FROM "Hospital" h
WHERE h."id" = a."hospitalId";

-- No appointment can exist without a clinic (the FK is NOT NULL and cascades),
-- so the join above reaches every row and this is safe.
ALTER TABLE "Appointment" ALTER COLUMN "startsAt" SET NOT NULL;

DROP INDEX "Appointment_hospitalId_scheduledDate_scheduledTime_idx";
DROP INDEX "Appointment_hospitalId_status_scheduledDate_idx";
DROP INDEX "Appointment_hospitalId_doctorId_scheduledDate_idx";
DROP INDEX "Appointment_hospitalId_patientId_scheduledDate_idx";
DROP INDEX "Appointment_chairId_scheduledDate_idx";

ALTER TABLE "Appointment" DROP COLUMN "scheduledDate";
ALTER TABLE "Appointment" DROP COLUMN "scheduledTime";

CREATE INDEX "Appointment_hospitalId_startsAt_idx" ON "Appointment"("hospitalId", "startsAt");
CREATE INDEX "Appointment_hospitalId_status_startsAt_idx" ON "Appointment"("hospitalId", "status", "startsAt");
CREATE INDEX "Appointment_hospitalId_doctorId_startsAt_idx" ON "Appointment"("hospitalId", "doctorId", "startsAt");
CREATE INDEX "Appointment_hospitalId_patientId_startsAt_idx" ON "Appointment"("hospitalId", "patientId", "startsAt" DESC);
CREATE INDEX "Appointment_chairId_startsAt_idx" ON "Appointment"("chairId", "startsAt");
