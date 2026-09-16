-- One table for when a clinic, or one member of staff, is bookable.
--
-- `StaffShift` said when a dentist works; `Holiday` said when the clinic is
-- shut. Both answer the same question for the slot picker, which had to query
-- each of them separately and then reconcile the answers — and between them
-- they could not express two things clinics actually need:
--
--   * a dentist's day off. Nothing recorded staff leave at all, so somebody on
--     holiday kept showing free slots on the booking page.
--   * a half-day closure. `Holiday` had no times, so "closing at 13:00 on
--     Christmas Eve" had to be recorded as a full day shut or not at all.
--
-- `Holiday.isRecurring` was worse than unused: the column existed, the settings
-- screen offered the checkbox, and the slot routes matched on the exact date —
-- so a holiday marked as recurring was observed once and never again.

CREATE TABLE "Availability" (
  "id" TEXT NOT NULL,
  "hospitalId" TEXT NOT NULL,
  "staffId" TEXT,
  "dayOfWeek" INTEGER,
  "date" DATE,
  "startTime" TEXT,
  "endTime" TEXT,
  "isAvailable" BOOLEAN NOT NULL DEFAULT true,
  "name" TEXT,
  "isRecurring" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "Availability_pkey" PRIMARY KEY ("id")
);

-- A weekly pattern or a particular day, never both and never neither. The
-- nullable columns are what buys one table instead of two, so the shape they
-- are allowed to take is worth spelling out rather than trusting to callers.
ALTER TABLE "Availability"
  ADD CONSTRAINT "Availability_weekly_or_dated"
  CHECK (num_nonnulls("dayOfWeek", "date") = 1);

-- A dentist's weekly shift opens the time.
INSERT INTO "Availability" (
  "id", "hospitalId", "staffId", "dayOfWeek", "startTime", "endTime", "isAvailable", "createdAt"
)
SELECT
  s."id", s."hospitalId", s."staffId", s."dayOfWeek", s."startTime", s."endTime", true, now()
FROM "StaffShift" s
WHERE s."isActive";

-- A clinic holiday closes the whole day for everybody.
INSERT INTO "Availability" (
  "id", "hospitalId", "staffId", "date", "isAvailable", "name", "isRecurring", "createdAt"
)
SELECT h."id", h."hospitalId", NULL, h."date", false, h."name", h."isRecurring", h."createdAt"
FROM "Holiday" h;

ALTER TABLE "Availability"
  ADD CONSTRAINT "Availability_hospitalId_fkey"
  FOREIGN KEY ("hospitalId") REFERENCES "Hospital"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Availability"
  ADD CONSTRAINT "Availability_staffId_fkey"
  FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "Availability_hospitalId_staffId_dayOfWeek_idx"
  ON "Availability"("hospitalId", "staffId", "dayOfWeek");
CREATE INDEX "Availability_hospitalId_date_idx" ON "Availability"("hospitalId", "date");
CREATE INDEX "Availability_hospitalId_isRecurring_idx"
  ON "Availability"("hospitalId", "isRecurring");

DROP TABLE "StaffShift";
DROP TABLE "Holiday";
