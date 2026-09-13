-- FR-007 clinical note locking: signature, addenda and amendment history.
--
-- Additive only (new nullable columns and two new tables), so this is taken
-- from `prisma migrate diff` unchanged — there is nothing for a generated DROP
-- to discard.
--
-- Existing treatments are left unsigned. Backfilling a signature would be
-- inventing an attestation nobody made: `signedAt` means a named clinician put
-- their name to the note, and a COMPLETED status is not that. Notes recorded
-- before this migration stay editable under the old workflow rule until
-- somebody signs them.

-- AlterTable
ALTER TABLE "Treatment" ADD COLUMN     "amendedAt" TIMESTAMP(3),
ADD COLUMN     "signedAt" TIMESTAMP(3),
ADD COLUMN     "signedById" TEXT;

-- CreateTable
CREATE TABLE "TreatmentAddendum" (
    "id" TEXT NOT NULL,
    "hospitalId" TEXT NOT NULL,
    "treatmentId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TreatmentAddendum_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TreatmentRevision" (
    "id" TEXT NOT NULL,
    "hospitalId" TEXT NOT NULL,
    "treatmentId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "changes" JSONB NOT NULL,
    "amendedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TreatmentRevision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TreatmentAddendum_hospitalId_idx" ON "TreatmentAddendum"("hospitalId");

-- CreateIndex
CREATE INDEX "TreatmentAddendum_treatmentId_idx" ON "TreatmentAddendum"("treatmentId");

-- CreateIndex
CREATE INDEX "TreatmentRevision_hospitalId_idx" ON "TreatmentRevision"("hospitalId");

-- CreateIndex
CREATE INDEX "TreatmentRevision_treatmentId_idx" ON "TreatmentRevision"("treatmentId");

-- CreateIndex
CREATE INDEX "Treatment_signedById_idx" ON "Treatment"("signedById");

-- AddForeignKey
ALTER TABLE "Treatment" ADD CONSTRAINT "Treatment_signedById_fkey" FOREIGN KEY ("signedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TreatmentAddendum" ADD CONSTRAINT "TreatmentAddendum_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "Hospital"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TreatmentAddendum" ADD CONSTRAINT "TreatmentAddendum_treatmentId_fkey" FOREIGN KEY ("treatmentId") REFERENCES "Treatment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TreatmentAddendum" ADD CONSTRAINT "TreatmentAddendum_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TreatmentRevision" ADD CONSTRAINT "TreatmentRevision_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "Hospital"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TreatmentRevision" ADD CONSTRAINT "TreatmentRevision_treatmentId_fkey" FOREIGN KEY ("treatmentId") REFERENCES "Treatment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TreatmentRevision" ADD CONSTRAINT "TreatmentRevision_amendedById_fkey" FOREIGN KEY ("amendedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

