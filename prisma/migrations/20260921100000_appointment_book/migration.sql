-- The appointment book: tokens instead of chairs, and visitors instead of
-- half-entered patients.
--
-- Three changes, one migration, because they are one decision.
--
-- 1. CHAIRS GO. The clinic does not run on chairs; it runs on a token queue.
--    Double-booking is now checked on the dentist alone, which is what it was
--    actually catching anyway — a chair clash can only occur where a dentist
--    clash already has.
--
-- 2. TOKENS ARRIVE, AT CHECK-IN. DDMMYY then a three-digit sequence, so
--    200926001 is the first arrival on 20 September 2026. Issued when the
--    patient turns up, not when they book: a number handed out weeks ahead
--    says nothing about who is in the waiting room, and the queue a clinic
--    actually runs is arrival order.
--
-- 3. A VISITOR IS NOT A PATIENT. An appointment may belong to either, and
--    exactly one of the two. Insisting on a patient record before anyone can
--    be seen is how a register fills up with people who came once and left a
--    name, a guessed date of birth and nothing else.

-- ---------------------------------------------------------------------------
-- 1. Chairs
-- ---------------------------------------------------------------------------

-- The FK first, so dropping the table cannot be blocked by it.
ALTER TABLE "Appointment" DROP CONSTRAINT IF EXISTS "Appointment_chairId_fkey";
DROP INDEX IF EXISTS "Appointment_chairId_startsAt_idx";
ALTER TABLE "Appointment" DROP COLUMN IF EXISTS "chairId";
DROP TABLE IF EXISTS "Chair";

-- ---------------------------------------------------------------------------
-- 2. Tokens
-- ---------------------------------------------------------------------------

ALTER TABLE "Appointment" ADD COLUMN "tokenNumber" TEXT;
ALTER TABLE "Appointment" ADD COLUMN "tokenIssuedAt" TIMESTAMP(3);

-- Unique per clinic, not globally: two clinics both issue 200926001 on the
-- same morning and neither is wrong.
CREATE UNIQUE INDEX "Appointment_hospitalId_tokenNumber_key"
  ON "Appointment"("hospitalId", "tokenNumber");

-- Appointments already checked in when this ran have no token and will not get
-- one retrospectively. A number invented now would imply an arrival order that
-- nobody recorded.

-- ---------------------------------------------------------------------------
-- 3. Visitors
-- ---------------------------------------------------------------------------

CREATE TABLE "Visitor" (
  "id"                 TEXT NOT NULL,
  "hospitalId"         TEXT NOT NULL,
  "name"               TEXT NOT NULL,
  "phone"              TEXT,
  "notes"              TEXT,
  "convertedPatientId" TEXT,
  "convertedAt"        TIMESTAMP(3),
  "convertedById"      TEXT,
  "discardedAt"        TIMESTAMP(3),
  "discardedById"      TEXT,
  "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"          TIMESTAMP(3) NOT NULL,

  CONSTRAINT "Visitor_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Visitor_hospitalId_createdAt_idx" ON "Visitor"("hospitalId", "createdAt" DESC);
CREATE INDEX "Visitor_hospitalId_phone_idx" ON "Visitor"("hospitalId", "phone");
CREATE INDEX "Visitor_hospitalId_discardedAt_convertedAt_idx"
  ON "Visitor"("hospitalId", "discardedAt", "convertedAt");

ALTER TABLE "Visitor" ADD CONSTRAINT "Visitor_hospitalId_fkey"
  FOREIGN KEY ("hospitalId") REFERENCES "Hospital"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Visitor" ADD CONSTRAINT "Visitor_convertedPatientId_fkey"
  FOREIGN KEY ("convertedPatientId") REFERENCES "Patient"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Visitor" ADD CONSTRAINT "Visitor_convertedById_fkey"
  FOREIGN KEY ("convertedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Visitor" ADD CONSTRAINT "Visitor_discardedById_fkey"
  FOREIGN KEY ("discardedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- An appointment belongs to a patient or to a visitor.
ALTER TABLE "Appointment" ADD COLUMN "visitorId" TEXT;
ALTER TABLE "Appointment" ALTER COLUMN "patientId" DROP NOT NULL;

-- RESTRICT, not SET NULL. Nulling the visitor would leave an appointment
-- belonging to neither a patient nor a visitor, which the CHECK below forbids —
-- so a SET NULL here would turn "delete this visitor" into a constraint
-- violation nobody could read. A visitor with appointments is discarded, not
-- deleted; that is what `discardedAt` is for.
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_visitorId_fkey"
  FOREIGN KEY ("visitorId") REFERENCES "Visitor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "Appointment_hospitalId_visitorId_idx" ON "Appointment"("hospitalId", "visitorId");

-- Exactly one. Not "at least one": an appointment against both a patient and a
-- visitor is two people as far as every report is concerned, and nothing in the
-- application would notice which it had picked.
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_one_subject"
  CHECK (num_nonnulls("patientId", "visitorId") = 1);
