-- A patient's read-only sign-in to the portal.
--
-- Clinic-issued, never self-registered. The desk decides which record an
-- account belongs to, which is what makes the portal tractable at all: the
-- alternative — proving identity from a phone number — cannot tell a mother
-- from her two children, who share one number and hold one record each.
--
-- Its own table rather than columns on "Patient", because a patient record is a
-- clinical fact and an account is an access decision. Withdrawing access must
-- not touch the record, and most patients will never hold an account.
CREATE TABLE "PatientPortalAccount" (
    "id" TEXT NOT NULL,
    "hospitalId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" TIMESTAMP(3),
    "failedAttempts" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PatientPortalAccount_pkey" PRIMARY KEY ("id")
);

-- One account per patient record. There is no username column: sign-in is the
-- clinic's own patient number, which is already unique per clinic and already
-- printed on the patient's receipts.
CREATE UNIQUE INDEX "PatientPortalAccount_patientId_key" ON "PatientPortalAccount"("patientId");

CREATE INDEX "PatientPortalAccount_hospitalId_idx" ON "PatientPortalAccount"("hospitalId");

-- CASCADE on both: an account is meaningless without the record it opens, and
-- without the clinic that issued it.
ALTER TABLE "PatientPortalAccount"
  ADD CONSTRAINT "PatientPortalAccount_hospitalId_fkey"
  FOREIGN KEY ("hospitalId") REFERENCES "Hospital"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PatientPortalAccount"
  ADD CONSTRAINT "PatientPortalAccount_patientId_fkey"
  FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;
