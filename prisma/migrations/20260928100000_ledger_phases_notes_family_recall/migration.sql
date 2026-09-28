-- Five things a dental practice does that this schema had no column for:
-- who settles a bill, which stage of a plan an item belongs to, a clinical
-- note that is not a procedure, and whether anybody has actually rung the
-- people on the recall list.
--
-- The patient ledger and its ageing are not here, deliberately: a ledger is a
-- reading of the invoices, payments and refunds that already exist, and
-- storing a running balance beside them would be a second copy of the truth
-- that goes wrong the first time an invoice is voided. See lib/ledger.ts.

-- ============================================================
-- Who settles the bill
-- ============================================================
--
-- A self-reference rather than a household table. What a practice needs is one
-- statement addressed to one person, and that person is always another patient
-- of the clinic — the mother whose three children hold three records and one
-- balance.
--
-- SET NULL, not CASCADE: deleting the payer must never delete the people they
-- were paying for.
ALTER TABLE "Patient" ADD COLUMN "guarantorId" TEXT;

ALTER TABLE "Patient"
  ADD CONSTRAINT "Patient_guarantorId_fkey"
  FOREIGN KEY ("guarantorId") REFERENCES "Patient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- "Everyone this person pays for" is the statement query, and it is asked per
-- clinic.
CREATE INDEX "Patient_hospitalId_guarantorId_idx" ON "Patient"("hospitalId", "guarantorId");

-- Nobody may guarantee themselves. Without this the ledger's one-hop rollup
-- would count a patient's own balance twice, and the statement would address
-- itself.
ALTER TABLE "Patient"
  ADD CONSTRAINT "Patient_guarantor_not_self"
  CHECK ("guarantorId" IS NULL OR "guarantorId" <> "id");

-- ============================================================
-- Treatment plans in phases
-- ============================================================
--
-- `priority` already existed and orders items within a stage. It was doing
-- both jobs, so a plan could not say "these four things, then those three, and
-- here is what each stage costs" — which is how a plan is agreed and paid for.
ALTER TABLE "TreatmentPlanItem" ADD COLUMN "phase" INTEGER NOT NULL DEFAULT 1;

-- What each phase is called, as ["Urgent", "Restorative", "Elective"]. Display
-- text, edited together with the plan, so an array rather than a table.
ALTER TABLE "TreatmentPlan" ADD COLUMN "phaseNames" JSONB;

CREATE INDEX "TreatmentPlanItem_treatmentPlanId_phase_priority_idx"
  ON "TreatmentPlanItem"("treatmentPlanId", "phase", "priority");

-- ============================================================
-- The other half of the recall loop
-- ============================================================
--
-- Recare could find who was overdue and never recorded whether anybody had
-- been told. The desk could work the list twice in a week and send the same
-- patient the same message, and no report could say what proportion of the
-- list had been contacted — the number that decides whether recall works.
--
-- The messages themselves live in "MessageLog" with relatedType = 'Recare';
-- these two columns exist so the due list can be filtered and sorted on
-- contact without joining the log on every row.
ALTER TABLE "Recare" ADD COLUMN "lastContactedAt" TIMESTAMP(3);
ALTER TABLE "Recare" ADD COLUMN "contactAttempts" INTEGER NOT NULL DEFAULT 0;

-- ============================================================
-- Clinical notes that are not procedures
-- ============================================================
--
-- Every clinical fact hung off "Treatment", which is a procedure with a price.
-- A telephone call about post-operative pain, a consultation that ended in
-- "come back when the swelling is down", and treatment offered and refused all
-- had one place to go: "Appointment"."notes" — no author, no signature, no
-- amendment trail, editable by anyone who can edit the booking.
CREATE TYPE "ClinicalNoteKind" AS ENUM (
  'CONSULTATION',
  'PHONE_CALL',
  'FOLLOW_UP',
  'OBSERVATION',
  'DECLINED_TREATMENT',
  'OTHER'
);

CREATE TABLE "ClinicalNote" (
    "id" TEXT NOT NULL,
    "hospitalId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    -- Null for a call or a note made between appointments, which is most of
    -- why this table exists.
    "appointmentId" TEXT,
    "noteNo" TEXT NOT NULL,
    "kind" "ClinicalNoteKind" NOT NULL DEFAULT 'CONSULTATION',
    "summary" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "toothNumbers" TEXT,
    -- Not nullable. An unattributed clinical note is not a clinical note, and
    -- there is no historical data here to be charitable to.
    "authorId" TEXT NOT NULL,
    "signedById" TEXT,
    "signedAt" TIMESTAMP(3),
    "amendedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClinicalNote_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ClinicalNote_hospitalId_noteNo_key" ON "ClinicalNote"("hospitalId", "noteNo");
CREATE INDEX "ClinicalNote_hospitalId_patientId_createdAt_idx" ON "ClinicalNote"("hospitalId", "patientId", "createdAt" DESC);
CREATE INDEX "ClinicalNote_hospitalId_createdAt_idx" ON "ClinicalNote"("hospitalId", "createdAt" DESC);
CREATE INDEX "ClinicalNote_appointmentId_idx" ON "ClinicalNote"("appointmentId");
CREATE INDEX "ClinicalNote_authorId_idx" ON "ClinicalNote"("authorId");

ALTER TABLE "ClinicalNote"
  ADD CONSTRAINT "ClinicalNote_hospitalId_fkey"
  FOREIGN KEY ("hospitalId") REFERENCES "Hospital"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ClinicalNote"
  ADD CONSTRAINT "ClinicalNote_patientId_fkey"
  FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- SET NULL: deleting a booking must not delete the clinical record made at it.
ALTER TABLE "ClinicalNote"
  ADD CONSTRAINT "ClinicalNote_appointmentId_fkey"
  FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- RESTRICT on both authors, which is the default: a user who has written or
-- signed a clinical note cannot be deleted out from under it.
ALTER TABLE "ClinicalNote"
  ADD CONSTRAINT "ClinicalNote_authorId_fkey"
  FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ClinicalNote"
  ADD CONSTRAINT "ClinicalNote_signedById_fkey"
  FOREIGN KEY ("signedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- The append-only trail. A separate table from "TreatmentAmendment" rather
-- than one polymorphic table: a foreign key that points at one of two parents
-- depending on a discriminator cannot be enforced by the database, and this
-- trail is what the whole signing model rests on.
CREATE TABLE "ClinicalNoteAmendment" (
    "id" TEXT NOT NULL,
    "hospitalId" TEXT NOT NULL,
    "noteId" TEXT NOT NULL,
    "kind" "AmendmentKind" NOT NULL,
    "body" TEXT NOT NULL,
    "changes" JSONB,
    "authorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClinicalNoteAmendment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ClinicalNoteAmendment_hospitalId_idx" ON "ClinicalNoteAmendment"("hospitalId");
CREATE INDEX "ClinicalNoteAmendment_noteId_idx" ON "ClinicalNoteAmendment"("noteId");
CREATE INDEX "ClinicalNoteAmendment_kind_idx" ON "ClinicalNoteAmendment"("kind");

ALTER TABLE "ClinicalNoteAmendment"
  ADD CONSTRAINT "ClinicalNoteAmendment_hospitalId_fkey"
  FOREIGN KEY ("hospitalId") REFERENCES "Hospital"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ClinicalNoteAmendment"
  ADD CONSTRAINT "ClinicalNoteAmendment_noteId_fkey"
  FOREIGN KEY ("noteId") REFERENCES "ClinicalNote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ClinicalNoteAmendment"
  ADD CONSTRAINT "ClinicalNoteAmendment_authorId_fkey"
  FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
